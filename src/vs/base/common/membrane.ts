import { VSBuffer } from 'vs/base/common/buffer';
// eslint-disable-next-line local/code-import-patterns
import { ISecretStorageProvider } from 'vs/platform/secrets/common/secrets';

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

	// vscode correct version
	const DB_VERSION = 3;
	const predefinedStores = ['vscode-userdata-store', 'vscode-logs-store', 'vscode-filehandles-store'];

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, DB_VERSION);

		request.onerror = (event) => {
			reject(`Error opening database: ${(event.target as IDBRequest).error}`);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			// create stores
			predefinedStores.forEach((store) => {
				if (!db.objectStoreNames.contains(store)) {
					db.createObjectStore(store);
				}
			});
		};

		request.onsuccess = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			if (!db.objectStoreNames.contains(storeName)) {
				reject(`Store ${storeName} does not exist in the database.`);
				db.close();
				return;
			}

			writeData(db);
		};

		function writeData(db: IDBDatabase) {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);

			const dataToStore = typeof data === 'string' ? data : JSON.stringify(data);

			const putRequest = store.put(
				VSBuffer.fromString(dataToStore).buffer,
				key,
			);

			putRequest.onerror = (event) => {
				reject(`Error writing data: ${(event.target as IDBRequest).error}`);
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


export function isWorkspaceDb(dbName: string): boolean {
	const regex = /^vscode-web-state-db-\w+$/;
	return regex.test(dbName);
}

export function isUserDataStore(store: string): boolean {
	return store === 'vscode-userdata-store';
}