/*
 * The redaction helpers shared by the two writers of WorkflowLog: the runner
 * (RunWorkflow.cleanLogs) and the scheduler (QueueWorkflow's schedule errors).
 * They used to live inside RunWorkflow, where the scheduler could not reach
 * them — which is how the scheduler came to log secrets in plaintext.
 */

import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WORKFLOW_LOG_REDACTED_VALUE,
  getSecretValuesForRedaction,
  getSecretWorkflowVariableValues,
  redactSecretsFromString,
} from "../../../FeatureSet/Workflow/Utils/SecretRedaction";
import { describe, expect, test } from "@jest/globals";

type VariableFunction = (
  content: string,
  isSecret?: boolean | string | undefined,
) => WorkflowVariable;

const variable: VariableFunction = (
  content: string,
  isSecret?: boolean | string | undefined,
): WorkflowVariable => {
  const workflowVariable: WorkflowVariable = new WorkflowVariable();
  workflowVariable.name = "variable";
  workflowVariable.content = content;
  workflowVariable.isSecret = isSecret as string;

  return workflowVariable;
};

describe("getSecretValuesForRedaction", () => {
  test("orders longest first so an overlapping shorter secret cannot expose a tail", () => {
    expect(
      getSecretValuesForRedaction(["token", "token-with-suffix", "tok"]),
    ).toEqual(["token-with-suffix", "token", "tok"]);
  });

  test("drops empty and missing values", () => {
    expect(getSecretValuesForRedaction(["", undefined, null, "real"])).toEqual([
      "real",
    ]);
  });

  test("de-duplicates repeated values", () => {
    expect(getSecretValuesForRedaction(["same", "same"])).toEqual(["same"]);
  });

  test("returns an empty list for no input", () => {
    expect(getSecretValuesForRedaction([])).toEqual([]);
  });
});

describe("getSecretWorkflowVariableValues", () => {
  test("collects variables flagged with a boolean true", () => {
    expect(getSecretWorkflowVariableValues([variable("secret", true)])).toEqual(
      ["secret"],
    );
  });

  test('collects variables flagged with the string "true"', () => {
    expect(
      getSecretWorkflowVariableValues([variable("secret", "true")]),
    ).toEqual(["secret"]);
  });

  test("ignores variables that are not secret", () => {
    expect(
      getSecretWorkflowVariableValues([
        variable("public", false),
        variable("also-public", "false"),
        variable("unflagged"),
      ]),
    ).toEqual([]);
  });

  test("ignores a secret with no content", () => {
    expect(getSecretWorkflowVariableValues([variable("", true)])).toEqual([]);
  });

  test("treats an unselected isSecret column as not secret", () => {
    /*
     * Reading the column is the caller's responsibility. This is exactly the
     * bug being fixed: a query that omits isSecret redacts nothing at all.
     */
    const unselected: WorkflowVariable = new WorkflowVariable();
    unselected.content = "would-not-be-redacted";

    expect(getSecretWorkflowVariableValues([unselected])).toEqual([]);
  });
});

describe("redactSecretsFromString", () => {
  test("replaces every occurrence of a secret", () => {
    expect(redactSecretsFromString("a secret b secret", ["secret"])).toBe(
      `a ${WORKFLOW_LOG_REDACTED_VALUE} b ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
  });

  test("does not leave the tail of a longer overlapping secret behind", () => {
    const secrets: Array<string> = getSecretValuesForRedaction([
      "token",
      "token-with-suffix",
    ]);

    expect(redactSecretsFromString("token-with-suffix", secrets)).toBe(
      WORKFLOW_LOG_REDACTED_VALUE,
    );
  });

  test("treats regex metacharacters in a secret literally", () => {
    expect(redactSecretsFromString("value a.*b here", ["a.*b"])).toBe(
      `value ${WORKFLOW_LOG_REDACTED_VALUE} here`,
    );
    // The pattern must not match text it only matches when read as a regex.
    expect(redactSecretsFromString("value aXXXb here", ["a.*b"])).toBe(
      "value aXXXb here",
    );
  });

  test("does not re-process the replacement marker", () => {
    expect(redactSecretsFromString("keep REDACTED", ["REDACTED"])).toBe(
      `keep ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
  });

  test("returns the value untouched when there are no secrets", () => {
    expect(redactSecretsFromString("nothing to hide", [])).toBe(
      "nothing to hide",
    );
  });

  test("handles an empty value", () => {
    expect(redactSecretsFromString("", ["secret"])).toBe("");
  });
});
