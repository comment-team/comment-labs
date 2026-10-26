import type { isCompatible } from './check'


export function inline(oldContent: string, newContent: string): Parameters<typeof isCompatible>[0] {
  return {
    base: 'old.ts',
    candidate: 'new.ts',
    options: {
      files: {
        base: oldContent,
        candidate: newContent
      }
    }
  }
}
