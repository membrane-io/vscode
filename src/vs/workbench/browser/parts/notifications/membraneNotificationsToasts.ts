/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationsModel, NotificationChangeType, INotificationChangeEvent, INotificationViewItem } from 'vs/workbench/common/notifications';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Dimension } from 'vs/base/browser/dom';
import { INotificationsToastController } from 'vs/workbench/browser/parts/notifications/notificationsCommands';
import { Event, Emitter } from 'vs/base/common/event';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { NotificationsFilter, NotificationPriority, Severity } from 'vs/platform/notification/common/notification';
import { IntervalCounter } from 'vs/base/common/async';
import { NotificationsToastsVisibleContext } from 'vs/workbench/common/contextkeys';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { MembranePortManager } from 'vs/base/browser/ui/dialog/membranePortManager';

export class MembraneNotificationsToasts implements INotificationsToastController {

	private static readonly MAX_NOTIFICATIONS = 3;
	private static readonly SPAM_PROTECTION = {
		interval: 800,
		limit: MembraneNotificationsToasts.MAX_NOTIFICATIONS
	};

	private readonly _onDidChangeVisibility = new Emitter<void>();
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private _isVisible = false;
	get isVisible(): boolean { return this._isVisible; }

	private isNotificationsCenterVisible: boolean | undefined;
	private readonly addedToastsIntervalCounter = new IntervalCounter(MembraneNotificationsToasts.SPAM_PROTECTION.interval);
	private readonly notificationsToastsVisibleContextKey: IContextKey<boolean>;

	private readonly activeNotifications = new Map<string, INotificationViewItem>();
	private readonly disposables = new DisposableStore();

	constructor(
		private readonly model: INotificationsModel,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		this.notificationsToastsVisibleContextKey = NotificationsToastsVisibleContext.bindTo(contextKeyService);
		this.registerListeners();

		// Register this instance as the notification response handler
		MembranePortManager.setNotificationResponseHandler((response: any) => {
			this.handleNotificationAction(response);
		});
	}

	private registerListeners(): void {
		this.lifecycleService.when(LifecyclePhase.Restored).then(() => {
			// Show toast for initial notifications if any
			this.model.notifications.forEach(notification => this.addToast(notification));

			// Update toasts on notification changes
			this.disposables.add(this.model.onDidChangeNotification(e => this.onDidChangeNotification(e)));
		});

		// Filter handling
		this.disposables.add(this.model.onDidChangeFilter(({ global, sources }) => {
			if (global === NotificationsFilter.ERROR) {
				this.hide();
			} else if (sources) {
				for (const [, notification] of this.activeNotifications) {
					if (typeof notification.sourceId === 'string' && sources.get(notification.sourceId) === NotificationsFilter.ERROR && notification.severity !== Severity.Error && notification.priority !== NotificationPriority.URGENT) {
						this.removeToast(notification);
					}
				}
			}
		}));
	}

	private onDidChangeNotification(e: INotificationChangeEvent): void {
		switch (e.kind) {
			case NotificationChangeType.ADD:
				return this.addToast(e.item);
			case NotificationChangeType.REMOVE:
				return this.removeToast(e.item);
		}
	}

	private addToast(item: INotificationViewItem): void {
		if (this.isNotificationsCenterVisible) {
			return; // do not show toasts while notification center is visible
		}

		if (item.priority === NotificationPriority.SILENT) {
			return; // do not show toasts for silenced notifications
		}

		// Filter out unwanted notifications
		if (this.shouldFilterNotification(item)) {
			return;
		}

		// Spam protection - same as original
		if (this.addedToastsIntervalCounter.increment() > MembraneNotificationsToasts.SPAM_PROTECTION.limit) {
			return;
		}

		// Generate a unique ID if none exists and store it on the item
		if (!item.id) {
			(item as any).id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		}

		// At this point we know item.id exists
		const notificationId = item.id!;

		// Forward notification to Gaze instead of creating DOM toast
		this.forwardNotificationToGaze(item);

		// Track the notification using the guaranteed ID
		this.activeNotifications.set(notificationId, item);

		// Update visibility state
		if (!this._isVisible) {
			this._isVisible = true;
			this.notificationsToastsVisibleContextKey.set(true);
			this._onDidChangeVisibility.fire();
		}

		// Mark as visible in the item
		item.updateVisibility(true);

		// Handle item close event
		Event.once(item.onDidClose)(() => {
			this.removeToast(item);
		});
	}

