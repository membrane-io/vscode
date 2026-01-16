/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface IMembraneWindow extends Window {
	vscodeToGazePort?: MessagePort;
}

declare const window: IMembraneWindow;

/**
 * Manages direct communication from VSCode to Gaze, bypassing the extension.
 * Used for low-latency updates like:
 * - Editor metrics (scroll, view zones, line positions)
 * - Dialogs
 * - Notifications
 */
export class GazePortManager {
	private static port: MessagePort | null = null;
	private static responseHandlers = new Map<string, (response: unknown) => void>();

	static setResponseHandler(messageType: string, handler: (response: unknown) => void): void {
		GazePortManager.responseHandlers.set(messageType, handler);
	}

	static ensureInitialized(): void {
		if (GazePortManager.port) {
			return;
		}

		GazePortManager.port = window.vscodeToGazePort || null;
		if (window.vscodeToGazePort) {
			delete window.vscodeToGazePort;
		}

		if (!GazePortManager.port) {
			console.warn('GazePortManager: vscodeToGazePort not available');
			return;
		}

		GazePortManager.port.onmessage = (event) => {
			try {
				const handler = GazePortManager.responseHandlers.get(event.data.messageType);
				handler?.(event.data);
			} catch (error) {
				console.error(`Error handling ${event.data.messageType}:`, error);
			}
		};
	}

	static sendMessage(messageType: string, data: object): void {
		try {
			GazePortManager.ensureInitialized();
			if (!GazePortManager.port) {
				return;
			}
			GazePortManager.port.postMessage({ messageType, ...data });
		} catch (error) {
			console.error(`Error sending ${messageType}:`, error);
		}
	}
}
