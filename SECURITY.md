# Security reports

For a suspected vulnerability, use this repository’s **Security → Report a
vulnerability** feature when private reporting is enabled. Avoid putting
sensitive details, credentials, student data or private PDFs in public issues.
If that feature is unavailable, request a private reporting route from the
repository maintainer without disclosing the vulnerability publicly.

Include the application version, browser and operating system, reproduction
steps and a minimal non-sensitive example. The project has no guaranteed
response deadline or support commitment for older releases.

The presenter processes selected PDFs in the browser. Its local server listens
on loopback and is intended for the same computer. Public hosting should use
the explicit static build, never a directory server over the repository root.
Report unexpected external requests, file exposure, unsafe PDF/folder behavior
or dependency-integrity failures.
