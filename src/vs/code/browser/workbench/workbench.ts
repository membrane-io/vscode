/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { create } from '../../../workbench/workbench.web.main.internal.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import {
	IWorkbenchConstructionOptions,
	IWorkspace,
	// IWorkspaceProvider,
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
	let additionalBuiltinExtensions = config.additionalBuiltinExtensions;
	if (Array.isArray(additionalBuiltinExtensions)) {
		additionalBuiltinExtensions = additionalBuiltinExtensions.map((ext: unknown) => URI.revive(ext as UriComponents));
	}

	// Create final config object with all properties (avoiding readonly mutation)
	const finalConfig: IWorkbenchConstructionOptions = {
		...config,
		additionalBuiltinExtensions,
		workspaceProvider: {
			workspace: { workspaceUri: URI.parse('memfs:/membrane.code-workspace') },
			trusted: true,
			open: async (
				_workspace: IWorkspace,
				_options?: { reuse?: boolean; payload?: Record<string, unknown> }
			): Promise<boolean> => {
				return true;
			},
		},
		secretStorageProvider: new SecretStorageProvider(),
	};

	const domElement = mainWindow.document.body;
	create(domElement, finalConfig);
})();
