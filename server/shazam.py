# Recognizes audio clips with Shazam through the unofficial shazamio library.
# Usage: uv run --python 3.12 --with shazamio==0.9.0 python -I shazam.py clip1.mp3 clip2.mp3 ...
# Prints a JSON list with one song (or null) per clip, in order.
import asyncio
import json
import sys

from shazamio import Shazam


def song(track):
    if not track:
        return None
    hub = track.get("hub") or {}
    apple = next((a["uri"] for o in hub.get("options", []) if o.get("providername") == "applemusic"
                  for a in o.get("actions", []) if a.get("uri", "").startswith("https://music.apple.com")), None)
    spotify = next((a["uri"] for p in hub.get("providers", []) if p.get("type") == "SPOTIFY"
                    for a in p.get("actions", []) if a.get("uri", "").startswith("spotify:search:")), None)
    return {
        "title": track.get("title"),
        "artist": track.get("subtitle"),
        "songLink": track.get("url"),
        "appleMusic": apple,
        # Shazam only gives a Spotify app search link; the web form also opens the app on Android.
        "spotify": spotify and "https://open.spotify.com/search/" + spotify.removeprefix("spotify:search:"),
    }


async def main():
    shazam = Shazam()
    print(json.dumps([song((await shazam.recognize(path)).get("track")) for path in sys.argv[1:]]))


asyncio.run(main())
