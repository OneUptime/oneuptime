import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  LOG_MESSAGE_WORD_COLUMN,
  LogMessageWordMatch,
  getLogMessageWordMatch,
  readLogMessageWords,
} from "../../../Utils/Telemetry/LogMessageWord";
import {
  QualifiedColumn,
  SQL,
  Statement,
} from "../AnalyticsDatabase/Statement";

/*
 * THE LOGS EXPLORER'S "WORD IN MESSAGE", AS CLICKHOUSE READS IT.
 *
 * A word a message holds whole (Utils/Telemetry/LogMessageWord), compiled
 * the way Connected Signals counts a value "In the message"
 * (SecurityTelemetryStatements): a case-insensitive search for any of the
 * word's spellings first - cheap, and it skips every line that holds none of
 * them - then the word's RE2 pattern, with its own edges, on the lines left:
 *
 *   (multiSearchAnyCaseInsensitive(ifNull(body, ''), [needles])
 *     AND match(ifNull(body, ''), pattern))
 *
 * The list (StatementGenerator, the `bodyWords` / `excludedBodyWords` query
 * keys) and the chart, the facet counts, the analytics and the export
 * (LogAggregationService, the same request fields) are built here, so every
 * read of a view leaves out exactly the same lines. The needles and the
 * pattern are bound as parameters, never written into the statement.
 */

// One word's test on a message column, or null for text that is no word.
export function getLogMessageWordStatement(data: {
  word: string;
  column?: string | QualifiedColumn | undefined;
}): Statement | null {
  const match: LogMessageWordMatch | null = getLogMessageWordMatch(data.word);

  if (!match) {
    return null;
  }

  const column: string | QualifiedColumn =
    data.column || LOG_MESSAGE_WORD_COLUMN;

  return SQL`(multiSearchAnyCaseInsensitive(ifNull(${column}, ''), ${{
    type: TableColumnType.ArrayText,
    value: match.needles,
  }}) AND match(ifNull(${column}, ''), ${{
    type: TableColumnType.Text,
    value: match.pattern,
  }}))`;
}

/*
 * The conditions the words of a query or a request add, each beginning with
 * AND: one for each word a message must hold, and AND NOT one for each it
 * must not. Text that is no word (readLogMessageWords) adds nothing, so a
 * malformed filter never narrows a read to no line at all. Empty when there
 * is no word.
 */
export function getLogMessageWordConditions(data: {
  words?: unknown;
  excludedWords?: unknown;
  column?: string | QualifiedColumn | undefined;
}): Array<Statement> {
  const conditions: Array<Statement> = [];

  for (const word of readLogMessageWords(data.words)) {
    const test: Statement | null = getLogMessageWordStatement({
      word,
      column: data.column,
    });

    if (test) {
      const condition: Statement = SQL`AND `;
      condition.append(test);
      conditions.push(condition);
    }
  }

  for (const word of readLogMessageWords(data.excludedWords)) {
    const test: Statement | null = getLogMessageWordStatement({
      word,
      column: data.column,
    });

    if (test) {
      const condition: Statement = SQL`AND NOT `;
      condition.append(test);
      conditions.push(condition);
    }
  }

  return conditions;
}

/*
 * The same conditions onto a statement whose WHERE already holds others,
 * each after a space: what LogAggregationService's filters add.
 */
export function appendLogMessageWordFilters(
  statement: Statement,
  data: {
    words?: unknown;
    excludedWords?: unknown;
    column?: string | QualifiedColumn | undefined;
  },
): void {
  for (const condition of getLogMessageWordConditions(data)) {
    statement.append(SQL` `);
    statement.append(condition);
  }
}
