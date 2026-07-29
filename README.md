# OrgChart Builder

A touch-first, installable web app for building org charts and hierarchies on
an iPhone, or any phone or browser. No App Store install needed.

Live at **https://jump4joy1.github.io/Org-Charts-/**

## Install on iPhone

1. Open the site in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Launch it from the home screen. It runs full screen and works offline.

Installing matters for more than convenience: iOS gives a home-screen web app
durable storage, while a plain Safari tab can have its data cleared after about
a week of not being opened.

## Building a chart

- **+** adds a box. Tapping empty canvas asks first by default; change that
  under Chart style · Tapping empty space.
- Drag the round handles on a box to connect it to another, or to empty space
  to create a connected box.
- Drag the square grip at a box's bottom-right corner to resize it.
- Long press a box for quick actions (Pro).
- Pinch to zoom, drag empty space to pan, and the ⤢ button fits everything.
- **Tidy layout** arranges the chart back into a clean tree.
- Multiple charts under menu · **Your charts**, with Save a copy and Rename.

## Boxes

- **12 shapes**: rounded, square edge, pill, square, circle, diamond, hexagon,
  octagon, slant, trapezoid, chevron, cylinder.
- **Corner rounding** works on rectangles and polygons alike, so a rounded
  hexagon is a real thing.
- **Size**: width and height sliders, or the corner grip. Auto height by
  default.
- **Text size**: a continuous 60 to 260 per cent slider, with presets.
- **Fills**: solid, gradient with an angle and eight ready-made blends, or one
  of 12 textures with its own colour, backing colour and scale.
- **Badges**: photo, nickname only, or none. A nickname longer than initials
  becomes a pill so it stays readable.
- **Photo only** fills the whole box with a picture, clipped to its shape.
- **Apply this look to all boxes** copies any subset of the styling.

## Canvas

- 24 ready-made backgrounds, plus solid, gradient and textured backgrounds you
  build yourself, or your own photo — filled or tiled, with an optional
  colour tint. Menu · **Chart style** · Background.
- Department containers group boxes and move them together.
- Title block and legend, both draggable, both included in exports.
- Shared trunk connectors, snap-to-grid with alignment guides.
- Notes attached to a box, a connector, or floating.

## Colours

- **Colour sets** (menu · Colour sets) define palettes that fill every colour
  picker in the app.
- **From a picture** reads a logo or photo and pulls out the colours it
  actually uses, discarding near-white, near-black and near-duplicates.

## Density, contrast and motion

Chart style has **Density** (compact, standard, spacious) which scales both the
interface and the chart geometry, and **Contrast** for a high-contrast palette
with thicker hairlines. The app honours the system reduced-motion setting.

## Exporting

- **Images and print**: PNG, JPG, SVG, and PDF laid out on Letter or A4 in
  either orientation.
- **Data**: CSV and Excel with all 22 schema columns, Mermaid, Draw.io, ICS for
  shifts, vCard for contacts.
- **Share a link**: the whole chart is packed into the URL fragment, so it
  works with no account and never reaches a server. Photos are left out to keep
  links short.
- **Backup**: Export and Import JSON.

## Sync across devices

Sign in with your email on each device and your charts follow you. There is no
code to copy.

Sync uses a Supabase project that **you** own, so your charts are never on a
server the author controls. One-time setup, free, no card:

1. Create a project at supabase.com. Any name, any region, free plan.
2. Project Settings · API: copy the **Project URL** and the **anon public** key
   into the app's sync sheet, then Save project details. Direct links to the
   remaining pages appear once the URL is in.
3. SQL Editor: paste the block from `supabase-setup.sql` (the app has a copy
   button), Run.
4. Enter your email, tap the button, and paste back whatever the email gives
   you. A 6-digit code and the stock sign-in link both work.
5. Same URL, key and email on the other device.

Editing the email template is optional. The app parses the token out of the
stock magic link, so there is no need to go and add `{{ .Token }}`.

Rows are tied to your account with row-level security, so the anon key alone
reads nothing. Pushes go out about a second after you stop editing; pulls run
at launch, on focus, on reconnect, and every 20 seconds while the app is open.
Conflicts are last-write-wins per chart.

**Test connection** in the sync sheet does a real round trip and names whatever
is wrong.

## Webhook

Optional, in the sync sheet. Give it a URL and the whole chart is POSTed there
as JSON whenever it changes, debounced to two seconds. No account, no OAuth.

## Pro

Status badges, contacts and one-tap Call / Text / WhatsApp / Email,
certification tracking with expiry warnings, shift scheduling with calendar
export, per-role task lists, and the succession view that flags any role with
nobody backing it up.

Checkout is **not** wired up. A static site cannot verify a payment, so the
button is inert until `PRO_CHECKOUT_URL` in `app.js` points at a Stripe payment
link. Licence keys validate against a checksum, which stops casual sharing but
not someone with developer tools. Real enforcement needs a server.

## Keyboard

| Key | Action |
| --- | --- |
| Ctrl/Cmd + K | Command palette |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| n | New box |
| f | Fit to screen |
| / | Search |
| Escape | Close any open sheet |

## Data and privacy

Charts live in the browser's local storage. With sync on they are mirrored to
your own Supabase project and nowhere else. Colour sets, preferences and the
Pro licence are per device and never travel inside an exported or synced chart.

Full policy, the version app store listings link to: **[privacy.html](https://jump4joy1.github.io/Org-Charts-/privacy.html)**.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and all CSS |
| `app.js` | The application |
| `design-tokens.js` | Colour, spacing, radius, type, motion and density |
| `schema.js` | Chart schema version 3 and the migration ladder |
| `command.js` | Command pattern and the undo/redo history |
| `sw.js` | Service worker; network-first for app code |
| `supabase-setup.sql` | The SQL for sync |
| `tools-make-icons.py` | Regenerates the app icons |

## Local development

No build step and no dependencies. Serve the folder with any static server:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

## Checking types

```
npx tsc -p jsconfig.json
```

Plain JavaScript checked through JSDoc and `checkJs`. Currently clean.
