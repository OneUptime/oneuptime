/*
 * What kind of action an auto-remediation suggestion proposes.
 *
 * Runbook:     the suggestion proposes starting a pre-authored runbook
 *              (deterministic rules and aiSelectsRunbook rules).
 * CommandPlan: the suggestion carries an AI-composed command plan — concrete
 *              Bash/SSH commands targeted at specific Runners, stored on
 *              the suggestion's commandPlan column. Approval executes the
 *              plan; FullAuto rules may have already executed allowlisted
 *              commands inline.
 */
enum AutoRemediationSuggestionType {
  Runbook = "Runbook",
  CommandPlan = "CommandPlan",
}

export default AutoRemediationSuggestionType;
