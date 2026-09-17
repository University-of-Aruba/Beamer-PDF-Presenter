# Beamer PDF Presenter

Beamer PDF Presenter is a free app for presenting PDFs with a private lecturer
dashboard and a separate audience window. The dashboard shows the current and
next page, with a PDF folder sidebar for revisiting other lectures. A virtual
laser pointer helps direct attention to a detail on the audience screen.
Optional narration reads a companion text file aloud with a local voice, following
overlay reveals and pausing for classroom activities. Built-in countdowns
support timed classroom activities, with an option to show
a full-screen timer and faculty logo. The portable Windows package runs
offline and keeps PDF documents on the lecturer’s computer.

## Built for teaching

- **Prepare the next page in private.** See the current and next page together
  on the laptop while students see the presentation on a separate screen.
- **Revisit an earlier lecture.** Browse a folder of PDFs with readable, wrapped
  filenames. Double-click a file to open it at the last page visited during
  that folder session.
- **Point directly from the preview.** Move the virtual laser pointer over the
  current page to highlight the same position on the classroom screen.
- **Give students a visible countdown.** Keep a timer in a slide corner or
  switch to a full-screen dial for a timed activity. The lecturer’s elapsed
  teaching timer stays private.
- **Play prepared narration.** Start at the current page, follow scripted
  reveals and pause for discussion. Select an installed local voice and adjust
  its speed. A Continue button resumes after an exercise.
- **Use a faculty’s own identity.** Choose a supplied University of Aruba logo
  or add a PNG. Its filename supplies the name shown with the full-screen timer.
- **Teach offline on Windows.** The portable download includes Python and the
  PDF renderer. Extract the folder and start the app without a separate
  installation; PDFs are processed locally in the browser.

Lecturers from every discipline are welcome to use it. In a literature
seminar, for example, it can display a passage for discussion. The name comes
from Beamer, a LaTeX tool for creating slides. Using the presenter requires
only an ordinary PDF.

## Start with the offline Windows download

The **Windows x64 Offline ZIP** is intended for Windows 10 or 11 laptops with
an Intel or AMD processor. It includes Python and the PDF renderer. Extract
the ZIP and run the app from its folder without a separate installation.
The extracted app works offline.

For a published release, open this repository’s **Releases** section and choose the file named
`Beamer-PDF-Presenter-<version>-Windows-x64-Offline.zip` under **Assets**.
GitHub also provides **Source code (zip)** and **Source code (tar.gz)**; those archives contain the project source and require the development setup.

1. **Extract the download.** Right-click the ZIP and choose **Extract All**.
   Save the extracted folder in Documents or another personal folder. Keep
   all the extracted files together.
2. **Start the presenter.** Open the extracted `Beamer-PDF-Presenter` folder
   and double-click **start-windows.bat**. The presenter opens in the browser.
   Keep the small console window open while presenting.
3. **Choose the teaching material.** Select **Open PDF** and choose a file.
4. **Set up the classroom screen.** Set the desktop display mode to **Extend**,
   then select **Open audience window** in the presenter. Move that window to
   the classroom screen and press **F** there for full screen. The dashboard
   stays on the lecturer’s screen.

Try this setup before the first class. The application runs without requesting
administrator rights, although a work computer’s security policy may require
IT approval for local applications.

Check this repository’s **About** section for the **demo website** link when
available. The demo needs the internet to load.
On macOS or Linux, follow the [source setup](docs/DEVELOPMENT.md#run-from-source)
with an existing Python installation.

To test recently pushed changes on Windows, download the build from the
matching **Actions** run. Follow the
[Windows test-build instructions](docs/GITHUB_SETUP.md#test-a-pushed-revision-on-windows);
an existing release download keeps its original files.

## During a class

To revisit material from an earlier lecture, select **Open PDF folder**. The
sidebar lists the PDFs in that folder, with long filenames wrapped onto
several lines.
Opening the folder leaves the current presentation in place. Double-click or
double-tap a filename to open it. A single click leaves the current slide in
place.
The presenter remembers the last page visited in each PDF in that folder
session.

The **virtual laser pointer** helps draw attention to a detail on the page.
Turn it on and move over the current-page preview to point to the same place
on the classroom screen.

For a timed discussion, show a countdown in a corner of the slide or use the
full-screen timer. The elapsed teaching timer remains private. Choose a
University of Aruba logo in the **Brand** control to
accompany the full-screen timer. A custom PNG can be added, or the logo can
be turned off. The [logo instructions](logos/README.md) explain how filenames
become the names displayed on screen.

For spoken narration, keep a matching `.txt` script beside the PDF. Select
**Open PDF folder**, double-click the PDF, then select **Auto-play**. For a
PDF opened individually, attach its script with **Open narration**. **Load demo** includes a narrated example.
The [narration guide](docs/NARRATION.md) explains the text format and local voices.

The [lecturer guide](docs/USER_GUIDE.md) walks through the controls and includes
keyboard shortcuts. Keep the dashboard open throughout the class; closing or
reloading it clears the PDF-folder session and countdown.

## Preparing teaching material

When working in PowerPoint or another slide editor, export the presentation
as a PDF first. The export contains static pages, so animations and embedded
videos will not play. PowerPoint speaker notes are also outside the PDF
presentation.

Selected PDFs are processed in the browser. The app does not upload documents
or folder contents, and it can be used without an account.

## If something gets in the way

- **The audience window does not open:** allow pop-ups for the presenter page.
- **A file or renderer is missing:** extract the complete ZIP into a new folder
  and keep its contents together.
- **A PDF will not open:** read the error below the controls. The current
  presentation remains available. Try a recent institution-approved browser.
- **The work laptop blocks startup:** share the message with IT so they can
  review it against the institution’s policy.

## Help improve the presenter

Suggestions from classroom use are welcome. If a control is difficult to find
or the instructions leave a step unclear, describe the experience in a GitHub
issue. Teaching experience is a useful contribution in its own right.

Start with the [contribution guide](CONTRIBUTING.md). The
[development guide](docs/DEVELOPMENT.md) covers local setup and testing.
The [GitHub setup guide](docs/GITHUB_SETUP.md) explains how to publish the
Windows download and enable the Pages demo.

Changes are recorded in the [changelog](CHANGELOG.md). The
[September 9 distribution validation record](DISTRIBUTION_VALIDATION.md)
preserves the package checks and outcomes from that preparation. Current
checks appear in the Actions run for each pushed revision. For a security concern, follow the
[security reporting guidance](SECURITY.md).

## License and acknowledgements

Beamer PDF Presenter is based on Beamer Presenter 1.1.0. The application is
distributed under the **[Apache License 2.0](LICENSE.txt)**, with the original
MIT notice retained in [NOTICE](NOTICE). Bundled dependencies retain their own
licenses, including font-source and attribution requirements; these are
documented in the [third-party notices](THIRD_PARTY_NOTICES.md).

University of Aruba names and logos retain their owners’ rights and are
separate from the software license. The [logo credits](logos/SOURCES.md)
identify the official sources.

Version **1.2.0** adds offline narration and prepares upcoming reveals. See the
[1.2.0 release notes](docs/releases/v1.2.0.md) for the changes and download guidance.
