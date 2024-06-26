/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { create } from 'vs/workbench/workbench.web.main';
import { URI } from 'vs/base/common/uri';
import {
	IWorkbenchConstructionOptions,
	IWorkspace,
} from 'vs/workbench/browser/web.api';
import { ISecretStorageProvider } from 'vs/platform/secrets/common/secrets';
declare const window: any;
type Writeable<T> = { -readonly [P in keyof T]: T[P] };

class SecretStorageProvider implements ISecretStorageProvider {
	public type: 'persisted';

	constructor() {
		this.type = 'persisted';
	}

	async get(key: string): Promise<string | undefined> {
		let extensionKey;
		try {
			// Check if the key is for an extension
			extensionKey = JSON.parse(key);
		} catch (err) {
			// Only keys for extensions are stored as JSON so this must not be an extension secret.
		}
		if (
			extensionKey?.extensionId === 'membrane.membrane' &&
			extensionKey?.key === 'membraneApiToken'
		) {
			// HACK: Find the first key that matches the pattern of auth0 React
			const localStorageKey = Object.keys(localStorage).find((key) =>
				key.includes('::default::openid')
			);
			if (localStorageKey) {
				const json = localStorage.getItem(localStorageKey);
				const value = JSON.parse(json!);
				return value.body.access_token;
			} else {
				throw new Error('Failed to read Membrane API token');
			}
		}
		return localStorage.getItem(key) ?? undefined;
	}

	async set(key: string, value: string): Promise<void> {
		localStorage.setItem(key, value);
	}

	async delete(key: string): Promise<void> {
		localStorage.removeItem(key);
	}
}

(async function () {
	// create workbench
	let config: Writeable<IWorkbenchConstructionOptions>;

	if (window.product) {
		config = window.product;
	} else {
		const result = await fetch('/product.json');
		config = await result.json();
	}

	const isHttps = window.location.protocol === 'https:';
	const isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
	const extensionUrl = {
		scheme: isHttps ? 'https' : 'http',
		path: isDev ? '/membrane-dev' : '/membrane',
	};

	config.additionalBuiltinExtensions = [URI.revive(extensionUrl)];

	config.workspaceProvider = {
		// IMPORTANT: this filename must match the filename used in `memfs.ts`.
		// TODO: Somehow use product.json to configure that globally
		workspace: { workspaceUri: URI.parse('memfs:/membrane.code-workspace') },
		trusted: true,
		open: async (
			_workspace: IWorkspace,
			_options?: { reuse?: boolean; payload?: object }
		) => {
			return true;
		},
	};

	config.secretStorageProvider = new SecretStorageProvider();

	const domElement = document.body;
	create(domElement, config);
})();
