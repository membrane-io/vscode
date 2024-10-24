/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/titlebarpart';
import { localize, localize2 } from 'vs/nls';
import { MultiWindowParts, Part } from 'vs/workbench/browser/part';
import { ITitleService } from 'vs/workbench/services/title/browser/titleService';
import { getZoomFactor, isWCOEnabled } from 'vs/base/browser/browser';
import { MenuBarVisibility, getTitleBarStyle, getMenuBarVisibility, TitlebarStyle, hasCustomTitlebar, hasNativeTitlebar } from 'vs/platform/window/common/window';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { IBrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ThemeIcon } from 'vs/base/common/themables';
import { TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_ACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_BACKGROUND, TITLE_BAR_BORDER, WORKBENCH_BACKGROUND } from 'vs/workbench/common/theme';
import { isMacintosh, isWindows, isLinux, isWeb, isNative, platformLocale } from 'vs/base/common/platform';
import { Color } from 'vs/base/common/color';
import { EventType, EventHelper, Dimension, append, $, addDisposableListener, prepend, reset, getWindow, getWindowId, isAncestor, getActiveDocument } from 'vs/base/browser/dom';
import { CustomMenubarControl } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Emitter, Event } from 'vs/base/common/event';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { Parts, IWorkbenchLayoutService, ActivityBarPosition, LayoutSettings, EditorActionsLocation, EditorTabsMode } from 'vs/workbench/services/layout/browser/layoutService';
import { createActionViewItem, createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { Action2, IMenu, IMenuService, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { Codicon } from 'vs/base/common/codicons';
import { getIconRegistry } from 'vs/platform/theme/common/iconRegistry';
import { WindowTitle } from 'vs/workbench/browser/parts/titlebar/windowTitle';
import { CommandCenterControl } from 'vs/workbench/browser/parts/titlebar/commandCenterControl';
import { IHoverDelegate } from 'vs/base/browser/ui/iconLabel/iconHoverDelegate';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { WorkbenchToolBar } from 'vs/platform/actions/browser/toolbar';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from 'vs/workbench/common/activity';
import { SimpleAccountActivityActionViewItem, SimpleGlobalActivityActionViewItem } from 'vs/workbench/browser/parts/globalCompositeBar';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { IEditorGroupsContainer, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ActionsOrientation, IActionViewItem, prepareActions } from 'vs/base/browser/ui/actionbar/actionbar';
import { EDITOR_CORE_NAVIGATION_COMMANDS } from 'vs/workbench/browser/parts/editor/editorCommands';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybinding } from 'vs/base/common/keybindings';
import { EditorCommandsContextActionRunner } from 'vs/workbench/browser/parts/editor/editorTabsControl';
import { IEditorCommandsContext, IEditorPartOptionsChangeEvent, IToolbarActions } from 'vs/workbench/common/editor';
import { mainWindow } from 'vs/base/browser/window';
import { ACCOUNTS_ACTIVITY_TILE_ACTION, GLOBAL_ACTIVITY_TITLE_ACTION } from 'vs/workbench/browser/parts/titlebar/titlebarActions';
import { IView } from 'vs/base/browser/ui/grid/grid';
import { ICommandService } from 'vs/platform/commands/common/commands';

export interface ITitleProperties {
	isPure?: boolean;
	isAdmin?: boolean;
	prefix?: string;
}

export interface ITitlebarPart extends IDisposable {

	/**
	 * An event when the menubar visibility changes.
	 */
	readonly onMenubarVisibilityChange: Event<boolean>;

	/**
	 * Update some environmental title properties.
	 */
	updateProperties(properties: ITitleProperties): void;
}

export class BrowserTitleService extends MultiWindowParts<BrowserTitlebarPart> implements ITitleService {

	declare _serviceBrand: undefined;

	readonly mainPart = this._register(this.createMainTitlebarPart());

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService
	) {
		super('workbench.titleService', themeService, storageService);

		this._register(this.registerPart(this.mainPart));

		this.registerActions();
	}

	protected createMainTitlebarPart(): BrowserTitlebarPart {
		return this.instantiationService.createInstance(MainBrowserTitlebarPart);
	}

	private registerActions(): void {

		// Focus action
		const that = this;
		registerAction2(class FocusTitleBar extends Action2 {

			constructor() {
				super({
					id: `workbench.action.focusTitleBar`,
					title: localize2('focusTitleBar', 'Focus Title Bar'),
					category: Categories.View,
					f1: true,
				});
			}

			run(): void {
				that.getPartByDocument(getActiveDocument()).focus();
			}
		});
	}

	//#region Auxiliary Titlebar Parts

	createAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer): IAuxiliaryTitlebarPart {
		const titlebarPartContainer = document.createElement('div');
		titlebarPartContainer.classList.add('part', 'titlebar');
		titlebarPartContainer.setAttribute('role', 'none');
		titlebarPartContainer.style.position = 'relative';
		container.insertBefore(titlebarPartContainer, container.firstChild); // ensure we are first element

		const disposables = new DisposableStore();

		const titlebarPart = this.doCreateAuxiliaryTitlebarPart(titlebarPartContainer, editorGroupsContainer);
		disposables.add(this.registerPart(titlebarPart));

		disposables.add(Event.runAndSubscribe(titlebarPart.onDidChange, () => titlebarPartContainer.style.height = `${titlebarPart.height}px`));
		titlebarPart.create(titlebarPartContainer);

		Event.once(titlebarPart.onWillDispose)(() => disposables.dispose());

		return titlebarPart;
	}

	protected doCreateAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer): BrowserTitlebarPart & IAuxiliaryTitlebarPart {
		return this.instantiationService.createInstance(AuxiliaryBrowserTitlebarPart, container, editorGroupsContainer, this.mainPart);
	}

	//#endregion


	//#region Service Implementation

	readonly onMenubarVisibilityChange = this.mainPart.onMenubarVisibilityChange;

	updateProperties(properties: ITitleProperties): void {
		for (const part of this.parts) {
			part.updateProperties(properties);
		}
	}

	//#endregion
}

