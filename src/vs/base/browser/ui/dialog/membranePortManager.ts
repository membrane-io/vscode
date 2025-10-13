/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare const window: any;

export class MembranePortManager {
	private static dialogPort: MessagePort | null = null;
	private static isInitialized = false;
	private static notificationResponseHandler: ((response: any) => void) | null = null;
	private static dialogResponseHandler: ((response: any) => void) | null = null;

	static setNotificationResponseHandler(handler: (response: any) => void): void {
		MembranePortManager.notificationResponseHandler = handler;
	}

	static setDialogResponseHandler(handler: (response: any) => void): void {
		MembranePortManager.dialogResponseHandler = handler;
	}

	static initializeDialogPort(): void {
		if (MembranePortManager.isInitialized) {
			return; // Already initialized
		}

		const dialogHandoffKey = window.membraneDialogPortHandoffKey;
		if (dialogHandoffKey && window[dialogHandoffKey]) {
			window[dialogHandoffKey]((dialogPort: MessagePort) => {
				MembranePortManager.dialogPort = dialogPort;
				MembranePortManager.isInitialized = true;

				// Set up listener for dialog and notification responses
				dialogPort.onmessage = (event) => {
					if (event.data.messageType === 'membraneDialogResponse') {
						MembranePortManager.handleDialogResponse(event.data);
					} else if (event.data.messageType === 'membraneNotificationResponse') {
						MembranePortManager.handleNotificationResponse(event.data);
					}
				};
			});
		} else {
			console.log('No handoff key or function available');
		}
	}

	static sendMessage(messageType: string, data: any): void {
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

	static handleDialogResponse(response: any): void {
		// Use registered handler if available
		if (MembranePortManager.dialogResponseHandler) {
			MembranePortManager.dialogResponseHandler(response);
		} else {
			console.log('No dialog response handler registered');
		}
	}

	static handleNotificationResponse(response: any): void {
		// Use registered handler if available
		if (MembranePortManager.notificationResponseHandler) {
			MembranePortManager.notificationResponseHandler(response);
		} else {
			console.log('No notification response handler registered');
		}
	}
}
