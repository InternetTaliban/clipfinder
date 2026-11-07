import express, { type ErrorRequestHandler } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getJob, jobDir, listJobs, newJob, runJob } from './jobs.ts'

const TOKEN = process.env.CLIPFINDER_TOKEN
if (!TOKEN) throw new Error('Set CLIPFINDER_TOKEN in server/.env (see .env.example)')
const want = Buffer.from(`Bearer ${TOKEN}`)

const app = express()

app.use((req, res, next) => {
  const got = Buffer.from(req.get('authorization') ?? '')
  if (got.length === want.length && timingSafeEqual(got, want)) return next()
  res.status(401).json({ error: 'Wrong or missing token' })
})

app.param('id', (_req, res, next, id) => (/^[\w-]+$/.test(id) && getJob(id) ? next() : res.status(404).json({ error: 'No such job' })))

// Body: { url, audio, original }. The video is always downloaded.
app.post('/jobs', express.json(), (req, res) => {
  const { url, audio, original } = req.body ?? {}
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url)) return void res.status(400).json({ error: 'url must be an http(s) link' })
  const job = newJob({ url, audio: !!audio, original: !!original })
  runJob(job)
  res.status(201).json(job)
})

// Raw video bytes in the body, actions in the query: /jobs/upload?audio=1&original=1
app.post('/jobs/upload', async (req, res) => {
  const job = newJob({ audio: req.query.audio === '1', original: req.query.original === '1' })
  await pipeline(req, createWriteStream(path.join(jobDir(job.id), 'upload.mp4')))
  runJob(job)
  res.status(201).json(job)
})

app.get('/jobs', (_req, res) => void res.json(listJobs()))
app.get('/jobs/:id', (req, res) => void res.json(getJob(req.params.id)))
// The video and evidence frames; `root` keeps paths inside the job folder.
app.get('/jobs/:id/files/*file', (req, res, next) => {
  res.sendFile((req.params.file as unknown as string[]).join('/'), { root: jobDir(req.params.id) }, (e) => e && next(e))
})

app.use(((err, _req, res, _next) => {
  res.status(err.status ?? 500).json({ error: err.message })
}) as ErrorRequestHandler)

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => console.log(`Clip Finder server on http://localhost:${port}`))
