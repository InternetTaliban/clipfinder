import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { findAudio, type Track } from './audio.ts'
import { findOriginal } from './original.ts'
import { download, type Video } from './tools.ts'

const DATA = path.join(import.meta.dirname, 'data')

type Status = 'running' | 'done' | 'error'
interface Step {
  status: Status
  error?: string
}
export interface Job {
  id: string
  createdAt: string
  finishedAt?: string
  status: Status
  error?: string
  url?: string
  video?: Video
  audio?: Step & { tracks?: Track[] }
  original?: Step & { progress: string[]; result?: unknown }
}

const jobs = new Map<string, Job>()

export const jobDir = (id: string) => path.join(DATA, id)
export const getJob = (id: string) => jobs.get(id)
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export function newJob(opts: { url?: string; audio: boolean; original: boolean }): Job {
  const job: Job = {
    id: `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    status: 'running',
    url: opts.url,
    audio: opts.audio ? { status: 'running' } : undefined,
    original: opts.original ? { status: 'running', progress: [] } : undefined,
  }
  mkdirSync(jobDir(job.id))
  return job
}

const save = (job: Job) => writeFileSync(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2))

function finish(job: Job, error?: string) {
  job.status = error ? 'error' : 'done'
  job.error = error
  job.finishedAt = new Date().toISOString()
  save(job)
}

async function step<S extends Step>(job: Job, s: S, work: (s: S) => Promise<void>) {
  try {
    await work(s)
    s.status = 'done'
  } catch (e) {
    Object.assign(s, { status: 'error', error: (e as Error).message })
  }
  save(job)
}

// A job runs on its own: closing the app doesn't affect it.
export async function runJob(job: Job) {
  jobs.set(job.id, job)
  save(job)
  const dir = jobDir(job.id)
  try {
    job.video = job.url ? await download(job.url, dir) : { file: 'upload.mp4' }
    save(job)
  } catch (e) {
    for (const s of [job.audio, job.original]) if (s) Object.assign(s, { status: 'error', error: 'Download failed' })
    return finish(job, (e as Error).message)
  }
  const video = path.join(dir, job.video.file)
  await Promise.all([
    job.audio && step(job, job.audio, async (s) => void (s.tracks = await findAudio(video, dir))),
    job.original && step(job, job.original, async (s) => {
      s.result = await findOriginal(video, dir, (line) => {
        s.progress.push(line)
        save(job)
      })
    }),
  ])
  finish(job)
}

// Load history; jobs cut off by a server restart can't resume, so mark them failed.
mkdirSync(DATA, { recursive: true })
for (const id of readdirSync(DATA)) {
  const file = path.join(DATA, id, 'job.json')
  if (!existsSync(file)) continue
  const job: Job = JSON.parse(readFileSync(file, 'utf8'))
  jobs.set(id, job)
  if (job.status === 'running') {
    for (const s of [job.audio, job.original]) if (s?.status === 'running') Object.assign(s, { status: 'error', error: 'Interrupted by a server restart' })
    finish(job, 'Interrupted by a server restart')
  }
}
