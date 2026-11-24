import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { LLM_USAGE_HIDDEN_GROUP_KEY } from "../../../Types/Telemetry/LlmUsageApi";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { buildHoldsScrubPlaceholderSql } from "./ScrubPlaceholderSql";

/*
 * WHO MADE AN AI CALL, AND WHICH TEAM IT IS CHARGED TO, ASKED IN
 * CLICKHOUSE (#10435, #10631).
 *
 * Utils/Telemetry/LlmCallIdentity's readLlmCallPerson and readLlmCallTeam,
 * for the reads that group calls where they are stored: the Usage tab's
 * breakdowns by person and by team (LlmUsageReader) and the people of each
 * conversation in the list (LlmConversationService). One expression each,
 * so the Usage tab, Conversations and Calls always read a call's person the
 * same way:
 *
 *   - its email, when no scrub rule touched it;
 *   - else its id, when no rule touched it;
 *   - else LLM_USAGE_HIDDEN_GROUP_KEY, when a rule hid either - Redact's
 *     "[REDACTED]", a mask, a Hash rule's token, whole or inside the value
 *     (ScrubPlaceholderSql): the call named someone, and every name it has
 *     was hidden;
 *   - else '': the call named nobody.
 *
 * Its team is its name, LLM_USAGE_HIDDEN_GROUP_KEY when a rule hid it, or
 * ''. Asked of each stored call, so the calls stored before this read the
 * same. The texts the values are compared with are bound as parameters.
 */

const USER_EMAIL_SQL: string = "ifNull(llmUserEmail, '')";
const USER_ID_SQL: string = "ifNull(llmUserId, '')";
const TEAM_SQL: string = "ifNull(llmTeam, '')";

// A person or a team a scrub rule hid, as a value.
function hiddenGroupSql(): Statement {
  return SQL`${{
    type: TableColumnType.Text,
    value: LLM_USAGE_HIDDEN_GROUP_KEY,
  }}`;
}

/*
 * A call's person: its email, else its id, past what a scrub rule left of
 * either; LLM_USAGE_HIDDEN_GROUP_KEY when a rule hid every name it has; ''
 * when it has none.
 */
export function buildLlmPersonSql(): Statement {
  const statement: Statement = SQL`multiIf(`;
  statement.append(`${USER_EMAIL_SQL} != '' AND NOT `);
  statement.append(buildHoldsScrubPlaceholderSql(USER_EMAIL_SQL));
  statement.append(`, ${USER_EMAIL_SQL}, ${USER_ID_SQL} != '' AND NOT `);
  statement.append(buildHoldsScrubPlaceholderSql(USER_ID_SQL));
  statement.append(`, ${USER_ID_SQL}, `);
  statement.append(buildHoldsScrubPlaceholderSql(USER_EMAIL_SQL));
  statement.append(" OR ");
  statement.append(buildHoldsScrubPlaceholderSql(USER_ID_SQL));
  statement.append(", ");
  statement.append(hiddenGroupSql());
  statement.append(", '')");

  return statement;
}

/*
 * A call's team: its name; LLM_USAGE_HIDDEN_GROUP_KEY when a scrub rule hid
 * it; '' when it has none.
 */
export function buildLlmTeamSql(): Statement {
  const statement: Statement = SQL`if(`;
  statement.append(buildHoldsScrubPlaceholderSql(TEAM_SQL));
  statement.append(", ");
  statement.append(hiddenGroupSql());
  statement.append(`, ${TEAM_SQL})`);

  return statement;
}
