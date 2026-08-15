import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConfigStore } from './workspace/config'
import { createLibraryStore } from './workspace/library-store'
import { createSkillWorkspace, type SetSkillEnabledInput, type SetSyndicationInput } from './workspace/skill-workspace'
import type {
  CreateSkillInput,
  ImportSkillArchiveInput,
  InstallRepoSkillInput,
  MachineRecord,
  SkillCategory,
  WorkspaceConfig,
} from './workspace/types'

// In dev the dock/menu show the default "Electron" name; override it before the
// app is ready. (Packaged builds get the name from build.productName.)
app.setName('Skilldex')

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 720,
    title: 'Skilldex',
    backgroundColor: '#09090b',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // In dev the macOS dock shows the default Electron icon; set ours explicitly.
  // (Packaged builds get the icon from build/icon.icns via electron-builder.)
  if (process.platform === 'darwin' && app.dock) {
    const devIcon = path.join(app.getAppPath(), 'build', 'icon.png')
    if (existsSync(devIcon)) app.dock.setIcon(nativeImage.createFromPath(devIcon))
  }

  const configStore = createConfigStore(path.join(app.getPath('userData'), 'config.json'))
  const workspace = createSkillWorkspace({
    homeDir: os.homedir(),
    configStore,
    // Machine management from the desktop app works when the agent bundle is
    // built (dev checkouts); packaged builds without it degrade gracefully.
    agentPath: path.join(app.getAppPath(), 'out', 'agent', 'skilldex-agent.js'),
    libraryStore: createLibraryStore(path.join(app.getPath('userData'), 'library.json')),
  })

  ipcMain.handle('skilldex:get-config', () => workspace.getConfig())
  ipcMain.handle('skilldex:get-snapshot', () => workspace.getSnapshot())
  ipcMain.handle('skilldex:configure-sources', (_event, config: WorkspaceConfig) =>
    workspace.configureSources(config),
  )
  ipcMain.handle('skilldex:get-skill-readme', (_event, id: string) => workspace.getSkillReadme(id))
  ipcMain.handle('skilldex:list-skill-files', (_event, id: string) => workspace.listSkillFiles(id))
  ipcMain.handle('skilldex:reveal-skill', async (_event, id: string) => {
    const target = await workspace.resolveSkillPath(id)
    if (target) shell.showItemInFolder(target)
    return target !== null
  })
  ipcMain.handle('skilldex:pick-directory', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(parent, {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    const picked = result.canceled ? undefined : result.filePaths[0]
    return picked && existsSync(picked) ? picked : null
  })
  ipcMain.handle('skilldex:enable-skill', (_event, id: string) => workspace.enableSkill(id))
  ipcMain.handle('skilldex:disable-skill', (_event, id: string) => workspace.disableSkill(id))
  ipcMain.handle('skilldex:remove-skill', (_event, id: string) => workspace.removeSkill(id))
  ipcMain.handle('skilldex:toggle-favourite', (_event, id: string) => workspace.toggleFavourite(id))
  ipcMain.handle('skilldex:create-skill', (_event, input: CreateSkillInput) => workspace.createSkill(input))
  ipcMain.handle('skilldex:import-skill-archive', (_event, input: ImportSkillArchiveInput) =>
    workspace.importSkillArchive(input),
  )
  ipcMain.handle('skilldex:list-repo-catalogs', () => workspace.listRepoCatalogs())
  ipcMain.handle('skilldex:add-skill-repo', (_event, input: string) => workspace.addSkillRepo(input))
  ipcMain.handle('skilldex:remove-skill-repo', (_event, slug: string) => workspace.removeSkillRepo(slug))
  ipcMain.handle('skilldex:refresh-skill-repo', (_event, slug: string) => workspace.refreshSkillRepo(slug))
  ipcMain.handle('skilldex:install-repo-skill', (_event, input: InstallRepoSkillInput) =>
    workspace.installRepoSkill(input),
  )
  ipcMain.handle('skilldex:list-machines', () => workspace.listMachineSnapshots())
  ipcMain.handle('skilldex:add-machine', (_event, machine: MachineRecord) => workspace.addMachine(machine))
  ipcMain.handle('skilldex:update-machine', (_event, name: string, machine: MachineRecord) =>
    workspace.updateMachine(name, machine),
  )
  ipcMain.handle('skilldex:remove-machine', (_event, name: string) => workspace.removeMachine(name))
  ipcMain.handle('skilldex:refresh-machine', (_event, name: string) => workspace.refreshMachine(name))
  ipcMain.handle('skilldex:machine-install', (_event, name: string, input: InstallRepoSkillInput) =>
    workspace.installOnMachine(name, input),
  )
  ipcMain.handle(
    'skilldex:machine-skill-op',
    (_event, name: string, op: 'enable' | 'disable' | 'remove', id: string) =>
      workspace.machineSkillOp(name, op, id),
  )
  ipcMain.handle('skilldex:set-syndication', (_event, input: SetSyndicationInput) =>
    workspace.setSyndication(input),
  )
  ipcMain.handle('skilldex:set-skill-enabled', (_event, input: SetSkillEnabledInput) =>
    workspace.setSkillEnabled(input),
  )
  ipcMain.handle('skilldex:machine-diff', (_event, name: string) => workspace.machineDiff(name))
  ipcMain.handle('skilldex:adopt-from-machine', (_event, name: string, skillIds: string[]) =>
    workspace.adoptFromMachine(name, skillIds),
  )
  ipcMain.handle('skilldex:converge-machine', (_event, name: string, dirNames?: string[]) =>
    workspace.convergeMachine(name, dirNames),
  )
  ipcMain.handle('skilldex:categorize-library', (_event, options?: { force?: boolean }) =>
    workspace.categorizeLibrary(options),
  )
  ipcMain.handle('skilldex:set-skill-category', (_event, id: string, category: SkillCategory | null) =>
    workspace.setSkillCategory(id, category),
  )

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
