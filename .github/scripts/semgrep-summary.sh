#!/usr/bin/env bash
# Writes a findings table for a Semgrep JSON report to the job summary.
# Usage: semgrep-summary.sh <semgrep-report.json>
set -euo pipefail

report=$1

{
  echo "### Semgrep SAST"
  echo
  echo "Total findings: **$(jq '.results | length' "$report")**"
  echo
  if [ "$(jq '.results | length' "$report")" -gt 0 ]; then
    echo "| Severity | Rule | File:line |"
    echo "|---|---|---|"
    jq -r '.results[] | "| \(.extra.severity) | `\(.check_id)` | \(.path):\(.start.line) |"' "$report"
    echo
  fi
  echo "Non-blocking scan: findings are reported, not enforced. Full results are in the job artifacts."
  echo
} >> "$GITHUB_STEP_SUMMARY"