class TitlebarPartHoverDelegate implements IHoverDelegate {

	readonly showHover = this.hoverService.showHover.bind(this.hoverService);
	readonly placement = 'element';

	private lastHoverHideTime: number = 0;
	get delay(): number {
		return Date.now() - this.lastHoverHideTime < 200
			? 0  // show instantly when a hover was recently shown
			: this.configurationService.getValue<number>('workbench.hover.delay');
	}

	constructor(
		@IHoverService private readonly hoverService: IHoverService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) { }

	onDidHideHover() {
		this.lastHoverHideTime = Date.now();
	}
}

export class BrowserTitlebarPart extends Part implements ITitlebarPart {

	//#region IView

	readonly minimumWidth: number = 0;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;

	get minimumHeight(): number {
		const value = this.isCommandCenterVisible || (isWeb && isWCOEnabled()) ? 35 : 30;

		return value / (this.preventZoom ? getZoomFactor(getWindow(this.element)) : 1);
	}

	get maximumHeight(): number { return this.minimumHeight; }

	//#endregion

	//#region Events

	private _onMenubarVisibilityChange = this._register(new Emitter<boolean>());
	readonly onMenubarVisibilityChange = this._onMenubarVisibilityChange.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	//#endregion

	protected rootContainer!: HTMLElement;
	protected primaryWindowControls: HTMLElement | undefined;
	protected dragRegion: HTMLElement | undefined;
	private title!: HTMLElement;

	private leftContent!: HTMLElement;
	private centerContent!: HTMLElement;
	private rightContent!: HTMLElement;

	protected customMenubar: CustomMenubarControl | undefined;

	// MEMBRANE: our tittlebar logo and buttons
	protected appIcon: HTMLElement | undefined;
	protected newButton: HTMLElement | undefined;
	protected searchButton: HTMLElement | undefined;

	private appIconBadge: HTMLElement | undefined;
	protected menubar?: HTMLElement;
	private lastLayoutDimensions: Dimension | undefined;

	private actionToolBar!: WorkbenchToolBar;
	private actionToolBarDisposable = this._register(new DisposableStore());
	private editorActionsChangeDisposable = this._register(new DisposableStore());
	private actionToolBarElement!: HTMLElement;

