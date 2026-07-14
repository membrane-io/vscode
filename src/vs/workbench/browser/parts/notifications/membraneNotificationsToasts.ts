/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationsModel, NotificationChangeType, INotificationChangeEvent, INotificationViewItem } from '../../../common/notifications.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { INotificationsToastController } from './notificationsCommands.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { NotificationsFilter, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { IntervalCounter } from '../../../../base/common/async.js';
import { NotificationsToastsVisibleContext } from '../../../common/contextkeys.js';
import { IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { MembraneVscodeUiSessions, ToastPayload } from '../../../../base/browser/membrane/membraneVscodeUi.js';

export class MembraneNotificationsToasts extends Disposable implements INotificationsToastController {

	private static readonly MAX_NOTIFICATIONS = 3;
	private static readonly SPAM_PROTECTION = {
		interval: 800,
		limit: this.MAX_NOTIFICATIONS
	};

	private readonly _onDidChangeVisibility = this._register(new Emitter<void>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private _isVisible = false;
	get isVisible(): boolean { return this._isVisible; }

	private isNotificationsCenterVisible: boolean | undefined;
	private readonly addedToastsIntervalCounter = new IntervalCounter(MembraneNotificationsToasts.SPAM_PROTECTION.interval);
	private readonly notificationsToastsVisibleContextKey: IContextKey<boolean>;

	private readonly activeNotifications = new Map<string, INotificationViewItem>();
	private readonly disposables = this._register(new DisposableStore());

	constructor(
		private readonly model: INotificationsModel,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();
		this.notificationsToastsVisibleContextKey = NotificationsToastsVisibleContext.bindTo(contextKeyService);
		this.registerListeners();
	}

	private registerListeners(): void {
		this.lifecycleService.when(LifecyclePhase.Restored).then(() => {
			this.model.notifications.forEach(notification => this.addToast(notification));
			this.disposables.add(this.model.onDidChangeNotification(e => this.onDidChangeNotification(e)));
		});

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
			return;
		}

		if (item.priority === NotificationPriority.SILENT) {
			return;
		}

		if (this.shouldFilterNotification(item)) {
			return;
		}

		if (this.addedToastsIntervalCounter.increment() > MembraneNotificationsToasts.SPAM_PROTECTION.limit) {
			return;
		}

		if (!item.id) {
			(item as { id?: string }).id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		}

		const notificationId = item.id!;

		this.forwardNotificationToGaze(item);

		this.activeNotifications.set(notificationId, item);

		if (!this._isVisible) {
			this._isVisible = true;
			this.notificationsToastsVisibleContextKey.set(true);
			this._onDidChangeVisibility.fire();
		}

		item.updateVisibility(true);

		Event.once(item.onDidClose)(() => {
			this.removeToast(item);
		});
	}

	private forwardNotificationToGaze(item: INotificationViewItem): void {
		const notificationId = item.id!;

		const payload: ToastPayload = {
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

		MembraneVscodeUiSessions.register(notificationId, 'toast', {
			onSelect: (actionId) => {
				const action = item.actions?.primary?.find(a => a.id === actionId);
				action?.run();
				// Gaze keeps rendering the toast until we hide it; running an action closes it.
				item.close();
			},
			onDismiss: () => {
				item.close();
			},
		});

		MembraneVscodeUiSessions.send({
			id: notificationId,
			lifecycle: 'show',
			kind: 'toast',
			payload,
		});
	}

	private severityToString(severity: Severity): ToastPayload['severity'] {
		switch (severity) {
			case Severity.Info: return 'info';
			case Severity.Warning: return 'warning';
			case Severity.Error: return 'error';
			default: return 'info';
		}
	}

	private shouldFilterNotification(item: INotificationViewItem): boolean {
		const message = item.message.raw.toLowerCase();
		if (message.includes('activating extension')) {
			return true;
		}
		return false;
	}

	private removeToast(item: INotificationViewItem): void {
		if (item.id) {
			this.activeNotifications.delete(item.id);
			MembraneVscodeUiSessions.unregister(item.id);
		}

		if (this.activeNotifications.size === 0) {
			this._isVisible = false;
			this.notificationsToastsVisibleContextKey.set(false);
			this._onDidChangeVisibility.fire();
		}

		item.updateVisibility(false);
	}

	hide(): void {
		for (const [, item] of this.activeNotifications) {
			this.removeToast(item);
		}
	}

	// Gaze toasts have no keyboard focus support; returning false lets callers
	// fall back (e.g. to the notifications center).
	focus(): boolean {
		return false;
	}

	focusNext(): boolean {
		return false;
	}

	focusPrevious(): boolean {
		return false;
	}

	focusFirst(): boolean {
		return false;
	}

	focusLast(): boolean {
		return false;
	}

	update(isCenterVisible: boolean): void {
		if (this.isNotificationsCenterVisible !== isCenterVisible) {
			this.isNotificationsCenterVisible = isCenterVisible;
			if (this.isNotificationsCenterVisible) {
				this.hide();
			}
		}
	}

	layout(_dimension: Dimension | undefined): void {
		// no-op
	}

	override dispose(): void {
		this.disposables.dispose();
		super.dispose();
	}
}
