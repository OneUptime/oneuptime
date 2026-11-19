import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "../../../Types/Dictionary";
import TotpCodeIssuer, {
  MAX_TOTP_SECRETS_PER_STEP,
  REDACTED_TOTP_CODE,
  TotpCodeAnswer,
  TotpSecrets,
  callsTotpCodeFunction,
  fillTotpCodes,
  getQuotedNames,
  getReferencedSecretNames,
  readTotpSecrets,
  redactTotpCodes,
  redactTotpCodesInValue,
} from "../../../Utils/Monitor/MonitorSecretTotp";
import {
  TotpAlgorithm,
  TotpParameters,
  generateTotpCode,
} from "../../../Utils/Totp/TotpSecret";

/*
 * One-time codes from TOTP monitor secrets (issue #9703), where a check
 * uses them: which references a text holds, how codes replace them, the
 * issuer that makes a check's codes - never one about to expire - and how
 * every code it made is taken out of what the check reports.
 */

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const LOGIN: TotpParameters = {
  secret: SEED,
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

const BILLING: TotpParameters = {
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  algorithm: TotpAlgorithm.SHA256,
  digits: 8,
  periodInSeconds: 30,
};

// The start of a 30-second period: RFC 6238's 1111111109 s falls in it.
const PERIOD_START: number = 1111111080000;

interface FakeClock {
  nowInMs: number;
  sleeps: Array<number>;
}

let clock: FakeClock;

function issuer(secrets: TotpSecrets = { LoginCode: LOGIN }): TotpCodeIssuer {
  return new TotpCodeIssuer({
    secrets,
    now: (): number => {
      return clock.nowInMs;
    },
    sleep: async (ms: number): Promise<void> => {
      clock.sleeps.push(ms);
      clock.nowInMs += ms;
    },
  });
}

function code(parameters: TotpParameters, atInMs: number): string {
  return generateTotpCode(parameters, atInMs);
}

beforeEach(() => {
  clock = { nowInMs: PERIOD_START + 10_000, sleeps: [] };
});

describe("the references a text holds", () => {
  test("are the names of its {{monitorSecrets.NAME}} placeholders, each once", () => {
    expect(
      getReferencedSecretNames(
        'await page.fill("#otp", "{{monitorSecrets.LoginCode}}");\n// {{monitorSecrets.ApiKey}} and {{monitorSecrets.LoginCode}} again',
      ),
    ).toEqual(["LoginCode", "ApiKey"]);
  });

  test("are read as the server reads them: no spaces, no other placeholders", () => {
    expect(
      getReferencedSecretNames(
        "{{ monitorSecrets.Spaced }} {{monitorSecrets.}} {{timestamp}} {{monitorSecret.Typo}} {monitorSecrets.Single}",
      ),
    ).toEqual([]);
  });

  test("are found in a script that asks for a code by name", () => {
    expect(
      callsTotpCodeFunction('await oneuptime.getTotpCode("LoginCode")'),
    ).toBe(true);
    expect(
      callsTotpCodeFunction("const c = await getTotpCode ('LoginCode');"),
    ).toBe(true);
    expect(callsTotpCodeFunction("oneuptime.getTotpCodes()")).toBe(false);
    expect(callsTotpCodeFunction("mygetTotpCode('x')")).toBe(false);
    expect(callsTotpCodeFunction("// getTotpCode is documented")).toBe(false);
  });

  test("name a secret only when the script writes the name in quotes", () => {
    const script: string =
      "const a = await oneuptime.getTotpCode(\"LoginCode\");\nconst b = await oneuptime.getTotpCode('Billing');\nconst c = `Backup`;\n// Unquoted mention of Admin";

    expect(
      getQuotedNames(script, ["LoginCode", "Billing", "Backup", "Admin", ""]),
    ).toEqual(["LoginCode", "Billing", "Backup"]);
  });
});

describe("filling codes into a text", () => {
  test("replaces every reference to a secret with a code, and leaves the rest", () => {
    expect(
      fillTotpCodes(
        '{"otp":"{{monitorSecrets.LoginCode}}","key":"{{monitorSecrets.ApiKey}}","again":"{{monitorSecrets.LoginCode}}","now":"{{timestamp}}"}',
        { LoginCode: "123456" },
      ),
    ).toBe(
      '{"otp":"123456","key":"{{monitorSecrets.ApiKey}}","again":"123456","now":"{{timestamp}}"}',
    );
  });

  test("never reads a name it was not given from the object's prototype", () => {
    expect(
      fillTotpCodes(
        "{{monitorSecrets.toString}} {{monitorSecrets.__proto__}}",
        {
          LoginCode: "123456",
        },
      ),
    ).toBe("{{monitorSecrets.toString}} {{monitorSecrets.__proto__}}");
  });

  test("leaves a text with no placeholder, and what is not text, as it is", () => {
    expect(fillTotpCodes("plain", { LoginCode: "1" })).toBe("plain");
    expect(fillTotpCodes(undefined as unknown as string, {})).toBeUndefined();
  });
});

describe("taking codes out of what a check reports", () => {
  test("takes out a code that stands as a number of its own", () => {
    expect(
      redactTotpCodes(
        "Entered 492039. otp=492039&next=1 [492039] code:492039",
        ["492039"],
      ),
    ).toBe(
      `Entered ${REDACTED_TOTP_CODE}. otp=${REDACTED_TOTP_CODE}&next=1 [${REDACTED_TOTP_CODE}] code:${REDACTED_TOTP_CODE}`,
    );
    expect(redactTotpCodes("492039", ["492039"])).toBe(REDACTED_TOTP_CODE);
    expect(redactTotpCodes("492039 492039", ["492039"])).toBe(
      `${REDACTED_TOTP_CODE} ${REDACTED_TOTP_CODE}`,
    );
  });

  test("leaves a longer number that only holds the same digits", () => {
    expect(
      redactTotpCodes("order 14920391, at 1700000492039", ["492039"]),
    ).toBe("order 14920391, at 1700000492039");
  });

  test("takes out every code it is given", () => {
    expect(redactTotpCodes("a 111111 b 22222222", ["111111", "22222222"])).toBe(
      `a ${REDACTED_TOTP_CODE} b ${REDACTED_TOTP_CODE}`,
    );
  });

  test("ignores what is no code", () => {
    expect(redactTotpCodes("a.b.c", [".", ""])).toBe("a.b.c");
    expect(redactTotpCodes("text", [])).toBe("text");
  });

  test("takes them out of a value at any depth, keys and numbers too, without changing it", () => {
    const value: Dictionary<unknown> = {
      data: { entered: "492039", asNumber: 492039, list: ["x 492039", 7] },
      "shot-492039": "kept",
      nothing: null,
      when: 1700000492039,
    };
    const copy: string = JSON.stringify(value);

    expect(redactTotpCodesInValue(value, ["492039"])).toEqual({
      data: {
        entered: REDACTED_TOTP_CODE,
        asNumber: REDACTED_TOTP_CODE,
        list: [`x ${REDACTED_TOTP_CODE}`, 7],
      },
      [`shot-${REDACTED_TOTP_CODE}`]: "kept",
      nothing: null,
      when: 1700000492039,
    });
    expect(JSON.stringify(value)).toBe(copy);
  });

  test("takes out a code returned as a number that lost its leading zero", () => {
    expect(redactTotpCodesInValue({ code: 81804 }, ["081804"])).toEqual({
      code: REDACTED_TOTP_CODE,
    });
  });
});

describe("the TOTP secrets a step carries, as the probe reads them", () => {
  test("keep only names and parameters that can make a code", () => {
    expect(
      readTotpSecrets({
        LoginCode: { ...LOGIN, extra: "dropped" },
        Bad: { ...LOGIN, digits: 7 },
        "": LOGIN,
        [`${"x".repeat(201)}`]: LOGIN,
        Text: "otpauth://totp/x",
      }),
    ).toEqual({ LoginCode: LOGIN });
  });

  test("are nothing when the step carries none, or something else", () => {
    for (const nothing of [undefined, null, "x", [LOGIN], 5]) {
      expect(readTotpSecrets(nothing)).toEqual({});
    }
  });

  test("are no more than a step may hold", () => {
    const many: TotpSecrets = {};

    for (
      let index: number = 0;
      index < MAX_TOTP_SECRETS_PER_STEP + 5;
      index++
    ) {
      many[`Code${index}`] = LOGIN;
    }

    expect(Object.keys(readTotpSecrets(many))).toHaveLength(
      MAX_TOTP_SECRETS_PER_STEP,
    );
  });
});

describe("a check's codes", () => {
  test("are made from the probe's clock at the moment they are asked for", async () => {
    clock.nowInMs = 1111111111000;

    // RFC 6238's 1111111111 s, SHA1: 14050471, of which six digits.
    expect(await issuer().getCode("LoginCode")).toBe("050471");
    expect(clock.sleeps).toEqual([]);
  });

  test("are the next period's when asked for a second before the end of one", async () => {
    // RFC 6238's 1111111109 s is the last second of its period: 07081804.
    clock.nowInMs = 1111111109000;

    expect(await issuer().getCode("LoginCode")).toBe("050471");
    expect(clock.sleeps).toEqual([1_000]);
  });

  test("wait for the next period when the current code is about to expire", async () => {
    // Four seconds left of the period.
    clock.nowInMs = PERIOD_START + 26_000;

    const issued: string = await issuer().getCode("LoginCode");

    expect(clock.sleeps).toEqual([4_000]);
    expect(issued).toBe(code(LOGIN, PERIOD_START + 30_000));
    expect(issued).not.toBe(code(LOGIN, PERIOD_START));
  });

  test("do not wait with exactly five seconds left", async () => {
    clock.nowInMs = PERIOD_START + 25_000;

    expect(await issuer().getCode("LoginCode")).toBe(code(LOGIN, PERIOD_START));
    expect(clock.sleeps).toEqual([]);
  });

  test("are of the next period even when the timer fires early", async () => {
    clock.nowInMs = PERIOD_START + 29_000;

    const early: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: { LoginCode: LOGIN },
      now: (): number => {
        return clock.nowInMs;
      },
      sleep: async (ms: number): Promise<void> => {
        clock.sleeps.push(ms);
        // The clock moves less than asked for.
        clock.nowInMs += ms - 5;
      },
    });

    expect(await early.getCode("LoginCode")).toBe(
      code(LOGIN, PERIOD_START + 30_000),
    );
  });

  test("say which name is missing, and what to check", async () => {
    await expect(issuer().getCode("Nope")).rejects.toThrow(
      "This monitor has no one-time code secret named \"Nope\". Check the name, that the secret's type is One-time code (TOTP), and that the secret's access lets this monitor use it.",
    );
    await expect(issuer().getCode(42)).rejects.toThrow(
      'Give oneuptime.getTotpCode the name of a one-time code secret, such as oneuptime.getTotpCode("LoginCode").',
    );
    await expect(issuer().getCode("  ")).rejects.toThrow(
      "Give oneuptime.getTotpCode the name",
    );
  });

  test("never say a seed in an error", async () => {
    try {
      await issuer().getCode("toString");
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(SEED);
    }

    expect.assertions(1);
  });

  test("are remembered, each once, for taking out of the check's report", async () => {
    const codes: TotpCodeIssuer = issuer();

    const first: string = await codes.getCode("LoginCode");
    await codes.getCode("LoginCode");
    clock.nowInMs += 30_000;
    const second: string = await codes.getCode("LoginCode");

    expect(codes.getIssuedCodes()).toEqual([first, second]);
    expect(
      codes.redact({
        log: [`typed ${first}`, `then ${second}`],
        error: `Expected ${second} to be accepted`,
      }),
    ).toEqual({
      log: [`typed ${REDACTED_TOTP_CODE}`, `then ${REDACTED_TOTP_CODE}`],
      error: `Expected ${REDACTED_TOTP_CODE} to be accepted`,
    });
  });

  test("redact nothing before any code is made", () => {
    expect(issuer().redact("123456")).toBe("123456");
  });
});