	private layoutToolbarMenu: IMenu | undefined;
	private readonly editorToolbarMenuDisposables = this._register(new DisposableStore());
	private readonly layoutToolbarMenuDisposables = this._register(new DisposableStore());

	private readonly hoverDelegate = new TitlebarPartHoverDelegate(this.hoverService, this.configurationService);

	private readonly titleDisposables = this._register(new DisposableStore());
	private titleBarStyle: TitlebarStyle = getTitleBarStyle(this.configurationService);

	private isInactive: boolean = false;
	private readonly isAuxiliary: boolean;

	private readonly windowTitle: WindowTitle;

	private readonly editorService: IEditorService;
	private readonly editorGroupsContainer: IEditorGroupsContainer;

	constructor(
		id: string,
		targetWindow: Window,
		editorGroupsContainer: IEditorGroupsContainer | 'main',
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService protected readonly environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IHostService private readonly hostService: IHostService,
		@IHoverService private readonly hoverService: IHoverService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService private readonly menuService: IMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, { hasTitle: false }, themeService, storageService, layoutService);

		this.isAuxiliary = editorGroupsContainer !== 'main';
		this.editorService = editorService.createScoped(editorGroupsContainer, this._store);
		this.editorGroupsContainer = editorGroupsContainer === 'main' ? editorGroupService.mainPart : editorGroupsContainer;

		this.windowTitle = this._register(instantiationService.createInstance(WindowTitle, targetWindow, editorGroupsContainer));

