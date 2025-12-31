/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
interface IMembraneWindow extends Window {
	dialogsToGazePort?: MessagePort;
}

declare const window: IMembraneWindow;

export class MembranePortManager {
	private static dialogsPort: MessagePort | null = null;
	private static notificationResponseHandler: ((response: unknown) => void) | null = null;
	private static dialogResponseHandler: ((response: unknown) => void) | null = null;

	static setNotificationResponseHandler(handler: (response: unknown) => void): void {
		MembranePortManager.notificationResponseHandler = handler;
	}

	static setDialogResponseHandler(handler: (response: unknown) => void): void {
		MembranePortManager.dialogResponseHandler = handler;
	}

	static ensureInitialized(): void {
		if (MembranePortManager.dialogsPort) {
			return; // Already initialized
		}

		MembranePortManager.dialogsPort = window.dialogsToGazePort || null;
		if (window.dialogsToGazePort) {
			delete window.dialogsToGazePort;
		}

		// Check if the port was actually available
		if (!MembranePortManager.dialogsPort) {
			console.warn('MembranePortManager: dialogsToGazePort not available. Dialogs and notifications may not work.');
			return;
		}

		// Set up listener for dialog and notification responses
		MembranePortManager.dialogsPort.onmessage = (event) => {
			try {
				if (event.data.messageType === 'membraneDialogResponse') {
					MembranePortManager.dialogResponseHandler?.(event.data);
				} else if (event.data.messageType === 'membraneNotificationResponse') {
					MembranePortManager.notificationResponseHandler?.(event.data);
				}
			} catch (error) {
				console.error(`Error handling ${event.data.messageType} message:`, error);
			}
		};

	}

	static sendMessage(messageType: string, data: object): void {
		try {
			MembranePortManager.ensureInitialized();
			if (!MembranePortManager.dialogsPort) {
				console.warn(`MembranePortManager: Cannot send ${messageType} message - dialogs port not available`);
				return;
			}
			const message = {
				messageType,
				...data
			};
			MembranePortManager.dialogsPort.postMessage(message);
		} catch (error) {
			console.error(`Error sending ${messageType} message:`, error);
		}
	}

}