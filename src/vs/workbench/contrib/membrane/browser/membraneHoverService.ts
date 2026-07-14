/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { MembraneVscodeUiSessions, ScreenAnchor } from '../../../../base/browser/membrane/membraneVscodeUi.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { timeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IHoverLifecycleOptions, IHoverOptions, IHoverWidget } from '../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { HoverService } from '../../../../platform/hover/browser/hoverService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';

class MembraneHoverWidget extends Disposable implements IHoverWidget {
	private _isDisposed = false;

	constructor(
		private readonly hoverId: string,
		private readonly onDidDispose: (hoverId: string) => void,
	) {
		super();
	}

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	override dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this.onDidDispose(this.hoverId);
		super.dispose();
	}
}

export class MembraneHoverService extends HoverService {

	private activeHoverId: string | undefined;
	private activeHoverWidget: MembraneHoverWidget | undefined;
	private activeHoverListeners: DisposableStore | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService private readonly membraneConfigurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILayoutService layoutService: ILayoutService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super(instantiationService, membraneConfigurationService, contextMenuService, keybindingService, layoutService, accessibilityService);
	}

	override showInstantHover(options: IHoverOptions, focus?: boolean, skipLastFocusedUpdate?: boolean, dontShow?: boolean): IHoverWidget | undefined {
		if (dontShow) {
			return undefined;
		}
		if (this.shouldStayNative(options)) {
			return super.showInstantHover(this.toNativeOptions(options), focus, skipLastFocusedUpdate, dontShow);
		}
		return this.showBridgedHover(options);
	}

	override showDelayedHover(
		options: IHoverOptions,
		lifecycleOptions: Pick<IHoverLifecycleOptions, 'groupId'>,
	): IHoverWidget | undefined {
		if (this.shouldStayNative(options)) {
			return super.showDelayedHover(this.toNativeOptions(options), lifecycleOptions);
		}

		const delay = this.membraneConfigurationService.getValue<number>('workbench.hover.delay');
		const hoverId = generateUuid();
		const widget = new MembraneHoverWidget(hoverId, id => this.hideHoverById(id));

		timeout(delay).then(() => {
			if (!widget.isDisposed) {
				this.showBridgedHover(options, hoverId, widget);
			}
		});

		return widget;
	}

	/**
	 * Tooltips anchored inside natively-kept editor widgets (find/replace) use the stock
	 * hover service: they're dense clusters of small controls where the native hover's
	 * mouse tracking gives much smoother behavior than the bridged round-trip, and the
	 * native widget is themed to match gaze via the editorHoverWidget.* tokens.
	 */
	private shouldStayNative(options: IHoverOptions): boolean {
		const target = options.target;
		const element = isHTMLElement(target) ? target : target.targetElements[0];
		return !!element?.closest('.find-widget');
	}

	/**
	 * The native hover defaults to ABOVE and checks available room against the full
	 * window, but only the editor cutout is actually visible and the find widget hugs
	 * its top edge, so ABOVE passes the window check and then gets clamped by the
	 * context view into the widget itself. Force BELOW, where there's always room.
	 */
	private toNativeOptions(options: IHoverOptions): IHoverOptions {
		return {
			...options,
			position: {
				...options.position,
				hoverPosition: HoverPosition.BELOW,
			},
		};
	}

	override hideHover(force?: boolean): void {
		if (this.activeHoverId) {
			this.hideHoverById(this.activeHoverId);
		}
		super.hideHover(force);
	}

	private hideHoverById(hoverId: string): void {
		MembraneVscodeUiSessions.unregister(hoverId);
		if (this.activeHoverId === hoverId) {
			this.activeHoverId = undefined;
			this.clearActiveHoverListeners();
			// Mark the widget disposed so ManagedHover knows the hover is gone and
			// will show it again on the next mouse-over of the same target.
			this.activeHoverWidget?.dispose();
			this.activeHoverWidget = undefined;
		}
	}

	private clearActiveHoverListeners(): void {
		this.activeHoverListeners?.dispose();
		this.activeHoverListeners = undefined;
	}

	private showBridgedHover(options: IHoverOptions, existingId?: string, existingWidget?: MembraneHoverWidget): IHoverWidget | undefined {
		const content = this.serializeContent(options.content);
		if (!content) {
			return undefined;
		}

		if (this.activeHoverId && this.activeHoverId !== existingId) {
			this.hideHover();
		}

		const hoverId = existingId ?? generateUuid();
		this.activeHoverId = hoverId;

		const anchor = this.getScreenAnchor(options);

		MembraneVscodeUiSessions.register(hoverId, 'hover', {
			onDismiss: () => this.hideHoverById(hoverId),
		});

		MembraneVscodeUiSessions.send({
			id: hoverId,
			lifecycle: 'show',
			kind: 'hover',
			anchor,
			payload: {
				parts: [{ type: 'markdown', contents: [{ value: content }] }],
			},
		});

		this.installHideListeners(hoverId, options);

		const widget = existingWidget ?? new MembraneHoverWidget(hoverId, id => this.hideHoverById(id));
		this.activeHoverWidget = widget;
		return widget;
	}

	/**
	 * The native hover service hides its widget via listeners it installs on the target
	 * element when the hover is created (mouse leave, click, IntersectionObserver, keydown).
	 * The bridged path skips native hover creation entirely, so mirror those hide triggers
	 * here; without them the gaze tooltip lingers after the pointer leaves the target or
	 * after the target slides out of view (e.g. the find widget hiding).
	 */
	private installHideListeners(hoverId: string, options: IHoverOptions): void {
		this.clearActiveHoverListeners();

		const targets = isHTMLElement(options.target) ? [options.target] : options.target.targetElements;
		if (targets.length === 0) {
			return;
		}

		const store = new DisposableStore();
		const hide = () => this.hideHoverById(hoverId);

		for (const element of targets) {
			store.add(addDisposableListener(element, EventType.MOUSE_LEAVE, hide));
			store.add(addDisposableListener(element, EventType.CLICK, hide));
		}

		// Covers the target sliding/scrolling out of view or being removed from the DOM.
		// IntersectionObserver accounts for ancestor clipping, so the find widget
		// translating out of the editor's overflow guard triggers this.
		if (mainWindow.IntersectionObserver) {
			const observer = new mainWindow.IntersectionObserver(entries => {
				const entry = entries[entries.length - 1];
				if (!entry.isIntersecting) {
					hide();
				}
			}, { threshold: 0 });
			observer.observe(targets[0]);
			store.add(toDisposable(() => observer.disconnect()));
		}

		store.add(addDisposableListener(mainWindow.document, EventType.KEY_DOWN, hide));

		this.activeHoverListeners = store;
	}

	private serializeContent(content: string | HTMLElement | IMarkdownString | undefined): string | undefined {
		if (!content) {
			return undefined;
		}
		if (typeof content === 'string') {
			return content;
		}
		if (isHTMLElement(content)) {
			return content.textContent ?? undefined;
		}
		return content.value;
	}

	private getScreenAnchor(options: IHoverOptions): ScreenAnchor {
		const target = options.target;
		if (isHTMLElement(target)) {
			const rect = target.getBoundingClientRect();
			return { type: 'screen', x: rect.left, y: rect.bottom, width: rect.width, height: rect.height };
		}
		if (target.targetElements.length > 0) {
			const rect = target.targetElements[0].getBoundingClientRect();
			const x = target.x ?? rect.left;
			const y = target.y ?? rect.bottom;
			return { type: 'screen', x, y, width: rect.width, height: rect.height };
		}
		return { type: 'screen', x: 0, y: 0 };
	}
}
