# Presenter logos

Place PNG logo files under new filenames directly in this folder. In a portable
package, leave inventoried assets intact so its integrity check still passes. The local server lists these files
in the presenter's Brand selector. Click Refresh logos after adding a logo.
Subfolders, hidden files and symbolic links are excluded.

The filename becomes the display name, without `.png`. Underscores and hyphens
become spaces and the name uses uppercase letters. Examples:

- `sisstem.png` becomes SISSTEM.
- `faculty_of_arts_and_science.png` becomes FACULTY OF ARTS AND SCIENCE.

Use a transparent PNG with enough resolution for a projector. A missing or
unreadable image leaves its brand name visible. Choose BEAMER PDF PRESENTER in the
selector to show the generic presenter without a logo.

For static hosting without the supplied Python server, also list each filename
in `catalog.json`. The supplied server discovers PNG files automatically.

`sisstem.png` is an unmodified copy of the existing SISSTEM gear asset. Its
SHA-256 is `14f9b8ca2f0f41347129da408760827af3c10d561cb40691c5459518318526d9`.

The supplied University of Aruba marks are documented in [SOURCES.md](SOURCES.md).
They retain their owners’ rights and are not licensed under the software’s Apache-2.0 grant.
