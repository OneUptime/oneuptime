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
 * and DoD, where such a tenant's app registration must be made - and its
 * settings explain MICROSOFT_TEAMS_CLOUD and say which cloud this server
 * is in. A value that names no cloud stops every Microsoft Teams request
 * on the server, so the guide says Teams is off rather than name the
 * commercial cloud its links fall back to.
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

import MicrosoftTeamsIntegrationDocumentation from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation";

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

describe("the Microsoft Teams setup guide, in each Microsoft cloud", () => {
  test.each([
    {
      setting: null,
      title: "Commercial",
      portal: "https://portal.azure.com",
    },
    {
      setting: "",
      title: "Commercial",
      portal: "https://portal.azure.com",
    },
    { setting: "gcc", title: "GCC", portal: "https://portal.azure.com" },
    {
      setting: "gcc-high",
      title: "GCC High",
      portal: "https://portal.azure.us",
    },
    // Read as the server reads it: the names Microsoft gives a cloud.
    {
      setting: "GCC High",
      title: "GCC High",
      portal: "https://portal.azure.us",
    },
    { setting: "dod", title: "DoD", portal: "https://portal.azure.us" },
  ])(
    "MICROSOFT_TEAMS_CLOUD=$setting: Step 2 opens $portal, and the guide names $title as this server's cloud",
    async (cloud: {
      setting: string | null;
      title: string;
      portal: string;
    }) => {
      const text: string = await renderGuide(cloud.setting);

      expect(text).toContain(`1. Go to the [Azure Portal](${cloud.portal})`);
      expect(cloudLine(text)).toContain(
        `This server's cloud: **${cloud.title}**.`,
      );
      // Where GCC High and DoD make their app, whatever this server's cloud.
      expect(cloudLine(text)).toContain(
        "make the app registration and the Azure Bot in [Azure Government's portal](https://portal.azure.us).",
      );
    },
  );

  test("a value that names no cloud: Teams is off until it does, and the guide names no cloud for this server", async () => {
    const text: string = await renderGuide("gcc-hihg");

    expect(cloudLine(text)).toContain(
      "This server's value names no Microsoft cloud, so Microsoft Teams is off until it does.",
    );
    expect(cloudLine(text)).not.toContain("This server's cloud:");
    // Only a link: the commercial cloud's portal, as the Dashboard's links fall back.
    expect(text).toContain(
      "1. Go to the [Azure Portal](https://portal.azure.com)",
    );
  });

  test("the setting's values are the ones the server takes", async () => {
    const text: string = await renderGuide(null);

    expect(cloudLine(text)).toContain(
      "only for Microsoft 365 in a US Government cloud - `gcc`, `gcc-high` or `dod`. Leave it unset for the commercial cloud.",
    );
  });
});
