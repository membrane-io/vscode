/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor, ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { mainWindow } from '../../../../base/browser/window.js';

export class MembraneEditorMetricsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.membraneEditorMetrics';

	private readonly _currentEditorDisposables = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._setupMetricsListener();
		this._register(this.editorService.onDidActiveEditorChange(() => this._setupMetricsListener()));
	}

	private _sendMetricsSync(metrics: object | null): void {
		if (!metrics) {
			return;
		}
		mainWindow.dispatchEvent(new CustomEvent('membrane:editorMetricsSync', {
			detail: { messageType: 'editorMetricsUpdate', ...metrics }
		}));
	}

	private _setupMetricsListener(): void {
		this._currentEditorDisposables.clear();

		const activeControl = this.editorService.activeTextEditorControl;
		if (!activeControl || !isCodeEditor(activeControl)) {
			return;
		}

		const sendMetrics = () => {
			const metrics = this._gatherMetrics(activeControl);
			this._sendMetricsSync(metrics);
		};

		sendMetrics();

		this._currentEditorDisposables.add(activeControl.onDidScrollChange(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidChangeViewZones(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidLayoutChange(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidChangeHiddenAreas(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidChangeConfiguration(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidChangeCursorSelection(sendMetrics));
		this._currentEditorDisposables.add(activeControl.onDidChangeModelContent(sendMetrics));
	}

	private _gatherMetrics(editor: ICodeEditor) {
		const model = editor.getModel();
		if (!model) {
			return null;
		}

		const visibleRanges = editor.getVisibleRanges();
		const firstVisibleLine = visibleRanges[0]?.startLineNumber ?? 1;
		const lastVisibleLine = visibleRanges[visibleRanges.length - 1]?.endLineNumber ?? 1;
		const layoutInfo = editor.getLayoutInfo();
		const lineCount = model.getLineCount();
		const startLine = Math.max(1, firstVisibleLine - 20);
		const endLine = Math.min(lineCount, lastVisibleLine + 20);
		const selection = editor.getSelection();

		const isLineVisible = (line: number): boolean => {
			return visibleRanges.some(range =>
				line >= range.startLineNumber && line <= range.endLineNumber
			);
		};

		const linePositions: Array<{ line: number; top: number; bottom: number }> = [];
		for (let line = startLine; line <= endLine; line++) {
			if (isLineVisible(line)) {
				linePositions.push({
					line,
					top: editor.getTopForLineNumber(line, true),
					bottom: editor.getBottomForLineNumber(line),
				});
			}
		}

		const hasSelection = selection && (
			selection.selectionStartLineNumber !== selection.positionLineNumber ||
			selection.selectionStartColumn !== selection.positionColumn
		);

		let selectionData = undefined;
		if (hasSelection) {
			const startLineNum = Math.min(selection.selectionStartLineNumber, selection.positionLineNumber);
			const endLineNum = Math.max(selection.selectionStartLineNumber, selection.positionLineNumber);

			let minLeft = Infinity;
			let maxRight = 0;
			for (let line = startLineNum; line <= endLineNum; line++) {
				let lineStartCol: number;
				let lineEndCol: number;

				if (line === selection.selectionStartLineNumber && line === selection.positionLineNumber) {
					lineStartCol = Math.min(selection.selectionStartColumn, selection.positionColumn);
					lineEndCol = Math.max(selection.selectionStartColumn, selection.positionColumn);
				} else if (line === startLineNum) {
					const startCol = line === selection.selectionStartLineNumber ? selection.selectionStartColumn : selection.positionColumn;
					lineStartCol = startCol;
					lineEndCol = model.getLineMaxColumn(line);
				} else if (line === endLineNum) {
					const endCol = line === selection.positionLineNumber ? selection.positionColumn : selection.selectionStartColumn;
					lineStartCol = 1;
					lineEndCol = endCol;
				} else {
					lineStartCol = 1;
					lineEndCol = model.getLineMaxColumn(line);
				}

				const leftOffset = editor.getOffsetForColumn(line, lineStartCol);
				const rightOffset = editor.getOffsetForColumn(line, lineEndCol);
				if (leftOffset !== -1) {
					minLeft = Math.min(minLeft, leftOffset);
				}
				if (rightOffset !== -1) {
					maxRight = Math.max(maxRight, rightOffset);
				}
			}

			selectionData = {
				selectionStartLineNumber: selection.selectionStartLineNumber,
				selectionStartColumn: selection.selectionStartColumn,
				positionLineNumber: selection.positionLineNumber,
				positionColumn: selection.positionColumn,
				visualLeft: minLeft !== Infinity ? minLeft : undefined,
				visualRight: maxRight > 0 ? maxRight : undefined,
			};
		}

		return {
			uri: model.uri.toString(),
			scrollTop: editor.getScrollTop(),
			scrollLeft: editor.getScrollLeft(),
			firstVisibleLine,
			firstLineTop: editor.getTopForLineNumber(firstVisibleLine, true),
			lastVisibleLine,
			contentLeft: layoutInfo.contentLeft,
			contentWidth: layoutInfo.contentWidth,
			lineCount,
			linePositions,
			...(selectionData && { selection: selectionData }),
		};
	}
}

registerWorkbenchContribution2(
	MembraneEditorMetricsContribution.ID,
	MembraneEditorMetricsContribution,
	WorkbenchPhase.AfterRestored
);
