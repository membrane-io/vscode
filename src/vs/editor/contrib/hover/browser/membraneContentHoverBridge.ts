/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDomNodePagePosition } from '../../../../base/browser/dom.js';
import { IAnchor } from '../../../../base/browser/ui/contextview/contextview.js';
import { createCancelablePromise } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { MembraneVscodeUiSessions, EditorAnchor, HoverActionPart, HoverPayload } from '../../../../base/browser/membrane/membraneVscodeUi.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ContentWidgetPositionPreference, ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Range } from '../../../common/core/range.js';
import { CodeActionTriggerType } from '../../../common/languages.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { ApplyCodeActionReason, getCodeActions } from '../../codeAction/browser/codeAction.js';
import { CodeActionController } from '../../codeAction/browser/codeActionController.js';
import { CodeActionItem, CodeActionKind, CodeActionSet, CodeActionTrigger, CodeActionTriggerSource } from '../../codeAction/common/types.js';
import { ContentHoverResult } from './contentHoverTypes.js';
import { MarkdownHover } from './markdownHoverParticipant.js';
import { MarkerHover } from './markerHoverParticipant.js';
import { IHoverPart } from './hoverTypes.js';
import * as nls from '../../../../nls.js';
import { IMarker } from '../../../../platform/markers/common/markers.js';
import { Progress } from '../../../../platform/progress/common/progress.js';

let activeHoverId: string | undefined;
let bridgedHoverDismissHandler: (() => void) | undefined;

interface BridgedHoverLayout {
	left: number;
	top: number;
	width: number;
	height: number;
	pointerInside: boolean;
}

let bridgedHoverLayout: BridgedHoverLayout | undefined;
let bridgedClosestMouseDistance: number | undefined;
let bridgedInitialMousePos: { x: number; y: number } | undefined;

export function isBridgedContentHoverVisible(): boolean {
	return activeHoverId !== undefined;
}

export function isMouseOnBridgedHoverWidget(posx: number, posy: number): boolean {
	const layout = bridgedHoverLayout;
	if (!layout || layout.width <= 0 || layout.height <= 0) {
		return false;
	}
	return posx >= layout.left && posx <= layout.left + layout.width
		&& posy >= layout.top && posy <= layout.top + layout.height;
}

export function isBridgedHoverPointerInside(): boolean {
	return bridgedHoverLayout?.pointerInside ?? false;
}

export function isBridgedMouseGettingCloser(posx: number, posy: number): boolean {
	const layout = bridgedHoverLayout;
	if (!layout || layout.width <= 0 || layout.height <= 0) {
		return false;
	}
	if (bridgedInitialMousePos === undefined) {
		bridgedInitialMousePos = { x: posx, y: posy };
		return false;
	}
	const distance = computeDistanceFromPointToRectangle(posx, posy, layout.left, layout.top, layout.width, layout.height);
	if (bridgedClosestMouseDistance === undefined) {
		bridgedClosestMouseDistance = computeDistanceFromPointToRectangle(
			bridgedInitialMousePos.x,
			bridgedInitialMousePos.y,
			layout.left,
			layout.top,
			layout.width,
			layout.height
		);
	}
	if (distance > bridgedClosestMouseDistance + 4) {
		return false;
	}
	bridgedClosestMouseDistance = Math.min(bridgedClosestMouseDistance, distance);
	return true;
}

export function setBridgedContentHoverDismissHandler(handler: (() => void) | undefined): void {
	bridgedHoverDismissHandler = handler;
}

function updateBridgedHoverLayout(data: Record<string, unknown>): void {
	if (activeHoverId === undefined) {
		return;
	}
	bridgedHoverLayout = {
		left: data.x as number,
		top: data.y as number,
		width: data.width as number,
		height: data.height as number,
		pointerInside: data.pointerInside === true,
	};
}

function clearBridgedHoverLayout(): void {
	bridgedHoverLayout = undefined;
	bridgedClosestMouseDistance = undefined;
	bridgedInitialMousePos = undefined;
}

function computeDistanceFromPointToRectangle(pointX: number, pointY: number, left: number, top: number, width: number, height: number): number {
	const x = left + width / 2;
	const y = top + height / 2;
	const dx = Math.max(Math.abs(pointX - x) - width / 2, 0);
	const dy = Math.max(Math.abs(pointY - y) - height / 2, 0);
	return Math.sqrt(dx * dx + dy * dy);
}

