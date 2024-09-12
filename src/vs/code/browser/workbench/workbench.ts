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
import { membraneApi, SecretStorageProvider, writeIndexedDbData } from 'vs/workbench/common/membrane';
declare const window: any;
type Writeable<T> = { -readonly [P in keyof T]: T[P] };

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
	const isDev = window.location.hostname === 'localhost';
	const extensionUrl = {
		scheme: isHttps ? 'https' : 'http',
		path: isDev ? '/membrane-dev' : '/membrane',
	};

	config.additionalBuiltinExtensions = [URI.revive(extensionUrl)];

	config.workspaceProvider = {
		// IMPORTANT: this filename must match the filename used in `memfs.ts`.
		// TODO: Somehow use product.json to configure that globally
		workspace: { workspaceUri: URI.parse('memfs:/membrane.code-workspace') },
		payload: {
			'skipReleaseNotes': 'true',
			'skipWelcome': 'true',
		},
		trusted: true,
		open: async (
			_workspace: IWorkspace,
			_options?: { reuse?: boolean; payload?: object }
		) => {
			return true;
		},
	};

	config.secretStorageProvider = SecretStorageProvider.getInstance();

	config.commands = [
		// Used to refresh the page from the extension when a new version of the IDE is known to exist.
		{ id: 'membrane.refreshPage', handler: () => window.location.reload() },
		{
			id: 'membrane.getLaunchParams', handler: () => {
				// eslint-disable-next-line no-restricted-syntax
				const meta = document.querySelector('meta[name="membrane-launch-params"]') as HTMLMetaElement;
				return meta?.content ?? '';
			}
		}];

	try {
		const res = await membraneApi('GET', `/settings?keys=${encodeURIComponent('user-data-settings')}`);
		if (!res.ok) {
			throw new Error(`HTTP error! status: ${res.status}`);
		}
		const settingsData = await res.json();
		const userData = settingsData['user-data-settings'];

		await writeIndexedDbData(userData, {
			dbName: 'vscode-web-db',
			storeName: 'vscode-userdata-store',
			key: '/User/settings.json',
		});
	} catch (error) {
		console.error('Failed to retrieve Membrane settings: ', error);
	}

	config.homeIndicator = { href: window.location.origin, icon: 'home', title: 'Membrane Home' };
	// eslint-disable-next-line no-restricted-syntax
	const domElement = document.body;
	create(domElement, config);
})();
