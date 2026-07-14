/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { addDisposableListener, EventType, isHTMLElement, ModifierKeyEmitter } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { MembraneVscodeUiSessions, ScreenAnchor } from '../../../../base/browser/membrane/membraneVscodeUi.js';
import { filterActions } from '../../../../base/browser/membrane/membraneVscodeUiPolicy.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ContextMenuMenuDelegate } from '../../../../platform/contextview/browser/contextMenuService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';

interface MenuLayout {
	x: number;
	y: number;
	width: number;
	height: number;
}

export class MembraneContextMenuService extends Disposable implements IContextMenuService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidShowContextMenu = this._register(new Emitter<void>());
	readonly onDidShowContextMenu = this._onDidShowContextMenu.event;

	private readonly _onDidHideContextMenu = this._register(new Emitter<void>());
	readonly onDidHideContextMenu = this._onDidHideContextMenu.event;

	private activeMenuId: string | undefined;
	private activeDelegate: IContextMenuDelegate | undefined;
	private menuOpenedAt: number = 0;
	private menuLayout: MenuLayout | undefined;
	private dismissListenerGeneration: number = 0;
	private readonly menuDismissListeners = this._register(new DisposableStore());

	constructor(
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
	}

	configure(_options: unknown): void {
		// no-op
	}

	showContextMenu(delegate: IContextMenuDelegate): void {
		this.dismissActiveMenu();

		delegate = ContextMenuMenuDelegate.transform(delegate, this.menuService, this.contextKeyService);

		const actions = delegate.getActions();
		const { items, live } = filterActions(actions, {
			getKeyBinding: (action) => delegate.getKeyBinding?.(action) ?? this.keybindingService.lookupKeybinding(action.id),
		});

		if (items.length === 0) {
			return;
		}

		const menuId = generateUuid();
		const anchor = this.getScreenAnchor(delegate);
		const context = delegate.getActionsContext?.();

		MembraneVscodeUiSessions.register(menuId, 'menu', {
			onSelect: () => {
				this.finishMenu(menuId, false);
			},
			onDismiss: (didCancel) => {
				this.finishMenu(menuId, didCancel);
			},
			onLayout: (data) => {
				if (this.activeMenuId !== menuId) {
					return;
				}
				const x = data.x as number | undefined;
				const y = data.y as number | undefined;
				const width = data.width as number | undefined;
				const height = data.height as number | undefined;
				if (typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number') {
					this.menuLayout = { x, y, width, height };
				}
			},
		}, { liveActions: live, context });

		this.activeMenuId = menuId;
		this.activeDelegate = delegate;
		this.menuOpenedAt = Date.now();
		this.menuLayout = undefined;

		MembraneVscodeUiSessions.send({
			id: menuId,
			lifecycle: 'show',
			kind: 'menu',
			anchor,
			payload: { items },
		});

		this.installDismissListeners();

		ModifierKeyEmitter.getInstance().resetKeyStatus();
		this._onDidShowContextMenu.fire();
	}

	private installDismissListeners(): void {
		this.menuDismissListeners.clear();
		const generation = ++this.dismissListenerGeneration;

		// Defer past the contextmenu/mousedown event that opened the menu.
		mainWindow.setTimeout(() => {
			if (generation !== this.dismissListenerGeneration || !this.activeMenuId) {
				return;
			}
			this.attachDismissListeners(generation);
		}, 0);
	}

	private attachDismissListeners(generation: number): void {
		this.menuDismissListeners.add(addDisposableListener(mainWindow, EventType.MOUSE_DOWN, (e) => {
			if (generation !== this.dismissListenerGeneration || !this.activeMenuId) {
				return;
			}
			if (this.shouldIgnoreDismissMouseEvent(e)) {
				return;
			}
			if (this.isEventOverMenu(e)) {
				return;
			}
			// Clicks that reach gaze (menu items, sidebar, etc.) are not in the workbench DOM.
			if (!this.isEventInWorkbench(e)) {
				return;
			}
			this.dismissActiveMenu();
		}, true));

		this.menuDismissListeners.add(addDisposableListener(mainWindow, EventType.KEY_DOWN, (e) => {
			if (generation !== this.dismissListenerGeneration || !this.activeMenuId) {
				return;
			}
			if (e.key === 'Escape') {
				this.dismissActiveMenu();
			}
		}));
	}

	private shouldIgnoreDismissMouseEvent(e: MouseEvent): boolean {
		if (e.defaultPrevented) {
			return true;
		}

		const event = new StandardMouseEvent(mainWindow, e);
		if (event.rightButton || (event.buttons & 2) !== 0) {
			return true;
		}
		if (isMacintosh && event.ctrlKey && event.leftButton) {
			return true;
		}
		if (Date.now() - this.menuOpenedAt < 400) {
			return true;
		}
		return false;
	}

	private isEventOverMenu(e: MouseEvent): boolean {
		const layout = this.menuLayout;
		if (!layout || layout.width <= 1 || layout.height <= 1) {
			return false;
		}
		return (
			e.clientX >= layout.x
			&& e.clientX <= layout.x + layout.width
			&& e.clientY >= layout.y
			&& e.clientY <= layout.y + layout.height
		);
	}

	private isEventInWorkbench(e: MouseEvent): boolean {
		const target = e.target;
		if (!(target instanceof Element)) {
			return false;
		}
		return !!target.closest('.monaco-workbench');
	}

	private dismissActiveMenu(): void {
		if (this.activeMenuId) {
			this.finishMenu(this.activeMenuId, true);
		}
	}

	private finishMenu(menuId: string, didCancel: boolean): void {
		if (this.activeMenuId !== menuId) {
			return;
		}

		this.dismissListenerGeneration++;
		this.menuDismissListeners.clear();

		const delegate = this.activeDelegate;
		this.activeDelegate = undefined;
		this.activeMenuId = undefined;
		this.menuOpenedAt = 0;
		this.menuLayout = undefined;

		MembraneVscodeUiSessions.unregister(menuId);

		delegate?.onHide?.(didCancel);
		this._onDidHideContextMenu.fire();
	}

	private getScreenAnchor(delegate: IContextMenuDelegate): ScreenAnchor {
		const anchor = delegate.getAnchor();
		if (anchor instanceof StandardMouseEvent) {
			return { type: 'screen', x: anchor.posx, y: anchor.posy };
		}
		if (isHTMLElement(anchor)) {
			const rect = anchor.getBoundingClientRect();
			return { type: 'screen', x: rect.left, y: rect.top, width: rect.width, height: rect.height };
		}
		const x = (anchor as { x?: number }).x ?? 0;
		const y = (anchor as { y?: number }).y ?? 0;
		return { type: 'screen', x, y };
	}
}
