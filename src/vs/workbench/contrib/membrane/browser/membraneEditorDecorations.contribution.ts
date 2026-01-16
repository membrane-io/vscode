/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor, ICodeEditor, IViewZoneChangeAccessor } from '../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration, OverviewRulerLane } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { URI } from '../../../../base/common/uri.js';

interface IMembraneViewZone {
	afterLine: number;
	lines: string[];
	styled?: boolean;
}

interface IMembraneHighlight {
	startLine: number;
	endLine: number;
}

interface IFileDecorations {
	viewZones: IMembraneViewZone[];
	highlights: IMembraneHighlight[];
}

// View zones are editor-specific (can't persist across editor instances)
interface IEditorWithMembraneDecorations extends ICodeEditor {
	__membraneViewZones?: string[];
}

// Highlights are model-specific (persist when switching tabs)
interface IModelWithMembraneDecorations {
	__membraneHighlights?: string[];
}

export class MembraneEditorDecorationsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.membraneEditorDecorations';

	constructor(
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._setupFileDecorationsListener();
	}


	private _setupFileDecorationsListener(): void {
		const handler = ((event: CustomEvent) => {
			const { uri, decorations } = event.detail as { uri: string; decorations: IFileDecorations };
			const parsedUri = URI.parse(uri);

			const activeControl = this.editorService.activeTextEditorControl;
			if (activeControl && isCodeEditor(activeControl)) {
				this._applyFileDecorations(activeControl, parsedUri, decorations);
			}
		}) as EventListener;

		mainWindow.addEventListener('membrane:setFileDecorations', handler);
		this._register({ dispose: () => mainWindow.removeEventListener('membrane:setFileDecorations', handler) });
	}

	private _applyFileDecorations(editor: ICodeEditor, targetUri: URI, decorations: IFileDecorations): void {
		const model = editor.getModel();
		if (!model || model.uri.scheme !== targetUri.scheme || model.uri.path !== targetUri.path) {
			return;
		}

		this._applyViewZones(editor, targetUri, decorations.viewZones);

		this._applyHighlights(editor, targetUri, decorations.highlights);
	}

	private _applyViewZones(editor: ICodeEditor, targetUri: URI, zones: IMembraneViewZone[]): void {
		const model = editor.getModel();
		if (!model || model.uri.scheme !== targetUri.scheme || model.uri.path !== targetUri.path) {
			return;
		}

		const editorWithDecorations = editor as IEditorWithMembraneDecorations;
		const existingZoneIds: string[] = editorWithDecorations.__membraneViewZones || [];

		editor.changeViewZones((zoneAccessor: IViewZoneChangeAccessor) => {
			// Remove existing zones
			for (const zoneId of existingZoneIds) {
				zoneAccessor.removeZone(zoneId);
			}

			// Add new zones
			const newZoneIds: string[] = [];
			for (const zone of zones) {
				const zoneId = zoneAccessor.addZone({
					afterLineNumber: zone.afterLine,
					domNode: this._createViewZoneNode(zone),
					suppressMouseDown: false,
				});
				newZoneIds.push(zoneId);
			}
			editorWithDecorations.__membraneViewZones = newZoneIds;
		});
	}

	private _applyHighlights(editor: ICodeEditor, targetUri: URI, highlights: IMembraneHighlight[]): void {
		const model = editor.getModel();
		if (!model || model.uri.scheme !== targetUri.scheme || model.uri.path !== targetUri.path) {
			return;
		}

		// Store decoration IDs on the model (persists across editor switches)
		const modelWithDecorations = model as unknown as IModelWithMembraneDecorations;
		const existingDecorationIds: string[] = modelWithDecorations.__membraneHighlights || [];

		const lineCount = model.getLineCount();

		// Use diff editor's inserted line background (already themed)
		const newDecorations: IModelDeltaDecoration[] = highlights
			.filter(h => h.startLine >= 1 && h.endLine <= lineCount && h.startLine <= h.endLine)
			.map(h => ({
				range: new Range(h.startLine, 1, h.endLine, model.getLineMaxColumn(h.endLine)),
				options: {
					description: 'membrane-added-line',
					isWholeLine: true,
					className: 'line-insert',
					overviewRuler: {
						color: { id: 'diffEditor.insertedLineBackground' },
						position: OverviewRulerLane.Full,
					},
				},
			}));

		const newIds = model.deltaDecorations(existingDecorationIds, newDecorations);
		modelWithDecorations.__membraneHighlights = newIds;
	}


	private _createViewZoneNode(zone: IMembraneViewZone): HTMLElement {
		const container = document.createElement('div');

		if (zone.styled) {
			// Styled view zone (e.g., deleted lines in diff)
			container.style.cssText = `
				position: relative;
				background: rgba(255, 0, 0, 0.15);
				border-left: 1px solid rgba(255, 0, 0, 0.4);
				font-family: var(--monaco-monospace-font);
				font-size: 12px;
				line-height: 18px;
				color: rgba(255, 100, 100, 0.9);
			`;
			zone.lines.forEach((line: string, idx: number) => {
				const lineDiv = document.createElement('div');
				lineDiv.style.cssText = `position: absolute; top: ${idx * 18}px; left: 0; right: 0; white-space: pre; overflow: hidden;`;
				lineDiv.textContent = line;
				container.appendChild(lineDiv);
			});
		}
		// Unstyled zones are just empty space (for codelens buttons)

		return container;
	}
}

registerWorkbenchContribution2(
	MembraneEditorDecorationsContribution.ID,
	MembraneEditorDecorationsContribution,
	WorkbenchPhase.AfterRestored
);
