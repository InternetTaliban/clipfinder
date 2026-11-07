---
name: find-original
description: Trace a video clip (reel, short, TikTok, tweet, screen recording) back to its original, earliest poster and its best-quality copy, verifying candidates by comparing frames. Use when asked to find where a clip came from.
---

# Find the original of a clip

Goal: the **source post** of this exact footage, plus the best-quality copy. Not the identity of the people in it. Never try to identify or locate private individuals.

You can watch videos and browse social media yourself, so **verify candidates visually**, never by topic alone. The earliest post *about the same thing* is not necessarily *the same clip*.

## Tools

- `yt-dlp`, `ffmpeg`, `ffprobe` on the shell. Run one command per call (no pipes, `&&` or `;`); compound commands are denied.
- The **agent-reach** skill: search and read X, Reddit, YouTube, Instagram, GitHub and the web (`agent-reach <channel> <action> ...`).
- The **last30days** skill: what people posted about a topic recently (good for viral clips).
- WebSearch and WebFetch for news articles and pages.
- Read on a `.jpg` shows you the image. Use it to look at frames and contact sheets.
- `node postdate.mjs <post url or id>` prints the exact post time for X and TikTok IDs.

Work inside the job folder you are given. Put frames, contact sheets and candidate downloads there.

### Recipes

- Contact sheet (one frame every 2 s, 4x4 per sheet): `ffmpeg -v error -i IN -vf "fps=1/2,scale=320:-1,tile=4x4" DIR/sheet-%02d.jpg`
- Scene changes: `ffmpeg -v error -i IN -vf "select='gt(scene,0.3)',scale=480:-1" -vsync vfr DIR/scene-%03d.jpg`
- One frame at 7.5 s: `ffmpeg -v error -ss 7.5 -i IN -frames:v 1 DIR/f.jpg`
- Candidate metadata and exact date: `yt-dlp --skip-download --dump-json URL` (`upload_date`, `timestamp`, `uploader`, `width`, `height`, `description`)
- Small candidate download for comparing: `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]/b" -o DIR/cand-1.%(ext)s URL`
- Center-crop a 16:9 frame to 9:16 to compare it with a vertical reupload: `ffmpeg -v error -i f.jpg -vf "crop=ih*9/16:ih" out.jpg`

## Playbook

1. **Collect everything about the input post.** If you got yt-dlp metadata, read the caption, hashtags, the account and the date. Read the **top comments** (agent-reach, or `yt-dlp --skip-download --write-comments`): commenters often name the source ("this is from @xyz").
2. **Extract frames**: scene changes plus a frame every 2–3 s, as contact sheets. Look for:
   - usernames, watermarks, channel logos, TikTok/Medal/Twitch marks, faint corner logos
   - burned-in captions and news logos (they tell you who reposted it and which event it is)
   - game HUDs, killfeeds, scoreboards and player names (these often lead straight to a streamer)
   - CCTV timestamps, signs, shop names, the language of any text, license plates of *vehicles and places* only
   - a film or TV look: actors, letterboxing, subtitles
3. **Classify the clip.** Each type has a different usual source:
   - game: mod pages, YouTube, Twitch clips, Medal, Reddit
   - news/CCTV: news articles, then the local-language press, then the first poster (often a business, a local Telegram channel or a local news account)
   - film/TV/anime: identify the title and the scene
   - creator content: the creator's TikTok/YouTube/Instagram
   - stock footage: stock sites
4. **Search by text.** Build queries from the clues, plus words like "original", "full video", "4K". **Search in the local language too.** Use agent-reach to search inside the platforms, and last30days for recent viral things.
5. **Reverse image search** 3–5 clean frames (cropped to remove captions and UI) if you have a way to (a browser tool or an API). If you don't, skip this step and rely on the text clues.
6. **Follow the chain back.** Articles embed posts, and reposts credit or tag the source. Keep following until you reach a post that credits nobody earlier.
7. **Get exact dates for every candidate:**
   - X: snowflake ID, `(id >> 22) + 1288834974657` = Unix ms (`node postdate.mjs`)
   - TikTok: `id >> 32` = Unix seconds (`node postdate.mjs`)
   - YouTube and others: `yt-dlp --dump-json` (`upload_date`, `timestamp`)
8. **Verify each serious candidate.** Download it, sample frames and compare them with the input clip side by side. The input is usually **cropped** (16:9 to 9:16) and has **text overlays**: center-crop the candidate to the input's aspect ratio and ignore the overlay areas. A match is **the same moment from the same camera angle**. The same event or the same topic is **not** a match.
9. **Rank and report:**
   - original = the earliest *verified* poster of this exact footage
   - best copy = the highest resolution and widest framing (leave it out if it is the original)
   - give a confidence level and the evidence, and say so honestly when it's only "same event, footage not confirmed"
   - save 1–3 matching frame pairs as JPGs in `evidence/` inside the job folder (`in-1.jpg` from the input, `match-1.jpg` from the original or best copy at the same moment) and list them in the result

## How two real cases were solved

**GTA V with a Minecraft mod (Instagram reupload, cropped, low quality)**
1. The contact sheet showed a Minecraft hotbar and item names ("Diamond Sword", "Ender Pearl") on top of GTA V gameplay.
2. Searching that combination found the mod ("Minecraft Steve Passthrough"). The mod page credited the original creator, which led to the creator's posts on X.
3. Exact post times came from decoding the X post IDs, compared with YouTube upload dates.
4. **Mistake made:** the earliest related post (the creator's X video) was reported as the original, but it was *different footage*. The real match was a YouTube upload of the same gameplay. Lesson: always check the footage itself.

**Robot pushed in a Russian store (CCTV, news caption on top, cropped to vertical)**
1. Frames showed a burned-in caption ("Robot reacts after being pushed by man in Russian store") and an N1 News logo: a news-aggregator repost of a viral event.
2. English searches found news articles naming the city and the store, embedding reposts (RT on X, a Turkish X account) and pointing to the store's Instagram.
3. A search **in Russian** found a local article saying the store itself published the video, so the store's account is the original and the outlets are reposts.
4. The store's account and post still had to be opened and confirmed directly (agent-reach can do this).
