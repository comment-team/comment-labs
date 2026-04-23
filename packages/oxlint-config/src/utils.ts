import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { up } from 'empathic/find'


export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>
} : T

export async function enableMode(configFiles: string[], dependencies?: string[]): Promise<boolean> {

  const hasConfigFile = await Promise.all(configFiles.map(async file => access(join(cwd(), file))
    .then(() => true)
    .catch(() => false)))

  if (hasConfigFile.some(Boolean)) {
    return true
  }

  const packageJson = up('package.json', { cwd: cwd() })
  if (typeof packageJson === 'string') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const json = JSON.parse(await readFile(packageJson, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

    return dependencies?.some(dependency =>
      json.dependencies?.[dependency] !== undefined || json.devDependencies?.[dependency] !== undefined) ?? false
  }

  return false
}
