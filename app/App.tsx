import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import * as Notifications from 'expo-notifications'
import { useShareIntent } from 'expo-share-intent'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator, Alert, BackHandler, FlatList, Image, Linking, Pressable, StatusBar as RNStatusBar,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native'
import { AUTH, fileUrl, getJob, listJobs, saveToGallery, startJob, uploadJob, type Job, type Post, type Track } from './api'
import { notifyFinished, setUpBackgroundChecks } from './background'

type Screen = { name: 'home' } | { name: 'job'; id: string } | { name: 'history' }

const firstUrl = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? text.trim()

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [url, setUrl] = useState('')
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent()
  const tapped = Notifications.useLastNotificationResponse()
  const open = (id: string) => setScreen({ name: 'job', id })

  // Also marks already-finished jobs as seen, so the background check only notifies about new ones.
  useEffect(() => void setUpBackgroundChecks().then(notifyFinished).catch(console.warn), [])

  useEffect(() => {
    if (!hasShareIntent) return
    setUrl(shareIntent.webUrl ?? firstUrl(shareIntent.text ?? ''))
    setScreen({ name: 'home' })
    resetShareIntent()
  }, [hasShareIntent])

  useEffect(() => {
    const id = tapped?.notification.request.content.data?.jobId
    if (typeof id !== 'string') return
    open(id)
    Notifications.clearLastNotificationResponse() // or every later app start reopens this job
  }, [tapped])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen.name === 'home') return false
      setScreen({ name: 'home' })
      return true
    })
    return () => sub.remove()
  }, [screen])

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={s.appName} accessibilityRole="button" onPress={() => setScreen({ name: 'home' })}>Clip Finder</Text>
        <Text style={s.link} accessibilityRole="button" onPress={() => setScreen({ name: 'history' })}>History</Text>
      </View>
      {screen.name === 'home' && <Home url={url} setUrl={setUrl} open={open} />}
      {screen.name === 'job' && <JobScreen key={screen.id} id={screen.id} />}
      {screen.name === 'history' && <History open={open} />}
    </View>
  )
}

function Home({ url, setUrl, open }: { url: string; setUrl: (u: string) => void; open: (id: string) => void }) {
  const [audio, setAudio] = useState(true)
  const [original, setOriginal] = useState(true)
  const [busy, setBusy] = useState(false)

  async function start(make: () => Promise<Job>) {
    setBusy(true)
    try {
      open((await make()).id)
    } catch (e) {
      Alert.alert('Could not start', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function pickVideo() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] })
    if (!picked.canceled) await start(() => uploadJob(picked.assets[0].uri, audio, original))
  }

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Link to a reel, short, TikTok or post</Text>
      <View style={s.row}>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://..."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Link"
        />
        <Button title="Paste" onPress={async () => setUrl(firstUrl(await Clipboard.getStringAsync()))} />
      </View>
      <Toggle label="Find the song(s)" value={audio} onChange={setAudio} />
      <Toggle label="Find the original" value={original} onChange={setOriginal} />
      <Button title="Start" primary disabled={busy || !url.trim()} onPress={() => start(() => startJob(url.trim(), audio, original))} />
      <Text style={s.or}>or</Text>
      <Button title="Pick a video from the gallery" disabled={busy || (!audio && !original)} onPress={pickVideo} />
      {busy && <ActivityIndicator style={s.gap} />}
      <Text style={[s.muted, s.gap]}>Links are always downloaded so you can save the video. Gallery videos skip that step.</Text>
    </ScrollView>
  )
}

function JobScreen({ id }: { id: string }) {
  const [job, setJob] = useState<Job>()
  const [error, setError] = useState<string>()

  // Poll every 2 s until the job is finished; the job keeps running on the server if the app closes.
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const j = await getJob(id)
        if (!live) return
        setJob(j)
        setError(undefined)
        if (j.status !== 'running') return
      } catch (e) {
        if (live) setError((e as Error).message)
      }
      if (live) timer = setTimeout(poll, 2000)
    }
    poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id])

  if (!job) return <View style={s.center}>{error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator />}</View>
  return (
    <ScrollView contentContainerStyle={s.page}>
      {error && <Text style={s.error}>Can't reach the server: {error}</Text>}
      {job.url && <DownloadCard job={job} />}
      {job.audio && <AudioCard job={job} />}
      {job.original && <OriginalCards job={job} />}
    </ScrollView>
  )
}

