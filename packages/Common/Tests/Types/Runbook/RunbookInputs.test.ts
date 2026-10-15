import {
  RUNBOOK_INPUTS_MAX_BYTES,
  RUNBOOK_INPUTS_MAX_DEPTH,
  RUNBOOK_INPUTS_VARIABLE,
  RUNBOOK_INPUT_MAX_NAME_LENGTH,
  RUNBOOK_INPUT_MAX_VARIABLES,
  RUNBOOK_INPUT_VARIABLE_PREFIX,
  RUNBOOK_TRIGGER_VARIABLE,
  RunbookInputsReadResult,
  RunbookInputsRefusal,
  getRunbookInputArgs,
  getRunbookInputVariableName,
  getRunbookInputVariableValue,
  getRunbookInputVariables,
  hasRunbookInputs,
  readRunbookInputs,
} from "../../../Types/Runbook/RunbookInputs";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * What a webhook call's body becomes: the run's inputs, refused when they
 * are not a JSON object of a sane size, and handed to the steps as
 * environment variables and arguments whose names a caller cannot choose
 * freely - never as script text.
 */

const NUL: string = String.fromCharCode(0);

const refusalOf: (result: RunbookInputsReadResult) => string | null = (
  result: RunbookInputsReadResult,
): string | null => {
  return result.isRefused ? result.refusal : null;
};

const inputsOf: (result: RunbookInputsReadResult) => JSONObject = (
  result: RunbookInputsReadResult,
): JSONObject => {
  if (result.isRefused) {
    throw new Error(`Refused: ${result.refusal}`);
  }

  return result.inputs;
};

describe("reading a webhook body as a run's inputs", () => {
  it("takes no body, an empty body and an empty object as no inputs", () => {
    for (const body of [undefined, null, "", {}]) {
      expect(inputsOf(readRunbookInputs(body))).toEqual({});
    }
  });

  it("keeps a JSON object as sent, nested values included", () => {
    const body: JSONObject = {
      host: "web-1",
      replicas: 3,
      dryRun: false,
      labels: { team: "payments", tier: ["web", "api"] },
      note: null,
    };

    expect(inputsOf(readRunbookInputs(body))).toEqual(body);
  });

  it("hands back a copy, so changing the request afterwards changes nothing", () => {
    const body: JSONObject = { host: "web-1", nested: { a: 1 } };
    const inputs: JSONObject = inputsOf(readRunbookInputs(body));

    (body["nested"] as JSONObject)["a"] = 2;
    body["host"] = "changed";

    expect(inputs).toEqual({ host: "web-1", nested: { a: 1 } });
  });

  it("refuses a body that is not an object: a list, text, a number", () => {
    for (const body of [[1, 2], "restart", 42, true]) {
      expect(refusalOf(readRunbookInputs(body))).toBe(
        RunbookInputsRefusal.NotAnObject,
      );
    }
  });

  it("refuses a body larger than the limit, measured as sent or as JSON", () => {
    expect(
      refusalOf(readRunbookInputs({ a: 1 }, RUNBOOK_INPUTS_MAX_BYTES + 1)),
    ).toBe(RunbookInputsRefusal.TooLarge);

    const big: JSONObject = { text: "x".repeat(RUNBOOK_INPUTS_MAX_BYTES) };

    expect(refusalOf(readRunbookInputs(big))).toBe(
      RunbookInputsRefusal.TooLarge,
    );

    // Measured in bytes: 30,000 three-byte characters are 90,000 bytes.
    const wide: JSONObject = { text: "€".repeat(30000) };

    expect(refusalOf(readRunbookInputs(wide))).toBe(
      RunbookInputsRefusal.TooLarge,
    );

    const justUnder: JSONObject = {
      text: "x".repeat(RUNBOOK_INPUTS_MAX_BYTES - 20),
    };

    expect(refusalOf(readRunbookInputs(justUnder))).toBe(null);
  });

  it("refuses a body nested deeper than the limit, without running out of stack", () => {
    const nest: (levels: number) => JSONObject = (
      levels: number,
    ): JSONObject => {
      let value: JSONObject = { leaf: true };

      for (let i: number = 1; i < levels; i++) {
        value = { child: value };
      }

      return value;
    };

    expect(refusalOf(readRunbookInputs(nest(RUNBOOK_INPUTS_MAX_DEPTH)))).toBe(
      null,
    );
    expect(
      refusalOf(readRunbookInputs(nest(RUNBOOK_INPUTS_MAX_DEPTH + 1))),
    ).toBe(RunbookInputsRefusal.TooDeep);

    // Fifty thousand levels: measured without recursion, refused at once.
    expect(refusalOf(readRunbookInputs(nest(50000)))).toBe(
      RunbookInputsRefusal.TooDeep,
    );

    let list: Array<unknown> = [];
    const root: JSONObject = { list: list as unknown as JSONObject };

    for (let i: number = 0; i < 50; i++) {
      const inner: Array<unknown> = [];
      list.push(inner);
      list = inner;
    }

    expect(refusalOf(readRunbookInputs(root))).toBe(
      RunbookInputsRefusal.TooDeep,
    );
  });

  it("refuses a NUL character in any value or name, at any depth", () => {
    expect(refusalOf(readRunbookInputs({ host: `web${NUL}1` }))).toBe(
      RunbookInputsRefusal.NulCharacter,
    );
    expect(
      refusalOf(readRunbookInputs({ deep: { list: ["ok", `a${NUL}`] } })),
    ).toBe(RunbookInputsRefusal.NulCharacter);
    expect(refusalOf(readRunbookInputs({ [`na${NUL}me`]: "x" }))).toBe(
      RunbookInputsRefusal.NulCharacter,
    );
  });
});

