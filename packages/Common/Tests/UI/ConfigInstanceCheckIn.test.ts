import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DAILY CHECK-IN, AS A PAGE READS IT.
 *
 * A self-hosted sign-up form offers release emails from oneuptime.com only
 * while the install's daily check-in is on (Accounts' Register page). The
 * page read that setting, and whether billing is on, from the server's
 * configuration (Server/EnvironmentConfig), which brought all of it - every
 * setting the server reads and what it reads them with - into the sign-up
 * page's first load: some 6 KB gzipped. It reads both from its own now
 * (UI/Config), which the server fills from the same settings (env.js, the
 * server's FRONTEND_ENV_ALLOW_LIST).
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

const KEYS: ReadonlyArray<string> = [
  "DISABLE_INSTANCE_CHECK_IN",
  "BILLING_ENABLED",
];

const saved: Record<string, string | undefined> = {};

for (const key of KEYS) {
  saved[key] = process.env[key];
}

interface PageConfig {
  DISABLE_INSTANCE_CHECK_IN: boolean;
  BILLING_ENABLED: boolean;
}

/*
 * UI/Config as a page loads it, with the settings the server handed it (in
 * a test, the page's process.env is the one jsdom shares with Node).
 */
const readConfig: (env: Record<string, string>) => PageConfig = (
  env: Record<string, string>,
): PageConfig => {
  for (const key of KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, env);

  let config: PageConfig | undefined;

  jest.isolateModules(() => {
    config = jest.requireActual(
      path.join(COMMON_ROOT, "UI/Config"),
    ) as PageConfig;
  });

  return config!;
};

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("the daily check-in, as a page reads it", () => {
  test("is off when the install turns it off", () => {
    expect(
      readConfig({ DISABLE_INSTANCE_CHECK_IN: "true" })
        .DISABLE_INSTANCE_CHECK_IN,
    ).toBe(true);
  });

  test.each([["false"], [""], ["yes"]])(
    'is on for "%s", as the server reads it (only "true" turns it off)',
    (value: string) => {
      expect(
        readConfig({ DISABLE_INSTANCE_CHECK_IN: value })
          .DISABLE_INSTANCE_CHECK_IN,
      ).toBe(false);
    },
  );

  test("is on where the install says nothing", () => {
    expect(readConfig({}).DISABLE_INSTANCE_CHECK_IN).toBe(false);
  });

  test("billing is read from the page's configuration too", () => {
    expect(readConfig({ BILLING_ENABLED: "true" }).BILLING_ENABLED).toBe(true);
    expect(readConfig({}).BILLING_ENABLED).toBe(false);
  });

  test("the server hands the page both settings (env.js), as it reads them itself", () => {
    const serverConfig: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Server/EnvironmentConfig.ts"),
      "utf8",
    );
    const listStart: number = serverConfig.indexOf(
      "const FRONTEND_ENV_ALLOW_LIST",
    );
    const allowList: string = serverConfig.slice(
      listStart,
      serverConfig.indexOf("];", listStart),
    );

    expect(allowList).toContain('"DISABLE_INSTANCE_CHECK_IN"');
    expect(allowList).toContain('"BILLING_ENABLED"');
    expect(serverConfig).toContain(
      'process.env["DISABLE_INSTANCE_CHECK_IN"] === "true"',
    );
  });
});
