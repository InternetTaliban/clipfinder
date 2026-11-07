import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { probe, run } from './tools.ts'

const WINDOW = 12
const STEP = 8
const SHAZAM = path.join(import.meta.dirname, 'shazam.py')

export interface Song {
  title: string
  artist: string
  album?: string
  songLink?: string
  spotify?: string
  appleMusic?: string
}
export interface Track extends Song {
  start: number
  end: number
}
export interface Hit {
  start: number
  end: number
  song: Song | null
}

// Start times of overlapping 12 s windows every 8 s; the last one may be shorter.
export function windows(duration: number): number[] {
  const starts = []
  for (let s = 0; ; s += STEP) {
    starts.push(s)
    if (s + WINDOW >= duration) return starts
  }
}

// Joins windows of the same song into one track; a gap of one missed window still counts as the same play.
// Keyed by title only: windows of one song often match different releases ("Various Artists" compilations).
export function mergeHits(hits: Hit[]): Track[] {
  const tracks: Track[] = []
  const key = (s: Song) => s.title.trim().toLowerCase()
  for (const h of hits) {
    if (!h.song) continue
    const last = tracks.at(-1)
    if (last && key(last) === key(h.song) && h.start <= last.end + STEP) last.end = Math.max(last.end, h.end)
    else tracks.push({ ...h.song, start: h.start, end: h.end })
  }
  return tracks
}

export async function findAudio(video: string, dir: string): Promise<Track[]> {
  const { duration, hasAudio } = await probe(video)
  if (!hasAudio) return []
  const starts = windows(duration)
  const clips = starts.map((s) => path.join(dir, `audio-${s}.mp3`))
  try {
    for (const [i, start] of starts.entries()) {
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(WINDOW), '-i', video, '-vn', '-ac', '1', '-b:a', '128k', clips[i]])
    }
    const songs = await recognize(clips)
    return mergeHits(starts.map((start, i) => ({ start, end: Math.min(start + WINDOW, duration), song: songs[i] })))
  } finally {
    await Promise.all(clips.map((c) => rm(c, { force: true })))
  }
}

// Shazam throttles bursts (5 clips: 33 s one by one, 166 s in parallel), so jobs take turns.
let shazamQueue: Promise<unknown> = Promise.resolve()
function shazam(clips: string[]): Promise<string> {
  const turn = shazamQueue.then(() => run('uv', ['run', '--quiet', '--python', '3.12', '--with', 'shazamio==0.9.0', 'python', '-I', SHAZAM, ...clips]))
  shazamQueue = turn.catch(() => {})
  return turn
}

// Shazam (free, unofficial) first; AudD (paid, official) only if Shazam fails and AUDD_TOKEN is set.
async function recognize(clips: string[]): Promise<(Song | null)[]> {
  try {
    return JSON.parse(await shazam(clips))
  } catch (e) {
    if (!process.env.AUDD_TOKEN) throw new Error(`Shazam: ${(e as Error).message}`)
    const songs = []
    for (const clip of clips) songs.push(await audd(clip))
    return songs
  }
}

async function audd(file: string): Promise<Song | null> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)]), 'clip.mp3')
  form.append('return', 'spotify,apple_music')
  if (process.env.AUDD_TOKEN) form.append('api_token', process.env.AUDD_TOKEN)
  const res = await fetch('https://api.audd.io/', { method: 'POST', body: form })
  const body = await res.json()
  if (body.status !== 'success') throw new Error(`AudD: ${body.error?.error_message ?? `HTTP ${res.status}`}`)
  const r = body.result
  if (!r) return null
  return {
    title: r.title,
    artist: r.artist,
    album: r.album,
    songLink: r.song_link,
    spotify: r.spotify?.external_urls?.spotify,
    appleMusic: r.apple_music?.url,
  }
}
