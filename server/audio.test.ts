import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeHits, windows } from './audio.ts'

test('windows cover the clip with 12 s windows every 8 s', () => {
  assert.deepEqual(windows(10), [0])
  assert.deepEqual(windows(12), [0])
  assert.deepEqual(windows(30), [0, 8, 16, 24])
})

test('mergeHits joins adjacent windows of the same song and keeps separate plays apart', () => {
  const a = { title: 'Song A', artist: 'X' }
  const b = { title: 'Song B', artist: 'Y' }
  const tracks = mergeHits([
    { start: 0, end: 12, song: a },
    { start: 8, end: 20, song: { title: 'song a', artist: 'Various Artists' } }, // same song from a compilation
    { start: 16, end: 28, song: null }, // one missed window
    { start: 24, end: 36, song: a },
    { start: 32, end: 44, song: b },
    { start: 40, end: 52, song: a }, // A again after B: a new play
  ])
  assert.deepEqual(
    tracks.map((t) => [t.title, t.start, t.end]),
    [['Song A', 0, 36], ['Song B', 32, 44], ['Song A', 40, 52]],
  )
  const twoMissed = mergeHits([
    { start: 0, end: 12, song: a },
    { start: 8, end: 20, song: null },
    { start: 16, end: 28, song: null },
    { start: 24, end: 36, song: a },
  ])
  assert.equal(twoMissed.length, 2)
  assert.deepEqual(mergeHits([{ start: 0, end: 12, song: null }]), [])
})
