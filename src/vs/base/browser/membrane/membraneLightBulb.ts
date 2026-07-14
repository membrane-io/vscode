/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MembraneVscodeUiSessions, VscodeUiAnchor } from './membraneVscodeUi.js';

export const LIGHTBULB_SESSION_ID = 'membrane-lightbulb';

export type LightbulbIcon = 'lightbulb' | 'autofix' | 'sparkle' | 'sparkleFilled';

export interface LightbulbPayload {
	icon: LightbulbIcon;
	title: string;
	gutter?: boolean;
}

let clickHandler: (() => void) | undefined;

export class MembraneLightBulb {

	static show(anchor: VscodeUiAnchor, payload: LightbulbPayload, onClick: () => void): void {
		clickHandler = onClick;

		MembraneVscodeUiSessions.register(LIGHTBULB_SESSION_ID, 'lightbulb', {
			onSelect: () => {
				clickHandler?.();
			},
		});

		MembraneVscodeUiSessions.send({
			id: LIGHTBULB_SESSION_ID,
			lifecycle: 'show',
			kind: 'lightbulb',
			anchor,
			payload,
		});
	}

	static hide(): void {
		MembraneVscodeUiSessions.unregister(LIGHTBULB_SESSION_ID);
		clickHandler = undefined;
	}
}
