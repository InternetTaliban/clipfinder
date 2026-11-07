import { File, Paths } from 'expo-file-system'
import { Asset, requestPermissionsAsync } from 'expo-media-library'

// Baked in at build time from app/.env (see .env.example).
export const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://10.0.2.2:8787'
export const AUTH = { Authorization: `Bearer ${process.env.EXPO_PUBLIC_TOKEN}` }

type Status = 'running' | 'done' | 'error'
export interface Post {
  url: string
  platform: string
  account: string
  date: string
  resolution?: string
  note?: string
  relation?: string
}
export interface Track {
  title: string
  artist: string
  songLink?: string
  spotify?: string
  appleMusic?: string
  start: number
  end: number
}
export interface OriginalResult {
  verdict: string
  confidence: string
  original?: Post
  bestCopy?: Post
  candidates: Post[]
  evidence: { summary: string; frames: { input: string; match: string }[] }
}
export interface Job {
  id: string
  createdAt: string
  finishedAt?: string
  status: Status
  error?: string
  url?: string
  video?: { file: string; title?: string; uploader?: string; uploadDate?: string; width?: number; height?: number }
  audio?: { status: Status; error?: string; tracks?: Track[] }
  original?: { status: Status; error?: string; progress: string[]; result?: OriginalResult }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(SERVER + path, { ...init, headers: { ...AUTH, ...init?.headers } })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export const listJobs = () => call<Job[]>('/jobs')
export const getJob = (id: string) => call<Job>(`/jobs/${id}`)
export const startJob = (url: string, audio: boolean, original: boolean) =>
  call<Job>('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, audio, original }) })

export async function uploadJob(uri: string, audio: boolean, original: boolean): Promise<Job> {
  const res = await new File(uri).upload(`${SERVER}/jobs/upload?audio=${+audio}&original=${+original}`, { httpMethod: 'POST', headers: AUTH })
  const body = JSON.parse(res.body)
  if (res.status >= 400) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

export const fileUrl = (job: Job, name: string) => `${SERVER}/jobs/${job.id}/files/${name}`

export async function saveToGallery(job: Job) {
  if (!(await requestPermissionsAsync(true)).granted) throw new Error('Gallery permission was denied')
  const file = new File(Paths.cache, `${job.id}-${job.video!.file}`)
  if (!file.exists) await File.downloadFileAsync(fileUrl(job, job.video!.file), file, { headers: AUTH })
  await Asset.create(file.uri)
  file.delete()
}
