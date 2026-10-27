import {
  LEGACY_RUNBOOK_SECRET_PREFIX,
  RUNBOOK_VARIABLE_NAME_MAX_LENGTH,
  RunbookVariableReference,
  RunbookVariableScope,
  findRunbookVariableReferences,
  findRunbookVariableReferencesIn,
  formatRunbookVariableReference,
  getRunbookVariableReferenceKey,
  isValidRunbookVariableName,
  parseSingleRunbookVariableReference,
  readRunbookVariableReference,
  replaceRunbookVariableReferences,
  rewriteLegacyRunbookSecretReferences,
} from "../../../Types/Runbook/RunbookVariableReference";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * HOW A RUNBOOK STEP NAMES A RUNBOOK VARIABLE - the way a workflow names a
 * workflow variable:
 *
 *   {{global.variables.NAME}}  one of the project's variables;
 *   {{local.variables.NAME}}   one of the runbook's own;
 *   {{runbookSecrets.NAME}}    how runbook secrets were named, before they
 *                              became global variables of the same name.
 *
 * Read in time in line with the text's length; anything else between braces
 * is left as written.
 */

const global: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Global, name };
};

const local: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Local, name };
};

describe("isValidRunbookVariableName", () => {
  test.each(["DB_HOST", "prod-key", "a", "A1_b-2", "x".repeat(100)])(
    "%s is a name",
    (name: string) => {
      expect(isValidRunbookVariableName(name)).toBe(true);
    },
  );

  test.each([
    ["empty", ""],
    ["a space", "DB HOST"],
    ["a dot", "db.host"],
    ["a brace", "a}"],
    ["a line break", "a\nb"],
    ["too long", "x".repeat(RUNBOOK_VARIABLE_NAME_MAX_LENGTH + 1)],
    ["a letter outside ASCII", "clé"],
  ])("%s is not", (_label: string, name: string) => {
    expect(isValidRunbookVariableName(name)).toBe(false);
  });

  test("anything but a string is not", () => {
    expect(isValidRunbookVariableName(undefined)).toBe(false);
    expect(isValidRunbookVariableName(7)).toBe(false);
  });
});

describe("readRunbookVariableReference", () => {
  test("reads the three spellings, white space around them allowed", () => {
    expect(readRunbookVariableReference("global.variables.DB_HOST")).toEqual(
      global("DB_HOST"),
    );
    expect(readRunbookVariableReference(" local.variables.NS ")).toEqual(
      local("NS"),
    );
    expect(readRunbookVariableReference("runbookSecrets.API_TOKEN")).toEqual(
      global("API_TOKEN"),
    );
  });

  test.each([
    "global.variables.",
    "global.variables.a b",
    "variables.DB_HOST",
    "global.DB_HOST",
    "local.variables.a.b",
    "args.host",
    ".Values.image",
  ])("%s names no variable", (inner: string) => {
    expect(readRunbookVariableReference(inner)).toBeNull();
  });
});

describe("formatting and keys", () => {
  test("a reference is written as a step writes it", () => {
    expect(formatRunbookVariableReference(global("DB_HOST"))).toBe(
      "{{global.variables.DB_HOST}}",
    );
    expect(formatRunbookVariableReference(local("NS"))).toBe(
      "{{local.variables.NS}}",
    );
  });

  test("a global and a local variable of one name are two variables", () => {
    expect(getRunbookVariableReferenceKey(global("X"))).toBe("global:X");
    expect(getRunbookVariableReferenceKey(local("X"))).toBe("local:X");
  });
});

