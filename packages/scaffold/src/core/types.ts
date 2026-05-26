export type JsonObject = { [key: string]: JsonValue | undefined }

export type JsonValue = boolean | number | string | null | JsonValue[] | JsonObject

export type PackageJson = {
  [key: string]: JsonValue | undefined
  name?: string
  private?: boolean
  packageManager?: string
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  configDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type StoredPreferences = Record<string, JsonValue>

export type StepDecision = 'apply' | 'skip' | 'merge' | 'abort'

export type PromptChoice = {
  title: string
  value: string
  selected?: boolean
}

export type WorkspacePackageSelection = {
  name: string
  selected: boolean
}

export type GitContext = {
  root: string | null
  originUrl: string | null
  repositoryName: string | null
  githubRepo: string | null
  baseBranch: string | null
}

export type AppContext = {
  cwd: string
  autoApprove: boolean
  git: GitContext
  preferencesPath: string
  packageJsonPath: string
  packageJson: PackageJson | null
  packageJsonIndent: string
  packageJsonNewline: string
  preferences: StoredPreferences
  changedFiles: Set<string>
  persistPreferencesOnExit: boolean
  workspacePackages: import('./package-step').WorkspacePackage[] | null
}