	private forwardNotificationToGaze(item: INotificationViewItem): void {
		const notificationId = item.id!;

		const notificationData = {
			id: notificationId,
			severity: this.severityToString(item.severity),
			message: item.message.raw,
			source: item.source,
			sticky: item.sticky,
			timestamp: Date.now(),
			actions: item.actions?.primary?.map(action => ({
				id: action.id,
				label: action.label,
				enabled: action.enabled
			})) || []
		};

		// Send notification via MembranePortManager

		MembranePortManager.sendMessage('membraneNotification', {
			type: 'toast',
			id: `notification-${notificationId}`,
			notification: notificationData
		});
	}

	private severityToString(severity: Severity): string {
		switch (severity) {
			case Severity.Info: return 'info';
			case Severity.Warning: return 'warning';
			case Severity.Error: return 'error';
			default: return 'info';
		}
	}

	private shouldFilterNotification(item: INotificationViewItem): boolean {
		const message = item.message.raw.toLowerCase();

		// Filter out extension activation notifications
		if (message.includes('activating extension')) {
			return true;
		}

		return false;
	}

	private removeToast(item: INotificationViewItem): void {
		// Remove from tracking
		if (item.id) {
			this.activeNotifications.delete(item.id);

			// Notify Gaze to hide the notification via MembranePortManager
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'hide',
				id: `notification-${item.id}`
			});
		}

		// Update visibility if no more notifications
		if (this.activeNotifications.size === 0) {
			this._isVisible = false;
			this.notificationsToastsVisibleContextKey.set(false);
			this._onDidChangeVisibility.fire();
		}

		// Mark as not visible in the item
		item.updateVisibility(false);
	}

	// Required interface methods
	hide(): void {
		// Hide all active notifications
		for (const [, item] of this.activeNotifications) {
			this.removeToast(item);
		}
	}

	focus(): boolean {
		// For keyboard navigation send focus request to Gaze via MembranePortManager
		if (this.activeNotifications.size > 0) {
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'focus',
				target: 'first'
			});
			return true;
		}
		return false;
	}

	focusNext(): boolean {
		if (this.activeNotifications.size > 0) {
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'focus',
				target: 'next'
			});
			return true;
		}
		return false;
	}

	focusPrevious(): boolean {
		if (this.activeNotifications.size > 0) {
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'focus',
				target: 'previous'
			});
			return true;
		}
		return false;
	}

	focusFirst(): boolean {
		if (this.activeNotifications.size > 0) {
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'focus',
				target: 'first'
			});
			return true;
		}
		return false;
	}

	focusLast(): boolean {
		if (this.activeNotifications.size > 0) {
			MembranePortManager.sendMessage('membraneNotification', {
				type: 'focus',
				target: 'last'
			});
			return true;
		}
		return false;
	}

	update(isCenterVisible: boolean): void {
		if (this.isNotificationsCenterVisible !== isCenterVisible) {
			this.isNotificationsCenterVisible = isCenterVisible;

			// Hide all toasts when the notification center gets visible
			if (this.isNotificationsCenterVisible) {
				this.hide();
			}
		}
	}

	layout(_dimension: Dimension | undefined): void {
		// No-op for Membrane - Gaze handles its own layout
	}

	private handleNotificationAction(response: any): void {
		if (!response || !response.notificationId) {
			return;
		}

		const notificationId = response.notificationId;
		const actionId = response.actionId;
		const dismissed = response.dismissed;

		// Find the notification by ID
		for (const [, item] of this.activeNotifications) {
			if (item.id === notificationId) {
				if (dismissed) {
					// User dismissed the notification
					item.close();
				} else if (actionId && item.actions?.primary) {
					// User clicked an action
					const action = item.actions.primary.find(a => a.id === actionId);
					if (action) {
						// Execute the action
						action.run();
					}
				}
				break;
			}
		}
	}

	dispose(): void {
		this.disposables.dispose();
		this._onDidChangeVisibility.dispose();
	}
}
