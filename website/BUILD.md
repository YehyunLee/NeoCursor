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
- `SilentCursor Setup 1.0.0.exe` — NSIS installer (use this for the website)

**For the website:** Copy the installer into `website/downloads/` and rename to `SilentCursor-Setup-1.0.0.exe` (no spaces) so the download link works:

```bash
copy "dist\SilentCursor Setup 1.0.0.exe" "website\downloads\SilentCursor-Setup-1.0.0.exe"
```

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

**For the website:** Copy the DMG (and optionally the ZIP) into `website/downloads/`:

```bash
cp "dist/SilentCursor-1.0.0.dmg" "website/downloads/"
```

---

## Version number

The version (e.g. `1.0.0`) comes from `version` in `package.json`. Update it there before building for a release; the output filenames will match.

---

## Summary

| OS       | Command           | Main artifact                          |
|----------|-------------------|----------------------------------------|
| Windows  | `npm run build:win`  | `dist/SilentCursor Setup 1.0.0.exe`   |
| macOS    | `npm run build:mac`  | `dist/SilentCursor-1.0.0.dmg`         |

After building, copy the files into `website/downloads/` as described above so the website download links work.
