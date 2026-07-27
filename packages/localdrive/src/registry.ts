import type { Localdrive } from './localdrive'


const localdriveRegistry = new Map<string, Localdrive>()

export function getLocaldrive(projectName: string): Localdrive | undefined {
  return localdriveRegistry.get(projectName)
}

export function registerLocaldrive(projectName: string, controller: Localdrive): void {
  localdriveRegistry.set(projectName, controller)
}

export function unregisterLocaldrive(projectName: string): void {
  localdriveRegistry.delete(projectName)
}
