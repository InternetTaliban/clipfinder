import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const COOKIES = path.join(import.meta.dirname, 'cookies.txt')

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) return resolve(out)
      reject(new Error(`${cmd} failed: ${err.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`}`))
    })
  })
}

export interface Video {
  file: string
  title?: string
  uploader?: string
  uploadDate?: string
  webpageUrl?: string
  width?: number
  height?: number
}

export async function download(url: string, dir: string): Promise<Video> {
  const out = await run('yt-dlp', [
    '--no-playlist', '--no-progress', '--write-info-json',
    '-f', 'bv*+ba/b', '-S', 'res,ext:mp4:m4a', '--merge-output-format', 'mp4', '--remux-video', 'mp4',
    '-o', path.join(dir, 'video.%(ext)s'),
    '--no-simulate', '--print', 'after_move:filepath',
    ...(existsSync(COOKIES) ? ['--cookies', COOKIES] : []),
    '--', url,
  ])
  const info = JSON.parse(readFileSync(path.join(dir, 'video.info.json'), 'utf8'))
  return {
    file: path.basename(out.trim().split('\n').at(-1)!),
    title: info.title,
    uploader: info.uploader ?? info.channel,
    uploadDate: info.upload_date,
    webpageUrl: info.webpage_url,
    width: info.width,
    height: info.height,
  }
}

export async function probe(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const out = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]))
  return {
    duration: Number(out.format.duration),
    hasAudio: out.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'),
  }
}
