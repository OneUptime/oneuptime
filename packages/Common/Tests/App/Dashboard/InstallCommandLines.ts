import { INSTALL_SCRIPT_RUN_CONTINUATION_INDENT } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";

/*
 * An install command as a shell reads it. The setup guides put each value
 * of a long run line on a line of its own, every line but the last ending
 * in a backslash (getInstallScriptRunCommand):
 *
 *   ONEUPTIME_URL=https://oneuptime.com \
 *     ONEUPTIME_TELEMETRY_INGESTION_KEY=... \
 *     bash install.sh
 *
 * A shell joins those lines into one command, and so does this - back to
 * "ONEUPTIME_URL=https://oneuptime.com ONEUPTIME_TELEMETRY_INGESTION_KEY=...
 * bash install.sh" - for a test about what the command runs rather than
 * how it is laid out. Exactly the guides' own continuation, nothing more:
 * a backslash at a line's end anywhere else is left as written.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */
export const INSTALL_COMMAND_CONTINUATION: string = ` \\\n${INSTALL_SCRIPT_RUN_CONTINUATION_INDENT}`;

export function joinContinuedLines(text: string): string {
  return text.split(INSTALL_COMMAND_CONTINUATION).join(" ");
}