describe("the variables a Bash step gets", () => {
  it("names each top-level value ONEUPTIME_INPUT_ and its name upper-cased", () => {
    expect(getRunbookInputVariableName("host")).toBe("ONEUPTIME_INPUT_HOST");
    expect(getRunbookInputVariableName("hostName")).toBe(
      "ONEUPTIME_INPUT_HOSTNAME",
    );
    expect(getRunbookInputVariableName("host-name")).toBe(
      "ONEUPTIME_INPUT_HOST_NAME",
    );
    expect(getRunbookInputVariableName("disk.usage %")).toBe(
      "ONEUPTIME_INPUT_DISK_USAGE__",
    );
    expect(getRunbookInputVariableName("2fa")).toBe("ONEUPTIME_INPUT_2FA");
  });

  it("makes no variable of a name with no letter or digit, or of a very long one", () => {
    for (const name of ["", "-", "___", "  ", "$$$"]) {
      expect(getRunbookInputVariableName(name)).toBe(null);
    }

    expect(
      getRunbookInputVariableName("a".repeat(RUNBOOK_INPUT_MAX_NAME_LENGTH)),
    ).not.toBe(null);
    expect(
      getRunbookInputVariableName(
        "a".repeat(RUNBOOK_INPUT_MAX_NAME_LENGTH + 1),
      ),
    ).toBe(null);
  });

  it("can never name a variable a shell or the Runner reads", () => {
    for (const name of [
      "PATH",
      "LD_PRELOAD",
      "BASH_ENV",
      "ENV",
      "IFS",
      "BASH_FUNC_x%%",
      "ONEUPTIME_RUNNER_KEY",
      "../../etc",
      "a=b",
      "x\ny",
    ]) {
      const variable: string | null = getRunbookInputVariableName(name);

      expect(variable).not.toBe(null);
      expect(variable!.startsWith(RUNBOOK_INPUT_VARIABLE_PREFIX)).toBe(true);
      expect(variable).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("writes text as it is, numbers and true/false as written, objects and lists as JSON", () => {
    expect(getRunbookInputVariableValue("web-1")).toBe("web-1");
    expect(getRunbookInputVariableValue(3)).toBe("3");
    expect(getRunbookInputVariableValue(2.5)).toBe("2.5");
    expect(getRunbookInputVariableValue(false)).toBe("false");
    expect(getRunbookInputVariableValue(null)).toBe("");
    expect(getRunbookInputVariableValue({ a: [1, "b"] })).toBe('{"a":[1,"b"]}');
    expect(getRunbookInputVariableValue(["x", "y"])).toBe('["x","y"]');
  });

  it("gives every value its variable, the whole object as JSON and what started the run", () => {
    expect(
      getRunbookInputVariables({
        inputs: { host: "web-1", replicas: 3, labels: { team: "payments" } },
        trigger: "Webhook",
      }),
    ).toEqual({
      ONEUPTIME_INPUT_HOST: "web-1",
      ONEUPTIME_INPUT_REPLICAS: "3",
      ONEUPTIME_INPUT_LABELS: '{"team":"payments"}',
      [RUNBOOK_INPUTS_VARIABLE]:
        '{"host":"web-1","replicas":3,"labels":{"team":"payments"}}',
      [RUNBOOK_TRIGGER_VARIABLE]: "Webhook",
    });
  });

  it("gives a run with no inputs an empty object, so a script can always read it", () => {
    expect(getRunbookInputVariables({ trigger: "Schedule" })).toEqual({
      [RUNBOOK_INPUTS_VARIABLE]: "{}",
      [RUNBOOK_TRIGGER_VARIABLE]: "Schedule",
    });
    expect(getRunbookInputVariables({ inputs: null })).toEqual({
      [RUNBOOK_INPUTS_VARIABLE]: "{}",
    });
    expect(
      getRunbookInputVariables({
        inputs: ["not", "an", "object"] as unknown as JSONObject,
      }),
    ).toEqual({ [RUNBOOK_INPUTS_VARIABLE]: "{}" });
  });

  it("keeps the first of two names that become the same variable", () => {
    expect(
      getRunbookInputVariables({
        inputs: { "host-name": "first", host_name: "second" },
      })["ONEUPTIME_INPUT_HOST_NAME"],
    ).toBe("first");
  });

  it("stops at the variable limit; the rest are still in ONEUPTIME_INPUTS", () => {
    const inputs: JSONObject = {};

    for (let i: number = 0; i < RUNBOOK_INPUT_MAX_VARIABLES + 25; i++) {
      inputs[`key${i}`] = i;
    }

    const variables: Record<string, string> = getRunbookInputVariables({
      inputs,
    });

    expect(
      Object.keys(variables).filter((name: string) => {
        return name.startsWith(RUNBOOK_INPUT_VARIABLE_PREFIX);
      }).length,
    ).toBe(RUNBOOK_INPUT_MAX_VARIABLES);
    expect(variables["ONEUPTIME_INPUT_KEY99"]).toBe("99");
    expect(variables["ONEUPTIME_INPUT_KEY100"]).toBe(undefined);
    expect(JSON.parse(variables[RUNBOOK_INPUTS_VARIABLE]!)).toEqual(inputs);
  });

  it("leaves out a value holding a NUL, which no process environment can carry", () => {
    const variables: Record<string, string> = getRunbookInputVariables({
      inputs: { ok: "fine", bad: `a${NUL}b` },
      trigger: `Web${NUL}hook`,
    });

    expect(variables["ONEUPTIME_INPUT_OK"]).toBe("fine");
    expect(variables["ONEUPTIME_INPUT_BAD"]).toBe(undefined);
    expect(variables[RUNBOOK_TRIGGER_VARIABLE]).toBe(undefined);

    for (const value of Object.values(variables)) {
      expect(value.indexOf(NUL)).toBe(-1);
    }
  });

  it("passes shell syntax through as plain text: it is a value, never a command", () => {
    const hostile: string = '$(touch /tmp/pwned); `id`; "; rm -rf / #';

    expect(
      getRunbookInputVariables({ inputs: { host: hostile } })[
        "ONEUPTIME_INPUT_HOST"
      ],
    ).toBe(hostile);
  });
});

describe("what a JavaScript step reads as args", () => {
  it("is the inputs as sent and what started the run", () => {
    expect(
      getRunbookInputArgs({
        inputs: { host: "web-1", list: [1, 2] },
        trigger: "Webhook",
      }),
    ).toEqual({ inputs: { host: "web-1", list: [1, 2] }, trigger: "Webhook" });
    expect(getRunbookInputArgs({})).toEqual({ inputs: {}, trigger: null });
  });

  it("knows whether a run has inputs to show", () => {
    expect(hasRunbookInputs({ a: 1 })).toBe(true);
    expect(hasRunbookInputs({})).toBe(false);
    expect(hasRunbookInputs(null)).toBe(false);
    expect(hasRunbookInputs(undefined)).toBe(false);
    expect(hasRunbookInputs([1])).toBe(false);
    expect(hasRunbookInputs("text")).toBe(false);
  });
});