const markerCodeActionTrigger: CodeActionTrigger = {
	type: CodeActionTriggerType.Invoke,
	filter: { include: CodeActionKind.QuickFix },
	triggerAction: CodeActionTriggerSource.QuickFixHover
};

interface HoverSessionState {
	editor: ICodeEditor;
	anchor: EditorAnchor;
	payload: HoverPayload;
	marker?: IMarker;
	actionsSet?: CodeActionSet;
	liveActions: Map<string, CodeActionItem>;
	disposables: DisposableStore;
}

const hoverSessions = new Map<string, HoverSessionState>();

export function shouldBridgeContentHover(hoverParts: readonly IHoverPart[]): boolean {
	for (const part of hoverParts) {
		if (!(part instanceof MarkdownHover) && !(part instanceof MarkerHover)) {
			return false;
		}
	}
	return hoverParts.length > 0;
}

export function bridgeContentHover(editor: ICodeEditor, hoverResult: ContentHoverResult, preference: ContentWidgetPositionPreference): boolean {
	if (!shouldBridgeContentHover(hoverResult.hoverParts)) {
		return false;
	}

	const model = editor.getModel();
	if (!model) {
		return false;
	}

	const anchorRange = hoverResult.options.anchor.range;
	const markerHover = hoverResult.hoverParts.find((part): part is MarkerHover => part instanceof MarkerHover);
	const payload = serializeHoverParts(hoverResult.hoverParts, markerHover, editor);
	const hoverId = activeHoverId ?? generateUuid();
	activeHoverId = hoverId;
	clearBridgedHoverLayout();

	const editorAnchor: EditorAnchor = {
		type: 'editor',
		uri: model.uri.toString(),
		line: anchorRange.startLineNumber,
		column: anchorRange.startColumn,
		preference: preference === ContentWidgetPositionPreference.BELOW ? 'below' : 'above',
	};

	// Dispose any state from a previous show with the same reused hover id.
	cleanupHoverSession(hoverId);

	const disposables = new DisposableStore();
	// The hover can outlive the quick fix menu; once a fix edits the buffer its
	// content is stale, so hide on any model change.
	disposables.add(editor.onDidChangeModelContent(() => hideBridgedContentHover()));
	hoverSessions.set(hoverId, {
		editor,
		anchor: editorAnchor,
		payload,
		marker: markerHover?.marker,
		liveActions: new Map(),
		disposables,
	});

	MembraneVscodeUiSessions.register(hoverId, 'hover', {
		onSelect: (itemId) => {
			handleHoverAction(hoverId, itemId);
		},
		onLayout: (data) => {
			if (activeHoverId === hoverId) {
				updateBridgedHoverLayout(data);
			}
		},
		onDismiss: () => {
			cleanupHoverSession(hoverId);
			if (activeHoverId === hoverId) {
				activeHoverId = undefined;
				clearBridgedHoverLayout();
			}
			bridgedHoverDismissHandler?.();
		},
	});

	MembraneVscodeUiSessions.send({
		id: hoverId,
		lifecycle: 'show',
		kind: 'hover',
		anchor: editorAnchor,
		payload,
	});

	if (markerHover && !editor.getOption(EditorOption.readOnly)) {
		loadQuickFixActions(hoverId, markerHover.marker);
	}

	return true;
}

export function hideBridgedContentHover(): void {
	if (!activeHoverId) {
		return;
	}
	const hoverId = activeHoverId;
	MembraneVscodeUiSessions.unregister(hoverId);
	cleanupHoverSession(hoverId);
	activeHoverId = undefined;
	clearBridgedHoverLayout();
}

function cleanupHoverSession(hoverId: string): void {
	const session = hoverSessions.get(hoverId);
	if (!session) {
		return;
	}
	session.disposables.dispose();
	session.actionsSet?.dispose();
	hoverSessions.delete(hoverId);
}

