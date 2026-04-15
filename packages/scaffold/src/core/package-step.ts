import type { PackageJson } from './types'


export type WorkspacePackage = {
  dirName: string
  dirPath: string
  packageJsonPath: string
  packageJson: PackageJson
  indent: string
  newline: string
}
