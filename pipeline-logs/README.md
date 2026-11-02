# Pipeline Execution Evidence

Verified run of the DevSecOps pipeline (`.github/workflows/devsecops.yml`) for PA1.

| | |
|---|---|
| Workflow | DevSecOps |
| Run | [#1, ID 41482256156](https://github.com/arastella625/cs763-resource-hub/actions/runs/41482256156) |
| Trigger | `push` to `main` |
| Commit | `aa141bc` (Add Agent_environment.md (Task 6)) |
| Started / finished | 2026-11-02 16:31:10 / 16:35:33 UTC |
| Result | **success**: all 6 jobs passed; findings reported, none blocking |

## Jobs

| Job | Result | Duration | Blocking? |
|---|---|---|---|
| Install, build and test | success | 1m06s | yes |
| Docker image build | success | 2m31s | yes |
| Trivy filesystem scan (dependencies) | success | 26s | no |
| Trivy image scan | success | 37s | no |
| Semgrep SAST | success | 50s | no |
| SonarQube Cloud scan | success | 1m09s | no |

Job graph: `build-test` → `docker-image` → `trivy-image`, and `build-test` → `sonarqube`. `trivy-fs` and `semgrep` run in parallel from the start.

Every scan is non-blocking in two layers: the scanner exits 0 even when it finds issues (Trivy `--exit-code 0`; Semgrep without `--error`), and each scan job sets `continue-on-error: true`. In this run the scanners found 238 issues and the run still passed, which demonstrates that findings are reported without failing the build.

## Scan results

### SAST

| Tool | Scope | Findings |
|---|---|---|
| Semgrep 1.183.0 | 266 rules (`p/default`, `p/owasp-top-ten`, `p/nodejs`, `p/typescript`, `p/dockerfile`, `p/secrets`) on 31 files | **1**: `dockerfile.security.missing-user` (ERROR), `Dockerfile:40`: container runs as root |
| SonarQube Cloud | `src/`, `Dockerfile`, tests, lcov coverage | Analysis successful (`ANALYSIS SUCCESSFUL`, `EXECUTION SUCCESS` in the log). Issues and coverage are on the [project dashboard](https://sonarcloud.io/dashboard?id=arastella625_cs763-resource-hub&branch=main). |

Semgrep also logged 2 `PartialParsing` warnings: two GitHub Actions rules could not parse a `${{ … }}` expression in a workflow `run:` block. These do not affect results.

### Dependency and image scanning (Trivy 0.76.1)

| Target | Vulnerabilities (C / H / M / L / U) | Misconfigurations | Secrets |
|---|---|---|---|
| Filesystem: `package-lock.json` (application npm dependencies) | **0** | none | none |
| Filesystem: `Dockerfile` | none | **2**: DS-0002 HIGH (image user should not be root), DS-0026 LOW (no HEALTHCHECK) | none |
| Image: Debian 12.15 OS packages (`node:24.22.2-slim` base) | **216** | none | none |
| Image: npm CLI bundled in the base image (`/usr/local/lib/node_modules/npm`) | **19** (undici, brace-expansion, ip-address, glob, minimatch, postcss-selector-parser) | none | none |
| **Image total** | **235** (1 / 38 / 110 / 84 / 2) | none | none |

The single critical finding is CVE-2023-45853 in `zlib1g` (Debian has no fixed version). 20 of the 235 image findings have a fixed version available. The application's own production dependencies (express, pg, @prisma/client, zod) have no known vulnerabilities.

These findings are the PA1 baseline. They come from the base image and container configuration, not from application code, since the app is still a barebone health endpoint.

## Files

| File | Contents |
|---|---|
| `run-41482256156/full-run.log` | Complete log of all jobs (`gh run view --log`). Secrets are masked by GitHub (`SONAR_TOKEN: ***`). |
| `run-41482256156/run-metadata.json` | Run ID, commit, trigger, timestamps, conclusion |
| `run-41482256156/reports/trivy-fs-report/` | `trivy-fs.json`, `trivy-fs.sarif` |
| `run-41482256156/reports/trivy-image-report/` | `trivy-image.json`, `trivy-image.sarif` |
| `run-41482256156/reports/semgrep-report/` | `semgrep.json`, `semgrep.sarif` |
| `run-41482256156/reports/coverage/` | `lcov.info` sent to SonarQube |

The reports are the artifacts uploaded by the run, downloaded unchanged with `gh run download`. The Docker image tar artifact (110 MB) was not copied here.
