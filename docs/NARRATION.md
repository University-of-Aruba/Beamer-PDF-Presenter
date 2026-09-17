# Narration scripts

Auto-play reads a UTF-8 text script alongside a PDF. Speech uses an installed
local voice exposed by the browser. No model download is required and text is
not sent to an online speech service. The audience window receives page changes;
speech plays on the lecturer's computer through its selected audio output.

## Start a narrated presentation

1. Keep `Lecture.pdf` and `Lecture.txt` in the same folder. Select **Open PDF
   folder**, then double-click the PDF. The folder list still shows PDFs only.
2. Press **Auto-play**. The app checks the companion file against the PDF before
   speaking. For PDFs opened with **Open PDF** or dropped into the app, select
   the script with **Open narration** first.
3. Use **Pause narration** to interrupt and **Continue** to resume. Manual page
   navigation or loading another PDF stops playback.

The script's filename stem must match the PDF exactly; `.txt` and `.TXT` are
accepted. Only files immediately inside the selected folder are considered.
If several files match, use Open narration to choose one explicitly.

**Load demo** includes [sample-beamer.txt](../sample-beamer.txt), paired with
[sample-beamer.pdf](../sample-beamer.pdf). The example has a timed pause and an
indefinite exercise wait. It also demonstrates an overlay reveal.

## Voice and playback controls

Expand **Voice settings and narration text** for the voice and speed controls.
Only voices reported as local by the browser appear. Available languages and
voice quality depend on the operating system and browser. If no voice appears,
enable a speech voice in the operating system, press **Refresh voices**, or try
another browser. Installing an additional OS voice may require an initial
download and may be restricted on managed computers. Test the selected voice
before class and connect the computer's audio output to the classroom speakers.

The current narration or instruction is readable in the same section. Opening
a script without starting playback displays the remaining script text. This
also works when no local voice is available.

Pause cancels the current speech passage. Continue repeats that passage, up to
240 characters. This avoids dependence on browser pause/resume support. A timed
pause retains its remaining duration. A `[wait]` instruction is displayed and
has no timeout. Continue moves past it without speaking the instruction.
Blanking the audience or showing the full-screen timer pauses active playback;
restore the PDF before continuing. An existing exercise wait stays in place.

Reveal captions are silent labels. Only `[cue: ...]` and ordinary narration
are spoken. Short cues flow into the following narration without restarting
the voice at each sentence or paragraph. Punctuation supplies natural pauses.
Use an explicit `[pause: ...]` or `[wait: ...]` for a longer break. The sample's
`[pause: think]` before the reveal remains a deliberate five-second pause.

Changing voice, speed or optional-slide selection stops playback. Auto-play
then begins again at the current page. Optional slides are included by default.

## File format

The first line must be `[format: math1-narration-v1]`. Place each command on its
own line. Ordinary paragraphs are spoken; blank lines separate them. Mathematical
notation is passed to the selected voice as written, so prose descriptions of
equations are usually clearer than raw TeX.

```text
[format: math1-narration-v1]
[pdf: Lecture.pdf]
[pdf-pages: 3]

[slide: 1 | Reading an image]
[pages: 1-2]
Look at the photograph and consider how it frames the subject.
[pause: think]
[reveal: 2 | Highlighted detail]
This detail changes how we interpret the scene.
[wait: Discuss that interpretation. Continue when ready.]

[slide: 2 | Further discussion]
[pages: 3-3]
[optional: true]
[cue: Compare the two interpretations on screen.]
Which evidence supports each interpretation?
```

| Command | Meaning |
| --- | --- |
| `[format: math1-narration-v1]` | Required first line. |
| `[pdf: Lecture.pdf]` | Required exact PDF filename, including letter case, without a folder path. |
| `[pdf-pages: 3]` | Required total physical pages, including Beamer overlays. |
| `[pdf-sha256: <64 hexadecimal characters>]` | Optional SHA-256 of the exact PDF bytes. A mismatch prevents playback. |
| `[source: main.tex \| sha256=<64 hexadecimal characters>]` | Optional record of inspected source; the app does not open or verify TeX. |
| `[slide: 1 \| Title]` | Starts a logical slide. Its title is metadata and is not spoken automatically. |
| `[pages: 1-2]` | Inclusive physical page range. Ranges must be ordered, non-overlapping and within the PDF. |
| `[reveal: 2 \| Highlighted detail]` | Selects overlay 2 in the current range. The optional caption is a silent label; it adds no pause. |
| `[cue: Look at the marked inputs.]` | Speaks and displays an instruction without navigating or moving the pointer. |
| `[pause: brief]` | Silence for 1.5 seconds, then automatic continuation. `think` is 5 seconds; `long` is 10. A number such as `2.5s` specifies seconds, up to 3600. |
| `[wait: Continue when ready.]` | Displays the instruction and waits indefinitely for Continue. |
| `[optional: true]` | Makes the whole slide optional. It remains included unless the checkbox is cleared. |
| `[narration: none]` | Silent slide: no spoken paragraphs; cues remain visible but unspoken. |

Place global metadata before the first slide. Place slide metadata (`pages`,
`optional`, `narration`) before its paragraphs or action commands. Duplicate
metadata, unknown commands and out-of-range reveals report a source line
instead of starting playback. Text files larger than 2 MB are rejected.

Auto-play begins at the current physical overlay and omits earlier overlay
narration in that logical slide. Subsequent scripted reveals retain their order,
including intentional revisits. If the same page appears repeatedly, playback
starts at its first scripted occurrence. A current page absent from all declared
ranges cannot start auto-play. Pages with no scripted actions advance to the
next narrated portion; add an explicit wait wherever lecturer input is needed.

A silent slide without reveal, pause or wait commands receives an automatic
Continue point. Explicit pacing commands on silent slides control progression.
The presenter and audience prepare the next physical PDF page in advance,
keeping at most two rendered pages per display surface. A reveal reuses that
prepared page when its size still matches. Scripted navigation confirms that
the current page is displayed before speaking. The next-page preview renders
separately and does not delay narration. An unresponsive
audience window reports an error after 10 seconds; a window that closes during
navigation cancels the pending request. Speech or current-page rendering errors
stop playback and show a message.

## Why installed voices

The browser [SpeechSynthesis interface](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
uses voices made available by the device. Its
[localService flag](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)
lets the presenter restrict playback to local speech. Voice lists can arrive
after startup, so the controls also listen for
[voiceschanged](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event).

A bundled neural model would add a separate inference runtime and model assets.
The current approach keeps the offline package small and supports the languages
already installed on the lecturer's computer. Availability still needs a check
in the intended browser; an operating system voice does not guarantee that every
browser exposes it.
