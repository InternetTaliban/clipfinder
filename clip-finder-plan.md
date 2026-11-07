# Clip Finder: plan

A small personal Android app. Paste (or share) a social media link, or pick a video from the gallery, and the app can:

1. **Download** the video (reel, short, TikTok, tweet, whatever).
2. **Find the audio**: identify the song, or several songs if the clip has more than one.
3. **Find the original**: trace the clip back to its original, uncropped, best-quality source, using a Claude Code agent that searches the web and social media and checks candidates itself.

It's just for me, so keep it simple: no accounts, no app store, no multi-user, no payments.

---

## Stack

- **App:** React Native with Expo, TypeScript. Android first, tested on the Android emulator.
- **Server:** Node and TypeScript (Express or Fastify, your choice). It runs somewhere with a shell: my PC or a small VPS. The phone only talks to this server.
- **Tools on the server:** `yt-dlp` (downloads), `ffmpeg` (frames and audio), a song-recognition service, and Claude Code with **Agent Reach** and **last30days** installed, plus a skill containing the playbook below.
- **Auth:** one shared secret token in a header. Nothing more.

Research the current state of these tools yourselves (yt-dlp extractors, song-recognition APIs, the best way to run Claude Code headless or as a remote session from Node) and pick the simplest option that works.

## Features

### Input
- A text box with a "Paste" button that reads the clipboard.
- **Android share target**: sharing from Instagram, TikTok, YouTube or X straight into the app fills in the link. This is the main convenience, so do it.
- "Pick video" from the gallery, for screen recordings or files I already have. Uploaded videos skip the download step.

### Download
- The server fetches the video with `yt-dlp` at the best available quality and the app saves it to the gallery.
- Instagram and some others may need cookies. Support a cookies file on the server.

### Find audio
- Extract the audio with ffmpeg and send it to a song-recognition service. Shazam-style options exist: AudD, ACRCloud, unofficial Shazam libraries and so on. Pick one.
- **Multiple songs:** split the audio into overlapping windows (for example 12 s windows every 8 s), recognize each one, and merge the results into a list of tracks with timestamps.
- If nothing matches, say "no music recognized (original audio)" rather than failing.
- Show the title, artist, timestamps, and Spotify/YouTube/Apple links when the service gives them.

### Find original
- Starts an agent job on the server. The app shows live progress, a few short status lines streamed over SSE or polling, then a result.
- Result cards:
  - **Original source**: the earliest real poster, with link, account, date and confidence.
  - **Best quality copy**: if it's different from the original (for example an uncropped widescreen YouTube upload).
  - **Other candidates**: a short list.
  - **Evidence**: one or two lines on why the agent thinks it's the match, plus matching frame thumbnails.
- Jobs can take several minutes, so they must survive the app being closed. Show a notification when one finishes.

### History
- A simple list of past links and jobs with their results, stored on the server (SQLite or a JSON file is fine).

---

## How to find the original clip (the agent playbook)

Put this into a skill the find-original agent loads. The agent can watch videos and view social media itself through Agent Reach and last30days, so it must **verify candidates visually**, not just by topic.

### How the first two cases were actually solved