		this.registerListeners(getWindowId(targetWindow));
	}

	private registerListeners(targetWindowId: number): void {
		this._register(this.hostService.onDidChangeFocus(focused => focused ? this.onFocus() : this.onBlur()));
		this._register(this.hostService.onDidChangeActiveWindow(windowId => windowId === targetWindowId ? this.onFocus() : this.onBlur()));
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationChanged(e)));
		this._register(this.editorGroupService.onDidChangeEditorPartOptions(e => this.onEditorPartConfigurationChange(e)));
	}

	private onBlur(): void {
		this.isInactive = true;

		this.updateStyles();
	}

	private onFocus(): void {
		this.isInactive = false;

		this.updateStyles();
	}

	private onEditorPartConfigurationChange({ oldPartOptions, newPartOptions }: IEditorPartOptionsChangeEvent): void {
		if (
			oldPartOptions.editorActionsLocation !== newPartOptions.editorActionsLocation ||
			oldPartOptions.showTabs !== newPartOptions.showTabs
		) {
			if (hasCustomTitlebar(this.configurationService, this.titleBarStyle) && this.actionToolBar) {
				this.createActionToolBar();
				this.createActionToolBarMenus({ editorActions: true });
				this._onDidChange.fire(undefined);
			}
		}
	}

	protected onConfigurationChanged(event: IConfigurationChangeEvent): void {

		// Custom menu bar (disabled if auxiliary)
		if (!this.isAuxiliary && !hasNativeTitlebar(this.configurationService, this.titleBarStyle) && (!isMacintosh || isWeb)) {
			if (event.affectsConfiguration('window.menuBarVisibility')) {
				if (this.currentMenubarVisibility === 'compact') {
					this.uninstallMenubar();
				} else {
					this.installMenubar();
				}
			}
		}

		// Actions
		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle) && this.actionToolBar) {
			const affectsLayoutControl = event.affectsConfiguration(LayoutSettings.LAYOUT_ACTIONS);
			const affectsActivityControl = event.affectsConfiguration(LayoutSettings.ACTIVITY_BAR_LOCATION);

			if (affectsLayoutControl || affectsActivityControl) {
				this.createActionToolBarMenus({ layoutActions: affectsLayoutControl, activityActions: affectsActivityControl });

				this._onDidChange.fire(undefined);
			}
		}

		// Command Center
		if (event.affectsConfiguration(LayoutSettings.COMMAND_CENTER)) {
			this.createTitle();

			this._onDidChange.fire(undefined);
		}
	}

	protected installMenubar(): void {
		if (this.menubar) {
			return; // If the menubar is already installed, skip
		}

		this.customMenubar = this._register(this.instantiationService.createInstance(CustomMenubarControl));

		this.menubar = append(this.leftContent, $('div.menubar'));
		this.menubar.setAttribute('role', 'menubar');

		this._register(this.customMenubar.onVisibilityChange(e => this.onMenubarVisibilityChanged(e)));

		this.customMenubar.create(this.menubar);
	}

	private uninstallMenubar(): void {
		this.customMenubar?.dispose();
		this.customMenubar = undefined;

		this.menubar?.remove();
		this.menubar = undefined;

		this.onMenubarVisibilityChanged(false);
	}

	protected onMenubarVisibilityChanged(visible: boolean): void {
		if (isWeb || isWindows || isLinux) {
			if (this.lastLayoutDimensions) {
				this.layout(this.lastLayoutDimensions.width, this.lastLayoutDimensions.height);
			}

			this._onMenubarVisibilityChange.fire(visible);
		}
	}

	updateProperties(properties: ITitleProperties): void {
		this.windowTitle.updateProperties(properties);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;
		this.rootContainer = append(parent, $('.titlebar-container'));

		this.leftContent = append(this.rootContainer, $('.titlebar-left'));
		this.centerContent = append(this.rootContainer, $('.titlebar-center'));
		this.rightContent = append(this.rootContainer, $('.titlebar-right'));

		// MEMBRANE: Home link at the top-left corner
		this.appIcon = prepend(this.leftContent, $('a.membrane-appicon'));
		const homeIndicator = this.environmentService.options?.homeIndicator;
		this.appIcon.setAttribute('href', homeIndicator?.href ?? 'https://membrane.io');
		append(this.appIcon, $.SVG('svg', { viewBox: '0 0 55 55' },
			$.SVG('path', { d: 'M23.41 35.93h.5l.2-.46 4.14-9.85a1425.49 1425.49 0 0 1 1.61-3.93l.32-.81a237.65 237.65 0 0 0 .02 5.2 71.5 71.5 0 0 0 .07 2.48l.3 6.66.02.71h9.08l-.05-.79-.98-16.6-.97-16.58-.04-.71h-7.99l-.2.47-7.6 19.11a49.6 49.6 0 0 0-1.35 3.68l-.4-1.17a92.1 92.1 0 0 0-.9-2.5L11.56 1.72l-.19-.47H3.26l-.05.7-1.95 33.19-.05.8H10.14l.02-.73.25-6.66a203.24 203.24 0 0 0 .1-5.67V20.67a1308.45 1308.45 0 0 0 2.05 5.35l.01.02v.02l4.06 9.41.19.45h6.59ZM39.57 35.97h5.68v5.68h-5.68z' })
		));

		// New program button
		// TODO: We need a command to create a new program
		// this.newButton = prepend(this.rightContent, $('a.membrane-new-program', {},
		// 	$.SVG('svg', { viewBox: '0 0 256 256', width: '14px', height: '14px' },
		// 		$.SVG('path', { d: 'M216.49,79.51l-56-56A12,12,0,0,0,152,20H56A20,20,0,0,0,36,40V216a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V88A12,12,0,0,0,216.49,79.51ZM160,57l23,23H160ZM60,212V44h76V92a12,12,0,0,0,12,12h48V212Zm104-60a12,12,0,0,1-12,12H140v12a12,12,0,0,1-24,0V164H104a12,12,0,0,1,0-24h12V128a12,12,0,0,1,24,0v12h12A12,12,0,0,1,164,152Z' })
		// 	),
		// 	'New Program'
		// ));

		// Search button
		this.searchButton = prepend(this.rightContent, $('a.membrane-package-search', {},
			$.SVG('svg', { viewBox: '0 0 256 256', width: '14px', height: '14px' },
				$.SVG('path', { d: 'M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z' })
			),
			'Find Programs'
		));
		// TODO: this button needs to change state when the package pane is actually open.
		this.searchButton.onclick = e => {
			e.preventDefault();
			e.stopPropagation();
			this.commandService.executeCommand('membrane.packages.search');
		};

		// App Icon (Native Windows/Linux and Web)
		if (!isMacintosh && !isWeb && !hasNativeTitlebar(this.configurationService, this.titleBarStyle)) {
			this.appIcon = prepend(this.leftContent, $('a.window-appicon'));

			// Web-only home indicator and menu (not for auxiliary windows)
			if (!this.isAuxiliary && isWeb) {
				const homeIndicator = this.environmentService.options?.homeIndicator;
				if (homeIndicator) {
					const icon: ThemeIcon = getIconRegistry().getIcon(homeIndicator.icon) ? { id: homeIndicator.icon } : Codicon.code;

					this.appIcon.setAttribute('href', homeIndicator.href);
					this.appIcon.classList.add(...ThemeIcon.asClassNameArray(icon));
					this.appIconBadge = document.createElement('div');
					this.appIconBadge.classList.add('home-bar-icon-badge');
					this.appIcon.appendChild(this.appIconBadge);
				}
			}
		}

		// Draggable region that we can manipulate for #52522
		this.dragRegion = prepend(this.rootContainer, $('div.titlebar-drag-region'));

		// Menubar: install a custom menu bar depending on configuration
		if (
			!this.isAuxiliary &&
			!hasNativeTitlebar(this.configurationService, this.titleBarStyle) &&
			(!isMacintosh || isWeb) &&
			this.currentMenubarVisibility !== 'compact'
		) {
			this.installMenubar();
		}

		// Title
		this.title = append(this.centerContent, $('div.window-title'));
		this.createTitle();

		// Create Toolbar Actions
		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle)) {
			this.actionToolBarElement = append(this.centerContent, $('div.action-toolbar-container'));
			this.createActionToolBar();
			this.createActionToolBarMenus();
		}

		let primaryControlLocation = isMacintosh ? 'left' : 'right';
		if (isMacintosh && isNative) {

			// Check if the locale is RTL, macOS will move traffic lights in RTL locales
			// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/textInfo

			const localeInfo = new Intl.Locale(platformLocale) as any;
			if (localeInfo?.textInfo?.direction === 'rtl') {
				primaryControlLocation = 'right';
			}
		}

		if (!hasNativeTitlebar(this.configurationService, this.titleBarStyle)) {
			this.primaryWindowControls = append(primaryControlLocation === 'left' ? this.leftContent : this.rightContent, $('div.window-controls-container.primary'));
			append(primaryControlLocation === 'left' ? this.rightContent : this.leftContent, $('div.window-controls-container.secondary'));
		}

		// Context menu over title bar: depending on the OS and the location of the click this will either be
		// the overall context menu for the entire title bar or a specific title context menu.
		// Windows / Linux: we only support the overall context menu on the title bar
		// macOS: we support both the overall context menu and the title context menu.
		//        in addition, we allow Cmd+click to bring up the title context menu.
		{
			this._register(addDisposableListener(this.rootContainer, EventType.CONTEXT_MENU, e => {
				EventHelper.stop(e);

				let targetMenu: MenuId;
				if (isMacintosh && e.target instanceof HTMLElement && isAncestor(e.target, this.title)) {
					targetMenu = MenuId.TitleBarTitleContext;
				} else {
					targetMenu = MenuId.TitleBarContext;
				}

				this.onContextMenu(e, targetMenu);
			}));

			if (isMacintosh) {
				this._register(addDisposableListener(this.title, EventType.MOUSE_DOWN, e => {
					if (e.metaKey) {
						EventHelper.stop(e, true /* stop bubbling to prevent command center from opening */);

						this.onContextMenu(e, MenuId.TitleBarTitleContext);
					}
				}, true /* capture phase to prevent command center from opening */));
			}
		}

		this.updateStyles();

		return this.element;
	}

	private createTitle(): void {
		this.titleDisposables.clear();

		// Text Title
		if (!this.isCommandCenterVisible) {
			this.title.innerText = this.windowTitle.value;
			this.titleDisposables.add(this.windowTitle.onDidChange(() => {
				this.title.innerText = this.windowTitle.value;
			}));
		}

		// Menu Title
		else {
			const commandCenter = this.instantiationService.createInstance(CommandCenterControl, this.windowTitle, this.hoverDelegate);
			reset(this.title, commandCenter.element);
			this.titleDisposables.add(commandCenter);
		}
	}

	private actionViewItemProvider(action: IAction): IActionViewItem | undefined {

		// --- Activity Actions
		if (!this.isAuxiliary) {
			if (action.id === GLOBAL_ACTIVITY_ID) {
				return this.instantiationService.createInstance(SimpleGlobalActivityActionViewItem, { position: () => HoverPosition.BELOW });
			}
			if (action.id === ACCOUNTS_ACTIVITY_ID) {
				return this.instantiationService.createInstance(SimpleAccountActivityActionViewItem, { position: () => HoverPosition.BELOW });
			}
		}

		// --- Editor Actions
		const activeEditorPane = this.editorGroupsContainer.activeGroup?.activeEditorPane;
		if (activeEditorPane && activeEditorPane instanceof EditorPane) {
			const result = activeEditorPane.getActionViewItem(action);

			if (result) {
				return result;
			}
		}

		// Check extensions
		return createActionViewItem(this.instantiationService, action, { hoverDelegate: this.hoverDelegate, menuAsChild: false });
	}

	private getKeybinding(action: IAction): ResolvedKeybinding | undefined {
		const editorPaneAwareContextKeyService = this.editorGroupsContainer.activeGroup?.activeEditorPane?.scopedContextKeyService ?? this.contextKeyService;

		return this.keybindingService.lookupKeybinding(action.id, editorPaneAwareContextKeyService);
	}

	private createActionToolBar() {

		// Creates the action tool bar. Depends on the configuration of the title bar menus
		// Requires to be recreated whenever editor actions enablement changes

		this.actionToolBarDisposable.clear();

		this.actionToolBar = this.actionToolBarDisposable.add(this.instantiationService.createInstance(WorkbenchToolBar, this.actionToolBarElement, {
			contextMenu: MenuId.TitleBarContext,
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: localize('ariaLabelTitleActions', "Title actions"),
			getKeyBinding: action => this.getKeybinding(action),
			overflowBehavior: { maxItems: 9, exempted: [ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID, ...EDITOR_CORE_NAVIGATION_COMMANDS] },
			anchorAlignmentProvider: () => AnchorAlignment.RIGHT,
			telemetrySource: 'titlePart',
			highlightToggledItems: this.editorActionsEnabled, // Only show toggled state for editor actions (Layout actions are not shown as toggled)
			actionViewItemProvider: action => this.actionViewItemProvider(action)
		}));

		if (this.editorActionsEnabled) {
			this.actionToolBarDisposable.add(this.editorGroupsContainer.onDidChangeActiveGroup(() => this.createActionToolBarMenus({ editorActions: true })));
		}
	}

	private createActionToolBarMenus(update: true | { editorActions?: boolean; layoutActions?: boolean; activityActions?: boolean } = true) {
		if (update === true) {
			update = { editorActions: true, layoutActions: true, activityActions: true };
		}

		const updateToolBarActions = () => {
			const actions: IToolbarActions = { primary: [], secondary: [] };

			// --- Editor Actions
			if (this.editorActionsEnabled) {
				this.editorActionsChangeDisposable.clear();

				const activeGroup = this.editorGroupsContainer.activeGroup;
				if (activeGroup) {
					const editorActions = activeGroup.createEditorActions(this.editorActionsChangeDisposable);

					actions.primary.push(...editorActions.actions.primary);
					actions.secondary.push(...editorActions.actions.secondary);

					this.editorActionsChangeDisposable.add(editorActions.onDidChange(() => updateToolBarActions()));
				}
			}

			// --- Layout Actions
			if (this.layoutToolbarMenu) {
				createAndFillInActionBarActions(
					this.layoutToolbarMenu,
					{},
					actions,
					() => !this.editorActionsEnabled // Layout Actions in overflow menu when editor actions enabled in title bar
				);
			}

			// --- Activity Actions
			if (this.activityActionsEnabled) {
				actions.primary.push(ACCOUNTS_ACTIVITY_TILE_ACTION);
				actions.primary.push(GLOBAL_ACTIVITY_TITLE_ACTION);
			}

			this.actionToolBar.setActions(prepareActions(actions.primary), prepareActions(actions.secondary));
		};

		// Create/Update the menus which should be in the title tool bar

		if (update.editorActions) {
			this.editorToolbarMenuDisposables.clear();

			// The editor toolbar menu is handled by the editor group so we do not need to manage it here.
			// However, depending on the active editor, we need to update the context and action runner of the toolbar menu.
			if (this.editorActionsEnabled && this.editorService.activeEditor !== undefined) {
				const context: IEditorCommandsContext = { groupId: this.editorGroupsContainer.activeGroup.id };

				this.actionToolBar.actionRunner = new EditorCommandsContextActionRunner(context);
				this.actionToolBar.context = context;
				this.editorToolbarMenuDisposables.add(this.actionToolBar.actionRunner);
			} else {
				this.actionToolBar.actionRunner = new ActionRunner();
				this.actionToolBar.context = {};

				this.editorToolbarMenuDisposables.add(this.actionToolBar.actionRunner);
			}
		}

		if (update.layoutActions) {
			this.layoutToolbarMenuDisposables.clear();

			if (this.layoutControlEnabled) {
				this.layoutToolbarMenu = this.menuService.createMenu(MenuId.LayoutControlMenu, this.contextKeyService);

				this.layoutToolbarMenuDisposables.add(this.layoutToolbarMenu);
				this.layoutToolbarMenuDisposables.add(this.layoutToolbarMenu.onDidChange(() => updateToolBarActions()));
			} else {
				this.layoutToolbarMenu = undefined;
			}
		}

		updateToolBarActions();
	}

	override updateStyles(): void {
		super.updateStyles();

		// Part container
		if (this.element) {
			if (this.isInactive) {
				this.element.classList.add('inactive');
			} else {
				this.element.classList.remove('inactive');
			}

			const titleBackground = this.getColor(this.isInactive ? TITLE_BAR_INACTIVE_BACKGROUND : TITLE_BAR_ACTIVE_BACKGROUND, (color, theme) => {
				// LCD Rendering Support: the title bar part is a defining its own GPU layer.
				// To benefit from LCD font rendering, we must ensure that we always set an
				// opaque background color. As such, we compute an opaque color given we know
				// the background color is the workbench background.
				return color.isOpaque() ? color : color.makeOpaque(WORKBENCH_BACKGROUND(theme));
			}) || '';
			this.element.style.backgroundColor = titleBackground;

			if (this.appIconBadge) {
				this.appIconBadge.style.backgroundColor = titleBackground;
			}

			if (titleBackground && Color.fromHex(titleBackground).isLighter()) {
				this.element.classList.add('light');
			} else {
				this.element.classList.remove('light');
			}

			const titleForeground = this.getColor(this.isInactive ? TITLE_BAR_INACTIVE_FOREGROUND : TITLE_BAR_ACTIVE_FOREGROUND);
			this.element.style.color = titleForeground || '';

			const titleBorder = this.getColor(TITLE_BAR_BORDER);
			this.element.style.borderBottom = titleBorder ? `1px solid ${titleBorder}` : '';
		}
	}

	protected onContextMenu(e: MouseEvent, menuId: MenuId): void {
		const event = new StandardMouseEvent(getWindow(this.element), e);

		// Show it
		this.contextMenuService.showContextMenu({
			getAnchor: () => event,
			menuId,
			contextKeyService: this.contextKeyService,
			domForShadowRoot: isMacintosh && isNative ? event.target : undefined
		});
	}

	protected get currentMenubarVisibility(): MenuBarVisibility {
		if (this.isAuxiliary) {
			return 'hidden';
		}

		return getMenuBarVisibility(this.configurationService);
	}

	private get layoutControlEnabled(): boolean {
		return !this.isAuxiliary && this.configurationService.getValue<boolean>(LayoutSettings.LAYOUT_ACTIONS) !== false;
	}

	protected get isCommandCenterVisible() {
		return this.configurationService.getValue<boolean>(LayoutSettings.COMMAND_CENTER) !== false;
	}

	private get editorActionsEnabled(): boolean {
		return this.editorGroupService.partOptions.editorActionsLocation === EditorActionsLocation.TITLEBAR ||
			(
				this.editorGroupService.partOptions.editorActionsLocation === EditorActionsLocation.DEFAULT &&
				this.editorGroupService.partOptions.showTabs === EditorTabsMode.NONE
			);
	}

	private get activityActionsEnabled(): boolean {
		return !this.isAuxiliary && this.configurationService.getValue<ActivityBarPosition>(LayoutSettings.ACTIVITY_BAR_LOCATION) === ActivityBarPosition.TOP;
	}

	get hasZoomableElements(): boolean {
		const hasMenubar = !(this.currentMenubarVisibility === 'hidden' || this.currentMenubarVisibility === 'compact' || (!isWeb && isMacintosh));
		const hasCommandCenter = this.isCommandCenterVisible;
		const hasToolBarActions = this.layoutControlEnabled || this.editorActionsEnabled || this.activityActionsEnabled;
		return hasMenubar || hasCommandCenter || hasToolBarActions;
	}

	get preventZoom(): boolean {
		// Prevent zooming behavior if any of the following conditions are met:
		// 1. Shrinking below the window control size (zoom < 1)
		// 2. No custom items are present in the title bar

		return getZoomFactor(getWindow(this.element)) < 1 || !this.hasZoomableElements;
	}

	override layout(width: number, height: number): void {
		this.updateLayout(new Dimension(width, height));

		super.layoutContents(width, height);
	}

	private updateLayout(dimension: Dimension): void {
		this.lastLayoutDimensions = dimension;

		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle)) {
			const zoomFactor = getZoomFactor(getWindow(this.element));

			this.element.style.setProperty('--zoom-factor', zoomFactor.toString());
			this.rootContainer.classList.toggle('counter-zoom', this.preventZoom);

			if (this.customMenubar) {
				const menubarDimension = new Dimension(0, dimension.height);
				this.customMenubar.layout(menubarDimension);
			}
		}
	}

	focus(): void {
		if (this.customMenubar) {
			this.customMenubar.toggleFocus();
		} else {
			(this.element.querySelector('[tabindex]:not([tabindex="-1"])') as HTMLElement).focus();
		}
	}

	toJSON(): object {
		return {
			type: Parts.TITLEBAR_PART
		};
	}

	override dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}

