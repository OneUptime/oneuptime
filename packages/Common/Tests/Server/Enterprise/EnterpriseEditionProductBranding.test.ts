import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import { EnterpriseServerModuleShape } from "../../../Server/Enterprise/EnterpriseServerModule";
import logger from "../../../Server/Utils/Logger";
import { ProductBranding } from "../../../Types/Branding/ProductBranding";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";

/*
 * EnterpriseEdition.getProductBranding: how the installation names and shows
 * itself, as core asks it while it renders env.js, a page or an email.
 *
 * Core decides nothing about when the branding differs from OneUptime's; it
 * shows what the enterprise module hands it, held to what core can use:
 *   - the Community Edition, a module without the hook, a module answering
 *     null: OneUptime's own (null);
 *   - a module that throws: OneUptime's own, never an error, warned once;
 *   - an answer is sanitized: a name that could not be shown, a website that
 *     is not http(s) and an image anywhere but on this host never get out.
 */

let warnSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("EnterpriseEdition.getProductBranding", () => {
  test("is null on the Community Edition", () => {
    uninstallEnterpriseModule();

    expect(EnterpriseEdition.getProductBranding()).toBeNull();
  });

  test("is null when the module answers null", () => {
    installFakeEnterpriseModule({ productBranding: null });

    expect(EnterpriseEdition.getProductBranding()).toBeNull();
  });

  test("is null when the module has no say in it (an older module)", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    (fake as unknown as Record<string, unknown>)["getProductBranding"] =
      undefined;

    expect(EnterpriseEdition.getProductBranding()).toBeNull();
  });

  test("is what the module hands it", () => {
    const branding: ProductBranding = {
      productName: "Acme",
      websiteUrl: "https://acme.example",
      logoUrl: "/api/branding/logo?v=1",
      darkLogoUrl: "/api/branding/dark-logo?v=1",
      faviconUrl: "/api/branding/favicon?v=1",
      isLogoEmailSafe: true,
    };

    installFakeEnterpriseModule({ productBranding: branding });

    expect(EnterpriseEdition.getProductBranding()).toEqual(branding);
  });

  test("is {} when the module may brand but has nothing set", () => {
    installFakeEnterpriseModule({ productBranding: {} });

    expect(EnterpriseEdition.getProductBranding()).toEqual({});
  });

  test("never lets out what core cannot use", () => {
    installFakeEnterpriseModule({
      productBranding: {
        productName: "Acme <img src=x>",
        websiteUrl: "javascript:alert(1)",
        logoUrl: "https://evil.example/logo.png",
        faviconUrl: "//evil.example/favicon.ico",
      },
    });

    expect(EnterpriseEdition.getProductBranding()).toEqual({});
  });

  test("is null, never an error, when the module throws, and says so once", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      productBranding: { productName: "Acme" },
    });
    fake.productBrandingError = new Error("branding exploded");

    expect(EnterpriseEdition.getProductBranding()).toBeNull();
    expect(EnterpriseEdition.getProductBranding()).toBeNull();

    const warnings: Array<string> = warnSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(
      warnings.filter((warning: string): boolean => {
        return warning.includes("showing OneUptime's branding");
      }),
    ).toHaveLength(1);
  });

  test("follows the module at once: each ask is answered from what it says now", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      productBranding: { productName: "Acme" },
    });

    expect(EnterpriseEdition.getProductBranding()?.productName).toBe("Acme");

    fake.productBranding = null;

    expect(EnterpriseEdition.getProductBranding()).toBeNull();
  });
});

describe("the module contract", () => {
  test("getProductBranding may be left out", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    (fake as unknown as Record<string, unknown>)["getProductBranding"] =
      undefined;

    expect(EnterpriseServerModuleShape.findProblems(fake)).toEqual([]);
  });

  test("getProductBranding, when present, must be a function", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    (fake as unknown as Record<string, unknown>)["getProductBranding"] = "Acme";

    expect(EnterpriseServerModuleShape.findProblems(fake)).toEqual([
      '"getProductBranding", when present, must be a function',
    ]);
  });
});
