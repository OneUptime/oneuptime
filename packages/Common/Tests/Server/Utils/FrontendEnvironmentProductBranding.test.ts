import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { ProductBranding } from "../../../Types/Branding/ProductBranding";

/*
 * env.js carries the installation's branding to every frontend as one key,
 * PRODUCT_BRANDING - and only when the enterprise module says it may differ
 * from OneUptime's. Without it the key is not there at all, so a frontend
 * served by a Community Edition, or by an Enterprise Edition that shows
 * OneUptime's branding, carries no trace of it.
 */

interface BrowserWindow {
  process?: {
    env?: Record<string, unknown>;
  };
}

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function renderWith(options: {
  enterpriseLoaded: boolean;
  productBranding?: ProductBranding | null;
}): Promise<{ script: string; env: Record<string, unknown> }> {
  jest.resetModules();

  const { getFrontendEnvironmentScript } = await import(
    "../../../Server/Utils/FrontendEnvironment"
  );
  const enterpriseKit: typeof import("../Enterprise/FakeEnterpriseModule") =
    await import("../Enterprise/FakeEnterpriseModule");

  if (options.enterpriseLoaded) {
    enterpriseKit.installFakeEnterpriseModule({
      productBranding: options.productBranding,
    });
  } else {
    enterpriseKit.uninstallEnterpriseModule();
  }

  const script: string = getFrontendEnvironmentScript();
  const browserWindow: BrowserWindow = {};

  new Function("window", script)(browserWindow);

  return { script, env: browserWindow.process?.env || {} };
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("PRODUCT_BRANDING in env.js", () => {
  test("is absent on the Community Edition", async () => {
    const { env, script } = await renderWith({ enterpriseLoaded: false });

    expect(env).not.toHaveProperty("PRODUCT_BRANDING");
    expect(script).not.toContain("PRODUCT_BRANDING");
  });

  test("is absent when the enterprise module shows OneUptime's branding", async () => {
    const { env, script } = await renderWith({
      enterpriseLoaded: true,
      productBranding: null,
    });

    expect(env).not.toHaveProperty("PRODUCT_BRANDING");
    expect(script).not.toContain("PRODUCT_BRANDING");
  });

  test("is {} when the installation may brand itself and has set nothing", async () => {
    const { env } = await renderWith({
      enterpriseLoaded: true,
      productBranding: {},
    });

    expect(env["PRODUCT_BRANDING"]).toBe("{}");
  });

  test("carries the branding as one JSON string the frontends read back", async () => {
    const branding: ProductBranding = {
      productName: 'Acme "Cloud" & Co',
      websiteUrl: "https://acme.example",
      logoUrl: "/api/branding/logo?v=1",
      faviconUrl: "/api/branding/favicon?v=1",
    };

    const { env } = await renderWith({
      enterpriseLoaded: true,
      productBranding: branding,
    });

    expect(JSON.parse(env["PRODUCT_BRANDING"] as string)).toEqual(branding);
  });

  test("keeps a name that looks like script inert: it is data inside a string", async () => {
    const { env } = await renderWith({
      enterpriseLoaded: true,
      productBranding: { productName: "Acme'; alert(1); //" },
    });

    expect(JSON.parse(env["PRODUCT_BRANDING"] as string)).toEqual({
      productName: "Acme'; alert(1); //",
    });
  });
});
