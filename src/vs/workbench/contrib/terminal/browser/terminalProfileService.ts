/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { throttle } from '../../../../base/common/decorators.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../base/common/platform.js';
import { ITerminalProfile, IExtensionTerminalProfile, IShellLaunchConfig } from '../../../../platform/terminal/common/terminal.js';
import { IRegisterContributedProfileArgs, ITerminalProfileProvider, ITerminalProfileService } from '../common/terminal.js';

/*
 * Links TerminalService with TerminalProfileResolverService
 * and keeps the available terminal profiles updated
 * 
 * NOTE: This is a web stub that returns safe defaults instead of throwing errors
 */
export class TerminalProfileService extends Disposable implements ITerminalProfileService {
	declare _serviceBrand: undefined;

	get onDidChangeAvailableProfiles(): Event<ITerminalProfile[]> { return Event.None; }

	get profilesReady(): Promise<void> {
		return Promise.resolve();
	}

	get availableProfiles(): ITerminalProfile[] {
		return [];
	}

	get contributedProfiles(): IExtensionTerminalProfile[] {
		return [];
	}

	constructor(
		// @IContextKeyService private readonly _contextKeyService: IContextKeyService,
		// @IConfigurationService private readonly _configurationService: IConfigurationService,
		// @ITerminalContributionService private readonly _terminalContributionService: ITerminalContributionService,
		// @IExtensionService private readonly _extensionService: IExtensionService,
		// @IRemoteAgentService private _remoteAgentService: IRemoteAgentService,
		// @IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		// @ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService
		...args: unknown[]
	) {
		super();
	}

	getDefaultProfileName(): string | undefined {
		return undefined;
	}

	getDefaultProfile(os?: OperatingSystem): ITerminalProfile | undefined {
		return undefined;
	}

	@throttle(2000)
	refreshAvailableProfiles(): void {
		// No-op
	}

	protected async _refreshAvailableProfilesNow(): Promise<void> {
		// No-op
	}

	getContributedProfileProvider(extensionIdentifier: string, id: string): ITerminalProfileProvider | undefined {
		return undefined;
	}

	async getPlatformKey(): Promise<string> {
		return 'web';
	}

	registerTerminalProfileProvider(extensionIdentifier: string, id: string, profileProvider: ITerminalProfileProvider): IDisposable {
		return { dispose: () => { } };
	}

	async registerContributedProfile(args: IRegisterContributedProfileArgs): Promise<void> {
		// No-op
	}

	async getContributedDefaultProfile(shellLaunchConfig: IShellLaunchConfig): Promise<IExtensionTerminalProfile | undefined> {
		return undefined;
	}

}
