/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogOptions, IDialogResult } from './dialog.js';
import { Disposable } from '../../../common/lifecycle.js';
import { generateUuid } from '../../../common/uuid.js';
import { MembraneVscodeUiSessions, ModalPayload } from '../../membrane/membraneVscodeUi.js';

export class MembraneDialog extends Disposable {
	private static pendingDialogs = new Map<string, {
		resolve: (result: IDialogResult) => void;
		reject: (error: Error) => void;
		cancelId: number;
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
	}

	async show(): Promise<IDialogResult> {
		return new Promise<IDialogResult>((resolve, reject) => {
			MembraneDialog.pendingDialogs.set(this.dialogId, {
				resolve,
				reject,
				cancelId: this.options.cancelId ?? 0,
			});

			const payload: ModalPayload = {
				dialogType: this.inferDialogType(),
				message: this.message,
				detail: this.options.detail,
				buttons: this.getButtonLabels(),
				checkboxLabel: this.options.checkboxLabel,
				checkboxChecked: this.options.checkboxChecked,
				inputs: this.options.inputs,
				cancelId: this.options.cancelId,
				iconType: this.options.type,
			};

			MembraneVscodeUiSessions.register(this.dialogId, 'modal', {
				resolveDialog: (result) => {
					MembraneDialog.pendingDialogs.delete(this.dialogId);
					resolve(result);
				},
				rejectDialog: (error) => {
					MembraneDialog.pendingDialogs.delete(this.dialogId);
					reject(error);
				},
			});

			MembraneVscodeUiSessions.send({
				id: this.dialogId,
				lifecycle: 'show',
				kind: 'modal',
				payload,
			});
		});
	}

	private inferDialogType(): ModalPayload['dialogType'] {
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

		if (MembraneDialog.pendingDialogs.has(this.dialogId)) {
			MembraneVscodeUiSessions.send({
				id: this.dialogId,
				lifecycle: 'update',
				kind: 'modal',
				payload: { dialogType: this.inferDialogType(), message, buttons: this.getButtonLabels() },
			});
		}
	}

	override dispose(): void {
		super.dispose();
		// Settle the promise before tearing down: without a timeout (removed on
		// purpose), a dialog disposed while still showing would otherwise leave
		// its `show()` awaiter hanging forever. Resolve as the cancel button.
		const pending = MembraneDialog.pendingDialogs.get(this.dialogId);
		if (pending) {
			MembraneDialog.pendingDialogs.delete(this.dialogId);
			pending.resolve({ button: pending.cancelId });
		}
		MembraneVscodeUiSessions.unregister(this.dialogId);
	}
}
