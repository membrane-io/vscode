/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IAnchor, isAnchor } from '../../../../base/browser/ui/contextview/contextview.js';
import { IAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
	ActionWidgetFooterActionPayload,
	ActionWidgetItemPayload,
	ActionWidgetPayload,
	MembraneVscodeUiSessions,
	ScreenAnchor,
} from '../../../../base/browser/membrane/membraneVscodeUi.js';
import { IListAccessibilityProvider } from '../../../../base/browser/ui/list/listWidget.js';
import {
	ActionListItemKind,
	IActionListDelegate,
	IActionListItem,
} from '../../../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

const ActionWidgetVisible = new RawContextKey<boolean>('codeActionMenuVisible', false);

interface ActiveSession {
	id: string;
	user: string;
	supportsPreview: boolean;
	items: readonly IActionListItem<unknown>[];
	delegate: IActionListDelegate<unknown>;
	liveItems: Map<string, unknown>;
	footerActions: Map<string, IAction>;
	footerPayload: ActionWidgetFooterActionPayload[] | undefined;
	focusableIndices: number[];
	focusedIndex: number;
	editorContainer?: HTMLElement;
}

function getScreenAnchor(anchor: HTMLElement | StandardMouseEvent | IAnchor): ScreenAnchor {
	if (isAnchor(anchor)) {
		return {
			type: 'screen',
			x: anchor.x,
			y: anchor.y,
			width: anchor.width,
			height: anchor.height,
		};
	}

	if (anchor instanceof StandardMouseEvent) {
		return { type: 'screen', x: anchor.posx, y: anchor.posy };
	}

	const rect = anchor.getBoundingClientRect();
	return {
		type: 'screen',
		x: rect.left,
		y: rect.top + rect.height,
		width: rect.width,
		height: rect.height,
	};
}

function focusableIndices(items: readonly IActionListItem<unknown>[]): number[] {
	const indices: number[] = [];
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (!item.disabled && item.kind === ActionListItemKind.Action) {
			indices.push(index);
		}
	}
	return indices;
}

function serializeItems(
	items: readonly IActionListItem<unknown>[],
	liveItems: Map<string, unknown>,
): ActionWidgetItemPayload[] {
	return items.map((item, index) => {
		const id = String(index);
		if (item.kind === ActionListItemKind.Action && item.item !== undefined) {
			liveItems.set(id, item.item);
		}

		return {
			id,
			kind: item.kind,
			label: item.label,
			description: item.description,
			keybinding: item.keybinding?.getLabel() ?? undefined,
			disabled: item.disabled,
			icon: item.group?.icon?.id,
			canPreview: item.canPreview,
			hideIcon: item.hideIcon,
			groupTitle: item.group?.title,
		};
	});
}

function serializeFooterActions(
	actions: readonly IAction[],
	liveActions: Map<string, IAction>,
): ActionWidgetFooterActionPayload[] {
	return actions.map((action, index) => {
		const id = `footer_${index}`;
		liveActions.set(id, action);
		return {
			id,
			label: action.label,
			enabled: action.enabled,
		};
	});
}

export class MembraneActionWidgetService extends Disposable implements IActionWidgetService {

	declare readonly _serviceBrand: undefined;

