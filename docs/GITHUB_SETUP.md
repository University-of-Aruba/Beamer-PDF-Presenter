# Publish the project on GitHub

This checklist is for the maintainer. The local preparation does not create a
remote, commit, push, enable Pages or publish a release.

## 1. Create the repository and upload reviewed source

Suggested repository name: **beamer-pdf-presenter**.

Suggested About description:

> A PDF presenter for university lecturers: private current/next previews,
> audience display, prepared narration and offline Windows use.

Useful topics: `pdf`, `presentation`, `education`, `beamer`, `offline`,
`javascript`, `university`.

Create an empty repository without generating another README or license.
Review and commit the prepared files locally, add the GitHub remote from the
repository’s own setup instructions, and push the main branch. No owner or
remote URL is preconfigured here. Keep `.tmp/`, `output/`, `runtime/`, local
settings and cached `vendor/pdfjs/` binaries out of Git; workflows recreate
the verified dependencies. Commit LICENSES, including the small font-source
archive and provenance, because public distributions require these files.

The local history includes the imported MIT release and the earlier SISSTEM
adaptation. The new Apache license preserves that attribution. Review history
and any institutional branding before making a repository public. Logo rights
are separate from the code license; the source list does not grant trademark
or artwork permissions. No credentials or custom GitHub secrets are needed
for the supplied workflows.

## 2. Let GitHub validate and build the Windows package

The **Validate and package** workflow runs on each push and pull request.
It can also be started through **Actions → Validate and package → Run workflow**.
It tests the source on Ubuntu and Windows. The Windows job builds the locked
offline ZIP, extracts it and runs the bundled Python integrity check before
storing a workflow artifact.

### Test a pushed revision on Windows

1. Commit the reviewed source changes and push them to GitHub. Include new
   files such as the narration modules, their tests, `sample-beamer.txt` and
   `docs/NARRATION.md`; `git commit -am` alone does not include new files.
2. Open **Actions → Validate and package** and select the run whose commit
   matches the push. Wait for both Ubuntu and Windows jobs to pass.
3. Download `Beamer-PDF-Presenter-Windows-x64-<run number>` from that run.
   Extract the outer Actions archive to find the
   `Beamer-PDF-Presenter-<version>-Windows-x64-Offline.zip` and its `.sha256`.
4. Right-click the inner offline ZIP and choose **Extract All**, using a fresh
   folder. Open the extracted `Beamer-PDF-Presenter` folder and double-click
   `start-windows.bat`. Keep the console window open.
5. Select **Load demo** and open the audience window. Choose an installed
   local voice if needed, then press **Auto-play**. Listen through the intended
   classroom audio output, check the overlay reveal and confirm that the
   exercise waits for **Continue**. Also check playback with the network
   disconnected. Windows voice availability and audible output require this
   check on the intended laptop; the workflow verifies package files.

This test build needs no tag, release or VERSION change. Select it by the
Actions run and commit, because its filename may contain the same version as
an earlier build. Pushing source does not replace files attached to an
existing release. The automatically generated **Source code** archives also
require the source setup and do not include the portable Windows runtime.

Actions artifacts have a configured retention of 30 days. For a stable
lecturer download, attach the checked inner offline ZIP and its checksum to
a GitHub Release.

## 3. Publish the lecturer download

In **Releases → Draft a new release**, choose the reviewed revision and a tag
matching the approved VERSION. Attach the inner Windows offline ZIP and its
checksum from the passing workflow. Explain the three steps: download,
Extract All, run `start-windows.bat`. Review the dependency source-provenance limitation in
[LICENSES/README.md](../LICENSES/README.md) and the separate logo rights.
Test the extracted download before
publishing and mark the published release as the latest release.

The welcome page’s Windows button links to this repository’s latest release.
Until the first release exists, that link has no download to offer. Publish
the Windows release before sharing the Pages URL with lecturers. No workflow
automatically creates a tag or release.

## 4. Enable the browser demo

1. Open **Settings → Pages** and choose **GitHub Actions** as the source.
2. Open **Actions → Publish GitHub Pages demo → Run workflow** from the default
   branch. This manual workflow validates the app and builds only the public
   file inventory before deployment.
3. Use the deployment URL reported by GitHub. Add that exact address to the
   repository’s **About → Website** field.
4. Check the welcome page, Windows download link and **Try the presenter**.
   Load a PDF, open the audience window and check a faculty timer.

The workflow supplies the repository identity automatically. No custom domain,
CNAME, token, hosting service or guessed account name is configured. GitHub’s
Pages availability depends on the account, repository visibility and policy.
The standard deployment uses the github-pages environment and the minimal
Pages/OIDC permissions described in the [official Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The site is a static demo, with no server uploads, analytics or service worker.
The browser still needs internet to load app resources. For offline teaching,
point lecturers to the Windows ZIP.

## 5. Optional repository settings

Enable private vulnerability reporting under **Settings → Code security** if
available, so SECURITY.md has a private reporting route. Configure branch
protection or rulesets if desired, using the actual check names from the first
successful run. CODEOWNERS and mandatory-review rules are intentionally left
to the repository owner, since no maintainer account was supplied.

Dependabot is configured only for weekly GitHub Actions update proposals. It
does not update the PDF.js/Python lock automatically. Actions use full commit
pins; approve updates after the validation workflow passes.
