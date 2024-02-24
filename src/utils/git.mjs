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
    try {
      git.dirty = Boolean(execSync('git status --porcelain', { stdio: 'ignore' }).toString().length)
      git.branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'ignore' }).toString().trim()
      git.commitHash = execSync('git rev-parse HEAD', { stdio: 'ignore' }).toString().trim()
      git.commitMessage = execSync(`git show -s --format=%B ${git.commitHash}`, { stdio: 'ignore' }).toString().trim()
    } catch (err) {
      // Ignore
    }
  }
  return git
}
