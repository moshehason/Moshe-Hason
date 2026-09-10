# 5 file updates — ready to merge into the 117 project

These 5 files replace the same-named files at the same paths in the project.
No new files, no deleted files — just updated content.

Where each one goes:
```
public/admin/app.js       ← replace
public/admin/admin.css    ← replace
public/index.html         ← replace
public/script.js          ← replace
public/styles.css         ← replace
```

## What changed and why

**public/admin/app.js**
- Fixed: iOS Safari was dropping multi-select in the photo/video picker
  (Photo Library and Files) because the dynamically-created `<input type=file>`
  was never attached to the DOM before `.click()`. Now it's appended (off-screen)
  before opening and removed after selection.
- Fixed: selecting several large videos at once could crash/close the tab.
  Video batches are now capped at 6 per selection, and each video is saved to
  the server immediately after it finishes uploading — so a mid-batch crash
  no longer loses videos that already finished.
- Added: move-left / move-right buttons on each process/detail photo, so
  photos can be reordered after upload (persists via the existing PUT /works/:id).
- Added: exact-duplicate detection (SHA-256 hash) within a single multi-select
  batch — if the same image file is picked twice in one go, only one copy is
  kept. Does not detect duplicates against photos uploaded in earlier sessions.

**public/admin/admin.css**
- Styling for the new move-left/move-right buttons on the detail photo grid.

**public/index.html**
- Added an Instagram link element in the footer info-contact section
  (id="infoInstagram"), wired to the site's existing `instagram` setting.

**public/script.js**
- Speech feature reworked into 5 named voice styles (oracle, urgent, whisper,
  robotic, vintage radio), each with its own pitch/rate/volume signature and
  its own line set, instead of one flat randomized voice.
- Added a small 80s-style pixel-art bird that flies across the screen (with
  wing-flap animation and a couple of brief glitch flickers) once every 2
  minutes. It's a fixed-position overlay, so it shows regardless of which
  view is open (home, work detail, diary).

**public/styles.css**
- Styling + keyframe animations for the new pixel bird overlay.

## Not yet deployed
None of this has shipped to the live site — Moshe doesn't currently have a
working `./ship` path (GitHub Actions → Cloudflare is stuck) or a computer
set up with Claude Code yet. He's set on learning to do this himself, so
whatever you can walk him through — even partially — helps.
