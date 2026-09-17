# Lecturer guide

[Back to Beamer PDF Presenter](../README.md)

## Present a PDF

Select **Open PDF**, or drag a PDF onto the dashboard. Then select **Open audience window**, allow the pop-up, move that window to the projector/second display, and press **F** inside it for fullscreen. Use an extended desktop rather than mirrored displays. Share only the audience window when presenting through a video-conferencing application.

The current and next previews are private. The audience window shows the current PDF page or the selected countdown display. Beamer overlays remain separate PDF-page presentation steps. The app does not upload the selected PDF.

## Switch between PDFs in a folder

The left sidebar groups **Open PDF** and **Open PDF folder** together.
Opening a folder lists its PDFs without selecting or opening any of them.
An already presented PDF remains on screen. A single-file selection grants
access only to that file; select its folder separately to browse nearby PDFs.

Only PDFs directly in the selected folder appear, including `.PDF`; nested
folders and other file types are excluded. **Double-click or double-tap** a
filename to open it. A single click only focuses the row. Keyboard users can
focus a row with Tab and press Enter or Space to open it. Long names wrap
within the sidebar. The last page of each PDF is remembered during that folder
session and shown in the list. Reloading the app, choosing another folder,
opening a standalone PDF, or loading the demo clears that folder session.

The browser may call folder selection an upload. The files are read locally in
the browser; this app does not upload their names or contents to a server.
No folder permission or PDF content is stored after closing the session.
An empty folder leaves the current PDF available and shows an empty-list message.
To refresh a changed folder, choose it again.

## Virtual laser pointer

Press **Laser pointer** in the controls, or **L**, then move over the current PDF
preview. A red dot indicates the corresponding point in the audience window.
Coordinates follow the rendered slide, including different aspect ratios and
letterboxing. The next-page preview does not drive the pointer.

The pointer hides outside the slide, during document/page changes, on focus
loss, when the audience is blanked, and while the full-screen timer is shown.
Move onto the current slide again to resume. Press the button or L to turn it
off. Coordinates use the bundled PDF.js canvas. Touch input does not activate it.

## Select a brand

Place PNG logo files directly in `logos/`, then press **Refresh logos** and
choose a **Brand** in the bottom controls. The filename supplies the uppercase
name: `sisstem.png` gives SISSTEM; `faculty_of_arts_and_science.png` and
`faculty-of-arts-and-science.png` give FACULTY OF ARTS AND SCIENCE.

The selected name/logo appears in the presenter header and audience analog
timer. Switching brands preserves the countdown and current PDF. The optional
selection preference is saved in this browser; unavailable storage does not
prevent use. **BEAMER PDF PRESENTER · no logo** is the generic choice. The supplied University of Aruba logos are listed in
[logo credits](../logos/SOURCES.md); other brands can be added as PNGs.

Add custom logos under new filenames. In a portable package, replacing or
removing an inventoried file fails its integrity check; adding another PNG is
supported. Static hosting also requires its filenames in `logos/catalog.json`;
the supplied Python server discovers them automatically.

## Resize the previews

Drag the vertical divider between **Current page** and **Next page** left to enlarge the next preview, or right to enlarge the current preview. Each pane can occupy from 15% to 85% of the available preview width. Both remain side by side on small screens, and the bottom controls wrap when needed.

Double-click the divider to restore the default **60% current / 40% next** split. With the divider focused, Left/Right adjusts it by two percentage points, Shift+Left/Right by ten, Home/End moves to the limits, and Enter resets it. Escape cancels a drag in progress. These keys resize the panes rather than navigating PDF pages while the divider has focus.

The split is saved per browser/web origin when local storage is available. It remains usable without storage. The last completed PDF canvas remains visible during dragging, then the preview is redrawn at its new resolution after the size settles.

## Independent exercise / exam countdown

The new **Exercise / exam countdown** section is in the bottom control dock. It is separate from the original private elapsed timer under **Presentation**.

Enter whole **Minutes** and **Seconds**, then press **Set**. Durations from one second to 1,440 minutes (24 hours) are accepted. Set applies the duration and resets/pauses the countdown; editing the fields without pressing Set does not change the active duration. The large digital readout is the configured countdown, not an uncommitted input value.

Choose one of three displays:

| Display | Audience output |
|---|---|
| Presenter only | PDF remains visible; countdown is private. |
| On slide (digital) | Small countdown in the selected slide corner. |
| Full-screen analog | A large countdown dial replaces the PDF. |

**Start countdown**, **Pause countdown**, and **Resume countdown** use the same button. **Reset** restores the configured duration and pauses it. Resetting the elapsed timer does not reset the countdown, and vice versa.

### Exercise timer on a slide

Navigate to the exercise page. For a five-minute exercise, enter **5** minutes and **0** seconds, press **Set**, choose **On slide (digital)**, choose a corner, and press **Start countdown**.

All four positions are available: top left, top right, bottom left, and bottom right. With PDF.js, the timer is anchored to the fitted PDF page rather than the black letterboxing around it. Its size scales with the slide. It appears in the private current-page preview and in the audience window, but never in the next-page preview.

The corner timer stays visible across page changes until hidden. Choose a corner that does not obscure exercise text. **Hide timer / return to PDF** (or **H**) removes the timer from the audience display without pausing it.

### Full-screen exam timer

For a 90-minute exam, enter **90** minutes and **0** seconds, press **Set**, choose **Full-screen analog**, and press **Start countdown**. Open the audience window and press **F** in that window for browser fullscreen.

