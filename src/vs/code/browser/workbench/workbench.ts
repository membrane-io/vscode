/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { create } from '../../../workbench/workbench.web.main.internal.js';
import { URI } from '../../../base/common/uri.js';
import {
	IWorkbenchConstructionOptions,
	IWorkspace,
	// IWorkspaceProvider,
} from '../../../workbench/browser/web.api.js';
import { mainWindow } from '../../../base/browser/window.js';
import { SecretStorageProvider } from '../workbench/membrane.js';
declare const window: Window & {
	product?: Writeable<IWorkbenchConstructionOptions>;
	SENTRY_REPORT_ISSUE?: (params: {
		source?: string;
		message?: string;
		context?: unknown;
	}) => void;
	vscodeTargetContainer?: HTMLElement | null;
	completeInitialization?: () => void;
	SENTRY_CAPTURE_EXCEPTION?: (error: Error) => void;
};
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

	const isHttps = window.location.protocol === 'https:';
	const isDev = window.location.hostname === 'localhost';
	const extensionUrl = {
		scheme: isHttps ? 'https' : 'http',
		path: isDev ? '/membrane-dev' : '/membrane',
	};

	config.additionalBuiltinExtensions = [URI.revive(extensionUrl)];

	config.workspaceProvider = {
		// IMPORTANT: this filename must match the filename used in `memfs.ts`.
		// TODO: Somehow use product.json to configure that globally
		workspace: { workspaceUri: URI.parse('memfs:/membrane.code-workspace') },
		payload: {
			'skipReleaseNotes': 'true',
			'skipWelcome': 'true',
		},
		trusted: true,
		open: async (
			_workspace: IWorkspace,
			_options?: { reuse?: boolean; payload?: object }
		) => {
			return true;
		},
	};

	config.secretStorageProvider = SecretStorageProvider.getInstance();

	config.commands = [
		// Used to refresh the page from the extension when a new version of the IDE is known to exist.
		{ id: 'membrane.refreshPage', handler: () => window.location.reload() },
		// Invoked when the navigator finishes loading
		{
			id: 'membrane.completeInitialization', handler: () => window.completeInitialization?.()
		},
		// For product tour, emit an event to advance to the next step
		{
			id: 'membrane.advanceTour', handler: (...args: unknown[]) => {
				const cmdArgs = args[0] as { trigger: string };
				window.dispatchEvent(new Event(`tour:${cmdArgs.trigger}`));
			}
		},
		// For product tour, send coordinates of gaze rects to the web app
		{
			id: 'membrane.reportGazeRect', handler: (...args: unknown[]) => {
				// cmdArgs { gaze_instance, rect_id, x, y, width, height }
				const cmdArgs = args[0] as { gaze_instance: string; rect_id: string; x: number; y: number; width: number; height: number };
				window.dispatchEvent(
					new CustomEvent('gaze:report-rect', { detail: cmdArgs }),
				);
			},
		},
		{
			id: 'membrane.reportOverlayRects',
			handler: (...args: unknown[]) => {
				// cmdArgs { gaze_instance, overlay_id, rects_json }
				const cmdArgs = args[0] as { gaze_instance: string; overlay_id: string; rects_json: string };
				window.dispatchEvent(
					new CustomEvent('gaze:report-overlay-rects', { detail: cmdArgs }),
				);
			},
		},
		{
			id: 'membrane.reportModalState',
			handler: (cmdArgs) => {
				// cmdArgs { gaze_instance, element_id, has_modal }
				window.dispatchEvent(
					new CustomEvent('gaze:modal-state', { detail: cmdArgs }),
				);
			},
		},
		// For extension panels to bubble up errors
		{
			id: 'membrane.reportError',
			handler: (...args: unknown[]) => {
				const cmdArgs = args[0] as { error: { message: string; stack?: string } };
				const error = new Error(cmdArgs.error.message);
				error.stack = cmdArgs.error.stack;
				window.SENTRY_CAPTURE_EXCEPTION?.(error);
			},
		},
		{
			id: 'membrane.reportIssue',
			handler: (...args: unknown[]) => {
				const cmdArgs = args[0] as { source?: string; message?: string; context?: unknown };
				window.SENTRY_REPORT_ISSUE?.({
					source: cmdArgs.source,
					message: cmdArgs.message,
					context: cmdArgs.context
				});
			},
		},
		{
			id: 'membrane.extensionToGaze',
			handler: (response) => {
				console.log('Workbench: Extension to Next.js:', response);
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
				// Reading from existing HTML meta tag created outside of workbench
				// eslint-disable-next-line no-restricted-syntax
				const metas = mainWindow.document.getElementsByTagName('meta');
				for (let i = 0; i < metas.length; i++) {
					const meta = metas[i];
					if (meta.name === 'membrane-launch-params') {
						return meta.content ?? '';
					}
				}
				return '';
			},
		},
	];

	// config.homeIndicator = {
	// 	href: window.location.origin,
	// 	icon: 'home',
	// 	title: 'Membrane Home',
	// };

	window.addEventListener('gazeToExtension', async (event: Event) => {
		const customEvent = event as CustomEvent;
		console.log('Workbench: Event received:', customEvent.detail);

		try {
			// Use VSCode's built-in command service
			const { ICommandService } = await import(
				'../../../platform/commands/common/commands.js'
			);
			const { StandaloneServices } = await import(
				'../../../editor/standalone/browser/standaloneServices.js'
			);

			const commandService = StandaloneServices.get(ICommandService);
			if (commandService) {
				await commandService.executeCommand(
					'membrane.gazeToExtension',
					customEvent.detail,
				);
				console.log('Workbench: Command executed successfully');
			} else {
				console.error('Command service not available');
			}
		} catch (error) {
			console.error('Failed to execute command:', error);
		}
	});

	console.log('Workbench: Setup complete');

	const domElement = window.vscodeTargetContainer || mainWindow.document.body;
	create(domElement, config);
})();