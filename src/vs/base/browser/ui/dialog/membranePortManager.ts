declare const window: any;

export class MembranePortManager {
	private static dialogsPort: MessagePort | null = null;
	private static notificationResponseHandler: ((response: any) => void) | null = null;
	private static dialogResponseHandler: ((response: any) => void) | null = null;

	static setNotificationResponseHandler(handler: (response: any) => void): void {
		MembranePortManager.notificationResponseHandler = handler;
	}

	static setDialogResponseHandler(handler: (response: any) => void): void {
		MembranePortManager.dialogResponseHandler = handler;
	}

	static ensureInitialized(): void {
		if (MembranePortManager.dialogsPort) {
			return; // Already initialized
		}

		MembranePortManager.dialogsPort = window.dialogsToGazePort;
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

	static sendMessage(messageType: string, data: any): void {
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