export class MainBrowserTitlebarPart extends BrowserTitlebarPart {

	constructor(
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@IHoverService hoverService: IHoverService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService commandService: ICommandService,
	) {
		super(Parts.TITLEBAR_PART, mainWindow, 'main', contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, hoverService, editorGroupService, editorService, menuService, keybindingService, commandService);
	}
}

export interface IAuxiliaryTitlebarPart extends ITitlebarPart, IView {
	readonly container: HTMLElement;
	readonly height: number;
}

export class AuxiliaryBrowserTitlebarPart extends BrowserTitlebarPart implements IAuxiliaryTitlebarPart {

	private static COUNTER = 1;

	get height() { return this.minimumHeight; }

	constructor(
		readonly container: HTMLElement,
		editorGroupsContainer: IEditorGroupsContainer,
		private readonly mainTitlebar: BrowserTitlebarPart,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@IHoverService hoverService: IHoverService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService commandService: ICommandService,
	) {
		const id = AuxiliaryBrowserTitlebarPart.COUNTER++;
		super(`workbench.parts.auxiliaryTitle.${id}`, getWindow(container), editorGroupsContainer, contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, hoverService, editorGroupService, editorService, menuService, keybindingService, commandService);
	}

	override get preventZoom(): boolean {

		// Prevent zooming behavior if any of the following conditions are met:
		// 1. Shrinking below the window control size (zoom < 1)
		// 2. No custom items are present in the main title bar
		// The auxiliary title bar never contains any zoomable items itself,
		// but we want to match the behavior of the main title bar.

		return getZoomFactor(getWindow(this.element)) < 1 || !this.mainTitlebar.hasZoomableElements;
	}
}
