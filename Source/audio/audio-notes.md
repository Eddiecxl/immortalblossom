# Game Beta v4 soundtrack

Six original compositions are stored in `Luoxian Beta v4/game/assets/audio/` as local 48 kHz stereo, 16-bit PCM WAV files. These are composed/synthesized arrangements, not recordings of a live orchestra and not third-party music samples. Each has its own theme, harmony sequence, quiet introduction, percussion build, climactic section, and resolving coda. Instruments comprise layered detuned sustained strings, plucked harmonic strings, flute-like lead, brass-like swells, low drums, cymbal noise, stereo placement and convolution ambience.

| Title | Seconds |
| --- | ---: |
| 九霄开天 | 77.24 |
| 云海问道 | 82.79 |
| 剑起昆仑 | 67.00 |
| 月照归墟 | 87.00 |
| 万劫争鸣 | 64.60 |
| 山河长明 | 75.57 |

Peak mastering target is 0.82 full scale (approximately -1.72 dBFS). Each master includes a gentle fade-in and final fade, and retains dynamic range instead of flattening all sections. Total running time is approximately 7 minutes 34 seconds before runtime overlaps. Metadata is in `game/beta4/soundtrack.js`.

## Runtime integration

`createScore(getSettings)` preserves `unlock`, `sfx`, `apply`, `setScene`, `setIntensity`, `setEnabled`, and `isEnabled`.

- `nextTrack()` returns a Promise for the next track metadata. With a locked context, first unlocks playback.
- `getNowPlaying()` returns null until first decoding completes, then `{id,title,composer,index,total,duration,position,scene}`. Index is 1-based and composer is `落仙原创`.
- `subscribe(fn)` immediately reports an already-playing track and returns an unsubscribe function.
- `document` receives `lx:track` with the same metadata in `event.detail`.
- `getPlaybackState()` reports the context state, scene, number of live sources, transition seconds, and loading state; useful for verification.
- `dispose()` tears down the transport, handlers, and audio context.

Music advances sequentially through each scene's eligible tracks and wraps without immediately repeating. Game scene includes all six; title is more restrained; introduction and danger favor martial pieces. Compatible pieces continue through scene changes. Transitions overlap for three seconds using equal-power curves; the next piece is decoded in advance, and decoded cache normally holds just the current and next piece. Browser audio must first be unlocked by user interaction.

`apply()` adjusts gains without restarting a source. Explicit volume-slider input should invoke `setEnabled(true)` and `unlock()` before `apply()` so an earlier top-level mute is intentionally released. `muteBackground` suspends the audio context only while the document is hidden and that option is true, preserving play position. Disabling that option resumes an already unlocked context.

## Reproduce and verify

From the release root, to regenerate the six WAV masters:

```powershell
node Source/audio/audio-render.mjs
```

Rendering uses a local Playwright installation and Microsoft Edge's OfflineAudioContext. No external network or music service is used. The render report records measured durations, levels and byte counts. The original development workspace also tested PCM peaks, RMS, stereo width, distinct file hashes, scene pools, volume changes, background suspension and rotation; those test scripts are not bundled in the player release.
