/*
 * The redaction helpers shared by the two writers of WorkflowLog: the runner
 * (RunWorkflow.cleanLogs) and the scheduler (QueueWorkflow's schedule errors).
 * They used to live inside RunWorkflow, where the scheduler could not reach
 * them — which is how the scheduler came to log secrets in plaintext.
 */

import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import { WorkflowVariableType } from "Common/Types/Workflow/WorkflowVariableOAuth";
import {
  LONG_REDACTED_VALUE_LENGTH,
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
  workflowVariable.isSecret = isSecret as boolean;

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

  /*
   * Read as the database stores the flag (toStoredBoolean), the same rule
   * WorkflowVariableService uses to refuse un-marking a secret: what the
   * service calls secret, the run logs redact.
   */
  test.each(["yes", "on", "1", " TRUE "])(
    "collects variables flagged with %p, which the database stores as true",
    (flag: string) => {
      expect(
        getSecretWorkflowVariableValues([variable("secret", flag)]),
      ).toEqual(["secret"]);
    },
  );

  test("ignores variables that are not secret", () => {
    expect(
      getSecretWorkflowVariableValues([
        variable("public", false),
        variable("also-public", "false"),
        variable("not-secret-either", "no"),
        variable("off-too", "0"),
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

/*
 * Long values - a sensitive step's images, handed on as base64 (#11476) -
 * are taken out by their text rather than in one pattern of megabytes.
 */
describe("redactSecretsFromString with long values", () => {
  const LONG: string = "QUJD".repeat(LONG_REDACTED_VALUE_LENGTH);
  const OTHER_LONG: string = "WFla".repeat(LONG_REDACTED_VALUE_LENGTH);

  test("a value over LONG_REDACTED_VALUE_LENGTH is long", () => {
    expect(LONG.length).toBeGreaterThan(LONG_REDACTED_VALUE_LENGTH);
  });

  test("replaces every occurrence of a long value", () => {
    expect(redactSecretsFromString(`a ${LONG} b ${LONG} c`, [LONG])).toBe(
      `a ${WORKFLOW_LOG_REDACTED_VALUE} b ${WORKFLOW_LOG_REDACTED_VALUE} c`,
    );
  });

  test("a long value and short secrets in one line are all taken out", () => {
    expect(
      redactSecretsFromString(`token=hunter2 data=${LONG} again hunter2`, [
        LONG,
        "hunter2",
      ]),
    ).toBe(
      `token=${WORKFLOW_LOG_REDACTED_VALUE} data=${WORKFLOW_LOG_REDACTED_VALUE} again ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
  });

  test("a short secret is never looked for inside the marker a long value left", () => {
    expect(
      redactSecretsFromString(`[${LONG}]`, [LONG, "REDACTED", "ACT"]),
    ).toBe(`[${WORKFLOW_LOG_REDACTED_VALUE}]`);
  });

  test("a short secret inside a long value goes with it, a short one outside it is taken out", () => {
    const secrets: Array<string> = getSecretValuesForRedaction(["QUJD", LONG]);

    expect(redactSecretsFromString(`${LONG} QUJD`, secrets)).toBe(
      `${WORKFLOW_LOG_REDACTED_VALUE} ${WORKFLOW_LOG_REDACTED_VALUE}`,
    );
  });

  test("of two overlapping long values, the longer goes first and leaves no tail", () => {
    const longer: string = `${LONG}-and-more`;
    const secrets: Array<string> = getSecretValuesForRedaction([LONG, longer]);

    expect(redactSecretsFromString(`x ${longer} y`, secrets)).toBe(
      `x ${WORKFLOW_LOG_REDACTED_VALUE} y`,
    );
  });

  test("two different long values, side by side", () => {
    expect(
      redactSecretsFromString(`${LONG}${OTHER_LONG}`, [LONG, OTHER_LONG]),
    ).toBe(`${WORKFLOW_LOG_REDACTED_VALUE}${WORKFLOW_LOG_REDACTED_VALUE}`);
  });

  test("a text with no long value in it is left as the short secrets leave it", () => {
    expect(
      redactSecretsFromString("only hunter2 here", [LONG, "hunter2"]),
    ).toBe(`only ${WORKFLOW_LOG_REDACTED_VALUE} here`);
  });

  test("a value of megabytes is taken out of a text of megabytes", () => {
    const megabytes: string = "AbCd".repeat(1024 * 1024);
    const text: string = `before ${megabytes} after`;

    expect(redactSecretsFromString(text, [megabytes])).toBe(
      `before ${WORKFLOW_LOG_REDACTED_VALUE} after`,
    );
  });

  test("the same short secrets asked again give the same answer", () => {
    for (let index: number = 0; index < 3; index++) {
      expect(redactSecretsFromString("a b a", ["a"])).toBe(
        `${WORKFLOW_LOG_REDACTED_VALUE} b ${WORKFLOW_LOG_REDACTED_VALUE}`,
      );
    }
  });
});

/*
 * An OAuth 2.0 variable's value is a bearer token, and it is the access token
 * - not `content`, which it leaves empty - that a component receives. It is
 * redacted whatever its secret flag says: a flag that somehow reached false
 * must not turn a live credential into log text.
 */
describe("getSecretWorkflowVariableValues and OAuth 2.0 variables", () => {
  type OAuthVariableFunction = (values: {
    accessToken?: string | undefined;
    clientSecret?: string | undefined;
    refreshToken?: string | undefined;
    isSecret?: boolean | undefined;
    content?: string | undefined;
  }) => WorkflowVariable;

  const oauthVariable: OAuthVariableFunction = (values: {
    accessToken?: string | undefined;
    clientSecret?: string | undefined;
    refreshToken?: string | undefined;
    isSecret?: boolean | undefined;
    content?: string | undefined;
  }): WorkflowVariable => {
    const workflowVariable: WorkflowVariable = new WorkflowVariable();
    workflowVariable.name = "API_TOKEN";
    workflowVariable.variableType = WorkflowVariableType.OAuth2;
    workflowVariable.content = values.content ?? "";
    workflowVariable.isSecret = values.isSecret as boolean;
    workflowVariable.oauthAccessToken = values.accessToken as string;
    workflowVariable.oauthClientSecret = values.clientSecret as string;
    workflowVariable.oauthRefreshToken = values.refreshToken as string;

    return workflowVariable;
  };

  test("redacts the access token", () => {
    expect(
      getSecretWorkflowVariableValues([
        oauthVariable({ accessToken: "eyJ.access.token", isSecret: true }),
      ]),
    ).toEqual(["eyJ.access.token"]);
  });

  test("redacts the access token even when the secret flag is off", () => {
    expect(
      getSecretWorkflowVariableValues([
        oauthVariable({ accessToken: "eyJ.access.token", isSecret: false }),
      ]),
    ).toEqual(["eyJ.access.token"]);
  });

  test("redacts the credentials too if a caller selected them", () => {
    expect(
      getSecretWorkflowVariableValues([
        oauthVariable({
          accessToken: "access-token-value",
          clientSecret: "client-secret-value",
          refreshToken: "refresh-token-value",
        }),
      ]).sort(),
    ).toEqual(
      [
        "access-token-value",
        "client-secret-value",
        "refresh-token-value",
      ].sort(),
    );
  });

  test("an OAuth variable with no token yet contributes nothing", () => {
    expect(getSecretWorkflowVariableValues([oauthVariable({})])).toEqual([]);
  });

  test("does not treat an OAuth variable's content as its value", () => {
    expect(
      getSecretWorkflowVariableValues([
        oauthVariable({ content: "leftover", accessToken: "real-token" }),
      ]),
    ).toEqual(["real-token"]);
  });

  test("redacts the token from a log line alongside Static secrets", () => {
    const secrets: Array<string> = getSecretWorkflowVariableValues([
      oauthVariable({ accessToken: "live-bearer-token" }),
      variable("static-secret", true),
      variable("not-a-secret", false),
    ]);

    expect(
      redactSecretsFromString(
        'Component Args: {"Authorization":"Bearer live-bearer-token","X-Key":"static-secret","X-Plain":"not-a-secret"}',
        secrets,
      ),
    ).toBe(
      `Component Args: {"Authorization":"Bearer ${WORKFLOW_LOG_REDACTED_VALUE}","X-Key":"${WORKFLOW_LOG_REDACTED_VALUE}","X-Plain":"not-a-secret"}`,
    );
  });
});
