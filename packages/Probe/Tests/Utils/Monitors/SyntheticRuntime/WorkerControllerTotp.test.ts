import { Browser, BrowserContext, Page, Route, chromium } from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import {
  TotpAlgorithm,
  TotpParameters,
  TotpSecrets,
} from "Common/Utils/Totp/TotpParameters";
import { generateTotpCode } from "Common/Utils/Totp/TotpSecret";

jest.setTimeout(120_000);

/*
 * A synthetic monitor that signs in with a one-time code (issue #9703), in
 * a real browser: the script's {{monitorSecrets.NAME}} is the code when the
 * script starts, oneuptime.getTotpCode("NAME") makes one when the script
 * asks, and every code the run made is masked in what it reports - its
 * logs, its returned data, its error and its screenshots' names. The seed
 * stays on the probe's side: the sandbox is handed codes, never the secret.
 */

const TARGET_URL: string = "https://synthetic-target.invalid/";

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

const SIGN_IN_PAGE: string = `<!doctype html>
<title>Sign in</title>
<form onsubmit="document.querySelector('#entered').textContent = document.querySelector('#otp').value; return false;">
  <label>Code <input id="otp" autocomplete="one-time-code"></label>
  <button type="submit">Verify</button>
</form>
<p id="entered"></p>`;

// The controller's private step that hands the sandbox its payload.
interface StartsWorker {
  startWorker: (data: { payload: unknown }) => Promise<unknown>;
}

interface Run {
  result: SandboxExecutionResult;
  // What the page's code field held when the run ended, read by the test.
  entered: string;
  // The codes that were current at some moment of the run.
  codesDuringRun: Set<string>;
  payloads: Array<string>;
}

describe("one-time codes in a synthetic monitor's script", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function run(
    code: string,
    totpSecrets: TotpSecrets | undefined = { LoginCode: LOGIN },
  ): Promise<Run> {
    const browserContext: BrowserContext = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    await browserContext.route(`${TARGET_URL}**`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: SIGN_IN_PAGE,
      });
    });
    const page: Page = await browserContext.newPage();

    // What the controller hands the sandbox, to prove the seed is not in it.
    const payloads: Array<string> = [];
    const controller: StartsWorker =
      WorkerController as unknown as StartsWorker;
    const startWorkerAsWritten: StartsWorker["startWorker"] =
      controller.startWorker;
    const startWorker: jest.SpyInstance = jest
      .spyOn(controller, "startWorker")
      .mockImplementation((data: { payload: unknown }): Promise<unknown> => {
        payloads.push(JSON.stringify(data.payload));
        return startWorkerAsWritten.call(WorkerController, data);
      });

    const startedAt: number = Date.now();

    try {
      const result: SandboxExecutionResult = await WorkerController.execute({
        browserContext,
        page,
        code,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        args: {},
        timeoutInMs: 30_000,
        totpSecrets,
      });
      const endedAt: number = Date.now();
      const codesDuringRun: Set<string> = new Set<string>();

      for (let at: number = startedAt; at <= endedAt + 1000; at += 1000) {
        codesDuringRun.add(generateTotpCode(LOGIN, at));
      }

      const entered: string = page.url().startsWith(TARGET_URL)
        ? await page.inputValue("#otp")
        : "";

      return { result, entered, codesDuringRun, payloads };
    } finally {
      startWorker.mockRestore();
      await browserContext.close();
    }
  }

  function expectNoCodeIn(value: unknown, codes: Set<string>): void {
    const text: string = JSON.stringify(value);

    for (const code of Array.from(codes)) {
      expect(text).not.toContain(code);
    }
  }

  test("fills a {{monitorSecrets.NAME}} with the code as the script starts, and masks it after", async () => {
    const outcome: Run = await run(`
      await page.goto("${TARGET_URL}");
      await page.fill("#otp", "{{monitorSecrets.LoginCode}}");
      await page.click("button");
      console.log("typed {{monitorSecrets.LoginCode}}");
      return { data: { typed: "{{monitorSecrets.LoginCode}}", shown: await page.textContent("#entered") } };
    `);

    expect(outcome.result.scriptError).toBeUndefined();
    expect(outcome.codesDuringRun.has(outcome.entered)).toBe(true);
    expect(outcome.result.logMessages).toEqual(["typed ******"]);
    expect(outcome.result.returnValue).toEqual({
      data: { typed: "******", shown: "******" },
    });
    expectNoCodeIn(outcome.result, outcome.codesDuringRun);
  });

  test("makes a code when the script asks with oneuptime.getTotpCode, and masks it everywhere", async () => {
    const outcome: Run = await run(`
      await page.goto("${TARGET_URL}");
      const code = await oneuptime.getTotpCode("LoginCode");
      await page.fill("#otp", code);
      screenshots["after " + code] = await page.screenshot();
      oneuptime.captureMetric("login.code." + code, 1, { code: code });
      throw new Error("The site refused " + code);
    `);

    expect(outcome.codesDuringRun.has(outcome.entered)).toBe(true);
    expect(outcome.result.scriptError).toBe("The site refused ******");
    expect(Object.keys(outcome.result.screenshots)).toEqual(["after ******"]);
    expect(outcome.result.capturedMetrics).toEqual([
      { name: "login.code.******", value: 1, attributes: { code: "******" } },
    ]);
    expectNoCodeIn(
      {
        ...outcome.result,
        screenshots: Object.keys(outcome.result.screenshots),
      },
      outcome.codesDuringRun,
    );
  });

  test("never hands the sandbox the seed", async () => {
    const outcome: Run = await run(`
      return { data: await oneuptime.getTotpCode("LoginCode") };
    `);

    expect(outcome.payloads.length).toBeGreaterThan(0);

    for (const payload of outcome.payloads) {
      expect(payload).not.toContain(LOGIN.secret);
    }
  });

  test("says what to check when the monitor has no secret of that name", async () => {
    const outcome: Run = await run(`
      await oneuptime.getTotpCode("Nope");
    `);

    expect(outcome.result.scriptError).toContain(
      'This monitor has no one-time code secret named "Nope".',
    );
  });

  test("says so in a script whose monitor has no one-time code secrets", async () => {
    const outcome: Run = await run(
      `return { data: typeof oneuptime.getTotpCode, code: await oneuptime.getTotpCode("LoginCode") };`,
      {},
    );

    expect(outcome.result.scriptError).toContain(
      'This monitor has no one-time code secret named "LoginCode".',
    );
  });

  test("leaves a reference to a secret the run has no code for as written", async () => {
    const outcome: Run = await run(
      `return { data: "{{monitorSecrets.LoginCode}}" };`,
      {},
    );

    expect(outcome.result.returnValue).toEqual({
      data: "{{monitorSecrets.LoginCode}}",
    });
  });
});
