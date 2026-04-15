export function changesetConfigTemplate(options: {
  access: 'public' | 'restricted'
  baseBranch: string
  changelogRepo?: string
  packageVersion: string
}): string {
  const config = {
    $schema: `https://unpkg.com/@changesets/config@${options.packageVersion}/schema.json`,
    changelog: options.changelogRepo !== undefined
      ? [
        '@changesets/changelog-github',
        { repo: options.changelogRepo }
      ]
      : '@changesets/cli/changelog',
    commit: false,
    fixed: [] as string[],
    linked: [] as string[],
    access: options.access,
    baseBranch: options.baseBranch,
    updateInternalDependencies: 'patch',
    ignore: [] as string[]
  }

  return `${JSON.stringify(config, null, 2)}\n`
}
