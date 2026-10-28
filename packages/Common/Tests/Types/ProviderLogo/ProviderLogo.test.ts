import { describe, expect, test } from "@jest/globals";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
  PROVIDER_LOGO_NAMES,
  getProviderLogoName,
  isProviderLogo,
} from "../../../Types/ProviderLogo/ProviderLogo";

/*
 * The logos of other companies' products the product shows (official logos
 * audit): every logo has the name it is read out as, the names are the
 * products' own, and the values are the file names in
 * Common/UI/Images/ProviderLogos.
 */

const FILE_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("ProviderLogo", () => {
  test("every logo is listed once", () => {
    expect(ALL_PROVIDER_LOGOS.length).toBe(Object.values(ProviderLogo).length);
    expect(new Set(ALL_PROVIDER_LOGOS).size).toBe(ALL_PROVIDER_LOGOS.length);
  });

  test.each(ALL_PROVIDER_LOGOS)(
    "%s is a file name: lower case words joined by hyphens, never -dark",
    (logo: ProviderLogo) => {
      expect(logo).toMatch(FILE_NAME);
      // A "-dark" file is a logo's mark for dark backgrounds, not a logo.
      expect(logo.endsWith("-dark")).toBe(false);
    },
  );

  test.each(ALL_PROVIDER_LOGOS)(
    "%s has the name it is read out as",
    (logo: ProviderLogo) => {
      const name: string = PROVIDER_LOGO_NAMES[logo];

      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
      expect(getProviderLogoName(logo)).toBe(name);
    },
  );

  test("no two logos are read out with the same name", () => {
    const names: Array<string> = ALL_PROVIDER_LOGOS.map(
      (logo: ProviderLogo): string => {
        return PROVIDER_LOGO_NAMES[logo];
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test("names are the products' own, as their makers write them", () => {
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.AmazonS3]).toBe("Amazon S3");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.IncidentIo]).toBe("incident.io");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.MinIO]).toBe("MinIO");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.UptimeRobot]).toBe("UptimeRobot");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.DotNet]).toBe(".NET");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.NodeJs]).toBe("Node.js");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.Aws]).toBe("Amazon Web Services");
    expect(PROVIDER_LOGO_NAMES[ProviderLogo.AtlassianStatuspage]).toBe(
      "Statuspage",
    );
  });

  test("isProviderLogo knows a logo from anything else", () => {
    expect(isProviderLogo(ProviderLogo.Slack)).toBe(true);
    expect(isProviderLogo("slack")).toBe(true);
    expect(isProviderLogo("Slack")).toBe(false);
    expect(isProviderLogo("slack-dark")).toBe(false);
    expect(isProviderLogo("")).toBe(false);
    expect(isProviderLogo(undefined)).toBe(false);
    expect(isProviderLogo(null)).toBe(false);
    expect(isProviderLogo(42)).toBe(false);
    expect(isProviderLogo({})).toBe(false);
  });

  test("a value that is not a logo has no name", () => {
    expect(getProviderLogoName("not-a-logo")).toBe("");
    expect(getProviderLogoName(undefined)).toBe("");
    // An object's own keys are not logos.
    expect(getProviderLogoName("constructor")).toBe("");
    expect(getProviderLogoName("toString")).toBe("");
  });
});
