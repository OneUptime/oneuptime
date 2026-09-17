/*
 * Where a RunnerJob came from — the discriminator that decides which Runner
 * capability gates its claim.
 *
 * Runbook:       a step of a runbook execution (the original job source).
 *                Claimable only by Runners with canRunRunbooks.
 * AiRemediation: an ad-hoc command composed by an AI remediation run (either
 *                auto-executed under an operator allowlist or human-approved
 *                as part of a command plan). Claimable only by Runners with
 *                canRunAiCommands.
 *
 * Rows created before this enum existed were backfilled to Runbook by the
 * AddAiCommandRemediation migration, so the column is NOT NULL.
 */
enum RunnerJobOrigin {
  Runbook = "Runbook",
  AiRemediation = "AiRemediation",
}

export default RunnerJobOrigin;
