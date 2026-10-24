# Practice Metronome

A piano-practice metronome with a large beat display, built to install on iPad and keep running offline.

The built-in preset is the original 4-bar loop in 4/4 at 80 BPM:

- Bar 1 plays a quarter-note triplet (three even clicks) across beats 1–2, then quarter notes on beats 3 and 4.
- Bars 2–4 are quarter notes.
- Downbeats are accented.

Tempo and volume can change while it plays without dropping the beat.

## Run it

The page is static. There is no build step. It has to be served over HTTP: ES modules and the service worker do not run from a `file://` URL.

```bash
python3 -m http.server 43123
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Tests

```bash
npm test
```

Node runs the scheduler, pattern, preset storage, click-voice, icon, and manifest checks. Nothing else needs to be installed.

## Deploy

Upload this directory as a static site. Do not set a build command.

- **GitHub Pages:** serve the branch root (or `/docs` if you move the files there). Relative paths mean `https://<user>.github.io/<repo>/` works.
- **Vercel, Netlify, or any static host:** publish the repository root.

iPad installation and offline caching need HTTPS. `http://` on a LAN address will load the page, but Safari will not install a service worker there.

## On iPad

1. Open the site in Safari over HTTPS.
2. Tap Share, then **Add to Home Screen**.
3. Open it from the icon. It runs full screen, without the Safari toolbar.

After that first online load, the metronome works offline. Presets stay on the device.

## Files

| Path | Role |
| --- | --- |
| `index.html` | Page, install tags, relative links |
| `css/styles.css` | Dark practice-room layout, portrait and landscape |
| `js/app.js` | Screen, transport, wake lock |
| `js/scheduler.js` | Lookahead scheduler on the audio clock |
| `js/pattern.js` | Bars, subdivisions, accents, built-in loop |
| `js/presets.js` | `localStorage` presets and the working session |
| `js/audio.js` | Sample-accurate clicks and the iOS unlock |
| `sw.js` | Offline cache |
| `manifest.json` | Installable web app manifest |
| `icons/` | 180, 192, 512, maskable 512, and a 32 px favicon |
| `scripts/generate-icons.py` | Redraws the icons (Pillow). The PNGs are already committed |
| `tests/` | Headless checks |

## iPad caveats

- **Install path.** iPad Safari has no install prompt. Use Share → Add to Home Screen. The manifest and `apple-mobile-web-app-capable` tag make that open full screen.
- **HTTPS.** A service worker is only installed on a secure origin. Localhost is secure on the iPad itself; a computer on the same Wi-Fi is not, unless you put TLS in front of it.
- **First tap.** Sound starts on the Start button. iPadOS will not play audio before a gesture.
- **Silent switch.** A silent audio loop starts with that gesture so Web Audio is more likely to ignore the ring/silent switch. On some iPadOS versions the switch still mutes the clicks. If you hear nothing, check the side switch and the volume.
- **Leaving the app.** iPadOS suspends the audio clock in the background. Coming back resumes it and keeps the beat when the clock only paused. If the system drops the audio session, tap Start again.
- **Screen sleep.** The Screen Wake Lock API keeps the display on while the metronome is playing. It needs iPadOS 16.4 or newer, and it is released when you leave the app. Older systems can still dim the screen.
- **Offline cache.** iPadOS may evict a site that has not been opened for a while (on the order of a week). Open it online once and the cache fills again.
- **Private browsing.** Presets and the offline cache may be unavailable. The page says so if storage throws.
- **Splash.** iPadOS picks its own launch image unless every device size is provided. The first frame can be a blank dark or white flash, then the metronome.
