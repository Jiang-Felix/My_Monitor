// Electron manages Windows login registration and quotes executable paths itself.
export class StartupPreference {
  constructor(app, executable) { this.app = app; this.executable = executable; }
  get() {
    if (!this.app.isPackaged) return false;
    const settings=this.app.getLoginItemSettings({ path: this.executable, args: [] });
    return !!settings.openAtLogin && settings.executableWillLaunchAtLogin!==false;
  }
  set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效');
    if (!this.app.isPackaged) throw new Error('开机自启仅支持打包后的应用程序');
    this.app.setLoginItemSettings({ openAtLogin: enabled, enabled, path: this.executable, args: [] });
    if (this.get() !== enabled) throw new Error('开机自启设置未生效，请检查系统启动应用设置');
    return enabled;
  }
}
