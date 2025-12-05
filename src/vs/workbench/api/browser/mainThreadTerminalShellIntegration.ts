/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { MainContext, type MainThreadTerminalShellIntegrationShape } from '../common/extHost.protocol.js';
import { ITerminalService } from '../../contrib/terminal/browser/terminal.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';
import { extHostNamedCustomer, type IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';

@extHostNamedCustomer(MainContext.MainThreadTerminalShellIntegration)
export class MainThreadTerminalShellIntegration extends Disposable implements MainThreadTerminalShellIntegrationShape {
	constructor(
		_extHostContext: IExtHostContext,
		@ITerminalService _terminalService: ITerminalService,
		@IWorkbenchEnvironmentService _workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IExtensionService _extensionService: IExtensionService
	) {
		super();
		// No-op: Terminal shell integration is not supported in web/membrane environment
	}

	$executeCommand(_terminalId: number, _commandLine: string): void {
		// No-op
	}
}
