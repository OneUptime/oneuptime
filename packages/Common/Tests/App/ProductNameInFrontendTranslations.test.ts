import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { i18n as I18nInstance } from "i18next";

/*
 * Each frontend that shows the product to the people using it - the
 * Dashboard, Accounts (sign-in, sign-up) and status pages - registers the
 * product-name post-processor with its own i18next instance, so on an
 * installation that goes by another name every translated sentence names it,
 * in every language. The Admin Dashboard does not: that is where the
 * installation's operators manage the OneUptime license, and its license
 * notices name the licensor.
 *
 * Each frontend's real i18n module is loaded the way the browser loads it -
 * after env.js has set PRODUCT_BRANDING - in a fresh module registry, so it
 * initialises its own i18next with what env.js said.
 */

const FEATURE_SET_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const ACME: string = JSON.stringify({ productName: "Acme" });

const setBranding: (value: string | null) => void = (
  value: string | null,
): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
};

const whenInitialized: (i18n: I18nInstance) => Promise<void> = async (
  i18n: I18nInstance,
): Promise<void> => {
  if (i18n.isInitialized) {
    return;
  }

  await new Promise<void>((resolve: () => void) => {
    i18n.on("initialized", () => {
      resolve();
    });
  });
};

// A frontend's i18n module, loaded fresh with the branding env.js carries.
const loadFrontendI18n: (
  frontend: "Accounts" | "StatusPage",
  branding: string | null,
) => Promise<I18nInstance> = async (
  frontend: "Accounts" | "StatusPage",
  branding: string | null,
): Promise<I18nInstance> => {
  setBranding(branding);
  window.localStorage.clear();

  let i18n: I18nInstance | null = null;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    i18n = require(
      path.join(FEATURE_SET_DIR, frontend, "src", "Utils", "i18n.ts"),
    ).default as I18nInstance;
  });

  await whenInitialized(i18n as unknown as I18nInstance);
  await (i18n as unknown as I18nInstance).changeLanguage("en");

  return i18n as unknown as I18nInstance;
};

afterEach(() => {
  setBranding(null);
});

describe("Accounts", () => {
  test("names the installation in its sentences when it goes by another name", async () => {
    const i18n: I18nInstance = await loadFrontendI18n("Accounts", ACME);

    expect(i18n.t("register.title")).toBe("Create your Acme account");

    await i18n.changeLanguage("de");
    expect(i18n.t("register.title")).toBe("Erstellen Sie Ihr Acme-Konto");
  });

  test("says OneUptime otherwise, exactly as written", async () => {
    const i18n: I18nInstance = await loadFrontendI18n("Accounts", null);

    expect(i18n.t("register.title")).toBe("Create your OneUptime account");
  });

  test("a branding with no name of its own (a logo only) changes no sentence", async () => {
    const i18n: I18nInstance = await loadFrontendI18n(
      "Accounts",
      JSON.stringify({ logoUrl: "/api/branding/logo?v=1" }),
    );

    expect(i18n.t("register.title")).toBe("Create your OneUptime account");
  });
});

describe("status pages", () => {
  test("say 'Powered by' the installation's name, in every language", async () => {
    const i18n: I18nInstance = await loadFrontendI18n("StatusPage", ACME);

    expect(i18n.t("footer.poweredBy")).toBe("Powered by Acme");

    await i18n.changeLanguage("fr");
    expect(i18n.t("footer.poweredBy")).toBe("Propulsé par Acme");

    await i18n.changeLanguage("ja");
    expect(i18n.t("footer.poweredBy")).toBe("Acme によって提供");
  });

  test("say 'Powered by OneUptime' otherwise", async () => {
    const i18n: I18nInstance = await loadFrontendI18n("StatusPage", null);

    expect(i18n.t("footer.poweredBy")).toBe("Powered by OneUptime");
  });
});

describe("the wiring in each frontend's i18n module", () => {
  const read: (frontend: string) => string = (frontend: string): string => {
    return fs.readFileSync(
      path.join(FEATURE_SET_DIR, frontend, "src", "Utils", "i18n.ts"),
      "utf8",
    );
  };

  test.each(["Dashboard", "Accounts", "StatusPage"])(
    "%s registers the post-processor and turns it on from env.js",
    (frontend: string) => {
      const source: string = read(frontend);

      expect(source).toContain(".use(productNamePostProcessor)");
      expect(source).toContain("postProcess: getProductNamePostProcess()");
    },
  );

  test("the Admin Dashboard does not: its license notices name OneUptime", () => {
    const source: string = read("AdminDashboard");

    expect(source).not.toContain("productNamePostProcessor");
    expect(source).not.toContain("getProductNamePostProcess");
  });
});
