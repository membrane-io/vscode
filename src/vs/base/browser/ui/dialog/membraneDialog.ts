/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogOptions, IDialogResult } from './dialog.js';
import { Disposable } from '../../../common/lifecycle.js';
import { generateUuid } from '../../../common/uuid.js';
import { mainWindow } from '../../../browser/window.js';

declare global {
	interface Window {
		membraneDialogResponseHandler?: (response: MembraneDialogResponse) => void;
	}
}

export interface MembraneDialogMessage {
	type: 'confirm' | 'prompt' | 'info' | 'warn' | 'error' | 'input';
	id: string;
	message: string;
	detail?: string;
	buttons: string[];
	checkboxLabel?: string;
	checkboxChecked?: boolean;
	inputs?: Array<{
		placeholder?: string;
		type?: 'text' | 'password';
		value?: string;
	}>;
	cancelId?: number;
	iconType?: 'none' | 'info' | 'error' | 'question' | 'warning' | 'pending';
}

export interface MembraneDialogResponse {
	id: string;
	button: number;
	checkboxChecked?: boolean;
	values?: string[];
}

export class MembraneDialog extends Disposable {
	private static pendingDialogs = new Map<string, {
		resolve: (result: IDialogResult) => void;
		reject: (error: Error) => void;
	}>();

	private readonly dialogId: string;

	constructor(
		_container: HTMLElement,
		private message: string,
		private buttons: string[] | undefined,
		private readonly options: IDialogOptions
	) {
		super();
		this.dialogId = generateUuid();

		// Set up global response handler if not already done
		if (!mainWindow.membraneDialogResponseHandler) {
			mainWindow.membraneDialogResponseHandler = (response: MembraneDialogResponse) => {
				const pending = MembraneDialog.pendingDialogs.get(response.id);
				if (pending) {
					MembraneDialog.pendingDialogs.delete(response.id);
					pending.resolve({
						button: response.button,
						checkboxChecked: response.checkboxChecked,
						values: response.values
					});
				}
			};
		}
	}

	async show(): Promise<IDialogResult> {
		return new Promise<IDialogResult>((resolve, reject) => {
			// Store the promise resolvers
			MembraneDialog.pendingDialogs.set(this.dialogId, { resolve, reject });

			// Prepare the message to send to the client
			const dialogMessage: MembraneDialogMessage = {
				type: this.inferDialogType(),
				id: this.dialogId,
				message: this.message,
				detail: this.options.detail,
				buttons: this.getButtonLabels(),
				checkboxLabel: this.options.checkboxLabel,
				checkboxChecked: this.options.checkboxChecked,
				inputs: this.options.inputs,
				cancelId: this.options.cancelId,
				iconType: this.options.type
			};

			// Send to client via custom event (following your existing pattern)
			mainWindow.dispatchEvent(new CustomEvent('membraneDialog', {
				detail: dialogMessage
			}));

			// Set up timeout to prevent hanging dialogs
			setTimeout(() => {
				const pending = MembraneDialog.pendingDialogs.get(this.dialogId);
				if (pending) {
					MembraneDialog.pendingDialogs.delete(this.dialogId);
					// Default to cancel/close behavior
					pending.resolve({
						button: this.options.cancelId || 0,
						checkboxChecked: this.options.checkboxChecked
					});
				}
			}, 30000); // 30 second timeout
		});
	}

	private inferDialogType(): MembraneDialogMessage['type'] {
		// Try to infer dialog type from options or button text
		if (this.options.inputs && this.options.inputs.length > 0) {
			return 'input';
		}

		const buttonText = this.getButtonLabels().join(' ').toLowerCase();
		if (buttonText.includes('ok') && buttonText.includes('cancel')) {
			return 'confirm';
		}
		if (buttonText.includes('yes') && buttonText.includes('no')) {
			return 'confirm';
		}

		switch (this.options.type) {
			case 'error':
				return 'error';
			case 'warning':
				return 'warn';
			case 'info':
			case 'question':
				return 'info';
			default:
				return 'prompt';
		}
	}

	private getButtonLabels(): string[] {
		if (Array.isArray(this.buttons) && this.buttons.length > 0) {
			return this.buttons;
		} else if (!this.options.disableDefaultAction) {
			return ['OK'];
		} else {
			return [];
		}
	}

	updateMessage(message: string): void {
		this.message = message;

		// Send update to Gaze if dialog is currently showing
		if (MembraneDialog.pendingDialogs.has(this.dialogId)) {
			mainWindow.dispatchEvent(new CustomEvent('membraneDialogUpdate', {
				detail: {
					id: this.dialogId,
					message: message
				}
			}));
		}
	}

	override dispose(): void {
		super.dispose();
		// Clean up any pending dialog
		MembraneDialog.pendingDialogs.delete(this.dialogId);
	}
}
