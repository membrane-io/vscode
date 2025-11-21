/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memoize } from '../../../../base/common/decorators.js';
import { Event, Emitter, IDynamicListEventMultiplexer, DynamicListEventMultiplexer } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICreateContributedTerminalProfileOptions, ITerminalBackend, ITerminalLaunchError, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IEditableData } from '../../../common/views.js';
import { ICreateTerminalOptions, IDetachedTerminalInstance, IDetachedXTermOptions, ITerminalGroup, ITerminalInstance, ITerminalInstanceHost, ITerminalLocationOptions, ITerminalService, ITerminalServiceNativeDelegate, TerminalConnectionState } from './terminal.js';
import { IRemoteTerminalAttachTarget, IStartExtensionTerminalRequest, ITerminalProcessExtHostProxy } from '../common/terminal.js';
import { ACTIVE_GROUP_TYPE, AUX_WINDOW_GROUP_TYPE, SIDE_GROUP_TYPE } from '../../../services/editor/common/editorService.js';
import { ITerminalCapabilityImplMap, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { GroupIdentifier } from '../../../common/editor.js';

export class TerminalService extends Disposable implements ITerminalService {
	readonly _serviceBrand: undefined;

	get isProcessSupportRegistered(): boolean { throw new Error('Unsupported'); }

	get connectionState(): TerminalConnectionState { throw new Error('Unsupported'); }

	// Never resolve
	get whenConnected(): Promise<void> { return new Promise(() => { }); }

	get restoredGroupCount(): number { throw new Error('Unsupported'); }

	get instances(): ITerminalInstance[] {
		throw new Error('Unsupported');
	}
	get foregroundInstances(): ITerminalInstance[] {
		throw new Error('Unsupported');
	}
	get detachedInstances(): Iterable<IDetachedTerminalInstance> {
		throw new Error('Unsupported');
	}

	getReconnectedTerminals(_reconnectionOwner: string): ITerminalInstance[] | undefined {
		return undefined;
	}

	get defaultLocation(): TerminalLocation { return TerminalLocation.Panel; }

	get activeInstance(): ITerminalInstance | undefined {
		return undefined;
	}

	get onDidCreateInstance(): Event<ITerminalInstance> { throw new Error('Unsupported'); }
	get onDidChangeInstanceDimensions(): Event<ITerminalInstance> { throw new Error('Unsupported'); }
	get onDidRegisterProcessSupport(): Event<void> { throw new Error('Unsupported'); }
	get onDidChangeConnectionState(): Event<void> { throw new Error('Unsupported'); }
	get onDidRequestStartExtensionTerminal(): Event<IStartExtensionTerminalRequest> { throw new Error('Unsupported'); }

	// ITerminalInstanceHost events
	get onDidDisposeInstance(): Event<ITerminalInstance> { throw new Error('Unsupported'); }
	get onDidFocusInstance(): Event<ITerminalInstance> { throw new Error('Unsupported'); }
	get onDidChangeActiveInstance(): Event<ITerminalInstance | undefined> { throw new Error('Unsupported'); }
	get onDidChangeInstances(): Event<void> { throw new Error('Unsupported'); }
	get onDidChangeInstanceCapability(): Event<ITerminalInstance> { throw new Error('Unsupported'); }

	// Terminal view events
	get onDidChangeActiveGroup(): Event<ITerminalGroup | undefined> { throw new Error('Unsupported'); }

	// Multiplexed events
	@memoize get onAnyInstanceData() { return this._register(this.createOnInstanceEvent(instance => Event.map(instance.onData, data => ({ instance, data })))).event; }
	@memoize get onAnyInstanceDataInput() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onDidInputData, () => e, e.store))).event; }
	@memoize get onAnyInstanceIconChange() { return this._register(this.createOnInstanceEvent(e => e.onIconChanged)).event; }
	@memoize get onAnyInstanceMaximumDimensionsChange() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onMaximumDimensionsChanged, () => e, e.store))).event; }
	@memoize get onAnyInstancePrimaryStatusChange() { return this._register(this.createOnInstanceEvent(e => Event.map(e.statusList.onDidChangePrimaryStatus, () => e, e.store))).event; }
	@memoize get onAnyInstanceProcessIdReady() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onProcessIdReady, () => e, e.store))).event; }
	@memoize get onAnyInstanceSelectionChange() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onDidChangeSelection, () => e, e.store))).event; }
	@memoize get onAnyInstanceTitleChange() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onTitleChanged, () => e, e.store))).event; }
	@memoize get onAnyInstanceShellTypeChanged() { return this._register(this.createOnInstanceEvent(e => Event.map(e.onDidChangeShellType, () => e))).event; }
	@memoize get onAnyInstanceAddedCapabilityType() { return this._register(this.createOnInstanceEvent(e => Event.map(e.capabilities.onDidAddCapability, e => e.id))).event; }

	constructor(
		// @IContextKeyService private _contextKeyService: IContextKeyService,
		// @ILifecycleService private readonly _lifecycleService: ILifecycleService,
		// @ITerminalLogService private readonly _logService: ITerminalLogService,
		// @IDialogService private _dialogService: IDialogService,
		// @IInstantiationService private _instantiationService: IInstantiationService,
		// @IRemoteAgentService private _remoteAgentService: IRemoteAgentService,
		// @IViewsService private _viewsService: IViewsService,
		// @IConfigurationService private readonly _configurationService: IConfigurationService,
		// @IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		// @ITerminalEditorService private readonly _terminalEditorService: ITerminalEditorService,
		// @ITerminalGroupService private readonly _terminalGroupService: ITerminalGroupService,
		// @ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
		// @IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		// @ITerminalProfileService private readonly _terminalProfileService: ITerminalProfileService,
		// @IExtensionService private readonly _extensionService: IExtensionService,
		// @INotificationService private readonly _notificationService: INotificationService,
		// @IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		// @ICommandService private readonly _commandService: ICommandService,
		// @IKeybindingService private readonly _keybindingService: IKeybindingService,
		// @ITimerService private readonly _timerService: ITimerService
		...args: unknown[]
	) {
		super();

	}

	async showProfileQuickPick(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<ITerminalInstance | undefined> {
		throw new Error('Unsupported');
	}

	async initializePrimaryBackend() {
		throw new Error('Unsupported');
	}

	getPrimaryBackend(): ITerminalBackend | undefined {
		throw new Error('Unsupported');
	}

	async setNextCommandId(id: number, commandLine: string, commandId: string): Promise<void> {
		throw new Error('Unsupported');
	}

	setActiveInstance(value: ITerminalInstance) {
		throw new Error('Unsupported');
	}

	async focusActiveInstance(): Promise<void> {
		throw new Error('Unsupported');
	}

	focusInstance(instance: ITerminalInstance): void {
		throw new Error('Unsupported');
	}

	async createContributedTerminalProfile(extensionIdentifier: string, id: string, options: ICreateContributedTerminalProfileOptions): Promise<void> {
		throw new Error('Unsupported');
	}

	async safeDisposeTerminal(instance: ITerminalInstance): Promise<void> {
		throw new Error('Unsupported');
	}

	async getActiveOrCreateInstance(options?: { acceptsInput?: boolean }): Promise<ITerminalInstance> {
		throw new Error('Unsupported');
	}

	async revealTerminal(source: ITerminalInstance, preserveFocus?: boolean): Promise<void> {
		throw new Error('Unsupported');
	}

	async showBackgroundTerminal(instance: ITerminalInstance, suppressSetActive?: boolean): Promise<void> {
		throw new Error('Unsupported');
	}

	async revealActiveTerminal(preserveFocus?: boolean): Promise<void> {
		throw new Error('Unsupported');
	}

	setEditable(instance: ITerminalInstance, data?: IEditableData | null): void {
		throw new Error('Unsupported');
	}

	isEditable(instance: ITerminalInstance | undefined): boolean {
		throw new Error('Unsupported');
	}

	getEditableData(instance: ITerminalInstance): IEditableData | undefined {
		throw new Error('Unsupported');
	}

	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined> {
		throw new Error('Unsupported');
	}

	setNativeDelegate(nativeDelegate: ITerminalServiceNativeDelegate): void {
		throw new Error('Unsupported');
	}

	refreshActiveGroup(): void {
		throw new Error('Unsupported');
	}

	getInstanceFromId(terminalId: number): ITerminalInstance | undefined {
		throw new Error('Unsupported');
	}

	getInstanceFromIndex(terminalIndex: number): ITerminalInstance {
		throw new Error('Unsupported');
	}

	getInstanceFromResource(resource: URI | undefined): ITerminalInstance | undefined {
		throw new Error('Unsupported');
	}

	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean {
		throw new Error('Unsupported');
	}

	moveToEditor(source: ITerminalInstance, group?: GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | AUX_WINDOW_GROUP_TYPE): void {
		throw new Error('Unsupported');
	}

	moveIntoNewEditor(source: ITerminalInstance): void {
		throw new Error('Unsupported');
	}

	async moveToTerminalView(source?: ITerminalInstance | URI, target?: ITerminalInstance, side?: 'before' | 'after'): Promise<void> {
		throw new Error('Unsupported');
	}

	registerProcessSupport(isSupported: boolean): void {
		throw new Error('Unsupported');
	}

	protected async _showTerminalCloseConfirmation(singleTerminal?: boolean): Promise<boolean> {
		throw new Error('Unsupported');
	}

	getDefaultInstanceHost(): ITerminalInstanceHost {
		throw new Error('Unsupported');
	}

	async getInstanceHost(location: ITerminalLocationOptions | undefined): Promise<ITerminalInstanceHost> {
		throw new Error('Unsupported');
	}

	async createTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance> {
		throw new Error('Unsupported');
	}

	async createAndFocusTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance> {
		throw new Error('Unsupported');
	}

	async createDetachedTerminal(options: IDetachedXTermOptions): Promise<IDetachedTerminalInstance> {
		throw new Error('Unsupported');
	}

	async resolveLocation(location?: ITerminalLocationOptions): Promise<TerminalLocation | undefined> {
		throw new Error('Unsupported');
	}

	async setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): Promise<void> {
		throw new Error('Unsupported');
	}

	getEditingTerminal(): ITerminalInstance | undefined {
		return undefined;
	}

	setEditingTerminal(instance: ITerminalInstance | undefined) {
		return undefined;
	}

	createOnInstanceEvent<T>(getEvent: (instance: ITerminalInstance) => Event<T>): DynamicListEventMultiplexer<ITerminalInstance, T> {
		// Return a dummy multiplexer with a never-firing event
		return new DynamicListEventMultiplexer<ITerminalInstance, T>(
			[],
			new Emitter<ITerminalInstance>().event,
			new Emitter<ITerminalInstance>().event,
			getEvent
		);
	}

	createOnInstanceCapabilityEvent<T extends TerminalCapability, K>(capabilityId: T, getEvent: (capability: ITerminalCapabilityImplMap[T]) => Event<K>): IDynamicListEventMultiplexer<{ instance: ITerminalInstance; data: K }> {
		throw new Error('Unsupported');
	}

	openResource(resource: URI): void {
		throw new Error('Unsupported');
	}
}
