/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { create } from '../../../workbench/workbench.web.main.internal.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import {
	IWorkbenchConstructionOptions,
	IWorkspace,
	IWorkspaceProvider,
} from '../../../workbench/browser/web.api.js';
import { ISecretStorageProvider } from '../../../platform/secrets/common/secrets.js';
import { mainWindow } from '../../../base/browser/window.js';

class SecretStorageProvider implements ISecretStorageProvider {
	public type = 'persisted' as const;

	async get(key: string): Promise<string | undefined> {
		try {
			const secret = JSON.parse(key);
			return localStorage.getItem(secret.key) ?? undefined;
		} catch {
			return undefined;
		}
	}

	async set(key: string, value: string): Promise<void> {
		localStorage.setItem(key, value);
	}

	async delete(key: string): Promise<void> {
		localStorage.removeItem(key);
	}

	async keys(): Promise<string[]> {
		return [];
	}
}

(async function () {
	let config: IWorkbenchConstructionOptions & {
		folderUri?: UriComponents;
		workspaceUri?: UriComponents;
		domElementId?: string;
	} = {};

	const windowProduct = (globalThis as { product?: unknown }).product;
	if (windowProduct && typeof windowProduct === 'object') {
		config = windowProduct as typeof config;
	} else {
		const result = await fetch('/product.json');
		if (!result.ok) {
			throw new Error(`Failed to fetch product.json: ${result.status}`);
		}
		config = await result.json() as typeof config;
	}

	// Revive URIs in additionalBuiltinExtensions if present
	if (Array.isArray(config.additionalBuiltinExtensions)) {
		config = {
			...config,
			additionalBuiltinExtensions: config.additionalBuiltinExtensions.map((ext: unknown) => URI.revive(ext as UriComponents))
		};
	}

	let workspace: IWorkspace | undefined;
	if (config.folderUri) {
		workspace = { folderUri: URI.revive(config.folderUri) };
	} else if (config.workspaceUri) {
		workspace = { workspaceUri: URI.revive(config.workspaceUri) };
	}

	const domElement = mainWindow.document.body;

	if (workspace) {
		const workspaceProvider: IWorkspaceProvider = {
			workspace,
			open: async (
				workspaceToOpen: IWorkspace,
				options?: { reuse?: boolean; payload?: object }
			): Promise<boolean> => {
				return true;
			},
			trusted: true,
		};
		(config as unknown as { workspaceProvider?: IWorkspaceProvider }).workspaceProvider = workspaceProvider;
	}

	(config as unknown as { secretStorageProvider?: ISecretStorageProvider }).secretStorageProvider = new SecretStorageProvider();

	create(domElement, config as IWorkbenchConstructionOptions);
})();