**Case 1: GTA V with a Minecraft mod (Instagram reupload, cropped, low quality)**
1. Extracted a frame every 2–3 s and made a contact sheet. I spotted the Minecraft hotbar and item names ("Diamond Sword", "Ender Pearl") on top of GTA V gameplay.
2. Searched the text for that combination and found the mod ("Minecraft Steve Passthrough"). The mod page credited the original creator, which led to the creator's posts on X.
3. Got exact post times by decoding the X post IDs (snowflake: `(id >> 22) + 1288834974657` = Unix milliseconds) and compared them with the YouTube upload dates.
4. **Mistake:** I reported the earliest related post (the creator's X video) as the original, but it was *different footage*. The real match was a YouTube video from 5 Oct 2026 (MicksCrazy, "I Added Minecraft into GTA 5..."). Lesson: the earliest post *about the same thing* isn't necessarily *the same clip*. Always check the footage itself.

**Case 2: robot pushed in a Russian store (CCTV, news caption on top, cropped to vertical)**
1. Frames showed the burned-in caption "Robot reacts after being pushed by man in Russian store" and an N1 News logo. That means it's a news-aggregator repost of a viral event.
2. Searched for the event in English and found several news articles. They named the city (Saratov) and the store (Volga Store), embedded reposts (RT on X, a Turkish X account), and pointed to the store's Instagram.
3. Searched **in the local language** (Russian). A local article said the store itself published the video, so the store's account is the original and outlets like RT and N1 are reposts.
4. Couldn't open Instagram directly from that environment. With Agent Reach the agent can open the store's account, find the post and confirm it.

### General playbook

1. **Collect everything about the input post:** download it, then read the caption, hashtags, the posting account, and the **top comments**. Commenters often name the source ("this is from @xyz").
2. **Extract frames:** use scene-change detection plus a frame every 2–3 s, and build a contact sheet. Look for:
   - usernames, watermarks, channel logos, TikTok/Medal/Twitch marks, faint corner logos
   - burned-in captions and news logos (they point to who reposted it and what event it is)
   - game HUDs, killfeeds, scoreboards and player names (these often lead straight to a streamer)
   - CCTV timestamps, signs, shop names, language of the text, license plates of *vehicles/places* only
   - film/TV look: actors, letterboxing, subtitles
3. **Classify the clip**, because each type has a different usual source:
   - game: mod pages, YouTube, Twitch clips, Medal, Reddit
   - news/CCTV: news articles, then the local-language press, then the first poster (often a business, a local Telegram channel, or a local news account)
   - film/TV/anime: identify the title and the scene
   - creator content: TikTok/YouTube/Instagram of the creator
   - stock footage: stock sites
4. **Search by text.** Build queries from the clues, plus words like "original", "full video", "4K". Search the local language as well. Use Agent Reach to search inside the platforms (YouTube, X, TikTok, Reddit, Instagram, Telegram), and last30days for recent viral stuff.
5. **Reverse image search** 3–5 clean frames, cropped to remove captions and UI: Google Lens and Yandex (Yandex is often best for video frames), plus Bing and TinEye. Use a browser or an API, whichever works.
6. **Follow the chain back.** Articles embed posts, and reposts credit or tag the source. Keep following until you reach a post that credits nobody earlier.
7. **Get exact dates for every candidate:**
   - X: decode the snowflake ID (formula above)
   - TikTok: `id >> 32` = Unix seconds
   - YouTube and others: `yt-dlp --dump-json` (`upload_date`, `timestamp`)
8. **Verify each serious candidate:** download it, sample frames and compare them with the input clip. The input is usually **cropped** (16:9 to 9:16) and has **text overlays**, so center-crop the candidate to the input's aspect ratio and ignore the overlay areas. Perceptual hashes or feature matching help, but the agent looking at frame pairs side by side is fine. Same event or same topic is **not** a match. The same moment from the same camera angle is.
9. **Rank and report:**
   - Original = earliest verified poster of this exact footage
   - Best copy = highest resolution and widest framing
   - Give a confidence level and the evidence, and say so honestly when it's only "same event, footage not confirmed".

Scope: the goal is the **source post**, not identifying the people in the footage. Don't try to identify or locate private individuals.

---

## Build order

1. Server: `POST /jobs` (url or uploaded file, plus which actions), job status/stream endpoint, download with yt-dlp, token auth.
2. App: input screen (paste, share target, gallery pick), then a result screen with three cards (Download / Audio / Original), plus saving to the gallery.
3. Audio recognition with multi-song windows.
4. Find-original: the server starts a Claude Code agent with the playbook skill, Agent Reach and last30days, streams progress lines, and returns structured JSON (original, best copy, candidates, evidence, confidence).
5. History screen, notifications, a quick design pass.

## Test cases

Use these two screen recordings as fixtures (I'll provide the mp4s):

| Clip | Expected result |
|---|---|
| GTA V + Minecraft mod gameplay (Instagram reupload) | YouTube, MicksCrazy, "I Added Minecraft into GTA 5...", 5 Oct 2026, https://www.youtube.com/watch?v=I_NIcHv2Pl8. Must **not** answer with Rehan Sheikh's X post, which is different footage. |
| Robot pushed in store, N1 News caption | The original is Volga Store's (Saratov) own Instagram post. The handle in articles is "volagstore64" (maybe "volgastore64"), so confirm it. RT's X post (2 Sep 2026) is an early repost. |

The find-original feature is done when it gets both of these right on its own and shows evidence.
