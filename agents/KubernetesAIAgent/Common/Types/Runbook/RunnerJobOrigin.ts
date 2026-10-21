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
 * AiInvestigation: a READ-ONLY kubectl command an AI investigation runs to
 *                inspect a cluster it was given access to (the cluster's AI
 *                page). Never changes anything; the policy is enforced at
 *                enqueue and again inside the Runner. Claimable only by
 *                Runners with canRunAiCommands.
 *
 * Rows created before this enum existed were backfilled to Runbook by the
 * AddAiCommandRemediation migration, so the column is NOT NULL.
 */
enum RunnerJobOrigin {
  Runbook = "Runbook",
  AiRemediation = "AiRemediation",
  AiInvestigation = "AiInvestigation",
}

/*
 * The origins a Runner may claim once the project granted it the AI-command
 * capability. Kept in one place so the ingress and the Runner agree.
 */
export const AI_COMMAND_JOB_ORIGINS: Array<RunnerJobOrigin> = [
  RunnerJobOrigin.AiRemediation,
  RunnerJobOrigin.AiInvestigation,
];

export default RunnerJobOrigin;