function handleHoverAction(hoverId: string, itemId: string): void {
	const session = hoverSessions.get(hoverId);
	if (!session) {
		return;
	}

	const editor = session.editor;
	const anchor = session.anchor;
	const actionsSet = session.actionsSet;
	const action = session.liveActions.get(itemId);

	if (itemId === 'quickFixMenu' && actionsSet) {
		// Hand the actions over to the code action widget and keep the hover open
		// behind it. Ownership transfers, so re-fetch a fresh set for the hover's
		// Quick Fix entry in case the menu is dismissed and clicked again.
		session.actionsSet = undefined;
		const controller = CodeActionController.get(editor);
		if (controller) {
			const screenAnchor = editorAnchorToScreen(editor, anchor);
			controller.showCodeActions(markerCodeActionTrigger, actionsSet, screenAnchor);
			if (session.marker) {
				loadQuickFixActions(hoverId, session.marker);
			}
		} else {
			actionsSet.dispose();
		}
		return;
	}

	hideBridgedContentHover();

	const controller = CodeActionController.get(editor);
	if (!controller) {
		return;
	}

	if (action) {
		controller.applyCodeAction(action, false, false, ApplyCodeActionReason.FromProblemsHover);
	}
}

function loadQuickFixActions(hoverId: string, marker: IMarker): void {
	const session = hoverSessions.get(hoverId);
	if (!session) {
		return;
	}

	const promise = createCancelablePromise(cancellationToken => {
		return session.editor.invokeWithinContext(accessor => {
			const languageFeaturesService = accessor.get(ILanguageFeaturesService);
			return getCodeActions(
				languageFeaturesService.codeActionProvider,
				session.editor.getModel()!,
				new Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
				markerCodeActionTrigger,
				Progress.None,
				cancellationToken,
			);
		});
	});

	session.disposables.add(toDisposable(() => promise.cancel()));
	promise.then(actions => {
		const current = hoverSessions.get(hoverId);
		if (!current || activeHoverId !== hoverId) {
			actions.dispose();
			return;
		}

		if (actions.validActions.length === 0) {
			actions.dispose();
			sendHoverUpdate(hoverId, { actionsStatus: 'none' });
			return;
		}

		const hoverActions: HoverActionPart[] = [{
			id: 'quickFixMenu',
			label: nls.localize('quick fixes', "Quick Fix..."),
			kind: 'quickFixMenu',
		}];

		const aiAction = actions.validActions.find(action => action.action.isAI);
		if (aiAction) {
			const id = 'ai_0';
			current.liveActions.set(id, aiAction);
			hoverActions.push({
				id,
				label: aiAction.action.title,
				kind: 'aiAction',
			});
		}

		current.actionsSet = actions;
		sendHoverUpdate(hoverId, {
			actions: hoverActions,
			actionsStatus: 'ready',
		});
	}, onUnexpectedError);
}

function sendHoverUpdate(hoverId: string, patch: Partial<HoverPayload>): void {
	const session = hoverSessions.get(hoverId);
	if (!session || activeHoverId !== hoverId) {
		return;
	}

	session.payload = { ...session.payload, ...patch };

	MembraneVscodeUiSessions.send({
		id: hoverId,
		lifecycle: 'update',
		kind: 'hover',
		anchor: session.anchor,
		payload: session.payload,
	});
}

function editorAnchorToScreen(editor: ICodeEditor, anchor: EditorAnchor): IAnchor {
	const position = { lineNumber: anchor.line, column: anchor.column };
	const coords = editor.getScrolledVisiblePosition(position);
	const domNode = editor.getDomNode();
	if (!coords || !domNode) {
		return { x: 0, y: 0 };
	}
	const editorCoords = getDomNodePagePosition(domNode);
	const layout = editor.getLayoutInfo();
	const lineHeight = editor.getOption(EditorOption.lineHeight);
	return {
		x: editorCoords.left + layout.contentLeft + coords.left,
		y: editorCoords.top + coords.top + lineHeight,
	};
}

function serializeHoverParts(hoverParts: readonly IHoverPart[], markerHover: MarkerHover | undefined, editor: ICodeEditor): HoverPayload {
	const parts = hoverParts.map(part => {
		if (part instanceof MarkdownHover) {
			return {
				type: 'markdown' as const,
				contents: part.contents.map(c => ({
					value: c.value,
					isTrusted: c.isTrusted === true,
				})),
			};
		}
		if (part instanceof MarkerHover) {
			return {
				type: 'marker' as const,
				severity: part.marker.severity,
				message: part.marker.message,
				source: part.marker.source,
				code: typeof part.marker.code === 'string' ? part.marker.code : undefined,
			};
		}
		return { type: 'markdown' as const, contents: [{ value: '' }] };
	});

	const actionsStatus = markerHover && !editor.getOption(EditorOption.readOnly) ? 'loading' as const : undefined;
	return { parts, actionsStatus };
}
