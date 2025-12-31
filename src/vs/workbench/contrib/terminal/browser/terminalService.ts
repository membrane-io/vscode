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

	get isProcessSupportRegistered(): boolean { return false; }

	get connectionState(): TerminalConnectionState { return TerminalConnectionState.Connected; }

	// Never resolve
	get whenConnected(): Promise<void> { return new Promise(() => { }); }

	get restoredGroupCount(): number { return 0; }

	get instances(): ITerminalInstance[] {
		return [];
	}
	get foregroundInstances(): ITerminalInstance[] {
		return [];
	}
	get detachedInstances(): Iterable<IDetachedTerminalInstance> {
		return [];
	}

	getReconnectedTerminals(_reconnectionOwner: string): ITerminalInstance[] | undefined {
		return undefined;
	}

	get defaultLocation(): TerminalLocation { return TerminalLocation.Panel; }

	get activeInstance(): ITerminalInstance | undefined {
		return undefined;
	}

	// Return Event.None for all events - they will never fire but won't throw errors
	get onDidCreateInstance(): Event<ITerminalInstance> { return Event.None; }
	get onDidChangeInstanceDimensions(): Event<ITerminalInstance> { return Event.None; }
	get onDidRegisterProcessSupport(): Event<void> { return Event.None; }
	get onDidChangeConnectionState(): Event<void> { return Event.None; }
	get onDidRequestStartExtensionTerminal(): Event<IStartExtensionTerminalRequest> { return Event.None; }

	// ITerminalInstanceHost events
	get onDidDisposeInstance(): Event<ITerminalInstance> { return Event.None; }
	get onDidFocusInstance(): Event<ITerminalInstance> { return Event.None; }
	get onDidChangeActiveInstance(): Event<ITerminalInstance | undefined> { return Event.None; }
	get onDidChangeInstances(): Event<void> { return Event.None; }
	get onDidChangeInstanceCapability(): Event<ITerminalInstance> { return Event.None; }

	// Terminal view events
	get onDidChangeActiveGroup(): Event<ITerminalGroup | undefined> { return Event.None; }

	// Multiplexed events - return events that never fire
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
		return undefined;
	}

	async initializePrimaryBackend() {
		// No-op
	}

	getPrimaryBackend(): ITerminalBackend | undefined {
		return undefined;
	}

	async setNextCommandId(id: number, commandLine: string, commandId: string): Promise<void> {
		// No-op
	}

	setActiveInstance(value: ITerminalInstance) {
		// No-op
	}

	async focusActiveInstance(): Promise<void> {
		// No-op
	}

	focusInstance(instance: ITerminalInstance): void {
		// No-op
	}

	async createContributedTerminalProfile(extensionIdentifier: string, id: string, options: ICreateContributedTerminalProfileOptions): Promise<void> {
		// No-op
	}

	async safeDisposeTerminal(instance: ITerminalInstance): Promise<void> {
		// No-op
	}

	async getActiveOrCreateInstance(options?: { acceptsInput?: boolean }): Promise<ITerminalInstance> {
		throw new Error('Terminal not supported in web environment');
	}

	async revealTerminal(source: ITerminalInstance, preserveFocus?: boolean): Promise<void> {
		// No-op
	}

	async showBackgroundTerminal(instance: ITerminalInstance, suppressSetActive?: boolean): Promise<void> {
		// No-op
	}

	async revealActiveTerminal(preserveFocus?: boolean): Promise<void> {
		// No-op
	}

	setEditable(instance: ITerminalInstance, data?: IEditableData | null): void {
		// No-op
	}

	isEditable(instance: ITerminalInstance | undefined): boolean {
		return false;
	}

	getEditableData(instance: ITerminalInstance): IEditableData | undefined {
		return undefined;
	}

	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined> {
		return Promise.resolve(undefined);
	}

	setNativeDelegate(nativeDelegate: ITerminalServiceNativeDelegate): void {
		// No-op
	}

	refreshActiveGroup(): void {
		// No-op
	}

	getInstanceFromId(terminalId: number): ITerminalInstance | undefined {
		return undefined;
	}

	getInstanceFromIndex(terminalIndex: number): ITerminalInstance {
		throw new Error('Terminal not supported in web environment');
	}

	getInstanceFromResource(resource: URI | undefined): ITerminalInstance | undefined {
		return undefined;
	}

	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean {
		return false;
	}

	moveToEditor(source: ITerminalInstance, group?: GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | AUX_WINDOW_GROUP_TYPE): void {
		// No-op
	}

	moveIntoNewEditor(source: ITerminalInstance): void {
		// No-op
	}

	async moveToTerminalView(source?: ITerminalInstance | URI, target?: ITerminalInstance, side?: 'before' | 'after'): Promise<void> {
		// No-op
	}

	registerProcessSupport(isSupported: boolean): void {
		// No-op
	}

	protected async _showTerminalCloseConfirmation(singleTerminal?: boolean): Promise<boolean> {
		return false;
	}

	getDefaultInstanceHost(): ITerminalInstanceHost {
		throw new Error('Terminal not supported in web environment');
	}

	async getInstanceHost(location: ITerminalLocationOptions | undefined): Promise<ITerminalInstanceHost> {
		throw new Error('Terminal not supported in web environment');
	}

	async createTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance> {
		throw new Error('Terminal not supported in web environment');
	}

	async createAndFocusTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance> {
		throw new Error('Terminal not supported in web environment');
	}

	async createDetachedTerminal(options: IDetachedXTermOptions): Promise<IDetachedTerminalInstance> {
		throw new Error('Terminal not supported in web environment');
	}

	async resolveLocation(location?: ITerminalLocationOptions): Promise<TerminalLocation | undefined> {
		return undefined;
	}

	async setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): Promise<void> {
		// No-op
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
		// Return a dummy multiplexer that never fires
		const emitter = new Emitter<{ instance: ITerminalInstance; data: K }>();
		return {
			event: emitter.event,
			dispose: () => emitter.dispose()
		};
	}

	openResource(resource: URI): void {
		// No-op
	}
}
