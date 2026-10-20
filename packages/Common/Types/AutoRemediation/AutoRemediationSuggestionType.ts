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
 * McpToolCalls: the suggestion carries the tool calls OneUptime AI makes, or
 *              proposes, through the project's external MCP servers (AWS,
 *              Azure, ...), stored on the suggestion's mcpToolCallPlan
 *              column. Approval makes the proposed calls; a rule that
 *              fixes without asking and names its MCP servers lets
 *              OneUptime AI make them itself.
 */
enum AutoRemediationSuggestionType {
  Runbook = "Runbook",
  CommandPlan = "CommandPlan",
  McpToolCalls = "McpToolCalls",
}

export default AutoRemediationSuggestionType;
