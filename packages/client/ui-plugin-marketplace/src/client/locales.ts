/** `settings.pluginMarketplace` namespace dictionaries (the marketplace tab). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  tab: '插件市场',
  search: '搜索插件',
  searchPlaceholder: '搜索 npm 上的 dsh 插件（关键词 dsh-plugin）…',
  searchButton: '搜索',
  searching: '正在搜索 npm 插件…',
  searchFailed: '搜索失败：',
  retry: '重试',
  catalog: '插件市场',
  empty: '没有匹配的插件。',
  install: '安装',
  installing: '安装中…',
  uninstall: '卸载',
  uninstalling: '卸载中…',
  installedTag: '已安装',
  installedTitle: '已安装的插件',
  installedEmpty: '还没有从市场安装过插件。安装后重启服务即可生效。',
  active: '已加入激活层',
  installDone: '安装成功：',
  installFailed: '安装失败：',
  uninstallDone: '已卸载：',
  uninstallFailed: '卸载失败：',
  restartHint: '新插件将在服务重启后生效。',
  loadingInstalled: '正在读取已安装插件…',
} satisfies Record<string, string>

/** The settings.pluginMarketplace namespace key union. */
export type MarketplaceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  tab: 'Marketplace',
  search: 'Search plugins',
  searchPlaceholder: 'Search dsh plugins on npm (keyword dsh-plugin)…',
  searchButton: 'Search',
  searching: 'Searching npm…',
  searchFailed: 'Search failed: ',
  retry: 'Retry',
  catalog: 'Marketplace',
  empty: 'No matching plugins.',
  install: 'Install',
  installing: 'Installing…',
  uninstall: 'Uninstall',
  uninstalling: 'Uninstalling…',
  installedTag: 'Installed',
  installedTitle: 'Installed plugins',
  installedEmpty: 'Nothing installed from the marketplace yet. Plugins activate after a service restart.',
  active: 'in activation layer',
  installDone: 'Installed: ',
  installFailed: 'Install failed: ',
  uninstallDone: 'Uninstalled: ',
  uninstallFailed: 'Uninstall failed: ',
  restartHint: 'New plugins take effect after the service restarts.',
  loadingInstalled: 'Reading installed plugins…',
} satisfies Record<MarketplaceKey, string>
