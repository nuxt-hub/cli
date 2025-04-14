import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { extname } from 'pathe'
import { joinURL } from 'ufo'
import { ofetch } from 'ofetch'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import mime from 'mime'
import { withTilde, MAX_ASSET_SIZE, MAX_UPLOAD_CHUNK_SIZE, MAX_UPLOAD_ATTEMPTS, UPLOAD_RETRY_DELAY, CONCURRENT_UPLOADS } from './index.mjs'
import prettyBytes from 'pretty-bytes'
import { gzipSize as getGzipSize } from 'gzip-size'

export function hashFile(filePath, data) {
  const extension = extname(filePath).substring(1)
  return createHash('sha256')
    .update(data + extension)
    .digest('hex')
    .slice(0, 32) // required by Cloudflare
}

/**
 * Create chunks based on base64 size
 */
export async function createChunks(files) {
  const chunks = []
  let currentChunk = []
  let currentSize = 0

  for (const file of files) {
    // If single file is bigger than chunk size, it gets its own chunk
    if (file.size > MAX_UPLOAD_CHUNK_SIZE) {
      // If we have accumulated files, push them as a chunk first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = []
        currentSize = 0
      }
      // Push large file as its own chunk
      chunks.push([file])
      continue
    }

    if (currentSize + file.size > MAX_UPLOAD_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = []
      currentSize = 0
    }

    currentChunk.push(file)
    currentSize += file.size
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * Create a storage instance for the dist directory
 * @param {string} dir - Nuxt build output directory
 * @returns {Promise<import('unstorage').Storage>}
 * @throws {Error} If dist directory doesn't exist
 */
export async function getStorage(dir) {
  await access(dir).catch(() => {
    throw new Error(`${withTilde(dir)} directory not found`)
  })
  return createStorage({
    driver: fsDriver({
      base: dir,
      ignore: ['.DS_Store']
    })
  })
}

/**
 * Get all files to deploy
 * @param {string[]} fileKeys - Array of file paths from storage
 * @returns {string[]} Array of paths to deploy
 */
export function getPathsToDeploy(fileKeys) {
  const fileKeyToPath = (fileKey) => joinURL('/', fileKey.replace(/:/g, '/'))
  return fileKeys.map(fileKeyToPath).filter(path => {
    if (path.startsWith('/.wrangler/')) return false
    if (path.startsWith('/node_modules/')) return false
    if (path === '/wrangler.toml') return false
    if (path === '/.dev.vars') return false
    if (path.startsWith('/database/migrations/')) return false
    return true
  })
}

/**
 * Get file data with metadata
 * @param {import('unstorage').Storage} storage - Storage instance
 * @param {string} path - File path
 * @param {BufferEncoding} [encoding='utf-8'] - File encoding
 * @returns {Promise<{ path: string, data: string, size: number, encoding: string, hash: string, contentType: string }>}
 * @throws {Error} If file size exceeds MAX_ASSET_SIZE
 */
export async function getFile(storage, path, encoding = 'utf-8') {
  const dataAsBuffer = await storage.getItemRaw(path)
  if (dataAsBuffer.length > MAX_ASSET_SIZE) {
    throw new Error(`NuxtHub deploy only supports files up to ${prettyBytes(MAX_ASSET_SIZE, { binary: true })} in size\n${withTilde(path)} is ${prettyBytes(dataAsBuffer.length, { binary: true })} in size`)
  }
  const gzipSize = await getGzipSize(dataAsBuffer)
  const data = dataAsBuffer.toString(encoding)

  return {
    path,
    data,
    size: dataAsBuffer.length,
    gzipSize,
    encoding,
    hash: hashFile(path, data),
    contentType: mime.getType(path) || 'application/octet-stream'
  }
}

export const META_PATHS = [
  '/_redirects',
  '/_headers',
  '/_routes.json',
  '/nitro.json',
  '/hub.config.json',
  '/wrangler.toml',
  '/package-lock.json',
  '/package.json'
]

export const isMetaPath = (path) => META_PATHS.includes(path)
export const isServerPath = (path) => path.startsWith('/_worker.js/')
export const isPublicPath = (path) => !isMetaPath(path) && !isServerPath(path)

export const isWorkerMetaPath = (path) => META_PATHS.includes(path)
export const isWorkerPublicPath = (path) => path.startsWith('/public/')
export const isWorkerServerPath = (path) => path.startsWith('/server/')

/**
 * Get all public files with their metadata
 * @param {import('unstorage').Storage} storage - Storage instance
 * @param {string[]} paths - Array of paths to filter and process
 * @returns {Promise<Array<{ path: string, data: string, size: number, encoding: string, hash: string, contentType: string }>>}
 */
export async function getPublicFiles(storage, paths) {
  return Promise.all(
    paths.filter(isPublicPath).map(p => getFile(storage, p, 'base64'))
  )
}
export async function getWorkerPublicFiles(storage, paths) {
  const files = await Promise.all(
    paths.filter(isWorkerPublicPath).map(p => getFile(storage, p, 'base64'))
  )
  return files.map((file) => ({
    ...file,
    path: file.path.replace('/public/', '/')
  }))
}

/**
 * Upload assets to Cloudflare Pages with concurrent uploads
 * @param {Array<{ path: string, data: string, hash: string, contentType: string }>} files - Files to upload
 * @param {string} cloudflareUploadJwt - Cloudflare upload JWT
 * @param {Function} onProgress - Callback function to update progress
 */
export async function uploadAssetsToCloudflare(files, cloudflareUploadJwt, onProgress) {
  const chunks = await createChunks(files)
  if (!chunks.length) {
    return
  }

  let filesUploaded = 0
  let progressSize = 0
  const totalSize = files.reduce((acc, file) => acc + file.size, 0)
  for (let i = 0; i < chunks.length; i += CONCURRENT_UPLOADS) {
    const chunkGroup = chunks.slice(i, i + CONCURRENT_UPLOADS)

    await Promise.all(chunkGroup.map(async (filesInChunk) => {
      return ofetch('/pages/assets/upload', {
        baseURL: 'https://api.cloudflare.com/client/v4/',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudflareUploadJwt}`
        },
        retry: MAX_UPLOAD_ATTEMPTS,
        retryDelay: UPLOAD_RETRY_DELAY,
        body: filesInChunk.map(file => ({
          path: file.path,
          key: file.hash,
          value: file.data,
          base64: true,
          metadata: {
            contentType: file.contentType
          }
        }))
      })
      .then(() => {
        if (typeof onProgress === 'function') {
          filesUploaded += filesInChunk.length
          progressSize += filesInChunk.reduce((acc, file) => acc + file.size, 0)
          onProgress({ progress: filesUploaded, progressSize, total: files.length, totalSize })
        }
      })
      .catch((err) => {
        if (err.data) {
          throw new Error(`Error while uploading assets to Cloudflare: ${JSON.stringify(err.data)} - ${err.message}`)
        }
        else {
          throw new Error(`Error while uploading assets to Cloudflare: ${err.message.split(' - ')[1] || err.message}`)
        }
      })
    }))
  }
}


/**
 * Upload assets to Cloudflare Workers with concurrent uploads
 * @param {Array<string<string>} buckets - Buckets of hashes to upload
 * @param {Array<{ path: string, data: string, hash: string, contentType: string }>} files - Files to upload
 * @param {string} cloudflareUploadJwt - Cloudflare upload JWT
 * @param {Function} onProgress - Callback function to update progress
 */
export async function uploadWorkersAssetsToCloudflare(accountId, files, cloudflareUploadJwt, onProgress) {
  const chunks = await createChunks(files)
  if (!chunks.length) {
    return
  }

  let filesUploaded = 0
  let progressSize = 0
  let completionToken
  const totalSize = files.reduce((acc, file) => acc + file.size, 0)
  for (let i = 0; i < chunks.length; i += CONCURRENT_UPLOADS) {
    const chunkGroup = chunks.slice(i, i + CONCURRENT_UPLOADS)

    await Promise.all(chunkGroup.map(async (filesInChunk) => {
      const form = new FormData()
      for (const file of filesInChunk) {
        form.append(file.hash, new File([file.data], file.hash, { type: file.contentType}), file.hash)
      }
      return ofetch(`/accounts/${accountId}/workers/assets/upload?base64=true`, {
        baseURL: 'https://api.cloudflare.com/client/v4/',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudflareUploadJwt}`
        },
        retry: MAX_UPLOAD_ATTEMPTS,
        retryDelay: UPLOAD_RETRY_DELAY,
        body: form
      })
      .then((data) => {
        if (data && data.result?.jwt) {
          completionToken = data.result.jwt
        }
        if (typeof onProgress === 'function') {
          filesUploaded += filesInChunk.length
          progressSize += filesInChunk.reduce((acc, file) => acc + file.size, 0)
          onProgress({ progress: filesUploaded, progressSize, total: files.length, totalSize })
        }
      })
      .catch((err) => {
        if (err.data) {
          throw new Error(`Error while uploading assets to Cloudflare: ${JSON.stringify(err.data)} - ${err.message}`)
        }
        else {
          throw new Error(`Error while uploading assets to Cloudflare: ${err.message.split(' - ')[1] || err.message}`)
        }
      })
    }))
  }
  return completionToken
}
