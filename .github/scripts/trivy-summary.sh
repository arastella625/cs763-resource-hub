#!/usr/bin/env bash
# Writes a severity table for a Trivy JSON report to the job summary.
# Usage: trivy-summary.sh <title> <trivy-report.json>
set -euo pipefail

title=$1
report=$2

{
  echo "### $title"
  echo
  jq -r '
    def row(name; key):
      [.Results[]? | (.[key] // [])[] | .Severity] as $s
      | "| \(name) | "
        + (["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
           | map(. as $l | [$s[] | select(. == $l)] | length | tostring)
           | join(" | "))
        + " | \($s | length) |";
    "| Finding type | Critical | High | Medium | Low | Unknown | Total |",
    "|---|---|---|---|---|---|---|",
    row("Vulnerabilities"; "Vulnerabilities"),
    row("Misconfigurations"; "Misconfigurations"),
    row("Secrets"; "Secrets")
  ' "$report"
  echo
  echo "Non-blocking scan: findings are reported, not enforced. Full results are in the job artifacts."
  echo
} >> "$GITHUB_STEP_SUMMARY"
