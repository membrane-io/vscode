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

		return {
			uri: model.uri.toString(),
			scrollTop: editor.getScrollTop(),
			scrollLeft: editor.getScrollLeft(),
			firstVisibleLine,
			firstLineTop: editor.getTopForLineNumber(firstVisibleLine, true),
			lastVisibleLine,
			contentLeft: layoutInfo.contentLeft,
			contentWidth: layoutInfo.contentWidth,
			linePositions,
		};
	}
}

registerWorkbenchContribution2(
	MembraneEditorMetricsContribution.ID,
	MembraneEditorMetricsContribution,
	WorkbenchPhase.AfterRestored
);
