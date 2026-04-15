import { execFileSync } from 'node:child_process'
import path from 'node:path'

import type { GitContext } from './types'


const gitSuffix = '.git'
const githubPathPrefixPattern = /^[/:]+/

export function getGitContext(cwd: string): GitContext {
  const root = runGit(cwd, [ 'rev-parse', '--show-toplevel' ])
  if (root === null) {
    return {
      root: null,
      originUrl: null,
      repositoryName: null,
      githubRepo: null,
      baseBranch: null
    }
  }

  const originUrl = runGit(cwd, [ 'remote', 'get-url', 'origin' ])
  const repositoryName = originUrl !== null ? parseRepositoryName(originUrl) : path.basename(root)
  const githubRepo = originUrl !== null ? parseGithubRepo(originUrl) : null
  const baseBranch
    = runGit(cwd, [ 'symbolic-ref', 'refs/remotes/origin/HEAD' ])?.replace('refs/remotes/origin/', '')
    ?? runGit(cwd, [ 'rev-parse', '--abbrev-ref', 'HEAD' ])
    ?? 'main'

  return {
    root,
    originUrl,
    repositoryName,
    githubRepo,
    baseBranch
  }
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8' })

    return stdout.trim() || null
  } catch {
    return null
  }
}

function parseRepositoryName(originUrl: string): string {
  const repo = stripGitSuffix(originUrl).split('/').at(-1)

  return repo !== undefined && repo.length > 0 ? repo : originUrl
}

function parseGithubRepo(originUrl: string): string | null {
  const normalized = stripGitSuffix(originUrl)
  const githubIndex = normalized.indexOf('github.com')
  if (githubIndex === -1) {
    return null
  }

  const repoPath = normalized.slice(githubIndex + 'github.com'.length).replace(githubPathPrefixPattern, '')
  const [ owner, repo ] = repoPath.split('/')
  if (owner === undefined || owner.length === 0 || repo === undefined || repo.length === 0) {
    return null
  }

  return `${owner}/${repo}`
}

function stripGitSuffix(originUrl: string): string {
  return originUrl.endsWith(gitSuffix) ? originUrl.slice(0, -gitSuffix.length) : originUrl
}
