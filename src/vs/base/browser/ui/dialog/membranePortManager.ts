/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MembraneDialogResponse } from './membraneDialog.js';

export interface MembraneNotificationActionResponse {
	notificationId: string;
	actionId?: string;
	dismissed?: boolean;
}

interface MembraneWindow extends Window {
	membraneDialogPortHandoffKey?: string;
	[key: string]: unknown;
}

declare const window: MembraneWindow;

export class MembranePortManager {
	private static dialogPort: MessagePort | null = null;
	private static isInitialized = false;
	private static notificationResponseHandler: ((response: MembraneNotificationActionResponse) => void) | null = null;
	private static dialogResponseHandler: ((response: MembraneDialogResponse) => void) | null = null;

	static setNotificationResponseHandler(handler: (response: MembraneNotificationActionResponse) => void): void {
		MembranePortManager.notificationResponseHandler = handler;
	}

	static setDialogResponseHandler(handler: (response: MembraneDialogResponse) => void): void {
		MembranePortManager.dialogResponseHandler = handler;
	}

	static initializeDialogPort(): void {
		if (MembranePortManager.isInitialized) {
			return; // Already initialized
		}

		const dialogHandoffKey = window.membraneDialogPortHandoffKey;
		if (dialogHandoffKey && window[dialogHandoffKey]) {
			const handoffFunction = window[dialogHandoffKey] as ((callback: (port: MessagePort) => void) => void) | undefined;
			if (handoffFunction) {
				handoffFunction((dialogPort: MessagePort) => {
					MembranePortManager.dialogPort = dialogPort;
					MembranePortManager.isInitialized = true;

					// Set up listener for dialog and notification responses
					dialogPort.onmessage = (event: MessageEvent<Record<string, unknown> & { messageType: string }>) => {
						const data = event.data;
						if (data.messageType === 'membraneDialogResponse') {
							MembranePortManager.handleDialogResponse(data as unknown as MembraneDialogResponse);
						} else if (data.messageType === 'membraneNotificationResponse') {
							MembranePortManager.handleNotificationResponse(data as unknown as MembraneNotificationActionResponse);
						}
					};
				});
			}
		} else {
			console.log('No handoff key or function available');
		}
	}

	static sendMessage(messageType: string, data: Record<string, unknown>): void {
		if (!MembranePortManager.dialogPort) {
			MembranePortManager.initializeDialogPort();

			if (!MembranePortManager.dialogPort) {
				return;
			}
		}

		try {
			const message = {
				messageType,
				...data
			};
			MembranePortManager.dialogPort.postMessage(message);
		} catch (error) {
			console.error(`Error sending ${messageType} message:`, error);
		}
	}

	static handleDialogResponse(response: MembraneDialogResponse): void {
		// Use registered handler if available
		if (MembranePortManager.dialogResponseHandler) {
			MembranePortManager.dialogResponseHandler(response);
		} else {
			console.log('No dialog response handler registered');
		}
	}

	static handleNotificationResponse(response: MembraneNotificationActionResponse): void {
		// Use registered handler if available
		if (MembranePortManager.notificationResponseHandler) {
			MembranePortManager.notificationResponseHandler(response);
		} else {
			console.log('No notification response handler registered');
		}
	}
}
