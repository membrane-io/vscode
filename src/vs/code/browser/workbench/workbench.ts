
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { create } from 'vs/workbench/workbench.web.main';
import { URI } from 'vs/base/common/uri';
import {
	IWorkbenchConstructionOptions,
	IWorkspace,
} from 'vs/workbench/browser/web.api';
import { SecretStorageProvider } from 'vs/code/browser/workbench/membrane';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import type { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { mainWindow } from 'vs/base/browser/window';

declare const window: any;
type Writeable<T> = { -readonly [P in keyof T]: T[P] };

(async function () {
	// create workbench
	let config: Writeable<IWorkbenchConstructionOptions>;

	if (window.product) {
		config = window.product;
	} else {
		const result = await fetch('/product.json');
		config = await result.json();
	}

	// Forward the MessagePort to the extension so it can directly talk to gaze
	config.messagePorts = new Map([
		['membrane.membrane', window.extensionToGazePort],
	]);
	delete window.extensionToGazePort;

	const isHttps = window.location.protocol === 'https:';
	const isDev = window.location.hostname === 'localhost';
	const extensionUrl = {
		authority: window.location.host,
		scheme: isHttps ? 'https' : 'http',
		path: isDev ? '/membrane-dev' : '/membrane',
	};

	config.additionalBuiltinExtensions = [URI.revive(extensionUrl)];

	config.workspaceProvider = {
		// IMPORTANT: this filename must match the filename used in `memfs.ts`.
		// TODO: Somehow use product.json to configure that globally
		workspace: { workspaceUri: URI.parse('memfs:/membrane.code-workspace') },
		payload: {
			skipReleaseNotes: 'true',
			skipWelcome: 'true',
		},
		trusted: true,
		open: async (
			_workspace: IWorkspace,
			_options?: { reuse?: boolean; payload?: object },
		) => {
			return true;
		},
	};

	config.secretStorageProvider = SecretStorageProvider.getInstance();

	config.commands = [
		{ id: 'membrane.refreshPage', handler: () => window.location.reload() },
		{
			id: 'membrane.completeInitialization',
			handler: () => window.completeInitialization?.(),
		},
		{
			id: 'membrane.advanceTour',
			handler: (cmdArgs) =>
				window.dispatchEvent(new Event(`tour:${cmdArgs.trigger}`)),
		},
		{
			id: 'membrane.reportError',
			handler: (cmdArgs) => {
				const error = new Error(cmdArgs.error.message);
				error.stack = cmdArgs.error.stack;
				(window as any).SENTRY_CAPTURE_EXCEPTION(error);
			},
		},
		{
			id: 'membrane.reportIssue',
			handler: (cmdArgs) => {
				(window as any).SENTRY_REPORT_ISSUE({
					source: cmdArgs.source,
					message: cmdArgs.message,
					context: cmdArgs.context,
				});
			},
		},
		{
			id: 'membrane.extensionToGaze',
			handler: (response) => {
				window.dispatchEvent(
					new CustomEvent('extensionToGaze', {
						detail: response,
					}),
				);
				return true;
			},
		},
		{
			id: 'membrane.getLaunchParams',
			handler: () => {
				const meta = mainWindow.document.querySelector(
					'meta[name="membrane-launch-params"]',
				) as HTMLMetaElement;
				return meta?.content ?? '';
			},
		},
	];

	config.homeIndicator = {
		href: window.location.origin,
		icon: 'home',
		title: 'Membrane Home',
	};

	const domElement = (window as any).vscodeTargetContainer || mainWindow.document.body;
	create(domElement, config);

	// Register Monaco commands for review decorations
	// These allow the extension to add/remove view zones (e.g., showing removed lines during code review)
	CommandsRegistry.registerCommand(
		'membrane.addMonacoViewZone',
		async (
			accessor: ServicesAccessor,
			args: {
				uri: string;
				afterLineNumber: number;
				heightInPx: number;
				lines: string[];
			},
		) => {
			const editorService = accessor.get(IEditorService);
			const targetUri = URI.parse(args.uri);

			const activeControl = editorService.activeTextEditorControl;
			if (!activeControl || !isCodeEditor(activeControl)) {
				return null;
			}

			const model = activeControl.getModel();
			if (!model) {
				return null;
			}

			// Verify we're in the correct file
			const modelUri = model.uri;
			if (
				modelUri.scheme !== targetUri.scheme ||
				modelUri.path !== targetUri.path
			) {
				return null;
			}

			let zoneId: string | null = null;

			activeControl.changeViewZones((accessor) => {
				const container = document.createElement('div');
				container.style.cssText = `
					position: relative;
					background: rgba(255, 0, 0, 0.15);
					border-left: 1px solid rgba(255, 0, 0, 0.4);
					font-family: var(--monaco-monospace-font, 'Menlo', 'Monaco', 'Courier New', monospace);
					font-size: 12px;
					line-height: 18px;
					padding: 0;
					color: rgba(255, 100, 100, 0.9);
				`;

				args.lines.forEach((line: string, idx: number) => {
					const lineDiv = document.createElement('div');
					lineDiv.style.cssText = `
						position: absolute;
						top: ${idx * 18}px;
						left: 0;
						right: 0;
						white-space: pre;
						overflow: hidden;
						text-overflow: ellipsis;
					`;

					lineDiv.textContent = line;
					container.appendChild(lineDiv);
				});

				zoneId = accessor.addZone({
					afterLineNumber: args.afterLineNumber,
					heightInPx: args.heightInPx,
					domNode: container,
					suppressMouseDown: false,
				});
			});

			return { zoneId };
		},
	);

	CommandsRegistry.registerCommand(
		'membrane.removeMonacoViewZone',
		async (
			accessor: ServicesAccessor,
			args: { uri: string; zoneId: string },
		) => {
			const editorService = accessor.get(IEditorService);
			const targetUri = URI.parse(args.uri);

			const activeControl = editorService.activeTextEditorControl;
			if (!activeControl || !isCodeEditor(activeControl)) {
				return;
			}

			const model = activeControl.getModel();
			if (!model) {
				return;
			}

			// Verify we're in the correct file
			const modelUri = model.uri;
			if (
				modelUri.scheme !== targetUri.scheme ||
				modelUri.path !== targetUri.path
			) {
				return;
			}

			activeControl.changeViewZones((accessor) => {
				accessor.removeZone(args.zoneId);
			});
		},
	);
})();
