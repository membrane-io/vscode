/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalInstance, ITerminalInstanceService } from './terminal.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IShellLaunchConfig, ITerminalBackend, ITerminalBackendRegistry, ITerminalProfile, TerminalExtensions, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export class TerminalInstanceService extends Disposable implements ITerminalInstanceService {
	declare _serviceBrand: undefined;
	// private _configHelper: TerminalConfigHelper;
	private _backendRegistration = new Map<string | undefined, { promise: Promise<void>; resolve: () => void }>();

	private readonly _onDidCreateInstance = this._register(new Emitter<ITerminalInstance>());
	get onDidCreateInstance(): Event<ITerminalInstance> { return this._onDidCreateInstance.event; }

	private readonly _onDidRegisterBackend = this._register(new Emitter<ITerminalBackend>());
	get onDidRegisterBackend(): Event<ITerminalBackend> { return this._onDidRegisterBackend.event; }

	constructor(
		// @IInstantiationService private readonly _instantiationService: IInstantiationService,
		// @IContextKeyService private readonly _contextKeyService: IContextKeyService,
		// @IWorkbenchEnvironmentService readonly _environmentService: IWorkbenchEnvironmentService,
		...args: unknown[]
	) {
		super();
	}

	createInstance(profile: ITerminalProfile, target: TerminalLocation): ITerminalInstance;
	createInstance(shellLaunchConfig: IShellLaunchConfig, target: TerminalLocation): ITerminalInstance;
	createInstance(config: IShellLaunchConfig | ITerminalProfile, target: TerminalLocation): ITerminalInstance {
		throw new Error('Unimplemented');
	}

	convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile?: IShellLaunchConfig | ITerminalProfile, cwd?: string | URI): IShellLaunchConfig {
		// Return empty shell launch config
		return {};
	}

	async getBackend(remoteAuthority?: string): Promise<ITerminalBackend | undefined> {
		return undefined;
	}

	getRegisteredBackends(): IterableIterator<ITerminalBackend> {
		return Registry.as<ITerminalBackendRegistry>(TerminalExtensions.Backend).backends.values();
	}

	didRegisterBackend(backend: ITerminalBackend) {
		this._backendRegistration.get(backend.remoteAuthority)?.resolve();
		this._onDidRegisterBackend.fire(backend);
	}
}

registerSingleton(ITerminalInstanceService, TerminalInstanceService, InstantiationType.Delayed);
