import { execSync } from 'node:child_process'

export function gitInfo() {
  const git = {
    dirty: false,
    branch: '',
    commitHash: '',
    commitMessage: '',
  }
  let isGitDir = true
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      stdio: 'ignore',
    })
  } catch (err) {
    isGitDir = false
  }

  if (isGitDir) {
    const stdio = ['ignore', 'pipe', 'ignore']
    try {
      git.dirty = Boolean(execSync('git status --porcelain', { stdio }).toString().length)
      git.branch = execSync('git branch --show-current', { stdio }).toString().trim()
      git.commitHash = execSync('git rev-parse HEAD', { stdio }).toString().trim()
      git.commitMessage = execSync(`git show -s --format=%B ${git.commitHash}`, { stdio }).toString().trim()
    } catch (err) {
      // Ignore
    }
  }
  return git
}

export function getProjectEnv(project, args) {
  if (args.production) {
    return 'production'
  }
  if (args.preview) {
    return 'preview'
  }
  // Guess from git branch
  const git = gitInfo()
  if (!git.branch || git.branch === project?.productionBranch) {
    return 'production'
  }
  return 'preview'
}
