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
	extensionToGazePort?: MessagePort;
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

	// Forward the MessagePort to the extension so it can directly talk to gaze
	if (window.extensionToGazePort) {
		config.messagePorts = new Map([
			['membrane.membrane', window.extensionToGazePort],
		]);
		delete window.extensionToGazePort;
	}


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
				// eslint-disable-next-line no-restricted-syntax
				const meta = document.querySelector('meta[name="membrane-launch-params"]') as HTMLMetaElement;
				return meta?.content ?? '';
			},
		},
	];

	(config as Writeable<IWorkbenchConstructionOptions> & { homeIndicator?: { href: string; icon: string; title: string } }).homeIndicator = {
		href: window.location.origin,
		icon: 'home',
		title: 'Membrane Home',
	};

	// eslint-disable-next-line no-restricted-syntax
	const domElement = window.vscodeTargetContainer || document.body;
	create(domElement, config);
})();