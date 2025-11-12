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

declare const window: Window & {
	dialogsToGazePort?: MessagePort;
};

export class MembranePortManager {
	private static dialogsPort: MessagePort | null = null;
	private static notificationResponseHandler: ((response: MembraneNotificationActionResponse) => void) | null = null;
	private static dialogResponseHandler: ((response: MembraneDialogResponse) => void) | null = null;

	static setNotificationResponseHandler(handler: (response: MembraneNotificationActionResponse) => void): void {
		MembranePortManager.notificationResponseHandler = handler;
	}

	static setDialogResponseHandler(handler: (response: MembraneDialogResponse) => void): void {
		MembranePortManager.dialogResponseHandler = handler;
	}

	static ensureInitialized(): void {
		if (MembranePortManager.dialogsPort) {
			return; // Already initialized
		}

		MembranePortManager.dialogsPort = window.dialogsToGazePort ?? null;
		delete window.dialogsToGazePort;

		// Set up listener for dialog and notification responses
		MembranePortManager.dialogsPort!.onmessage = (event) => {
			try {
				if (event.data.messageType === 'membraneDialogResponse') {
					MembranePortManager.dialogResponseHandler!(event.data);
				} else if (event.data.messageType === 'membraneNotificationResponse') {
					MembranePortManager.notificationResponseHandler!(event.data);
				}
			} catch (error) {
				console.error(`Error handling ${event.data.messageType} message:`, error);
			}
		};

	}

	static sendMessage(messageType: string, data: Record<string, unknown>): void {
		try {
			MembranePortManager.ensureInitialized();
			const message = {
				messageType,
				...data
			};
			MembranePortManager.dialogsPort!.postMessage(message);
		} catch (error) {
			console.error(`Error sending ${messageType} message:`, error);
		}
	}

}