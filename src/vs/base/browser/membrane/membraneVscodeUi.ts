/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../common/actions.js';
import { IDialogResult } from '../ui/dialog/dialog.js';
import { GazePortManager } from './membranePortManager.js';
import { VscodeUiMenuItem } from './membraneVscodeUiPolicy.js';

export const VSCODE_UI_REQUEST_MESSAGE_TYPE = 'membraneVscodeUi';
export const VSCODE_UI_RESPONSE_MESSAGE_TYPE = 'membraneVscodeUiResponse';

export type VscodeUiKind = 'menu' | 'hover' | 'quickpick' | 'modal' | 'toast' | 'actionWidget' | 'lightbulb';
export type VscodeUiLifecycle = 'show' | 'update' | 'hide';
export type VscodeUiResponseAction = 'select' | 'dismiss' | 'command' | 'submit' | 'filter' | 'focus' | 'layout';

export interface ScreenAnchor {
	type: 'screen';
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export interface EditorAnchor {
	type: 'editor';
	uri: string;
	line: number;
	column: number;
	preference?: 'above' | 'below';
}

export type VscodeUiAnchor = ScreenAnchor | EditorAnchor;

export interface MenuPayload {
	items: VscodeUiMenuItem[];
}

export interface HoverMarkdownPart {
	type: 'markdown';
	contents: Array<{ value: string; isTrusted?: boolean }>;
}

export interface HoverMarkerPart {
	type: 'marker';
	severity: number;
	message: string;
	source?: string;
	code?: string;
}

export interface HoverActionPart {
	id: string;
	label: string;
	kind: 'quickFixMenu' | 'action' | 'aiAction';
}

export type HoverPart = HoverMarkdownPart | HoverMarkerPart;

export interface HoverPayload {
	parts: HoverPart[];
	actions?: HoverActionPart[];
	actionsStatus?: 'loading' | 'ready' | 'none';
}

export interface QuickPickItemPayload {
	id: string;
	label: string;
	description?: string;
	picked?: boolean;
	disabled?: boolean;
	separator?: boolean;
}

export interface QuickPickPayload {
	title?: string;
	placeholder?: string;
	value?: string;
	busy?: boolean;
	canSelectMany?: boolean;
	items: QuickPickItemPayload[];
	inputOnly?: boolean;
	password?: boolean;
}

export interface ModalPayload {
	dialogType: 'confirm' | 'prompt' | 'info' | 'warn' | 'error' | 'input';
	message: string;
	detail?: string;
	buttons: string[];
	checkboxLabel?: string;
	checkboxChecked?: boolean;
	inputs?: Array<{
		placeholder?: string;
		type?: 'text' | 'password';
		value?: string;
	}>;
	cancelId?: number;
	iconType?: 'none' | 'info' | 'error' | 'question' | 'warning' | 'pending';
}

export interface ToastActionPayload {
	id: string;
	label: string;
	enabled: boolean;
}

export interface ToastPayload {
	severity: 'info' | 'warning' | 'error';
	message: string;
	source?: string;
	sticky: boolean;
	timestamp: number;
	actions: ToastActionPayload[];
}

export interface ActionWidgetItemPayload {
	id: string;
	kind: 'header' | 'action' | 'separator';
	label?: string;
	description?: string;
	keybinding?: string;
	disabled?: boolean;
	icon?: string;
	canPreview?: boolean;
	hideIcon?: boolean;
	groupTitle?: string;
}

export interface ActionWidgetFooterActionPayload {
	id: string;
	label: string;
	enabled: boolean;
}

export interface ActionWidgetPayload {
	user: string;
	supportsPreview: boolean;
	focusedIndex: number;
	items: ActionWidgetItemPayload[];
	footerActions?: ActionWidgetFooterActionPayload[];
}

export interface LightbulbPayload {
	icon: 'lightbulb' | 'autofix' | 'sparkle' | 'sparkleFilled';
	title: string;
}

export type VscodeUiPayload =
	| MenuPayload
	| HoverPayload
	| QuickPickPayload
	| ModalPayload
	| ToastPayload
	| ActionWidgetPayload
	| LightbulbPayload;

export interface MembraneVscodeUiMessage {
	messageType?: typeof VSCODE_UI_REQUEST_MESSAGE_TYPE;
	id: string;
	lifecycle: VscodeUiLifecycle;
	kind: VscodeUiKind;
	anchor?: VscodeUiAnchor;
	/** Not needed for `hide`: gaze drops the session without looking at it. */
	payload?: VscodeUiPayload;
}

export interface MembraneVscodeUiResponse {
	messageType: typeof VSCODE_UI_RESPONSE_MESSAGE_TYPE;
	id: string;
	action: VscodeUiResponseAction;
	data?: Record<string, unknown>;
}

export interface VscodeUiSessionCallbacks {
	onSelect?: (itemId: string, options?: { preview?: boolean }) => void;
	onDismiss?: (didCancel: boolean) => void;
	onFocus?: (itemId: string) => void;
	onCommand?: (commandId: string, args?: unknown) => void;
	onSubmit?: (data: Record<string, unknown>) => void;
	onFilter?: (value: string) => void;
	onLayout?: (data: Record<string, unknown>) => void;
	resolveDialog?: (result: IDialogResult) => void;
	rejectDialog?: (error: Error) => void;
}

interface VscodeUiSession {
	kind: VscodeUiKind;
	liveActions?: Map<string, IAction>;
	context?: unknown;
	callbacks: VscodeUiSessionCallbacks;
}

let responseHandlerRegistered = false;

function ensureResponseHandler(): void {
	if (responseHandlerRegistered) {
		return;
	}
	responseHandlerRegistered = true;
	GazePortManager.ensureInitialized();
	GazePortManager.setResponseHandler(VSCODE_UI_RESPONSE_MESSAGE_TYPE, (response: unknown) => {
		MembraneVscodeUiSessions.handleResponse(response as MembraneVscodeUiResponse);
	});
}

export class MembraneVscodeUiSessions {
	private static readonly sessions = new Map<string, VscodeUiSession>();