describe("findRunbookVariableReferences", () => {
  test("reads each variable a text names, once, in the order it first names it", () => {
    expect(
      findRunbookVariableReferences(
        [
          "ssh {{global.variables.USER}}@{{ global.variables.HOST }}",
          "kubectl -n {{local.variables.NS}} get pods",
          "echo {{global.variables.HOST}} {{runbookSecrets.TOKEN}}",
        ].join("\n"),
      ),
    ).toEqual([global("USER"), global("HOST"), local("NS"), global("TOKEN")]);
  });

  test("the old spelling and the new one of a name are one variable", () => {
    expect(
      findRunbookVariableReferences(
        "{{runbookSecrets.TOKEN}} {{global.variables.TOKEN}}",
      ),
    ).toEqual([global("TOKEN")]);
  });

  test("leaves every other placeholder alone: a Helm template, a workflow value", () => {
    expect(
      findRunbookVariableReferences(
        "helm template --set image={{ .Values.image }} {{args.host}} {{local.variables}}",
      ),
    ).toEqual([]);
  });

  test("reads nothing from nothing", () => {
    expect(findRunbookVariableReferences("")).toEqual([]);
    expect(findRunbookVariableReferences(undefined)).toEqual([]);
    expect(findRunbookVariableReferences(null)).toEqual([]);
    expect(findRunbookVariableReferences("no braces here")).toEqual([]);
  });

  test("never reads across a line: a placeholder left open is not one", () => {
    expect(
      findRunbookVariableReferences(
        "echo {{global.variables.A\n}} and {{global.variables.B}}",
      ),
    ).toEqual([global("B")]);
  });

  test("reads a long text in time in line with its length", () => {
    const text: string = "{{global.variables.X}} {{ ".repeat(40_000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(findRunbookVariableReferences(text)).toEqual([global("X")]);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("findRunbookVariableReferencesIn reads several texts as one", () => {
    expect(
      findRunbookVariableReferencesIn([
        "{{global.variables.A}}",
        undefined,
        "{{global.variables.A}} {{local.variables.B}}",
      ]),
    ).toEqual([global("A"), local("B")]);
  });
});

describe("parseSingleRunbookVariableReference: a field that holds one secret", () => {
  test("reads a field that is one reference, white space around it allowed", () => {
    expect(
      parseSingleRunbookVariableReference("  {{global.variables.KEY}}\n"),
    ).toEqual(global("KEY"));
    expect(
      parseSingleRunbookVariableReference("{{local.variables.KUBECONFIG}}"),
    ).toEqual(local("KUBECONFIG"));
  });

  test.each([
    ["empty", ""],
    ["a value typed in", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["text before it", "key {{global.variables.KEY}}"],
    ["text after it", "{{global.variables.KEY}}x"],
    ["two references", "{{global.variables.A}}{{global.variables.B}}"],
    ["another placeholder", "{{args.key}}"],
  ])("%s is not one", (_label: string, text: string) => {
    expect(parseSingleRunbookVariableReference(text)).toBeNull();
  });

  test("anything but a string is not one", () => {
    expect(parseSingleRunbookVariableReference(undefined)).toBeNull();
    expect(parseSingleRunbookVariableReference(null)).toBeNull();
  });
});

describe("replaceRunbookVariableReferences", () => {
  const values: Record<string, string> = {
    "global:HOST": "10.0.4.21",
    "local:NS": "checkout",
    "global:TRICKY": "{{global.variables.HOST}} $(rm -rf /)",
  };

  const getValue: (
    reference: RunbookVariableReference,
  ) => string | undefined = (
    reference: RunbookVariableReference,
  ): string | undefined => {
    return values[getRunbookVariableReferenceKey(reference)];
  };

  test("fills in each reference it has a value for, in every spelling", () => {
    expect(
      replaceRunbookVariableReferences(
        "ssh deploy@{{global.variables.HOST}} -n {{ local.variables.NS }} {{runbookSecrets.HOST}}",
        getValue,
      ),
    ).toBe("ssh deploy@10.0.4.21 -n checkout 10.0.4.21");
  });

  test("leaves a reference it has no value for, and every other placeholder, as written", () => {
    expect(
      replaceRunbookVariableReferences(
        "{{global.variables.UNKNOWN}} {{ .Values.x }} {{args.y}}",
        getValue,
      ),
    ).toBe("{{global.variables.UNKNOWN}} {{ .Values.x }} {{args.y}}");
  });

  test("places a value as it is, in one pass: a value holding a reference is never read again", () => {
    expect(
      replaceRunbookVariableReferences(
        "echo {{global.variables.TRICKY}}",
        getValue,
      ),
    ).toBe("echo {{global.variables.HOST}} $(rm -rf /)");
  });

  test("an empty value is a value", () => {
    expect(
      replaceRunbookVariableReferences("[{{global.variables.EMPTY}}]", () => {
        return "";
      }),
    ).toBe("[]");
  });
});

describe("rewriteLegacyRunbookSecretReferences: steps written before variables", () => {
  test("writes each secret the way variables are, by the name its variable has", () => {
    const names: Map<string, string> = new Map<string, string>([
      ["API_TOKEN", "API_TOKEN"],
      // Taken by another variable already: the move gave it another name.
      ["DB_PASSWORD", "DB_PASSWORD-2"],
    ]);

    expect(
      rewriteLegacyRunbookSecretReferences(
        "curl -H 'Authorization: {{runbookSecrets.API_TOKEN}}' && psql -W {{ runbookSecrets.DB_PASSWORD }}",
        (name: string): string | undefined => {
          return names.get(name);
        },
      ),
    ).toBe(
      "curl -H 'Authorization: {{global.variables.API_TOKEN}}' && psql -W {{global.variables.DB_PASSWORD-2}}",
    );
  });

  test("asks for a name a variable could not have, as the step wrote it", () => {
    const asked: Array<string> = [];

    expect(
      rewriteLegacyRunbookSecretReferences(
        "echo {{runbookSecrets.db password}}",
        (name: string): string | undefined => {
          asked.push(name);
          return name === "db password" ? "db_password" : undefined;
        },
      ),
    ).toBe("echo {{global.variables.db_password}}");
    expect(asked).toEqual(["db password"]);
  });

  test("leaves a secret it has no variable for, and every other placeholder, as written", () => {
    const text: string =
      "{{runbookSecrets.GONE}} {{global.variables.X}} {{ .Values.y }} {{runbookSecrets.}}";

    expect(
      rewriteLegacyRunbookSecretReferences(text, () => {
        return undefined;
      }),
    ).toBe(text);
  });

  test("never writes a name a variable cannot have", () => {
    expect(
      rewriteLegacyRunbookSecretReferences("{{runbookSecrets.A}}", () => {
        return "not a name";
      }),
    ).toBe("{{runbookSecrets.A}}");
  });

  test("a text without the old spelling is handed back as it is", () => {
    const getName: jest.Mock = jest.fn();

    expect(
      rewriteLegacyRunbookSecretReferences(
        "echo {{global.variables.A}}",
        getName,
      ),
    ).toBe("echo {{global.variables.A}}");
    expect(getName).not.toHaveBeenCalled();
    expect(LEGACY_RUNBOOK_SECRET_PREFIX).toBe("runbookSecrets.");
  });
});
