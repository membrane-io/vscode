
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
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { isCodeEditor } from '../../../editor/browser/editorBrowser.js';
import type { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { mainWindow } from '../../../base/browser/window.js';
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
		config.messagePorts = new Map<string, MessagePort>([
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
			id: 'membrane.advanceTour', handler: (...args: unknown[]) => {
				const cmdArgs = args[0] as { trigger: string };
				window.dispatchEvent(new Event(`tour:${cmdArgs.trigger}`));
			}
		},
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

	(config as Writeable<IWorkbenchConstructionOptions> & { homeIndicator?: { href: string; icon: string; title: string } }).homeIndicator = {
		href: window.location.origin,
		icon: 'home',
		title: 'Membrane Home',
	};

	// MEMBRANE: Configure workbench settings
	config.defaultLayout = {
		...config.defaultLayout,
		views: [
			...(config.defaultLayout?.views || []),
		],
		layout: {
			...(config.defaultLayout?.layout || {}),
		},
	};

	// MEMBRANE: Configure editor settings
	config.configurationDefaults = {
		...config.configurationDefaults,
		'window.commandCenter': false, // Hide command center
	};

	// eslint-disable-next-line no-restricted-syntax
	const domElement = window.vscodeTargetContainer || document.body;
	create(domElement, config);

	CommandsRegistry.registerCommand(
  'membrane.setViewZones',
  async (
    accessor: ServicesAccessor,
    args: {
      uri: string;
      zones: Array<{
        afterLineNumber: number;
        heightInPx: number;
        lines: string[];
        styled?: boolean;
      }>;
    },
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

    const modelUri = model.uri;
    if (
      modelUri.scheme !== targetUri.scheme ||
      modelUri.path !== targetUri.path
    ) {
      return;
    }

    // Track zones per-editor (use a WeakMap or store on editor instance)
    const existingZoneIds: string[] = (activeControl as any).__membraneViewZones || [];

    activeControl.changeViewZones((accessor) => {
      // Remove ALL existing zones first
      for (const zoneId of existingZoneIds) {
        accessor.removeZone(zoneId);
      }

      // Add all new zones
      const newZoneIds: string[] = [];
      for (const zone of args.zones) {
      const container = document.createElement('div');
      
      if (zone.styled) {
        container.style.cssText = `
          position: relative;
          background: rgba(255, 0, 0, 0.15);
          border-left: 1px solid rgba(255, 0, 0, 0.4);
          font-family: var(--monaco-monospace-font);
          font-size: 12px;
          line-height: 18px;
          color: rgba(255, 100, 100, 0.9);
        `;

        zone.lines.forEach((line, idx) => {
          const lineDiv = document.createElement('div');
          lineDiv.style.cssText = `
            position: absolute;
            top: ${idx * 18}px;
            left: 0;
            right: 0;
            white-space: pre;
            overflow: hidden;
          `;
          lineDiv.textContent = line;
          container.appendChild(lineDiv);
        });
      }

        const zoneId = accessor.addZone({
          afterLineNumber: zone.afterLineNumber,
          heightInPx: zone.heightInPx,
          domNode: container,
          suppressMouseDown: false,
        });
        newZoneIds.push(zoneId);
      }

      // Store for next call
      (activeControl as any).__membraneViewZones = newZoneIds;
    });
  },
);
	
	CommandsRegistry.registerCommand(
  'membrane.getEditorScrollInfo',
  (accessor: ServicesAccessor) => {
    const editorService = accessor.get(IEditorService);
    const activeControl = editorService.activeTextEditorControl;
    if (!activeControl || !isCodeEditor(activeControl)) {
      return null;
    }
    const visibleRanges = activeControl.getVisibleRanges();
    const firstVisibleLine = visibleRanges[0]?.startLineNumber ?? 1;
    return {
      scrollTop: activeControl.getScrollTop(),
      firstLineTop: activeControl.getTopForLineNumber(firstVisibleLine),
      firstVisibleLine: firstVisibleLine,
      contentLeft: activeControl.getLayoutInfo().contentLeft,
    };
  },
);



})();