	static send(message: Omit<MembraneVscodeUiMessage, 'messageType'>): void {
		ensureResponseHandler();
		GazePortManager.sendMessage(VSCODE_UI_REQUEST_MESSAGE_TYPE, message);
	}

	static register(
		id: string,
		kind: VscodeUiKind,
		callbacks: VscodeUiSessionCallbacks,
		options?: { liveActions?: Map<string, IAction>; context?: unknown }
	): void {
		ensureResponseHandler();
		this.sessions.set(id, {
			kind,
			liveActions: options?.liveActions,
			context: options?.context,
			callbacks,
		});
	}

	static unregister(id: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}
		this.sessions.delete(id);
		// Gaze is a dumb renderer: it only removes a session when told to hide it.
		// Every teardown path funnels through here, so this is the single spot
		// that keeps the gaze side in sync.
		this.send({ id, lifecycle: 'hide', kind: session.kind });
	}

	static handleResponse(response: MembraneVscodeUiResponse): void {
		const session = this.sessions.get(response.id);
		if (!session) {
			return;
		}

		switch (response.action) {
			case 'select': {
				const itemId = response.data?.itemId as string | undefined;
				const preview = response.data?.preview === true;
				if (itemId && session.liveActions) {
					const action = session.liveActions.get(itemId);
					action?.run(session.context);
				}
				session.callbacks.onSelect?.(itemId ?? '', { preview });
				break;
			}
			case 'focus': {
				const itemId = response.data?.itemId as string | undefined;
				if (itemId) {
					session.callbacks.onFocus?.(itemId);
				}
				break;
			}
			case 'dismiss': {
				const didCancel = response.data?.didCancel !== false;
				session.callbacks.onDismiss?.(didCancel);
				if (session.kind === 'modal' && session.callbacks.resolveDialog) {
					const cancelId = (response.data?.cancelId as number | undefined) ?? 0;
					session.callbacks.resolveDialog({
						button: cancelId,
						checkboxChecked: response.data?.checkboxChecked as boolean | undefined,
					});
				}
				this.unregister(response.id);
				break;
			}
			case 'command': {
				const commandId = response.data?.commandId as string | undefined;
				if (commandId) {
					session.callbacks.onCommand?.(commandId, response.data?.args);
				}
				break;
			}
			case 'submit': {
				const data = response.data ?? {};
				session.callbacks.onSubmit?.(data);
				if (session.kind === 'modal' && session.callbacks.resolveDialog) {
					session.callbacks.resolveDialog({
						button: (data.button as number | undefined) ?? 0,
						checkboxChecked: data.checkboxChecked as boolean | undefined,
						values: data.values as string[] | undefined,
					});
					this.unregister(response.id);
				} else if (session.kind === 'quickpick') {
					this.unregister(response.id);
				}
				break;
			}
			case 'filter': {
				const value = (response.data?.value as string | undefined) ?? '';
				session.callbacks.onFilter?.(value);
				break;
			}
			case 'layout': {
				if (response.data) {
					session.callbacks.onLayout?.(response.data);
				}
				break;
			}
		}
	}
}
