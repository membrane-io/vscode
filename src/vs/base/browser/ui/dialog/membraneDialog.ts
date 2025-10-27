/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogOptions, IDialogResult } from 'vs/base/browser/ui/dialog/dialog';
import { Disposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { MembranePortManager } from './membranePortManager';

declare const window: any;

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
	private static pendingResponses = new Map<string, {
		resolve: (result: IDialogResult) => void;
		reject: (error: Error) => void;
	}>();

	private readonly dialogId: string;

	// Handle dialog responses from Gaze
	private handleDialogResponse(response: MembraneDialogResponse): void {
		const pending = MembraneDialog.pendingResponses.get(response.id);
		if (pending) {
			MembraneDialog.pendingResponses.delete(response.id);
			pending.resolve({
				button: response.button,
				checkboxChecked: response.checkboxChecked,
				values: response.values
			});
		}
	}

	constructor(
		_container: HTMLElement,
		private message: string,
		private buttons: string[] | undefined,
		private readonly options: IDialogOptions
	) {
		super();
		this.dialogId = generateUuid();

		// Register this instance as the dialog response handler
		MembranePortManager.setDialogResponseHandler((response: any) => {
			this.handleDialogResponse(response);
		});
	}

	async show(): Promise<IDialogResult> {
		return new Promise<IDialogResult>((resolve, reject) => {
			// Store the promise resolvers
			MembraneDialog.pendingResponses.set(this.dialogId, { resolve, reject });

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


			// Send via MessagePort using shared port manager
			MembranePortManager.sendMessage('membraneDialog', dialogMessage);

			// Set up timeout to prevent hanging dialogs
			setTimeout(() => {
				const pending = MembraneDialog.pendingResponses.get(this.dialogId);
				if (pending) {
					MembraneDialog.pendingResponses.delete(this.dialogId);
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
		if (MembraneDialog.pendingResponses.has(this.dialogId)) {
			MembranePortManager.sendMessage('membraneDialogUpdate', {
				id: this.dialogId,
				message: message
			});
		}
	}

	override dispose(): void {
		super.dispose();
		// Clean up any pending dialog
		MembraneDialog.pendingResponses.delete(this.dialogId);
	}
}
