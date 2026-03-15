# Build executables for SilentCursor

Builds are done from the **project root** (where `package.json` is), not from the `website/` folder.

## Prerequisites

- Node.js and npm installed
- Dependencies installed: `npm install`

---

## Windows (64-bit)

From project root:

```bash
npm run build:win
```

**Output in `dist/`:**
- `SilentCursor Setup 1.0.0.exe` — NSIS installer (~330 MB)

**Do not commit the .exe** (GitHub’s limit is 100 MB). **Publish via GitHub Releases:** create a new Release, tag (e.g. `v1.0.0`), and attach `SilentCursor Setup 1.0.0.exe` from `dist/`. The website points users to the Releases page.

---

## macOS (DMG + ZIP)

macOS builds **must be run on a Mac** (Apple silicon and Intel are supported by default).

From project root:

```bash
npm run build:mac
```

**Output in `dist/`:**
- `SilentCursor-1.0.0.dmg` — disk image for installation
- `SilentCursor-1.0.0-mac.zip` — alternative (e.g. for notarization workflows)

**Do not commit large binaries.** Attach the DMG (and optionally the ZIP) to the same GitHub Release as the Windows build so the website’s “Download” links work.

---

## Version number

The version (e.g. `1.0.0`) comes from `version` in `package.json`. Update it there before building for a release; the output filenames will match.

---

## Summary

| OS       | Command           | Main artifact                          |
|----------|-------------------|----------------------------------------|
| Windows  | `npm run build:win`  | `dist/SilentCursor Setup 1.0.0.exe`   |
| macOS    | `npm run build:mac`  | `dist/SilentCursor-1.0.0.dmg`         |

After building, create a **GitHub Release** (e.g. tag `v1.0.0`) and attach the .exe and .dmg so the website’s download links work. The repo ignores `website/downloads/*.exe`, `*.dmg`, and `*.zip` to stay under GitHub’s 100 MB file limit.
