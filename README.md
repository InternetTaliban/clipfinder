# Clip Finder

Personal Android app: share or paste a link (or pick a gallery video) to download it, identify the song(s), and trace the clip to its original source. The plan is in [clip-finder-plan.md](clip-finder-plan.md).

- `server/`: Node 24 + Express, runs TypeScript directly (no build step). Jobs are folders in `server/data/<id>/` with a `job.json`.
- `agent/`: the find-original agent's working folder, with its playbook skill in `.claude/skills/find-original/`.
- `app/`: Expo (SDK 58) app.

## Server

Needs `yt-dlp`, `ffmpeg`, `uv` (runs the Shazam script in `server/shazam.py`) and Claude Code (logged in, with the **last30days** plugin and the **agent-reach** skill) on PATH.

```sh
cd server
npm install
cp .env.example .env   # set CLIPFINDER_TOKEN to a long random string
npm start              # http://localhost:8787
npm test
```

- **Claude login for unattended runs:** a normal `claude` login expires. Run `claude setup-token` and put the token in `server/.env` as `CLAUDE_CODE_OAUTH_TOKEN=...`.
- **Instagram and other sites that need a login:** export your browser cookies in Netscape format to `server/cookies.txt`; yt-dlp uses it automatically.
- **Song recognition:** Shazam through the unofficial `shazamio` library: free, no key, but it can break if Shazam changes its API. Put an AudD key (https://dashboard.audd.io, paid) in `AUDD_TOKEN` to fall back to AudD when that happens.

API, all with `Authorization: Bearer <CLIPFINDER_TOKEN>`:

| | |
|---|---|
| `POST /jobs` | `{ "url": "...", "audio": true, "original": true }`; the video is always downloaded |
| `POST /jobs/upload?audio=1&original=1` | raw video bytes as the body |
| `GET /jobs` | history, newest first |
| `GET /jobs/:id` | one job; poll it |
| `GET /jobs/:id/files/<path>` | the video and evidence frames |

## App

```sh
cd app
npm install
cp .env.example .env   # same token as the server
npx expo run:android   # builds and installs on the running emulator
```

For a real phone, set `EXPO_PUBLIC_SERVER_URL` to the PC's LAN address (e.g. `http://192.168.1.20:8787`) and build a standalone APK with `npx expo run:android --variant release`.

Finished-job notifications are local notifications fired by a background check (no Firebase). Android runs it about every 15 minutes or more, so a notification can arrive up to ~15 minutes after the job ends; it doesn't run after a force-stop.
