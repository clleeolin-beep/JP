# Talent DB Launcher (Public)

This repository now keeps only a public launcher page.

- Public page: `index.html`
- Private core app: hosted in Google Drive (not in this repo)

## How It Works

1. User opens the public launcher.
2. User signs in with Google OAuth.
3. Launcher reads a private manifest JSON from Google Drive.
4. Launcher reads the private app entry HTML from Google Drive.
5. Private app runs inside an iframe.

## Required Setup

Update these constants in `index.html`:

- `CLIENT_ID`
- `APP_MANIFEST_FILE_ID`

## Drive Manifest Example

Create a private Drive file (JSON) and put:

```json
{
  "entryFileId": "YOUR_PRIVATE_ENTRY_HTML_FILE_ID"
}
```

`entryFileId` should point to the private app HTML file in Google Drive.

## Important Security Note

Loading code from Drive hides code from public GitHub, but browser-delivered code is still visible to logged-in users.
For true server-side secrecy, move sensitive logic to backend APIs (Apps Script / Cloud Run / Cloud Functions).