describe("filling a check's texts", () => {
  test("fills a script's references with the code of the moment", async () => {
    const script: string =
      'await page.fill("#otp", "{{monitorSecrets.LoginCode}}");\nawait page.fill("#key", "{{monitorSecrets.ApiKey}}");';

    expect(await issuer().fill(script)).toBe(
      `await page.fill("#otp", "${code(LOGIN, clock.nowInMs)}");\nawait page.fill("#key", "{{monitorSecrets.ApiKey}}");`,
    );
  });

  test("fills a request's URL, headers and body at one moment, and copies them", async () => {
    clock.nowInMs = PERIOD_START + 27_000;

    const request: {
      url: string;
      headers: Dictionary<string>;
      body: Dictionary<unknown>;
    } = {
      url: "https://api.example.com/verify?otp={{monitorSecrets.LoginCode}}",
      headers: {
        "X-OTP": "{{monitorSecrets.Billing}}",
        Accept: "application/json",
      },
      body: {
        user: "ops",
        mfa: { codes: ["{{monitorSecrets.LoginCode}}"], count: 1 },
      },
    };
    const before: string = JSON.stringify(request);

    const filled: typeof request = await issuer({
      LoginCode: LOGIN,
      Billing: BILLING,
    }).fill(request);

    // One wait for both, to the start of the next period.
    expect(clock.sleeps).toEqual([3_000]);

    const moment: number = PERIOD_START + 30_000;

    expect(filled).toEqual({
      url: `https://api.example.com/verify?otp=${code(LOGIN, moment)}`,
      headers: { "X-OTP": code(BILLING, moment), Accept: "application/json" },
      body: { user: "ops", mfa: { codes: [code(LOGIN, moment)], count: 1 } },
    });
    expect(JSON.stringify(request)).toBe(before);
  });

  test("waits only for the codes the text uses", async () => {
    clock.nowInMs = PERIOD_START + 27_000;

    expect(
      await issuer().fill("no code here, only {{monitorSecrets.ApiKey}}"),
    ).toBe("no code here, only {{monitorSecrets.ApiKey}}");
    expect(clock.sleeps).toEqual([]);
  });

  test("waits again when a second secret's period ends right after the first's", async () => {
    const ten: TotpParameters = { ...LOGIN, periodInSeconds: 10 };
    const twelve: TotpParameters = { ...LOGIN, periodInSeconds: 12 };

    /*
     * 3 s left of a 10-second period, less than its 3.3 s; the 12-second
     * one has 5 s, enough - until the first wait leaves it 2 s, less than
     * the 4 s a third of its period asks for.
     */
    const minute: number = 1_700_000_040_000;
    clock.nowInMs = minute + 7_000;

    const filled: string = await issuer({ Ten: ten, Twelve: twelve }).fill(
      "{{monitorSecrets.Ten}} {{monitorSecrets.Twelve}}",
    );

    expect(clock.sleeps).toEqual([3_000, 2_000]);
    expect(clock.nowInMs).toBe(minute + 12_000);
    expect(filled).toBe(
      `${code(ten, minute + 12_000)} ${code(twelve, minute + 12_000)}`,
    );
  });

  test("shares one wait between secrets whose periods end together", async () => {
    const sixty: TotpParameters = { ...LOGIN, periodInSeconds: 60 };
    const twenty: TotpParameters = { ...LOGIN, periodInSeconds: 20 };

    clock.nowInMs = 1_700_000_098_000;

    await issuer({ Sixty: sixty, Twenty: twenty }).fill(
      "{{monitorSecrets.Sixty}} {{monitorSecrets.Twenty}}",
    );

    expect(clock.sleeps).toEqual([2_000]);
  });

  test("is nothing to do for a step with no TOTP secrets", async () => {
    const none: TotpCodeIssuer = issuer({});

    expect(none.hasSecrets()).toBe(false);
    expect(await none.fill("{{monitorSecrets.LoginCode}}")).toBe(
      "{{monitorSecrets.LoginCode}}",
    );
  });
});

describe("a code asked for by a runtime that cannot wait", () => {
  test("is given at once while it has time left", () => {
    const answer: TotpCodeAnswer = issuer().tryGetCode("LoginCode");

    expect(answer).toEqual({ code: code(LOGIN, clock.nowInMs) });
  });

  test("says how long to wait when it is about to expire", () => {
    clock.nowInMs = PERIOD_START + 28_500;

    expect(issuer().tryGetCode("LoginCode")).toEqual({ waitInMs: 1_500 });
  });

  test("says what is wrong with the name", () => {
    expect(issuer().tryGetCode("Nope").error).toContain(
      'no one-time code secret named "Nope"',
    );
    expect(issuer().tryGetCode(undefined).error).toContain(
      "Give oneuptime.getTotpCode the name",
    );
  });

  test("is remembered for redaction like any other", () => {
    const codes: TotpCodeIssuer = issuer();
    const answer: TotpCodeAnswer = codes.tryGetCode("LoginCode");

    expect(codes.getIssuedCodes()).toEqual([answer.code]);
  });
});