The analog display also works **without loading any PDF**. It shows a dial, a hand, a shrinking shaded sector, a large exact digital readout, and the running/paused/finished status. The dial represents the entire configured duration. Its quarter labels are in seconds for durations up to two minutes, and minutes for longer durations; the hand retreats toward zero as time expires. Decimal dial labels represent fractions of a minute, not a minutes:seconds string.

The current-preview pane mirrors this display, while the next-preview pane remains a PDF preview. Switching back to Presenter only or choosing **Hide timer / return to PDF** restores the current PDF page. PDF navigation remains available while the analog display is shown; changing pages intentionally changes which page will be restored.

At zero, the display stays at **00:00** and shows **Time is up**. It does not beep, flash, restart, or advance the PDF automatically. Press Reset to prepare another countdown. The final 20% and 10% use warning colors without animation.

## Synchronization and session behavior

Countdown changes are sent to the audience window immediately. Each window calculates remaining time from the same absolute deadline, rather than decrementing a counter whenever a browser callback runs. A newly opened or reloaded audience window receives the active countdown state, including its remaining time, display mode, corner, and pause status.

Hiding the timer, switching its display, changing the PDF page, blanking the screen, or resizing the panes does not pause the countdown. The **B** shortcut blanks the audience output, including an analog timer. The presenter keeps a private preview with an “Audience screen is blanked” notice.

Keep the presenter dashboard open. Closing/reloading it ends the session and clears the running countdown; this is not a persistent exam-management system. Configure the computer not to sleep during an exam. Sleep or background throttling may delay painting, but the next update recalculates time from the deadline. Changing the device's system clock can change the remaining time.

## Narration and auto-play

Keep a narration text file beside its PDF, with the same filename stem:
`Lecture.pdf` and `Lecture.txt`. Open that folder, open the PDF, then press
**Auto-play**. Browser access to a single PDF does not include adjacent files;
use **Open narration** to select the text file in that case. **Load demo**
includes the supplied `sample-beamer.txt` example.

Playback starts at the current physical PDF page. **Pause narration** holds
playback; **Continue** repeats the interrupted passage, up to 240 characters,
and resumes. A scripted
`[wait: ...]` remains on screen until Continue is pressed. Manual page changes
stop narration. Blanking the audience or showing the full-screen timer pauses
active narration, so an exercise can run before the PDF is restored.

Expand **Voice settings and narration text** to select a local voice or change
speed. Optional slides are included by default. Changing a setting stops
playback; the next Auto-play starts at the current page. Speech comes from the
lecturer's computer. Its audio output must be connected to classroom speakers
if students are to hear it.

The [narration guide](NARRATION.md) documents the script format, validation and
voice availability. Narration uses installed local voices, so no TTS model or
online speech service is required. The text remains readable when the browser
has no local voice.

## Keyboard controls

| Key | Action |
|---|---|
| Right, Down, Page Down, Space, Enter | Next PDF page |
| Left, Up, Page Up, Backspace | Previous PDF page |
| Home / End | First / last PDF page |
| B | Blank / restore audience output |
| L, in presenter | Toggle the virtual laser pointer |
| O | Open / focus audience window, from presenter |
| T / R | Start-pause / reset private elapsed timer, from presenter |
| C | Start-pause / resume countdown, from either window |
| H | Hide countdown / return to PDF, without pausing it |
| F, in audience | Enter / leave browser fullscreen |

Navigation shortcuts do not hijack text/number fields or selectors. Enter/Space on a focused button activates that button rather than changing the PDF page. Divider keys have the separate resizing behavior described above.

## PDF renderer and offline use

The app uses only local PDF.js assets and never downloads a renderer from a CDN. The portable ZIP already contains the module, worker, character maps, standard fonts, WebAssembly decoders, ICC profiles and licenses. For the source checkout, a maintainer can prepare the locked cache once while online:

```bash
python3 tools/cache_pdfjs.py
```

On Windows:

```powershell
py -3 tools\cache_pdfjs.py
```

The cache helper verifies the pinned package integrity and stages a complete resource set before installation. A failed preparation preserves the previous cache. The app's local server also applies a content policy that blocks external runtime connections. The countdown and logo have no network dependencies.

PDFs render only through the bundled PDF.js canvas; browser PDF toolbars,
thumbnail panes and embedded readers are never used. If a new PDF cannot
load, its error remains below the controls and the current presentation stays
available. The offline renderer uses Mozilla's translated/polyfilled legacy
build, with the matching worker at the same pinned version 6.3.289. The
renderer line reads “offline compatibility build”. Browser minimums still
apply; see [Mozilla's compatibility table](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported).
After a source update, prepare the cache again and reload both presenter and
audience windows. Full-screen analog output can run without loading a PDF.

The existing renderer scope remains: no PDF transition effects or embedded audiovisual playback, and no custom password dialog. Each PDF.js page is independently fitted, including mixed page sizes.

## Static hosting

The app can be served as static files. Keep `index.html`, `styles.css`, **all application `.mjs` files**, `sample-beamer.pdf`, `sample-beamer.txt`, `logos/` (including its catalog), and a complete `vendor/` together. There is no database or application backend. Presenter and audience must use the same origin. HTTPS or localhost is preferable for browser capabilities. Publish an explicit static-file set, excluding `.git` and development files; do not expose the source checkout as a production website.
