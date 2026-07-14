/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { MembraneVscodeUiSessions, QuickPickItemPayload, QuickPickPayload } from '../../../../base/browser/membrane/membraneVscodeUi.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IQuickAccessController } from '../../../../platform/quickinput/common/quickAccess.js';
import {
	IInputBox,
	IInputOptions,
	IKeyMods,
	IPickOptions,
	IQuickInput,
	IQuickInputButton,
	IQuickInputHideEvent,
	IQuickInputService,
	IQuickInputToggle,
	IQuickNavigateConfiguration,
	IQuickPick,
	IQuickPickDidAcceptEvent,
	IQuickPickItem,
	IQuickPickItemButtonEvent,
	IQuickPickSeparator,
	IQuickPickSeparatorButtonEvent,
	IQuickPickWillAcceptEvent,
	IQuickTree,
	IQuickTreeItem,
	IQuickWidget,
	ItemActivation,
	NO_KEY_MODS,
	QuickInputHideReason,
	QuickInputType,
	QuickPickFocus,
	QuickPickInput,
} from '../../../../platform/quickinput/common/quickInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

function isQuickPickSeparator<T extends IQuickPickItem>(item: QuickPickInput<T>): item is IQuickPickSeparator {
	return (item as IQuickPickSeparator).type === 'separator';
}

abstract class MembraneQuickInputBase extends Disposable implements IQuickInput {
	readonly abstract type: QuickInputType;

	private readonly _onDidHide = this._register(new Emitter<IQuickInputHideEvent>());
	readonly onDidHide = this._onDidHide.event;

	private readonly _onWillHide = this._register(new Emitter<IQuickInputHideEvent>());
	readonly onWillHide = this._onWillHide.event;

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	private readonly _onDidTriggerButton = this._register(new Emitter<IQuickInputButton>());
	readonly onDidTriggerButton = this._onDidTriggerButton.event;

	readonly sessionId = generateUuid();
	protected visible = false;

	title: string | undefined;
	description: string | undefined;
	widget: unknown;
	step: number | undefined;
	totalSteps: number | undefined;
	buttons: ReadonlyArray<IQuickInputButton> = [];
	enabled = true;
	contextKey: string | undefined;
	busy = false;
	ignoreFocusOut = false;
	toggles: IQuickInputToggle[] | undefined;

	show(): void {
		this.visible = true;
		this.sendToGaze('show');
	}

	hide(): void {
		if (!this.visible) {
			return;
		}
		this.visible = false;
		MembraneVscodeUiSessions.send({
			id: this.sessionId,
			lifecycle: 'hide',
			kind: 'quickpick',
			payload: this.buildPayload(),
		});
		this._onDidHide.fire({ reason: QuickInputHideReason.Other });
	}

	didHide(reason?: QuickInputHideReason): void {
		this._onDidHide.fire({ reason: reason ?? QuickInputHideReason.Other });
	}

	willHide(reason?: QuickInputHideReason): void {
		this._onWillHide.fire({ reason: reason ?? QuickInputHideReason.Other });
	}

	protected abstract buildPayload(): QuickPickPayload;
	protected abstract sendToGaze(lifecycle: 'show' | 'update'): void;

	override dispose(): void {
		this.hide();
		MembraneVscodeUiSessions.unregister(this.sessionId);
		this._onDispose.fire();
		super.dispose();
	}
}

class MembraneQuickPick<T extends IQuickPickItem> extends MembraneQuickInputBase implements IQuickPick<T> {
	readonly type = QuickInputType.QuickPick;

	private readonly _onDidAccept = this._register(new Emitter<IQuickPickDidAcceptEvent>());
	readonly onDidAccept = this._onDidAccept.event;

	private readonly _onDidChangeValue = this._register(new Emitter<string>());
	readonly onDidChangeValue = this._onDidChangeValue.event;

	private readonly _onWillAccept = this._register(new Emitter<IQuickPickWillAcceptEvent>());
	readonly onWillAccept = this._onWillAccept.event;

	private readonly _onDidCustom = this._register(new Emitter<void>());
	readonly onDidCustom = this._onDidCustom.event;

	private readonly _onDidTriggerItemButton = this._register(new Emitter<IQuickPickItemButtonEvent<T>>());
	readonly onDidTriggerItemButton = this._onDidTriggerItemButton.event;

	private readonly _onDidTriggerSeparatorButton = this._register(new Emitter<IQuickPickSeparatorButtonEvent>());
	readonly onDidTriggerSeparatorButton = this._onDidTriggerSeparatorButton.event;

	private readonly _onDidChangeActive = this._register(new Emitter<T[]>());
	readonly onDidChangeActive = this._onDidChangeActive.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<T[]>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	private resolvePick: ((value: T | T[] | undefined) => void) | undefined;