const ymd = (d?: string) => d && `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function DownloadCard({ job }: { job: Job }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const v = job.video

  async function save() {
    setState('saving')
    try {
      await saveToGallery(job)
      setState('saved')
    } catch (e) {
      setState('idle')
      Alert.alert('Could not save', (e as Error).message)
    }
  }

  return (
    <Card title="Download">
      {v ? (
        <>
          <Text style={s.strong}>{v.title ?? 'Video'}</Text>
          <Text style={s.muted}>{[v.uploader, v.width && `${v.width}×${v.height}`, ymd(v.uploadDate)].filter(Boolean).join(' · ')}</Text>
          <Button
            title={{ idle: 'Save to gallery', saving: 'Saving…', saved: 'Saved to gallery' }[state]}
            disabled={state !== 'idle'}
            onPress={save}
          />
        </>
      ) : job.status === 'error' ? (
        <Text style={s.error}>{job.error}</Text>
      ) : (
        <Busy text="Downloading…" />
      )}
    </Card>
  )
}

function AudioCard({ job }: { job: Job }) {
  const a = job.audio!
  return (
    <Card title="Audio">
      {a.status === 'running' ? (
        <Busy text={job.video ? 'Listening…' : 'Waiting for the download…'} />
      ) : a.status === 'error' ? (
        <Text style={s.error}>{a.error}</Text>
      ) : !a.tracks?.length ? (
        <Text>No music recognized (original audio)</Text>
      ) : (
        a.tracks.map((t, i) => <TrackRow key={i} t={t} />)
      )}
    </Card>
  )
}

function TrackRow({ t }: { t: Track }) {
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.artist} ${t.title}`)}`
  return (
    <View style={s.item}>
      <Text style={s.strong}>{t.title}</Text>
      <Text style={s.muted}>{t.artist} · {mmss(t.start)}–{mmss(t.end)}</Text>
      <View style={s.links}>
        <LinkText url={t.spotify} label="Spotify" />
        <LinkText url={t.appleMusic} label="Apple Music" />
        <LinkText url={youtube} label="YouTube" />
        <LinkText url={t.songLink} label="All links" />
      </View>
    </View>
  )
}

function OriginalCards({ job }: { job: Job }) {
  const o = job.original!
  if (o.status === 'running') {
    return (
      <Card title="Original">
        <Busy text={job.video ? 'Searching. This can take several minutes; you can close the app.' : 'Waiting for the download…'} />
        {o.progress.slice(-5).map((line, i) => (
          <Text key={i} style={s.muted} numberOfLines={2}>• {line}</Text>
        ))}
      </Card>
    )
  }
  if (!o.result) return <Card title="Original"><Text style={s.error}>{o.error ?? 'No result'}</Text></Card>
  const r = o.result
  return (
    <>
      <Card title="Original source">
        <Text style={s.muted}>{r.verdict} · {r.confidence} confidence</Text>
        {r.original ? <PostView p={r.original} /> : <Text>Not found</Text>}
      </Card>
      {r.bestCopy && <Card title="Best quality copy"><PostView p={r.bestCopy} /></Card>}
      {r.candidates.length > 0 && <Card title="Other candidates">{r.candidates.map((p, i) => <PostView key={i} p={p} />)}</Card>}
      <Card title="Evidence">
        <Text>{r.evidence.summary}</Text>
        {r.evidence.frames.map((f, i) => (
          <View key={i} style={s.row}>
            <Frame job={job} name={f.input} label="Your clip" />
            <Frame job={job} name={f.match} label="Match" />
          </View>
        ))}
      </Card>
    </>
  )
}

function PostView({ p }: { p: Post }) {
  return (
    <Pressable style={s.item} accessibilityRole="link" onPress={() => Linking.openURL(p.url)}>
      <Text style={s.strong}>{p.account} · {p.platform}</Text>
      <Text style={s.muted}>{[p.date.includes('T') ? new Date(p.date).toLocaleString() : p.date, p.resolution, p.relation].filter(Boolean).join(' · ')}</Text>
      {p.note && <Text>{p.note}</Text>}
      <Text style={s.link} numberOfLines={1}>{p.url}</Text>
    </Pressable>
  )
}

function Frame({ job, name, label }: { job: Job; name: string; label: string }) {
  // Frames come in the input's shape; uploads have no size info and are usually vertical screen recordings.
  const aspectRatio = job.video?.width && job.video.height ? job.video.width / job.video.height : 9 / 16
  return (
    <View style={s.frameBox}>
      <Image source={{ uri: fileUrl(job, name), headers: AUTH }} style={[s.frame, { aspectRatio }]} resizeMode="contain" accessibilityLabel={label} />
      <Text style={s.muted}>{label}</Text>
    </View>
  )
}

function History({ open }: { open: (id: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>()
  const [error, setError] = useState<string>()
  useEffect(() => void listJobs().then(setJobs, (e: Error) => setError(e.message)), [])

  if (!jobs) return <View style={s.center}>{error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator />}</View>
  return (
    <FlatList
      contentContainerStyle={s.page}
      data={jobs}
      keyExtractor={(j) => j.id}
      ListEmptyComponent={<Text style={s.muted}>No jobs yet</Text>}
      renderItem={({ item: j }) => (
        <Pressable style={s.card} accessibilityRole="button" onPress={() => open(j.id)}>
          <Text style={s.strong} numberOfLines={1}>{j.video?.title ?? j.url ?? 'Uploaded video'}</Text>
          <Text style={s.muted}>
            {new Date(j.createdAt).toLocaleString()} · {[j.url && 'download', j.audio && 'audio', j.original && 'original'].filter(Boolean).join(' + ')} · {j.status}
          </Text>
          {j.original?.result?.original && <Text numberOfLines={1}>Original: {j.original.result.original.account}</Text>}
        </Pressable>
      )}
    />
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  )
}

function Button({ title, onPress, primary, disabled }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [s.button, primary && s.primary, (disabled || pressed) && s.dim]}
    >
      <Text style={[s.buttonText, primary && s.primaryText]}>{title}</Text>
    </Pressable>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[s.row, s.between]}>
      <Text>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  )
}

const Busy = ({ text }: { text: string }) => (
  <View style={s.row}>
    <ActivityIndicator />
    <Text style={s.muted}>{text}</Text>
  </View>
)

const LinkText = ({ url, label }: { url?: string; label: string }) =>
  url ? <Text style={s.link} accessibilityRole="link" onPress={() => Linking.openURL(url)}>{label}</Text> : null

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f3f4f6', paddingTop: RNStatusBar.currentHeight },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  appName: { fontSize: 20, fontWeight: '700' },
  page: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { justifyContent: 'space-between' },
  label: { fontWeight: '600' },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 12, paddingVertical: 10 },
  or: { textAlign: 'center', color: '#6b7280' },
  gap: { marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  item: { gap: 2, paddingVertical: 6 },
  strong: { fontWeight: '600' },
  muted: { color: '#6b7280', flexShrink: 1 },
  error: { color: '#b91c1c' },
  link: { color: '#2563eb' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  button: { backgroundColor: '#e5e7eb', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  primary: { backgroundColor: '#2563eb' },
  dim: { opacity: 0.5 },
  buttonText: { fontWeight: '600' },
  primaryText: { color: '#fff' },
  frameBox: { flex: 1, gap: 4, alignItems: 'center' },
  frame: { width: '100%', backgroundColor: '#111827', borderRadius: 6 },
})
