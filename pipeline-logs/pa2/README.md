# PA2 pipeline evidence: naive baseline scan

| Field | Value |
|---|---|
| Workflow run | [43976561548](https://github.com/arastella625/cs763-resource-hub/actions/runs/43976561548) (`workflow_dispatch` on `pa2`) |
| Commit scanned | `131f7ce` (functional baseline generated in Prompt_test_log.md Entry 5, plus logs) |
| Date | 2026-11-16 |
| Result | All 6 jobs succeeded. The 48 integration tests passed against the CI PostgreSQL service |

Files in `run-43976561548/`:

| Path | Contents |
|---|---|
| `semgrep-report/semgrep.json`, `.sarif` | Semgrep 1.183.0, 266 rules (`p/default`, `p/owasp-top-ten`, `p/nodejs`, `p/typescript`, `p/dockerfile`, `p/secrets`) on 60 tracked files |
| `trivy-fs-report/trivy-fs.json`, `.sarif` | Trivy 0.76.1 filesystem scan: dependencies, secrets, Dockerfile misconfigurations |
| `trivy-image-report/trivy-image.json`, `.sarif` | Trivy image scan of the runtime image |
| `coverage/lcov.info` | Test coverage from the build-test job |
| `run.log`, `run-metadata.json` | Full job log and run metadata (`gh run view`) |

Raw scanner output, as reported (non-blocking):

| Scanner | Findings |
|---|---|
| Semgrep | 1: `dockerfile.security.missing-user.missing-user` (ERROR, CWE-250), `functional-codebase/Dockerfile:51`. Also 3 scanner warnings: a timeout on the PA1 `full-run.log` and 2 partial-parse warnings in `devsecops.yml:169` |
| Trivy fs: npm dependencies | 0 vulnerabilities |
| Trivy fs: Dockerfile | DS-0002 HIGH (image user is root), DS-0026 LOW (no HEALTHCHECK) |
| Trivy image | 245 vulnerabilities (1 critical, 43 high): 226 in Debian 12 base packages, 19 in Node packages bundled in the image |
| SonarQube Cloud | Analysis successful. The project is private, so results are on the [dashboard](https://sonarcloud.io/dashboard?id=arastella625_cs763-resource-hub&branch=pa2), not in this folder |

The scanner output is unedited. `trivy-fs.json` includes git commit metadata (author and committer). Triage of these findings, with false positives and the logic flaws the scanners missed, is in `sast-triage-report.md`.
