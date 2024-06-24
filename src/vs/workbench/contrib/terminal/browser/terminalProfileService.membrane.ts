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
 */
export class TerminalProfileService extends Disposable implements ITerminalProfileService {
	declare _serviceBrand: undefined;

	get onDidChangeAvailableProfiles(): Event<ITerminalProfile[]> { throw new Error('Unsupported'); }

	get profilesReady(): Promise<void> {

		throw new Error('Unsupported');
	}
	get availableProfiles(): ITerminalProfile[] {

		throw new Error('Unsupported');
	}
	get contributedProfiles(): IExtensionTerminalProfile[] {

		throw new Error('Unsupported');
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

		throw new Error('Unsupported');
	}

	getDefaultProfile(os?: OperatingSystem): ITerminalProfile | undefined {

		throw new Error('Unsupported');
	}


	@throttle(2000)
	refreshAvailableProfiles(): void {

		throw new Error('Unsupported');
	}

	protected async _refreshAvailableProfilesNow(): Promise<void> {

		throw new Error('Unsupported');
	}

	getContributedProfileProvider(extensionIdentifier: string, id: string): ITerminalProfileProvider | undefined {

		throw new Error('Unsupported');
	}

	async getPlatformKey(): Promise<string> {

		throw new Error('Unsupported');
	}

	registerTerminalProfileProvider(extensionIdentifier: string, id: string, profileProvider: ITerminalProfileProvider): IDisposable {

		throw new Error('Unsupported');
	}

	async registerContributedProfile(args: IRegisterContributedProfileArgs): Promise<void> {

		throw new Error('Unsupported');
	}

	async getContributedDefaultProfile(shellLaunchConfig: IShellLaunchConfig): Promise<IExtensionTerminalProfile | undefined> {

		throw new Error('Unsupported');
	}

}
