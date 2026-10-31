import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as React from "react";

/*
 * THE TEAMS SETUP GUIDE, FOR THE MICROSOFT CLOUD THIS SERVER'S TEAMS IS IN.
 *
 * A server without its Microsoft Teams app shows the setup guide
 * (MicrosoftTeamsIntegrationDocumentation). Its Step 2 sends the admin to
 * the Azure portal of the server's cloud - Azure Government's for GCC High
 * and DoD, where such a tenant's app registration must be made - and, on a
 * server not set to one of those, names Azure Government's portal beside
 * it, before the app is made. Its settings explain MICROSOFT_TEAMS_CLOUD
 * and say what this server is set to. A value that names no cloud stops
 * every Microsoft Teams request on the server, so the guide quotes it and
 * says Teams is off, rather than name the commercial cloud its links fall
 * back to.
 */

const mockCloud: { setting: string | null } = { setting: null };

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  // A getter after the spread, so each test's setting is read live.
  Object.defineProperty(mockedConfig, "MicrosoftTeamsCloudSetting", {
    configurable: true,
    enumerable: true,
    get: (): string | null => {
      return mockCloud.setting;
    },
  });

  return mockedConfig;
});

import MicrosoftTeamsIntegrationDocumentation, {
  getServerCloudSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation";
import MicrosoftTeamsCloudUtil, {
  MicrosoftTeamsCloud,
} from "../../../Types/Workspace/MicrosoftTeamsCloud";

/*
 * The guide's markdown, as it lands in the DOM: react-markdown is mocked to
 * a div holding its source.
 */
const renderGuide: (setting: string | null) => Promise<string> = async (
  setting: string | null,
): Promise<string> => {
  mockCloud.setting = setting;

  render(<MicrosoftTeamsIntegrationDocumentation />);

  const markdown: HTMLElement = await screen.findByTestId("react-markdown");

  return markdown.textContent || "";
};

// The settings line that explains MICROSOFT_TEAMS_CLOUD.
const cloudLine: (text: string) => string = (text: string): string => {
  return (
    text.split("\n").find((line: string): boolean => {
      return line.startsWith("- `MICROSOFT_TEAMS_CLOUD`");
    }) || ""
  );
};

afterEach(() => {
  mockCloud.setting = null;
});

// Step 2's first line on a server in the commercial cloud or GCC.
const COMMERCIAL_PORTAL_STEP: string =
  "1. Go to the [Azure Portal](https://portal.azure.com) (the [Azure Government portal](https://portal.azure.us) for a GCC High or DoD tenant)";

// And on a server in GCC High or DoD.
const GOVERNMENT_PORTAL_STEP: string =
  "1. Go to the [Azure Government portal](https://portal.azure.us)";

// What the settings line says of every server, before its own value.
const SETTING_EXPLAINED: string =
  "- `MICROSOFT_TEAMS_CLOUD` (`cloud`): only for a Microsoft 365 tenant in a US Government cloud: `gcc`, `gcc-high` or `dod`. Leave it unset for the commercial cloud.";

describe("the Microsoft Teams setup guide, in each Microsoft cloud", () => {
  test.each([
    { setting: null, step: COMMERCIAL_PORTAL_STEP, said: "" },
    { setting: "", step: COMMERCIAL_PORTAL_STEP, said: "" },
    { setting: "  ", step: COMMERCIAL_PORTAL_STEP, said: "" },
    {
      setting: "commercial",
      step: COMMERCIAL_PORTAL_STEP,
      said: " This server is set to **Commercial**.",
    },
    {
      setting: "gcc",
      step: COMMERCIAL_PORTAL_STEP,
      said: " This server is set to **GCC**.",
    },
    {
      setting: "gcc-high",
      step: GOVERNMENT_PORTAL_STEP,
      said: " This server is set to **GCC High**.",
    },
    // Read as the server reads it: the names Microsoft gives a cloud.
    {
      setting: "GCC High",
      step: GOVERNMENT_PORTAL_STEP,
      said: " This server is set to **GCC High**.",
    },
    {
      setting: "dod",
      step: GOVERNMENT_PORTAL_STEP,
      said: " This server is set to **DoD**.",
    },
  ])(
    "MICROSOFT_TEAMS_CLOUD=$setting: Step 2 opens the cloud's portal, and the settings line says what the server is set to",
    async (cloud: { setting: string | null; step: string; said: string }) => {
      const text: string = await renderGuide(cloud.setting);

      expect(text.split("\n")).toContain(cloud.step);
      expect(cloudLine(text)).toBe(SETTING_EXPLAINED + cloud.said);
      expect(getServerCloudSentence(cloud.setting)).toBe(cloud.said);
    },
  );

  /*
   * A GCC High or DoD tenant's app registration is made in Azure
   * Government. An admin reads that at Step 2, before making it - not at
   * Step 7, after making it in the commercial cloud.
   */
  test("on a server not yet set to a US Government cloud, Step 2 names Azure Government's portal before the app is made", async () => {
    const text: string = await renderGuide(null);
    const lines: Array<string> = text.split("\n");
    const portalAt: number = lines.indexOf(COMMERCIAL_PORTAL_STEP);

    expect(portalAt).toBeGreaterThan(-1);
    expect(portalAt).toBeLessThan(
      lines.indexOf(
        '2. Navigate to "App registrations" and click "New registration"',
      ),
    );
    expect(portalAt).toBeLessThan(
      lines.findIndex((line: string): boolean => {
        return line.startsWith("##### Step 7");
      }),
    );
  });

  test("a value that names no cloud: the guide quotes it, and says Teams is off until it is changed", async () => {
    const text: string = await renderGuide("gcc-hihg");

    expect(cloudLine(text)).toBe(
      SETTING_EXPLAINED +
        " This server's value, `gcc-hihg`, names no Microsoft cloud, so Microsoft Teams is off until you change it.",
    );
    expect(cloudLine(text)).not.toContain("This server is set to");
    // Only a link: the commercial cloud's portal, as the Dashboard's links fall back.
    expect(text.split("\n")).toContain(COMMERCIAL_PORTAL_STEP);
  });

  test.each([
    // A stray quote from an env file is what the server reads, and shows.
    {
      setting: '"gcc-high"',
      said: ' This server\'s value, `"gcc-high"`, names no Microsoft cloud, so Microsoft Teams is off until you change it.',
    },
    // A value a code span cannot hold, or too long to read, is not quoted.
    {
      setting: "gcc`high",
      said: " This server's value names no Microsoft cloud, so Microsoft Teams is off until you change it.",
    },
    {
      setting: "gcc\nhigh",
      said: " This server's value names no Microsoft cloud, so Microsoft Teams is off until you change it.",
    },
    {
      setting: "x".repeat(65),
      said: " This server's value names no Microsoft cloud, so Microsoft Teams is off until you change it.",
    },
  ])(
    "a value that names no cloud ($setting) is quoted only when it can be read",
    (cloud: { setting: string; said: string }) => {
      expect(getServerCloudSentence(cloud.setting)).toBe(cloud.said);
    },
  );

  test("the values the settings line names are the server's US Government clouds, each read as that cloud", async () => {
    const line: string = cloudLine(await renderGuide(null));
    const listed: string = line.slice(
      line.indexOf("US Government cloud: ") + "US Government cloud: ".length,
      line.indexOf(". Leave it unset"),
    );

    // The code spans of "`gcc`, `gcc-high` or `dod`", in order.
    const values: Array<string> = listed
      .split("`")
      .filter((_part: string, index: number): boolean => {
        return index % 2 === 1;
      });

    expect(values).toEqual(
      MicrosoftTeamsCloudUtil.SETTING_VALUES.filter((value: string) => {
        return value !== MicrosoftTeamsCloud.Commercial;
      }),
    );

    for (const value of values) {
      expect(MicrosoftTeamsCloudUtil.read(value)).toBe(value);
    }
  });
});
