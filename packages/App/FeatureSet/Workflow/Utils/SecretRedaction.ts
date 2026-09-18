import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";

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
 * `isSecret` is declared as a string on the model but arrives as a real
 * boolean from the database, so both are accepted. A variable whose `isSecret`
 * was not selected reads as undefined and is treated as not secret — every
 * caller must therefore select the column.
 */
export const getSecretWorkflowVariableValues: GetSecretWorkflowVariableValuesFunction =
  (variables: Array<WorkflowVariable>): Array<string> => {
    return getSecretValuesForRedaction(
      variables
        .filter((variable: WorkflowVariable) => {
          const isSecret: unknown = variable.isSecret;

          return isSecret === true || isSecret === "true";
        })
        .map((variable: WorkflowVariable) => {
          return variable.content as string;
        }),
    );
  };

type RedactSecretsFromStringFunction = (
  value: string,
  secrets: Array<string>,
) => string;

export const redactSecretsFromString: RedactSecretsFromStringFunction = (
  value: string,
  secrets: Array<string>,
): string => {
  if (!value || secrets.length === 0) {
    return value;
  }

  const escapedSecrets: Array<string> = secrets.map((secret: string) => {
    return secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });

  /*
   * One global expression replaces every occurrence without processing the
   * replacement marker again. The alternatives are longest-first from
   * getSecretValuesForRedaction, which prevents a shorter overlapping secret
   * from exposing the tail of a longer one.
   */
  const secretPattern: RegExp = new RegExp(escapedSecrets.join("|"), "g");

  return value.replace(secretPattern, () => {
    return WORKFLOW_LOG_REDACTED_VALUE;
  });
};