	value = '';
	filterValue = (value: string) => value;
	ariaLabel: string | undefined;
	placeholder: string | undefined;
	prompt: string | undefined;
	canAcceptInBackground = false;
	ok: boolean | 'default' = 'default';
	okLabel: string | undefined;
	customButton = false;
	customLabel: string | undefined;
	customHover: string | undefined;
	canSelectMany = false;
	matchOnDescription = true;
	matchOnDetail = true;
	matchOnLabel = true;
	matchOnLabelMode: 'fuzzy' | 'contiguous' = 'fuzzy';
	sortByLabel = true;
	keepScrollPosition = false;
	itemActivation = ItemActivation.FIRST;
	activeItems: T[] = [];
	selectedItems: T[] = [];
	private entries: QuickPickInput<T>[] = [];
	quickNavigate: IQuickNavigateConfiguration | undefined;
	readonly keyMods: IKeyMods = NO_KEY_MODS;
	valueSelection: Readonly<[number, number]> | undefined;
	validationMessage: string | undefined;
	severity: Severity = Severity.Ignore;
	hideInput = false;
	hideCountBadge = false;
	hideCheckAll = false;

	constructor(canSelectMany: boolean) {
		super();
		this.canSelectMany = canSelectMany;
	}

	waitForPick(): Promise<T | T[] | undefined> {
		return new Promise(resolve => {
			this.resolvePick = resolve;
		});
	}

	inputHasFocus(): boolean {
		return this.visible;
	}

	focusOnInput(): void { }

	focus(_focus: QuickPickFocus): void { }

	accept(inBackground = false): void {
		if (this.canSelectMany) {
			this.resolvePick?.(this.selectedItems);
		} else {
			this.resolvePick?.(this.activeItems[0]);
		}
		this._onDidAccept.fire({ inBackground });
		this.hide();
	}

	handleSelect(itemId: string): void {
		const item = this.entries.find(i => !isQuickPickSeparator(i) && (i.id ?? i.label) === itemId) as T | undefined;
		if (!item) {
			return;
		}
		this.activeItems = [item];
		this.selectedItems = [item];
		this.accept();
	}

	get items(): T[] {
		return this.entries.filter((item): item is T => !isQuickPickSeparator(item));
	}

	set items(items: T[]) {
		this.loadEntries(items);
	}

	loadEntries(entries: QuickPickInput<T>[]): void {
		this.entries = [...entries];
		if (this.visible) {
			this.sendToGaze('update');
		}
	}

	handleFilter(value: string): void {
		if (this.value !== value) {
			this.value = value;
			this._onDidChangeValue.fire(value);
			this.sendToGaze('update');
		}
	}

	handleDismiss(): void {
		this.resolvePick?.(undefined);
		this.hide();
	}

	protected buildPayload(): QuickPickPayload {
		return {
			title: this.title,
			placeholder: this.placeholder,
			value: this.value,
			busy: this.busy,
			canSelectMany: this.canSelectMany,
			items: this.serializeItems(),
		};
	}

	protected sendToGaze(lifecycle: 'show' | 'update'): void {
		// No anchor: gaze positions the quick input top-centered in the editor
		// pane, like the native widget in the workbench window.
		MembraneVscodeUiSessions.send({
			id: this.sessionId,
			lifecycle,
			kind: 'quickpick',
			payload: this.buildPayload(),
		});
	}

	private serializeItems(): QuickPickItemPayload[] {
		return this.entries.map(item => {
			if (isQuickPickSeparator(item)) {
				return { id: item.id ?? generateUuid(), label: item.label ?? '', separator: true };
			}
			return {
				id: item.id ?? item.label,
				label: item.label,
				description: item.description,
				picked: item.picked,
				disabled: item.disabled,
			};
		});
	}
}

class MembraneInputBox extends MembraneQuickInputBase implements IInputBox {
	readonly type = QuickInputType.InputBox;

	private readonly _onDidAccept = this._register(new Emitter<void>());
	readonly onDidAccept = this._onDidAccept.event;

	private readonly _onDidChangeValue = this._register(new Emitter<string>());
	readonly onDidChangeValue = this._onDidChangeValue.event;

	private resolveInput: ((value: string | undefined) => void) | undefined;

	value = '';
	valueSelection: Readonly<[number, number]> | undefined;
	placeholder: string | undefined;
	password = false;
	prompt: string | undefined;
	validationMessage: string | undefined;
	severity: Severity = Severity.Ignore;

	waitForInput(): Promise<string | undefined> {
		return new Promise(resolve => {
			this.resolveInput = resolve;
		});
	}

	accept(): void {
		this.resolveInput?.(this.value);
		this._onDidAccept.fire();
		this.hide();
	}

	handleSubmit(value: string): void {
		this.value = value;
		this.accept();
	}

	handleDismiss(): void {
		this.resolveInput?.(undefined);
		this.hide();
	}

	handleFilter(value: string): void {
		this.value = value;
		this._onDidChangeValue.fire(value);
	}

	protected buildPayload(): QuickPickPayload {
		return {
			title: this.title,
			placeholder: this.placeholder,
			value: this.value,
			inputOnly: true,
			password: this.password,
			items: [],
		};
	}

	protected sendToGaze(lifecycle: 'show' | 'update'): void {
		// No anchor: gaze positions the quick input like the quick pick above.
		MembraneVscodeUiSessions.send({
			id: this.sessionId,
			lifecycle,
			kind: 'quickpick',
			payload: this.buildPayload(),
		});
	}
}

