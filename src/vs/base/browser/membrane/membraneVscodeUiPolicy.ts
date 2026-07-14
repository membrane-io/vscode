/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator, SubmenuAction } from '../../common/actions.js';
import { ResolvedKeybinding } from '../../common/keybindings.js';

export interface VscodeUiMenuItem {
	id: string;
	label: string;
	enabled: boolean;
	checked?: boolean;
	keybinding?: string;
	submenu?: VscodeUiMenuItem[];
	separator?: boolean;
}

export const DENIED_COMMANDS = new Set<string>([
	'workbench.action.showCommands',
	'workbench.action.toggleZenMode',
	'workbench.action.splitEditor',
	'workbench.action.splitEditorOrthogonal',
	'workbench.action.splitEditorDown',
	'workbench.action.splitEditorLeft',
	'workbench.action.splitEditorRight',
	'workbench.action.splitEditorUp',
	// Peek widgets and the references view are native VS Code UI membrane doesn't render.
	'editor.action.goToReferences',
	'references-view.findReferences',
	'references-view.findImplementations',
	'references-view.showCallHierarchy',
	// Niche navigation that mostly lands in .d.ts noise for membrane programs.
	'editor.action.goToTypeDefinition',
	'editor.action.goToImplementation',
	'typescript.goToSourceDefinition',
	// Formatter picker: prettier is the only formatter we ship.
	'editor.action.formatDocument.multiple',
]);

export const DENIED_MENU_GROUPS = new Set<string>([
	'11_share',
	'1_chat',
	'debug',
	'testing',
]);

export const DENIED_SUBMENUS = new Set<string>([
	'copy as',
	'share',
	'copyas',
	// Peek definition/references/implementations: all native zone widgets.
	'peek',
]);

export interface FilterActionsOptions {
	getKeyBinding?: (action: IAction) => ResolvedKeybinding | undefined;
	deniedGroups?: Set<string>;
}

export interface FilterActionsResult {
	items: VscodeUiMenuItem[];
	live: Map<string, IAction>;
}

let nextActionId = 0;

function isDeniedSubmenu(submenu: SubmenuAction): boolean {
	const label = submenu.label?.toLowerCase() ?? '';
	for (const denied of DENIED_SUBMENUS) {
		if (label.includes(denied)) {
			return true;
		}
	}
	return false;
}

function serializeAction(
	action: IAction,
	options: FilterActionsOptions,
	live: Map<string, IAction>,
): VscodeUiMenuItem | undefined {
	if (action instanceof Separator || action.id === Separator.ID) {
		return { id: `sep-${nextActionId++}`, label: '', enabled: false, separator: true };
	}

	if (action instanceof SubmenuAction) {
		if (isDeniedSubmenu(action)) {
			return undefined;
		}
		const submenuItems: VscodeUiMenuItem[] = [];
		for (const child of action.actions) {
			const item = serializeAction(child, options, live);
			if (item) {
				submenuItems.push(item);
			}
		}
		if (submenuItems.length === 0) {
			return undefined;
		}
		const id = `submenu-${nextActionId++}`;
		live.set(id, action);
		return {
			id,
			label: action.label,
			enabled: action.enabled,
			submenu: submenuItems,
		};
	}

	if (action.id && DENIED_COMMANDS.has(action.id)) {
		return undefined;
	}

	const id = `action-${nextActionId++}`;
	live.set(id, action);
	const keybinding = options.getKeyBinding?.(action)?.getLabel();
	return {
		id,
		label: action.label,
		enabled: action.enabled,
		checked: action.checked,
		keybinding: keybinding ?? undefined,
	};
}

export function filterMenuGroups(
	groups: [string, IAction[]][],
	options: FilterActionsOptions = {},
): FilterActionsResult {
	const live = new Map<string, IAction>();
	const items: VscodeUiMenuItem[] = [];
	const deniedGroups = options.deniedGroups ?? DENIED_MENU_GROUPS;

	for (const [groupId, actions] of groups) {
		if (deniedGroups.has(groupId)) {
			continue;
		}
		for (const action of actions) {
			const item = serializeAction(action, options, live);
			if (item) {
				items.push(item);
			}
		}
	}

	return { items: collapseSeparators(items), live };
}

export function filterActions(
	actions: readonly IAction[],
	options: FilterActionsOptions = {},
): FilterActionsResult {
	const live = new Map<string, IAction>();
	const items: VscodeUiMenuItem[] = [];

	for (const action of actions) {
		const item = serializeAction(action, options, live);
		if (item) {
			items.push(item);
		}
	}

	return { items: collapseSeparators(items), live };
}

function collapseSeparators(items: VscodeUiMenuItem[]): VscodeUiMenuItem[] {
	const result: VscodeUiMenuItem[] = [];
	for (const item of items) {
		if (item.separator) {
			if (result.length === 0 || result[result.length - 1].separator) {
				continue;
			}
		}
		result.push(item);
	}
	if (result.length > 0 && result[result.length - 1].separator) {
		result.pop();
	}
	return result;
}