	private activeSession: ActiveSession | undefined;
	private sessionOpenedAt: number = 0;
	private readonly visibleContext: ReturnType<typeof ActionWidgetVisible.bindTo>;
	private readonly dismissListeners = this._register(new DisposableStore());

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.visibleContext = ActionWidgetVisible.bindTo(contextKeyService);
	}

	get isVisible(): boolean {
		return this.visibleContext.get() ?? false;
	}

	show<T>(
		user: string,
		supportsPreview: boolean,
		items: readonly IActionListItem<T>[],
		delegate: IActionListDelegate<T>,
		anchor: HTMLElement | StandardMouseEvent | IAnchor,
		_container: HTMLElement | undefined,
		actionBarActions?: readonly IAction[],
		_accessibilityProvider?: Partial<IListAccessibilityProvider<IActionListItem<T>>>,
	): void {
		this.hide(true);

		const id = generateUuid();
		const liveItems = new Map<string, unknown>();
		const footerActions = new Map<string, IAction>();
		const serializedItems = serializeItems(items as readonly IActionListItem<unknown>[], liveItems);
		const indices = focusableIndices(items as readonly IActionListItem<unknown>[]);
		const focusedIndex = indices[0] ?? 0;

		const payload: ActionWidgetPayload = {
			user,
			supportsPreview,
			focusedIndex,
			items: serializedItems,
		};
		let footerPayload: ActionWidgetFooterActionPayload[] | undefined;
		if (actionBarActions?.length) {
			footerPayload = serializeFooterActions(actionBarActions, footerActions);
			payload.footerActions = footerPayload;
		}

		const session: ActiveSession = {
			id,
			user,
			supportsPreview,
			items: items as readonly IActionListItem<unknown>[],
			delegate: delegate as IActionListDelegate<unknown>,
			liveItems,
			footerActions,
			footerPayload,
			focusableIndices: indices,
			focusedIndex,
			editorContainer: _container,
		};
		this.activeSession = session;
		this.sessionOpenedAt = Date.now();

		MembraneVscodeUiSessions.register(id, 'actionWidget', {
			onSelect: (itemId, options) => {
				this.applySelection(itemId, options?.preview);
			},
			onFocus: (itemId) => {
				this.applyFocus(itemId);
			},
			onDismiss: (didCancel) => {
				this.finishSession(didCancel);
			},
		});

		this.visibleContext.set(true);
		const focusedItem = items[focusedIndex];
		if (focusedItem?.item !== undefined) {
			delegate.onFocus?.(focusedItem.item);
		}

		MembraneVscodeUiSessions.send({
			id,
			lifecycle: 'show',
			kind: 'actionWidget',
			anchor: getScreenAnchor(anchor),
			payload,
		});

		this.installDismissListeners();
	}

	focusPrevious(): void {
		const session = this.activeSession;
		if (!session || session.focusableIndices.length === 0) {
			return;
		}

		const currentPos = session.focusableIndices.indexOf(session.focusedIndex);
		const nextPos = currentPos <= 0 ? session.focusableIndices.length - 1 : currentPos - 1;
		this.setFocusedIndex(session.focusableIndices[nextPos]);
	}

	focusNext(): void {
		const session = this.activeSession;
		if (!session || session.focusableIndices.length === 0) {
			return;
		}

		const currentPos = session.focusableIndices.indexOf(session.focusedIndex);
		const nextPos = currentPos < 0 || currentPos >= session.focusableIndices.length - 1 ? 0 : currentPos + 1;
		this.setFocusedIndex(session.focusableIndices[nextPos]);
	}

	acceptSelected(preview?: boolean): void {
		const session = this.activeSession;
		if (!session) {
			return;
		}

		const item = session.items[session.focusedIndex];
		if (!item || item.disabled || item.kind !== ActionListItemKind.Action || item.item === undefined) {
			return;
		}

		session.delegate.onSelect(item.item, preview);
		this.finishSession(false);
	}

	hide(didCancel?: boolean): void {
		if (!this.activeSession) {
			return;
		}
		this.finishSession(didCancel ?? true);
	}

	private setFocusedIndex(index: number): void {
		const session = this.activeSession;
		if (!session) {
			return;
		}

		session.focusedIndex = index;
		const item = session.items[index];
		session.delegate.onFocus?.(item?.item);

		MembraneVscodeUiSessions.send({
			id: session.id,
			lifecycle: 'update',
			kind: 'actionWidget',
			payload: {
				user: session.user,
				supportsPreview: session.supportsPreview,
				focusedIndex: index,
				items: serializeItems(session.items, new Map()),
				footerActions: session.footerPayload,
			} satisfies ActionWidgetPayload,
		});
	}

	private applyFocus(itemId: string): void {
		const session = this.activeSession;
		if (!session) {
			return;
		}

		const index = Number.parseInt(itemId, 10);
		if (Number.isNaN(index) || index < 0 || index >= session.items.length) {
			return;
		}

		session.focusedIndex = index;
		const item = session.items[index];
		session.delegate.onFocus?.(item?.item);
	}

	private applySelection(itemId: string, preview?: boolean): void {
		const session = this.activeSession;
		if (!session) {
			return;
		}

		if (itemId.startsWith('footer_')) {
			const action = session.footerActions.get(itemId);
			action?.run();
			this.finishSession(false);
			return;
		}

		const item = session.liveItems.get(itemId);
		if (item !== undefined) {
			session.delegate.onSelect(item, preview);
		}
		this.finishSession(false);
	}

	private finishSession(didCancel: boolean): void {
		const session = this.activeSession;
		if (!session) {
			return;
		}

		this.dismissListeners.clear();

		session.delegate.onHide(didCancel);
		MembraneVscodeUiSessions.unregister(session.id);
		this.activeSession = undefined;
		this.sessionOpenedAt = 0;
		this.visibleContext.reset();
	}

	private installDismissListeners(): void {
		this.dismissListeners.clear();

		const dismiss = () => {
			if (this.activeSession) {
				this.hide(true);
			}
		};

		const editorContainer = this.activeSession?.editorContainer;
		if (editorContainer) {
			this.dismissListeners.add(addDisposableListener(editorContainer, EventType.MOUSE_DOWN, () => {
				dismiss();
			}, true));
		}

		this.dismissListeners.add(addDisposableListener(mainWindow, EventType.MOUSE_DOWN, (e) => {
			if (e.defaultPrevented) {
				return;
			}
			if (e.button === 2 || (e.buttons & 2) !== 0) {
				return;
			}
			if (Date.now() - this.sessionOpenedAt < 250) {
				return;
			}
			// Clicks that reach gaze (menu items, sidebar, etc.) are not in the workbench DOM.
			if (!this.isEventInWorkbench(e)) {
				return;
			}
			dismiss();
		}, true));

		// No BLUR listener: focusing the gaze iframe blurs mainWindow, which would
		// dismiss the widget before gaze's select response arrives.
		this.dismissListeners.add(addDisposableListener(mainWindow, EventType.KEY_DOWN, (e) => {
			if (e.key === 'Escape') {
				dismiss();
			}
		}));
	}

	private isEventInWorkbench(e: MouseEvent): boolean {
		const target = e.target;
		if (!(target instanceof Element)) {
			return false;
		}
		return !!target.closest('.monaco-workbench');
	}
}