class MembraneQuickAccessStub implements IQuickAccessController {
	show(_value?: string, _options?: unknown): void { }
	pick(_value?: string, _options?: unknown): Promise<undefined> {
		return Promise.resolve(undefined);
	}
}

export class MembraneQuickInputService extends Disposable implements IQuickInputService {

	declare readonly _serviceBrand: undefined;

	readonly backButton: IQuickInputButton = { iconClass: '', tooltip: '' };
	readonly quickAccess = new MembraneQuickAccessStub();

	private readonly _onShow = this._register(new Emitter<void>());
	readonly onShow = this._onShow.event;

	private readonly _onHide = this._register(new Emitter<void>());
	readonly onHide = this._onHide.event;

	currentQuickInput: IQuickInput | undefined;

	constructor(
		@IInstantiationService _instantiationService: IInstantiationService,
		@IContextKeyService _contextKeyService: IContextKeyService,
	) {
		super();
	}

	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;
	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: boolean } = { useSeparators: false }): IQuickPick<T, { useSeparators: boolean }> {
		const pick = new MembraneQuickPick<T>(false);
		this.registerQuickInput(pick, {
			onSelect: (itemId) => pick.handleSelect(itemId),
			onDismiss: () => pick.handleDismiss(),
			onFilter: (value) => pick.handleFilter(value),
		});
		return pick;
	}

	createInputBox(): IInputBox {
		const box = new MembraneInputBox();
		this.registerQuickInput(box, {
			onSubmit: (data) => box.handleSubmit((data.value as string | undefined) ?? box.value),
			onDismiss: () => box.handleDismiss(),
			onFilter: (value) => box.handleFilter(value),
		});
		return box;
	}

	createQuickWidget(): IQuickWidget {
		throw new Error('MembraneQuickWidget not implemented');
	}

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T> {
		throw new Error('MembraneQuickTree not implemented');
	}

	async pick<T extends IQuickPickItem>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[],
		options?: IPickOptions<T> & { canPickMany?: boolean },
		_token?: CancellationToken,
	): Promise<T | T[] | undefined> {
		const items = await Promise.resolve(picks);
		const pick = new MembraneQuickPick<T>(options?.canPickMany ?? false);
		this.registerQuickInput(pick, {
			onSelect: (itemId) => pick.handleSelect(itemId),
			onDismiss: () => pick.handleDismiss(),
			onFilter: (value) => pick.handleFilter(value),
		});
		pick.title = options?.title;
		pick.placeholder = options?.placeHolder;
		pick.canSelectMany = options?.canPickMany ?? false;
		pick.loadEntries(items);
		const resultPromise = pick.waitForPick();
		pick.show();
		this._onShow.fire();
		try {
			return await resultPromise;
		} finally {
			// This pick is owned here (unlike createQuickPick, where the caller
			// disposes), so tear it down to unregister its gaze session.
			pick.dispose();
			this._onHide.fire();
		}
	}

	async input(options?: IInputOptions, _token?: CancellationToken): Promise<string | undefined> {
		const box = new MembraneInputBox();
		this.registerQuickInput(box, {
			onSubmit: (data) => box.handleSubmit((data.value as string | undefined) ?? box.value),
			onDismiss: () => box.handleDismiss(),
			onFilter: (value) => box.handleFilter(value),
		});
		box.title = options?.title;
		box.placeholder = options?.placeHolder;
		box.value = options?.value ?? '';
		box.password = options?.password ?? false;
		const resultPromise = box.waitForInput();
		box.show();
		this._onShow.fire();
		try {
			return await resultPromise;
		} finally {
			box.dispose();
			this._onHide.fire();
		}
	}

	focus(): void { }
	toggle(): void { }
	navigate(_next: boolean, _quickNavigate?: IQuickNavigateConfiguration): void { }
	async back(): Promise<void> { }
	async accept(_keyMods?: IKeyMods): Promise<void> {
		if (this.currentQuickInput instanceof MembraneQuickPick) {
			this.currentQuickInput.accept();
		} else if (this.currentQuickInput instanceof MembraneInputBox) {
			this.currentQuickInput.accept();
		}
	}
	async cancel(_reason?: QuickInputHideReason): Promise<void> {
		this.currentQuickInput?.hide();
	}
	toggleHover(): void { }
	setAlignment(_alignment: 'top' | 'center' | { top: number; left: number }): void { }

	private registerQuickInput(
		input: MembraneQuickInputBase,
		callbacks: {
			onSelect?: (itemId: string) => void;
			onDismiss?: () => void;
			onFilter?: (value: string) => void;
			onSubmit?: (data: Record<string, unknown>) => void;
		},
	): void {
		this.currentQuickInput = input;
		MembraneVscodeUiSessions.register(input.sessionId, 'quickpick', {
			onSelect: (itemId) => callbacks.onSelect?.(itemId),
			onDismiss: () => callbacks.onDismiss?.(),
			onFilter: (value) => callbacks.onFilter?.(value),
			onSubmit: (data) => callbacks.onSubmit?.(data),
		});
	}
}
