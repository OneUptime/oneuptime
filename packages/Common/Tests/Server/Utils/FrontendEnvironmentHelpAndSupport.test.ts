import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { FrontendEnvironmentOptions } from "../../../Server/Utils/FrontendEnvironment";
import {
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
} from "../../../Types/HelpAndSupport/HelpAndSupport";

/*
 * env.js SAYS WHERE THE SERVER SENDS ITS PEOPLE FOR HELP - TO THE DASHBOARD
 * AND THE SIGN-IN PAGES ONLY, AND ONLY WHAT ANYBODY MAY READ (#10864-#10866).
 *
 * Every place's choice rides in env.js under HELP_AND_SUPPORT, so a page
 * knows it before it draws and an error screen knows it however the page
 * broke. env.js is served to anybody, so it carries the support address and
 * the help page - shown on the sign-in pages anyway - but never a chat link
 * or the mobile app's page. A server that never changed a place serves
 * env.js exactly as before: no key at all. Status pages, public dashboards
 * and the Admin Dashboard never carry it.
 */

interface BrowserWindow {
  process?: {
    env?: Record<string, unknown>;
  };
}

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function render(
  options?: FrontendEnvironmentOptions,
): Promise<{ script: string; env: Record<string, unknown> }> {
  jest.resetModules();

  const { getFrontendEnvironmentScript } = await import(
    "../../../Server/Utils/FrontendEnvironment"
  );
  const enterpriseKit: typeof import("../Enterprise/FakeEnterpriseModule") =
    await import("../Enterprise/FakeEnterpriseModule");

  enterpriseKit.uninstallEnterpriseModule();

  const script: string = getFrontendEnvironmentScript(options);
  const browserWindow: BrowserWindow = {};

  new Function("window", script)(browserWindow);

  return { script, env: browserWindow.process?.env || {} };
}

const ownSettings: () => HelpAndSupportSettings =
  (): HelpAndSupportSettings => {
    const settings: HelpAndSupportSettings =
      getDefaultHelpAndSupportSettings();

    settings[HelpItem.SupportEmail] = {
      choice: HelpChoice.Email,
      value: "it-help@example.com",
    };
    settings[HelpItem.HelpLink] = {
      choice: HelpChoice.Link,
      value: "https://intranet.example.com/help",
    };
    settings[HelpItem.Chat] = {
      choice: HelpChoice.Link,
      value: "https://join.slack.com/t/acme/shared_invite/zt-very-secret",
    };
    settings[HelpItem.MobileApp] = {
      choice: HelpChoice.Link,
      value: "https://portal.example.com/apps/oneuptime",
    };
    settings[HelpItem.RequestDemo] = { choice: HelpChoice.Hidden, value: null };
    settings[HelpItem.GitHub] = { choice: HelpChoice.Hidden, value: null };
    settings[HelpItem.GiveFeedback] = {
      choice: HelpChoice.Email,
      value: "feedback@example.com",
    };
    settings[HelpItem.InviteMessage] = {
      choice: HelpChoice.Text,
      value: "Ask the IT service desk.",
    };

    return settings;
  };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("HELP_AND_SUPPORT in env.js", () => {
  test("is absent when no route hands it in, as on a standalone frontend server", async () => {
    const { env, script } = await render();

    expect(env).not.toHaveProperty("HELP_AND_SUPPORT");
    expect(script).not.toContain("HELP_AND_SUPPORT");
  });

  test("is absent while every place is on its default: env.js reads as before", async () => {
    for (const frontend of ["/dashboard", "/accounts"]) {
      const { env, script } = await render({
        frontend: frontend,
        helpAndSupport: getDefaultHelpAndSupportSettings(),
      });

      expect(env).not.toHaveProperty("HELP_AND_SUPPORT");
      expect(script).not.toContain("HELP_AND_SUPPORT");
    }
  });

  test.each(["/dashboard", "dashboard", "/accounts", "accounts"])(
    "is carried to %s, with every choice and only the values anybody may read",
    async (frontend: string) => {
      const { env, script } = await render({
        frontend: frontend,
        helpAndSupport: ownSettings(),
      });

      expect(JSON.parse(env["HELP_AND_SUPPORT"] as string)).toEqual({
        supportEmail: { choice: "email", value: "it-help@example.com" },
        chat: { choice: "link" },
        helpLink: {
          choice: "link",
          value: "https://intranet.example.com/help",
        },
        requestDemo: { choice: "hidden" },
        mobileApp: { choice: "link" },
        gitHub: { choice: "hidden" },
      });

      // A workspace invitation, the app's page, feedback and the message stay off env.js.
      expect(script).not.toContain("zt-very-secret");
      expect(script).not.toContain("portal.example.com");
      expect(script).not.toContain("feedback@example.com");
      expect(script).not.toContain("Ask the IT service desk.");
    },
  );

  test.each(["/admin", "/status-page", "/public-dashboard", "/unknown"])(
    "is never carried to %s",
    async (frontend: string) => {
      const { env, script } = await render({
        frontend: frontend,
        helpAndSupport: ownSettings(),
      });

      expect(env).not.toHaveProperty("HELP_AND_SUPPORT");
      expect(script).not.toContain("it-help@example.com");
      expect(script).not.toContain("intranet.example.com");
    },
  );

  test("needs both the frontend and the settings", async () => {
    expect(
      (await render({ frontend: "/dashboard", helpAndSupport: null })).env,
    ).not.toHaveProperty("HELP_AND_SUPPORT");
    expect(
      (await render({ helpAndSupport: ownSettings() })).env,
    ).not.toHaveProperty("HELP_AND_SUPPORT");
  });
});
