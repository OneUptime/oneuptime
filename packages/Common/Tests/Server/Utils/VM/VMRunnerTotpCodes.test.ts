import VMRunner from "../../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import TotpCodeIssuer from "../../../../Utils/Monitor/MonitorSecretTotp";
import {
  TotpAlgorithm,
  TotpParameters,
} from "../../../../Utils/Totp/TotpParameters";
import { generateTotpCode } from "../../../../Utils/Totp/TotpSecret";
import { describe, expect, jest, test } from "@jest/globals";

jest.setTimeout(60000);

/*
 * oneuptime.getTotpCode("NAME") in the isolated-vm sandbox a probe's Custom
 * JavaScript Code monitor runs its script in (issue #9703): a fresh code
 * from the monitor's one-time code secrets, made by the host at the moment
 * the script asks - never one about to expire, which the script waits out
 * on the sandbox's own sleep - and a clear error for a name the monitor
 * has no secret for, or for a script with no monitor (a workflow's).
 */

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

// The start of a 30-second period.
const PERIOD_START: number = 1111111080000;

async function run(
  code: string,
  totpCodes: TotpCodeIssuer | undefined,
): Promise<ReturnResult> {
  return VMRunner.runCodeInSandbox({
    code,
    options: {
      timeout: 10000,
      totpCodes,
    },
  });
}

describe("oneuptime.getTotpCode in a Custom JavaScript Code script", () => {
  test("hands the script the code of the moment it asks", async () => {
    const issuer: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: { LoginCode: LOGIN },
      now: (): number => {
        return PERIOD_START + 10_000;
      },
    });

    const result: ReturnResult = await run(
      'return { data: await oneuptime.getTotpCode("LoginCode") };',
      issuer,
    );

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      data: generateTotpCode(LOGIN, PERIOD_START + 10_000),
    });
    expect(issuer.getIssuedCodes()).toEqual([
      generateTotpCode(LOGIN, PERIOD_START + 10_000),
    ]);
  });

  test("waits out a code about to expire, and hands the next one", async () => {
    let asks: number = 0;
    const issuer: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: { LoginCode: LOGIN },
      // 150 ms left of the period on the first ask; the next period after.
      now: (): number => {
        asks++;
        return asks === 1 ? PERIOD_START + 29_850 : PERIOD_START + 30_000;
      },
    });

    const startedAt: number = Date.now();
    const result: ReturnResult = await run(
      'return { data: await oneuptime.getTotpCode("LoginCode") };',
      issuer,
    );

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      data: generateTotpCode(LOGIN, PERIOD_START + 30_000),
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
    expect(issuer.getWaitedInMs()).toBe(150);
  });

  test("fails the script with what to check for a secret the monitor does not have", async () => {
    const result: ReturnResult = await run(
      'await oneuptime.getTotpCode("Nope");',
      new TotpCodeIssuer({ secrets: { LoginCode: LOGIN } }),
    );

    expect(result.scriptError?.message).toContain(
      'This monitor has no one-time code secret named "Nope".',
    );
  });

  test("fails the script when it gives no name", async () => {
    const result: ReturnResult = await run(
      "await oneuptime.getTotpCode(42);",
      new TotpCodeIssuer({ secrets: { LoginCode: LOGIN } }),
    );

    expect(result.scriptError?.message).toContain(
      "Give oneuptime.getTotpCode the name of a one-time code secret",
    );
  });

  test("says it is a monitor script's in a script that has no monitor", async () => {
    const result: ReturnResult = await run(
      'await oneuptime.getTotpCode("LoginCode");',
      undefined,
    );

    expect(result.scriptError?.message).toBe(
      "oneuptime.getTotpCode works only in a monitor's script, where the monitor's one-time code (TOTP) secrets are.",
    );
  });

  test("keeps the host callback out of the script's reach", async () => {
    const result: ReturnResult = await run(
      "return { data: [typeof globalThis.__oneuptimeHostTotpCallback, Object.isFrozen(oneuptime), typeof oneuptime.getTotpCode] };",
      undefined,
    );

    expect(result.returnValue).toEqual({
      data: ["undefined", true, "function"],
    });
  });
});
