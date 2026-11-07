import * as BackgroundTask from 'expo-background-task'
import { File, Paths } from 'expo-file-system'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { listJobs } from './api'

const TASK = 'check-finished-jobs'
const CHANNEL = 'jobs'
// The newest server finishedAt we've already handled, so phone/server clock skew doesn't matter.
const seen = new File(Paths.document, 'last-finished.txt')

// Shows a local notification (no Firebase needed) for each job that finished since the last check.
export async function notifyFinished() {
  const jobs = await listJobs()
  const since = seen.exists ? seen.textSync() : undefined
  let latest = since ?? ''
  for (const job of jobs) {
    if (!job.finishedAt) continue
    if (since !== undefined && job.finishedAt > since) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: job.status === 'error' ? 'Clip Finder job failed' : 'Clip Finder job finished',
          body: job.video?.title ?? job.url ?? 'Uploaded video',
          data: { jobId: job.id },
        },
        trigger: { channelId: CHANNEL },
      })
    }
    if (job.finishedAt > latest) latest = job.finishedAt
  }
  if (!seen.exists) seen.create()
  await seen.write(latest)
}

// Android runs this through WorkManager roughly every 15+ minutes, even with the app closed (not force-stopped).
TaskManager.defineTask(TASK, async () => {
  try {
    await notifyFinished()
    return BackgroundTask.BackgroundTaskResult.Success
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

export async function setUpBackgroundChecks() {
  // Android 13+ only shows the permission prompt once a channel exists.
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Finished jobs', importance: Notifications.AndroidImportance.HIGH })
  await Notifications.requestPermissionsAsync()
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 })
}
