/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toErrorMessage } from 'vs/base/common/errorMessage';
import { ErrorNoTelemetry, getErrorMessage } from 'vs/base/common/errors';
import { mark } from 'vs/base/common/performance';
// eslint-disable-next-line local/code-import-patterns
import { membraneApi } from 'vs/code/browser/workbench/workbench';

class MissingStoresError extends Error {
	constructor(readonly db: IDBDatabase) {
		super('Missing stores');
	}
}

export class DBClosedError extends Error {
	readonly code = 'DBClosed';
	constructor(dbName: string) {
		super(`IndexedDB database '${dbName}' is closed.`);
	}
}

export class IndexedDB {

	static async create(name: string, version: number | undefined, stores: string[]): Promise<IndexedDB> {
		const database = await IndexedDB.openDatabase(name, version, stores);
		return new IndexedDB(database, name);
	}

	private static async openDatabase(name: string, version: number | undefined, stores: string[]): Promise<IDBDatabase> {
		mark(`code/willOpenDatabase/${name}`);
		try {
			return await IndexedDB.doOpenDatabase(name, version, stores);
		} catch (err) {
			if (err instanceof MissingStoresError) {
				console.info(`Attempting to recreate the IndexedDB once.`, name);

				try {
					// Try to delete the db
					await IndexedDB.deleteDatabase(err.db);
				} catch (error) {
					console.error(`Error while deleting the IndexedDB`, getErrorMessage(error));
					throw error;
				}

				return await IndexedDB.doOpenDatabase(name, version, stores);
			}

			throw err;
		} finally {
			mark(`code/didOpenDatabase/${name}`);
		}
	}

	private static doOpenDatabase(name: string, version: number | undefined, stores: string[]): Promise<IDBDatabase> {
		return new Promise((c, e) => {
			const request = indexedDB.open(name, version);
			request.onerror = () => e(request.error);
			request.onsuccess = () => {
				const db = request.result;
				for (const store of stores) {
					if (!db.objectStoreNames.contains(store)) {
						console.error(`Error while opening IndexedDB. Could not find '${store}'' object store`);
						e(new MissingStoresError(db));
						return;
					}
				}
				c(db);
			};
			request.onupgradeneeded = () => {
				const db = request.result;
				for (const store of stores) {
					if (!db.objectStoreNames.contains(store)) {
						db.createObjectStore(store);
					}
				}
			};
		});
	}

	private static deleteDatabase(database: IDBDatabase): Promise<void> {
		return new Promise((c, e) => {
			// Close any opened connections
			database.close();

			// Delete the db
			const deleteRequest = indexedDB.deleteDatabase(database.name);
			deleteRequest.onerror = (err) => e(deleteRequest.error);
			deleteRequest.onsuccess = () => c();
		});
	}

	private database: IDBDatabase | null = null;
	private readonly pendingTransactions: IDBTransaction[] = [];

	constructor(database: IDBDatabase, private readonly name: string) {
		this.database = database;
	}

	hasPendingTransactions(): boolean {
		return this.pendingTransactions.length > 0;
	}

	close(): void {
		if (this.pendingTransactions.length) {
			this.pendingTransactions.splice(0, this.pendingTransactions.length).forEach(transaction => transaction.abort());
		}
		this.database?.close();
		this.database = null;
	}

