/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISecretStorageProvider } from 'vs/platform/secrets/common/secrets';
import { VSBuffer } from 'vs/base/common/buffer';

export class SecretStorageProvider implements ISecretStorageProvider {
	public type: 'persisted';
	private static instance: SecretStorageProvider;
	public getAuthToken: () => Promise<string>;

	constructor() {
		this.type = 'persisted';
		// Capture the window function
		this.getAuthToken = (window as any).globalIdeState.getAuthToken;
		(window as any).globalIdeState.getAuthToken = () => {
			throw new Error('This function is no longer available');
		};
	}

	public static getInstance(): SecretStorageProvider {
		if (!SecretStorageProvider.instance) {
			SecretStorageProvider.instance = new SecretStorageProvider();
		}
		return SecretStorageProvider.instance;
	}

	async get(key: string): Promise<string | undefined> {
		let extensionKey;
		try {
			// Check if the key is for an extension (it's a JSON string)
			extensionKey = JSON.parse(key);
		} catch (err) {
			// Only keys for extensions are stored as JSON so this must not be an extension secret.
		}
		if (
			extensionKey?.extensionId === 'membrane.membrane' &&
			extensionKey?.key === 'membraneApiToken'
		) {
			try {
				return await this.getAuthToken();
			} catch (error) {
				throw new Error(`Failed to read Membrane API token: ${error}`);
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


interface writeIndexedDbDataOptions {
	dbName: string;
	storeName: string;
	key: string;
}

export async function writeIndexedDbData(
	data: string | object,
	options: writeIndexedDbDataOptions,
): Promise<void> {
	const { dbName, storeName, key } = options;

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, 1);
		request.onerror = (event) => {
			reject(`Error opening database: ${(event.target as any).error}`);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};

		request.onsuccess = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			if (!db.objectStoreNames.contains(storeName)) {
				db.close();
				const newVersion = db.version + 1;
				const upgradeRequest = indexedDB.open(dbName, newVersion);

				upgradeRequest.onupgradeneeded = (upgradeEvent) => {
					const upgradedDb = (upgradeEvent.target as IDBOpenDBRequest).result;
					upgradedDb.createObjectStore(storeName);
				};

				upgradeRequest.onsuccess = () => {
					writeData(upgradeRequest.result);
				};

				upgradeRequest.onerror = (upgradeErr) => {
					reject(`Error upgrading database: ${(upgradeErr.target as any).error}`);
				};
			} else {
				writeData(db);
			}
		};
		function writeData(db: IDBDatabase) {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);

			const dataToStore =
				typeof data === 'string' ? data : JSON.stringify(data);
			const putRequest = store.put(
				VSBuffer.fromString(dataToStore).buffer,
				key,
			);

			putRequest.onerror = (event) => {
				reject(`Error writing data: ${(event.target as any).error}`);
			};

			putRequest.onsuccess = () => {
				resolve();
			};

			tx.oncomplete = () => {
				db.close();
			};
		}
	});
}

export async function membraneApi(
	method: 'GET' | 'POST',
	path: `/${string}`,
	body?: BodyInit
): Promise<Response> {
	const isDev = window.location.hostname === 'localhost';
	const baseUrl = isDev ? 'http://localhost:8091' : 'https://api.membrane.io';

	const secretProvider = SecretStorageProvider.getInstance();
	const token = await secretProvider.getAuthToken();

	if (!token) {
		throw new Error('Failed to retrieve Membrane API token');
	}

	return await fetch(`${baseUrl}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body,
	});
}
