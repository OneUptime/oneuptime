import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import { toStoredBoolean } from "Common/Types/Database/BooleanColumnValue";
import { isOAuth2WorkflowVariable } from "Common/Types/Workflow/WorkflowVariableOAuth";
import escapeRegExp from "Common/Utils/RegExpEscape";

/**
 * Redaction of workflow-variable secrets out of anything that gets persisted
 * to a WorkflowLog row.
 *
 * This lives outside RunWorkflow because the run log is not the only writer:
 * QueueWorkflow writes a log row of its own when a scheduled workflow cannot
 * be registered, and that message quotes the resolved schedule — which can be
 * the plaintext of a secret variable. Both writers must scrub the same values
 * the same way, and RunWorkflow already imports QueueWorkflow, so the shared
 * helpers cannot live in either service.
 */

export const WORKFLOW_LOG_REDACTED_VALUE: string = "[REDACTED]";

type GetSecretValuesForRedactionFunction = (
  values: Array<string | undefined | null>,
) => Array<string>;

/**
 * Build the replacement list once, with overlapping secrets ordered safely.
 *
 * A secret of `token` must not run before `token-with-suffix`, or the first
 * replacement leaves `-with-suffix` behind in the log. Empty values are
 * excluded because every string contains the empty string.
 */
export const getSecretValuesForRedaction: GetSecretValuesForRedactionFunction =
  (values: Array<string | undefined | null>): Array<string> => {
    const definedValues: Array<string> = values.filter(
      (value: string | undefined | null): value is string => {
        return typeof value === "string" && value.length > 0;
      },
    );

    return Array.from(new Set(definedValues)).sort(
      (first: string, second: string) => {
        return second.length - first.length;
      },
    );
  };

type GetSecretWorkflowVariableValuesFunction = (
  variables: Array<WorkflowVariable>,
) => Array<string>;

/**
 * The secret contents of the supplied variables, ready to hand to
 * `redactSecretsFromString`.
 *
 * `isSecret` is read as the database stores it (toStoredBoolean), the same
 * way WorkflowVariableService reads it, so a literal such as "true" that
 * reached a variable some other way counts as secret too. A variable whose
 * `isSecret` was not selected reads as undefined and is treated as not
 * secret — every caller must therefore select the column.
 *
 * An OAuth 2.0 variable is secret whatever its flag says: its value is a
 * bearer token, and it is the access token (not `content`, which it leaves
 * empty) that ends up in a component's arguments. Its client secret and
 * refresh token are never put into a run, but they are redacted too if a caller
 * happened to select them, so no future code path can print one by accident.
 */
export const getSecretWorkflowVariableValues: GetSecretWorkflowVariableValuesFunction =
  (variables: Array<WorkflowVariable>): Array<string> => {
    const values: Array<string | undefined | null> = [];

    for (const variable of variables) {
      if (isOAuth2WorkflowVariable(variable.variableType)) {
        values.push(
          variable.oauthAccessToken,
          variable.oauthClientSecret,
          variable.oauthRefreshToken,
        );
        continue;
      }

      if (toStoredBoolean(variable.isSecret) === true) {
        values.push(variable.content);
      }
    }

    return getSecretValuesForRedaction(values);
  };

type RedactSecretsFromStringFunction = (
  value: string,
  secrets: Array<string>,
) => string;

/*
 * Values longer than this are taken out by their text, one after another,
 * rather than in the one pattern the shorter ones share (#11476): a value a
 * step marked sensitive and handed on can be megabytes of base64, and a
 * pattern of megabytes is slow to build and to run.
 */
export const LONG_REDACTED_VALUE_LENGTH: number = 256;

// The pattern of each list of short values, built once.
const SHORT_VALUE_PATTERNS: Map<string, RegExp> = new Map();
const MAX_CACHED_PATTERNS: number = 100;

const getShortValuePattern: (shortValues: Array<string>) => RegExp = (
  shortValues: Array<string>,
): RegExp => {
  const key: string = shortValues.join("\u0000");
  const known: RegExp | undefined = SHORT_VALUE_PATTERNS.get(key);

  if (known) {
    return known;
  }

  /*
   * One global expression replaces every occurrence without processing the
   * replacement marker again. The alternatives are longest-first from
   * getSecretValuesForRedaction, which prevents a shorter overlapping secret
   * from exposing the tail of a longer one.
   */
  const pattern: RegExp = new RegExp(
    shortValues
      .map((secret: string) => {
        return escapeRegExp(secret);
      })
      .join("|"),
    "g",
  );

  if (SHORT_VALUE_PATTERNS.size >= MAX_CACHED_PATTERNS) {
    SHORT_VALUE_PATTERNS.clear();
  }

  SHORT_VALUE_PATTERNS.set(key, pattern);

  return pattern;
};

export const redactSecretsFromString: RedactSecretsFromStringFunction = (
  value: string,
  secrets: Array<string>,
): string => {
  if (!value || secrets.length === 0) {
    return value;
  }

  const longValues: Array<string> = [];
  const shortValues: Array<string> = [];

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }

    if (secret.length > LONG_REDACTED_VALUE_LENGTH) {
      longValues.push(secret);
    } else {
      shortValues.push(secret);
    }
  }

  const redactShort: (text: string) => string = (text: string): string => {
    if (!text || shortValues.length === 0) {
      return text;
    }

    const pattern: RegExp = getShortValuePattern(shortValues);
    pattern.lastIndex = 0;

    return text.replace(pattern, () => {
      return WORKFLOW_LOG_REDACTED_VALUE;
    });
  };

  if (longValues.length === 0) {
    return redactShort(value);
  }

  /*
   * The text as pieces between the long values (null where one was), the
   * longest taken out first so a shorter one inside it is gone with it; the
   * short values are then taken out of each piece, never out of a marker.
   */
  let pieces: Array<string | null> = [value];

  for (const longValue of longValues) {
    const next: Array<string | null> = [];

    for (const piece of pieces) {
      if (piece === null || !piece.includes(longValue)) {
        next.push(piece);
        continue;
      }

      piece.split(longValue).forEach((part: string, index: number): void => {
        if (index > 0) {
          next.push(null);
        }

        next.push(part);
      });
    }

    pieces = next;
  }

  return pieces
    .map((piece: string | null): string => {
      return piece === null ? WORKFLOW_LOG_REDACTED_VALUE : redactShort(piece);
    })
    .join("");
};
