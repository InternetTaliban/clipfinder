import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

const AGENT_DIR = path.resolve(import.meta.dirname, '..', 'agent')
const TIMEOUT_MS = 30 * 60_000

// shortcut: an allowlist, not a sandbox: ffmpeg/yt-dlp and the file tools can still write anywhere; run the agent in a VM or container if that matters.
const ALLOWED = [
  'Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'Skill', 'Task', 'TodoWrite',
  'Bash(yt-dlp *)', 'Bash(ffmpeg *)', 'Bash(ffprobe *)', 'Bash(agent-reach *)', 'Bash(node postdate.mjs *)', 'Bash(*last30days*)',
]
const DENIED = ['Bash(*--exec*)']

const post = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    platform: { type: 'string' },
    account: { type: 'string' },
    date: { type: 'string', description: 'ISO date or date-time of the post' },
    resolution: { type: 'string', description: 'e.g. 1920x1080' },
    note: { type: 'string', description: 'one short line' },
  },
  required: ['url', 'platform', 'account', 'date'],
}

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['verified', 'same event, footage not confirmed', 'not found'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    original: { ...post, description: 'Earliest verified poster of this exact footage. Omit if not found.' },
    bestCopy: { ...post, description: 'Highest resolution and widest framing, only if different from the original.' },
    candidates: {
      type: 'array',
      items: { ...post, properties: { ...post.properties, relation: { type: 'string', description: 'repost, same event, different footage, ...' } } },
    },
    evidence: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'one or two lines on why this is the match' },
        frames: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'path relative to the job folder, e.g. evidence/in-1.jpg' },
              match: { type: 'string', description: 'path relative to the job folder, e.g. evidence/match-1.jpg' },
            },
            required: ['input', 'match'],
          },
        },
      },
      required: ['summary', 'frames'],
    },
  },
  required: ['verdict', 'confidence', 'candidates', 'evidence'],
}

const slash = (p: string) => p.replaceAll('\\', '/')

export function findOriginal(video: string, dir: string, onProgress: (line: string) => void): Promise<unknown> {
  const info = path.join(dir, 'video.info.json')
  const prompt = [
    `Use the find-original skill to find the original source of the video clip at ${slash(video)}.`,
    existsSync(info)
      ? `Its post metadata from yt-dlp (caption, account, date, link) is in ${slash(info)}.`
      : 'It was picked from a phone gallery (a screen recording or a saved file), so there is no post metadata.',
    `The job folder is ${slash(dir)}: put frames and downloads there, and the evidence frame pairs in ${slash(dir)}/evidence/.`,
    'Finish by returning the structured result.',
  ].join('\n')

  return new Promise((resolve, reject) => {
    const p = spawn('claude', [
      '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--json-schema', JSON.stringify(SCHEMA),
      '--permission-mode', 'dontAsk',
      '--add-dir', dir,
      '--allowedTools', ALLOWED.join(','),
      '--disallowedTools', DENIED.join(','),
    // An inherited ORIGINAL_PATH makes Git Bash restore a stale PATH (missing yt-dlp/ffmpeg) inside the agent's shell.
    ], { cwd: AGENT_DIR, windowsHide: true, env: { ...process.env, ORIGINAL_PATH: undefined } })
    p.stdin.end(prompt)

    let result: { is_error?: boolean; structured_output?: unknown; result?: string; subtype?: string } | undefined
    let stderr = ''
    p.stderr.on('data', (d) => (stderr += d))
    createInterface({ input: p.stdout }).on('line', (line) => {
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (ev.type === 'result') result = ev
      if (ev.type !== 'assistant' || ev.parent_tool_use_id) return
      for (const block of ev.message.content) {
        const text = describe(block)
        if (text) onProgress(text.length > 160 ? `${text.slice(0, 157)}...` : text)
      }
    })

    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), p.kill()), TIMEOUT_MS)
    p.on('error', reject)
    p.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`Gave up after ${TIMEOUT_MS / 60_000} minutes`))
      if (result?.structured_output && !result.is_error) return resolve(relativeFrames(result.structured_output, dir))
      reject(new Error(result?.result || result?.subtype || stderr.trim().split('\n').at(-1) || `agent exited with code ${code}`))
    })
  })
}

// The app fetches frames by job-relative path, so normalize whatever path style the agent used.
function relativeFrames(out: any, dir: string) {
  const rel = (f: string) => slash(path.relative(dir, path.resolve(dir, f)))
  for (const f of out.evidence?.frames ?? []) Object.assign(f, { input: rel(f.input), match: rel(f.match) })
  return out
}

// One short status line per assistant step: its text, or what the tool call is doing.
function describe(b: { type: string; text?: string; name?: string; input?: Record<string, string> }): string | undefined {
  if (b.type === 'text') return b.text?.trim().split('\n')[0]
  if (b.type !== 'tool_use' || !b.input || b.name === 'StructuredOutput') return
  const i = b.input
  if (b.name === 'WebSearch') return `Searching the web: ${i.query}`
  if (b.name === 'WebFetch') return `Reading ${i.url}`
  if (b.name === 'Skill') return `Using the ${i.skill} skill`
  if (b.name === 'Read') return `Looking at ${path.basename(i.file_path ?? '')}`
  if (b.name === 'Bash' || b.name === 'Task') return i.description ?? i.command
}
