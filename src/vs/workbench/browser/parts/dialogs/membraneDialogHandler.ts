/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfirmation, IConfirmationResult, IInputResult, ICheckbox, IInputElement, ICustomDialogOptions, IInput, AbstractDialogHandler, DialogType, IPrompt, IAsyncPromptResult } from '../../../../platform/dialogs/common/dialogs.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import Severity from '../../../../base/common/severity.js';
import { MembraneDialog } from '../../../../base/browser/ui/dialog/membraneDialog.js';
import { IDialogResult, IDialogStyles } from '../../../../base/browser/ui/dialog/dialog.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { fromNow } from '../../../../base/common/date.js';
import type { IButtonStyles } from '../../../../base/browser/ui/button/button.js';
import type { ICheckboxStyles } from '../../../../base/browser/ui/toggle/toggle.js';
import type { IInputBoxStyles } from '../../../../base/browser/ui/inputbox/inputBox.js';

export class MembraneDialogHandler extends AbstractDialogHandler {

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IProductService private readonly productService: IProductService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super();
	}

	async prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>> {
		this.logService.trace('MembraneDialogHandler#prompt', prompt.message);

		const buttons = this.getPromptButtons(prompt);

		const { button, checkboxChecked } = await this.doShow(prompt.type, prompt.message, buttons, prompt.detail, prompt.cancelButton ? buttons.length - 1 : -1 /* Disabled */, prompt.checkbox, undefined, typeof prompt?.custom === 'object' ? prompt.custom : undefined);

		return this.getPromptResult(prompt, button, checkboxChecked);
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('MembraneDialogHandler#confirm', confirmation.message);

		const buttons = this.getConfirmationButtons(confirmation);

		const { button, checkboxChecked } = await this.doShow(confirmation.type ?? 'question', confirmation.message, buttons, confirmation.detail, buttons.length - 1, confirmation.checkbox, undefined, typeof confirmation?.custom === 'object' ? confirmation.custom : undefined);

		return { confirmed: button === 0, checkboxChecked };
	}

	async input(input: IInput): Promise<IInputResult> {
		this.logService.trace('MembraneDialogHandler#input', input.message);

		const buttons = this.getInputButtons(input);

		const { button, checkboxChecked, values } = await this.doShow(input.type ?? 'question', input.message, buttons, input.detail, buttons.length - 1, input?.checkbox, input.inputs, typeof input.custom === 'object' ? input.custom : undefined);

		return { confirmed: button === 0, checkboxChecked, values };
	}

	async about(): Promise<void> {
		const detailString = (useAgo: boolean): string => {
			return localize('aboutDetail',
				"Version: {0}\nCommit: {1}\nDate: {2}\nBrowser: {3}",
				this.productService.version || 'Unknown',
				this.productService.commit || 'Unknown',
				this.productService.date ? `${this.productService.date}${useAgo ? ' (' + fromNow(new Date(this.productService.date), true) + ')' : ''}` : 'Unknown',
				navigator.userAgent
			);
		};

		const detail = detailString(true);
		const detailToCopy = detailString(false);

		const { button } = await this.doShow(
			Severity.Info,
			this.productService.nameLong,
			[
				localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				localize('ok', "OK")
			],
			detail,
			1
		);

		if (button === 0) {
			this.clipboardService.writeText(detailToCopy);
		}
	}

	private async doShow(type: Severity | DialogType | undefined, message: string, buttons?: string[], detail?: string, cancelId?: number, checkbox?: ICheckbox, inputs?: IInputElement[], customOptions?: ICustomDialogOptions): Promise<IDialogResult> {
		const dialogDisposables = new DisposableStore();

		const dialog = new MembraneDialog(
			this.layoutService.activeContainer,
			message,
			buttons,
			{
				detail,
				cancelId,
				type: this.getDialogType(type),
				checkboxLabel: checkbox?.label,
				checkboxChecked: checkbox?.checked,
				inputs: inputs?.map(input => ({
					placeholder: input.placeholder,
					type: input.type,
					value: input.value
				})),
				disableCloseAction: customOptions?.disableCloseAction,
				// Note: We're not handling all the styling options since we're delegating to Gaze
				buttonStyles: {
					buttonBackground: undefined,
					buttonHoverBackground: undefined,
					buttonForeground: undefined,
					buttonSeparator: undefined,
					buttonSecondaryBackground: undefined,
					buttonSecondaryHoverBackground: undefined,
					buttonSecondaryForeground: undefined,
					buttonBorder: undefined
				},
				checkboxStyles: {
					checkboxBackground: undefined,
					checkboxBorder: undefined,
					checkboxForeground: undefined,
					checkboxDisabledBackground: undefined,
					checkboxDisabledForeground: undefined
				},
				inputBoxStyles: {
					inputBackground: undefined,
					inputForeground: undefined,
					inputBorder: undefined,
					inputValidationInfoBorder: undefined,
					inputValidationInfoBackground: undefined,
					inputValidationInfoForeground: undefined,
					inputValidationWarningBorder: undefined,
					inputValidationWarningBackground: undefined,
					inputValidationWarningForeground: undefined,
					inputValidationErrorBorder: undefined,
					inputValidationErrorBackground: undefined,
					inputValidationErrorForeground: undefined
				},
				dialogStyles: {
					dialogForeground: undefined,
					dialogBackground: undefined,
					dialogShadow: undefined,
					dialogBorder: undefined,
					errorIconForeground: undefined,
					warningIconForeground: undefined,
					infoIconForeground: undefined,
					textLinkForeground: undefined
				}
			}
		);

		dialogDisposables.add(dialog);

		const result = await dialog.show();
		dialogDisposables.dispose();

		return result;
	}
}