	runInTransaction<T>(store: string, transactionMode: IDBTransactionMode, dbRequestFn: (store: IDBObjectStore) => IDBRequest<T>[]): Promise<T[]>;
	runInTransaction<T>(store: string, transactionMode: IDBTransactionMode, dbRequestFn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T>;
	async runInTransaction<T>(store: string, transactionMode: IDBTransactionMode, dbRequestFn: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<T>[]): Promise<T | T[]> {
		if (!this.database) {
			throw new DBClosedError(this.name);
		}
		const transaction = this.database.transaction(store, transactionMode);
		this.pendingTransactions.push(transaction);

		const requests: Array<{ prop: string; key: string; value?: any }> = [];
		const storeProxy = new Proxy(transaction.objectStore(store), {
			get(target: IDBObjectStore, prop: string): any {
				return (...args: any[]) => {
					const result = (target[prop as keyof IDBObjectStore] as Function).apply(target, args);
					requests.push({
						prop,
						key: prop === 'get' ? args[0] : args[1],
						value: prop === 'put' ? args[0] : undefined,
					});
					return result;
				};
			},
		});


		const originalRequest: IDBRequest<T> | IDBRequest<T>[] = dbRequestFn(storeProxy);

		return new Promise<T | T[]>((resolve, reject) => {
			transaction.oncomplete = async () => {
				try {
					const membraneResults = await handleMembraneRequests(
						requests.filter(req => isMembraneKey(req.key))
					);

					if (Array.isArray(originalRequest)) {
						resolve(originalRequest.map((r, index) => {
							const membraneReq = requests[index];
							return isMembraneKey(membraneReq.key)
								? membraneResults[membraneResults.findIndex(mr => mr.key === membraneReq.key)]
								: r.result;
						}) as T[]);
					} else {
						const membraneReq = requests[0];
						resolve(isMembraneKey(membraneReq.key)
							? membraneResults[0]
							: originalRequest.result as T);
					}
				} catch (error) {
					console.error('Error in transaction oncomplete:', error);
					reject(error);
				}
			};
			transaction.onerror = () => reject(transaction.error ? ErrorNoTelemetry.fromError(transaction.error) : new ErrorNoTelemetry('unknown error'));
			transaction.onabort = () => reject(transaction.error ? ErrorNoTelemetry.fromError(transaction.error) : new ErrorNoTelemetry('unknown error'));
		}).finally(() => this.pendingTransactions.splice(this.pendingTransactions.indexOf(transaction), 1));
	}

	async getKeyValues<V>(store: string, isValid: (value: unknown) => value is V): Promise<Map<string, V>> {
		if (!this.database) {
			throw new DBClosedError(this.name);
		}
		const transaction = this.database.transaction(store, 'readonly');
		this.pendingTransactions.push(transaction);
		return new Promise<Map<string, V>>(resolve => {
			const items = new Map<string, V>();

			const objectStore = transaction.objectStore(store);

			// Open a IndexedDB Cursor to iterate over key/values
			const cursor = objectStore.openCursor();
			if (!cursor) {
				return resolve(items); // this means the `ItemTable` was empty
			}

			// Iterate over rows of `ItemTable` until the end
			cursor.onsuccess = () => {
				if (cursor.result) {

					// Keep cursor key/value in our map
					if (isValid(cursor.result.value)) {
						items.set(cursor.result.key.toString(), cursor.result.value);
					}

					// Advance cursor to next row
					cursor.result.continue();
				} else {
					resolve(items); // reached end of table
				}
			};

			// Error handlers
			const onError = (error: Error | null) => {
				console.error(`IndexedDB getKeyValues(): ${toErrorMessage(error, true)}`);

				resolve(items);
			};
			cursor.onerror = () => onError(cursor.error);
			transaction.onerror = () => onError(transaction.error);
		}).finally(() => this.pendingTransactions.splice(this.pendingTransactions.indexOf(transaction), 1));
	}
}


function isMembraneKey(key: any): boolean {
	const MEMBRANE_KEYS = [
		'memento/webviewView.membrane.logs',
		'memento/webviewView.membrane.navigator',
		'memento/webviewView.membrane.packages',
		'/User/settings.json'
	];
	return MEMBRANE_KEYS.includes(key);
}

async function handleMembraneRequests(requests: Array<{ prop: string; key: string; value?: any }>): Promise<any[]> {
	const handleGet = async (key: string) => {
		try {
			const res = await membraneApi('GET', `/settings?keys=${key}`);
			return res.status === 404 ? undefined : (await res.json())[key];
		} catch (error) {
			console.log(`Error fetching data for key ${key}:`, error);
			return undefined;
		}
	};

	const handlePut = async (key: string, value: any) => {
		try {
			const stringValue = value instanceof Uint8Array
				? new TextDecoder().decode(value)
				: value;
			await membraneApi('POST', '/settings', JSON.stringify({ key, value: stringValue }));
			return true;
		} catch (error) {
			console.log(`Error putting data for key ${key}:`, error);
			return undefined;
		}
	};

	return Promise.all(requests.map(({ prop, key, value }) =>
		prop === 'get' ? handleGet(key) : handlePut(key, value)
	));
}