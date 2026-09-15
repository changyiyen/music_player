# Bruce music player — LilyGO T-Embed CC1101

`music_player.js` provides SD-card WAV/MP3 browsing, play/pause/resume, stop,
next/previous track, rewind to the beginning, volume adjustment, and playlists.
It uses Bruce's existing audio decoder and the device's built-in I2S speaker.

## Firmware prerequisite

**Copying the JavaScript onto stock Bruce is insufficient.** In the supplied
firmware, `audio.playFile()` blocks the interpreter and stops on any keypress.
The small `audio.control()` binding added to `../firmware` exposes the existing
asynchronous player. The application itself, including its UI and playlists,
is JavaScript; no JavaScript audio decoder or extra firmware library is needed.

The binding is already applied to the adjacent firmware checkout. For a separate
checkout of the same Bruce source, apply the included source patch once:

```sh
git -C /path/to/firmware apply --check /path/to/music_player/firmware-audio.patch
git -C /path/to/firmware apply /path/to/music_player/firmware-audio.patch
```

Build using Bruce's normal PlatformIO toolchain, with its interpreter enabled:

```sh
cd /path/to/firmware
pio run -e lilygo-t-embed-cc1101
# With the device connected, flash when ready:
pio run -e lilygo-t-embed-cc1101 -t upload
```

Keep `GEN_MQJS_HEADERS` enabled: `gen_mqjs_headers.py` regenerates the MicroQuickJS
ROM tables from `mqjs_stdlib.c`. Bruce's build requires a host C compiler and
32-bit development libraries for this step, in addition to PlatformIO's embedded
toolchain. Lite builds or builds with `DISABLE_INTERPRETER` cannot run this app.

On Fedora (inside Toolbox on Silverblue), install the 32-bit runtime dependencies
with `sudo dnf install glibc-devel.i686 libgcc.i686 libatomic.i686`. A linker error
for `/usr/lib/libatomic.so.1.2.0` indicates that `libatomic.i686` is missing or damaged.

## Install and use

1. Copy `music_player.js` to the SD card, for example
   `/interpreter/music_player/music_player.js`.
2. Put WAV/MP3 files anywhere on the SD card. Enable **Sound** in Bruce settings.
3. Launch the script through Bruce's JavaScript interpreter/file browser.
4. Rotate the dial to highlight an action; click the dial to activate it.
   Use the back button to leave a submenu or exit the player.

| Action | Behavior |
| --- | --- |
| Open SD file and play | Append a file to the queue and play it immediately |
| Play / Pause | Start the selected track, pause, or resume |
| Stop | Stop playback; retain the queue and selection |
| Skip to next track | Play the next queued file; no wrap at the end |
| Rewind to start | Restart the current file from the beginning |
| Previous track | Start the preceding queued file |
| Volume +5% / -5% | Adjust within 0–100%; Bruce saves its global volume setting |
| Add SD file to playlist | Append a file without interrupting playback |
| View playlist | Select any queued track to play |
| Save playlist | Save a newly named M3U playlist on SD |
| Load playlist | Replace the current queue; select Play to start |
| Clear playlist | Confirm, stop playback, and empty the queue |
| Exit / back at main menu | Stop playback and return to Bruce |

Menus retain the selected main action, so repeated clicks can adjust volume.
Playback advances automatically at end of track, including while browsing files
or viewing the queue. The filename-entry keyboard temporarily blocks JavaScript:
audio keeps playing, and advancement resumes when the keyboard closes.

## Playlists and format limits

- Build a queue with **Add SD file to playlist**, then **Save playlist**.
  Saved files live in `/music_player/<name>.m3u` on the SD card.
- Names accept letters, numbers, spaces, `_`, and `-`. Existing playlists are
  preserved: use a new name to save a revision. Writes are read back and verified
  before the temporary file is renamed; failed saves may leave a `.tmp` file.
- Loading supports UTF-8 M3U with absolute SD paths, LF/CRLF, and `#` comments.
  URLs and relative paths are rejected. Example:

  ```m3u
  #EXTM3U
  /Music/First song.mp3
  /Music/Second song.wav
  ```

- Maximum 128 tracks per queue and 32 KB per imported M3U. Directory listings use
  Bruce's in-memory `storage.readdir`; organize very large libraries into folders.
- WAV/MP3 decoding capabilities are those of Bruce's bundled ESP8266Audio decoder.
  PCM WAV and conventional MP3 files are suitable starting points for device tests.
  Unsupported, empty, or missing files that fail to start halt automatic advancement
  and show an error; use Skip or Open to continue.
- **Rewind means restart, not seek backward by seconds.** The supplied audio engine
  has no seek function. The displayed time is its approximate elapsed playback
  time; duration is unavailable. A decoder stopping during playback is reported
  as idle by Bruce, so this app cannot distinguish that failure from normal EOF.
- The app explicitly reads/writes SD, without falling back to internal flash.
  Enable/mount the SD card in Bruce before launching, especially if the script
  itself is stored on internal flash.

## Checks

```sh
node music_player/test_player.cjs
# Optional: repeat the same checks in BruceDevices/mquickjs tag 0.0.6:
node music_player/test_player.cjs /path/to/mqjs
```

Checks passed under Node.js 24.16.0 and a host build of BruceDevices/mquickjs
0.0.6. The firmware's 32-bit MicroQuickJS ROM header was regenerated from the
updated binding definitions. The included patch contains source changes only;
Bruce's build regenerates that header when the patch is applied elsewhere.

The dependency-free checks mock Bruce's hardware APIs and exercise controls,
queue advancement, volume boundaries, M3U validation, verified saves, browsing,
rotary selection, and exception/exit cleanup. Hardware mocks do not establish
audio output quality or board-level compatibility.

Before relying on the player on-device, test a WAV and MP3, pause/resume,
rewind/skip, volume endpoints, two-track automatic advancement, save/load after
relaunch, a missing file, and exit while playing. A full target build and physical
device playback have not been verified in this workspace.

## Binding reference

`require('audio').control(command, value)` supports:

| Command | Result |
| --- | --- |
| `play`, absolute SD WAV/MP3 path | Boolean; starts existing `PLAYBACK_ASYNC` engine |
| `pause` | Boolean; requests pause/resume toggle |
| `stop` | Boolean; false is normal when already idle |
| `volume`, number 0–100 | Sets global playback volume; integer percentage |
| `info` | `{state, position, volume}`; position in milliseconds |

States are `idle`, `playing`, `paused`, `stopping`, and `error`. Invalid commands
and arguments throw. Builds without the I2S speaker support throw an unsupported
error. The legacy `audio.playFile()` behavior remains available.

Source contracts: `src/modules/bjs_interpreter/{audio,storage,keyboard,display}_js.cpp`,
`src/modules/others/audio.{h,cpp}`, and
`boards/lilygo-t-embed-cc1101/{interface.cpp,pins_arduino.h}` in the supplied firmware.
