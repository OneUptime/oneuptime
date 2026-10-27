import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import VideoCallProviderLogo, {
  VIDEO_CALL_PROVIDER_LOGOS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderLogo";
import ToolImportLogo from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportLogo";
import { TOOL_IMPORT_LOGOS } from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportBrand";
import CloudConnectionLogo from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionLogo";
import LlmConnectionLogo from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionLogo";
import { WORKSPACE_CONNECTION_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionCopy";
import SetupChecklistTile from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/SetupChecklistTile";
import {
  SetupStep,
  SetupStepImportance,
  SetupStepStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import { DEVELOPER_DOCS_PAGES } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionCatalog } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import IconProp from "../../../Types/Icon/IconProp";
import { LlmConnectionCatalog } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import ProviderLogo, {
  isProviderLogo,
} from "../../../Types/ProviderLogo/ProviderLogo";
import ToolImportSource, {
  AllToolImportSources,
} from "../../../Types/ToolImport/ToolImportSource";
import VideoCallProvider, {
  AllVideoCallProviders,
  getVideoCallProviderDisplayName,
} from "../../../Types/VideoCall/VideoCallProvider";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { getProviderLogoTileSizeClassName } from "../../../UI/Components/ProviderLogo/ProviderLogoImage";
import { PROVIDER_ICON_TILE_TEST_ID } from "../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";

/*
 * The Dashboard's surfaces that name another company's product, each with
 * that product's official logo (official logos audit): video calls, Import
 * from another tool, Cloud and AI / LLM Connect, the workspace pages, the
 * setup checklist and the Developer pages' Terraform. Each was a generic
 * icon, an initial on a coloured square, or a hand-drawn mark.
 */

afterEach(() => {
  cleanup();
});

function logoIn(element: Element): Element | null {
  return element.querySelector("[data-provider-logo]");
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

describe("video calls", () => {
  test("Zoom, Google Meet, Microsoft Teams and a Slack huddle each have their product's logo; a meeting link none", () => {
    expect(VIDEO_CALL_PROVIDER_LOGOS).toEqual({
      [VideoCallProvider.Zoom]: ProviderLogo.Zoom,
      [VideoCallProvider.GoogleMeet]: ProviderLogo.GoogleMeet,
      [VideoCallProvider.MicrosoftTeams]: ProviderLogo.MicrosoftTeams,
      [VideoCallProvider.SlackHuddle]: ProviderLogo.Slack,
    });
    expect(
      VIDEO_CALL_PROVIDER_LOGOS[VideoCallProvider.CustomLink],
    ).toBeUndefined();
  });

  test.each(AllVideoCallProviders)(
    "%s is named after the call, and shows its logo or a link",
    (provider: VideoCallProvider) => {
      render(<VideoCallProviderLogo provider={provider} />);

      const mark: HTMLElement = screen.getByTestId(
        `video-call-logo-${provider}`,
      );

      // The image is named after the call ("Slack huddle"), not only the brand.
      expect(mark).toHaveAttribute("role", "img");
      expect(mark).toHaveAttribute(
        "aria-label",
        getVideoCallProviderDisplayName(provider),
      );

      const logo: ProviderLogo | undefined = VIDEO_CALL_PROVIDER_LOGOS[provider];

      if (logo) {
        expect(logoIn(mark)).toHaveAttribute("data-provider-logo", logo);
        // Named once, by the outer image: the logo inside is decorative.
        expect(logoIn(mark)).toHaveAttribute("aria-hidden", "true");
      } else {
        expect(logoIn(mark)).toBeNull();
        expect(
          mark.querySelector(`[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
        ).not.toBeNull();
      }
    },
  );

  test("a pasted Zoom link reads as Zoom", () => {
    render(
      <VideoCallProviderLogo
        provider={VideoCallProvider.CustomLink}
        joinUrl="https://acme.zoom.us/j/123456789"
      />,
    );

    const mark: HTMLElement = screen.getByTestId("video-call-logo-Zoom");

    expect(logoIn(mark)).toHaveAttribute("data-provider-logo", "zoom");
    expect(mark).toHaveAttribute("aria-label", "Zoom");
  });

  test.each([
    ["sm", 24],
    ["md", 36],
    ["lg", 44],
  ] as Array<["sm" | "md" | "lg", 24 | 36 | 44]>)(
    "the %s size is a %i pixel tile",
    (size: "sm" | "md" | "lg", pixels: 24 | 36 | 44) => {
      render(
        <VideoCallProviderLogo provider={VideoCallProvider.GoogleMeet} size={size} />,
      );

      expect(
        classesOf(logoIn(screen.getByTestId("video-call-logo-GoogleMeet"))!),
      ).toEqual(
        expect.arrayContaining(
          getProviderLogoTileSizeClassName(pixels).split(" "),
        ),
      );
    },
  );
});

describe("Import from another tool", () => {
  test("every tool has its official logo; Splunk On-Call and Grafana OnCall their makers'", () => {
    for (const source of AllToolImportSources) {
      expect({ source, isLogo: isProviderLogo(TOOL_IMPORT_LOGOS[source]) }).toEqual({
        source,
        isLogo: true,
      });
    }

    expect(TOOL_IMPORT_LOGOS[ToolImportSource.SplunkOnCall]).toBe(
      ProviderLogo.Splunk,
    );
    expect(TOOL_IMPORT_LOGOS[ToolImportSource.GrafanaOnCall]).toBe(
      ProviderLogo.Grafana,
    );
    expect(TOOL_IMPORT_LOGOS[ToolImportSource.AtlassianStatuspage]).toBe(
      ProviderLogo.AtlassianStatuspage,
    );
  });

  test.each(AllToolImportSources)(
    "%s's tile is its logo, decorative: the tool's name is beside it",
    (source: ToolImportSource) => {
      render(<ToolImportLogo source={source} />);

      const tile: HTMLElement = screen.getByTestId(`tool-import-logo-${source}`);

      expect(logoIn(tile)).toHaveAttribute(
        "data-provider-logo",
        TOOL_IMPORT_LOGOS[source],
      );
      expect(logoIn(tile)).toHaveAttribute("aria-hidden", "true");
      // No initial on a coloured square any more.
      expect(tile.querySelector("text")).toBeNull();
      expect(classesOf(logoIn(tile)!)).toEqual(
        expect.arrayContaining(getProviderLogoTileSizeClassName(36).split(" ")),
      );
    },
  );

  test("the large tile is 44 pixels", () => {
    render(<ToolImportLogo source={ToolImportSource.PagerDuty} size="lg" />);

    expect(
      classesOf(
        logoIn(screen.getByTestId("tool-import-logo-PagerDuty"))!,
      ),
    ).toEqual(
      expect.arrayContaining(getProviderLogoTileSizeClassName(44).split(" ")),
    );
  });

  test("a tool this build has no logo for is drawn as an import, on the same tile", () => {
    render(<ToolImportLogo source={"NoSuchTool" as ToolImportSource} />);

    const tile: HTMLElement = screen.getByTestId("tool-import-logo-NoSuchTool");

    expect(logoIn(tile)).toBeNull();
    expect(
      tile.querySelector(`[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
    ).not.toBeNull();
  });
});

describe("Cloud > Connect", () => {
  test.each(CloudConnectionCatalog)(
    "$title shows its cloud's logo, decorative",
    (definition: { provider: CloudProvider; logo: ProviderLogo }) => {
      render(<CloudConnectionLogo provider={definition.provider} />);

      const mark: HTMLElement = screen.getByTestId(
        `cloud-connection-logo-${definition.provider}`,
      );

      expect(logoIn(mark)).toHaveAttribute("data-provider-logo", definition.logo);
      expect(logoIn(mark)).toHaveAttribute("aria-hidden", "true");
      // Not a white cloud on the provider's colour any more.
      expect(mark.querySelector(".bg-orange-600")).toBeNull();
      expect(mark.querySelector(".text-white")).toBeNull();
    },
  );

  test.each([
    ["sm", 24],
    ["md", 32],
    ["lg", 40],
  ] as Array<["sm" | "md" | "lg", 24 | 32 | 40]>)(
    "the %s size is a %i pixel tile",
    (size: "sm" | "md" | "lg", pixels: 24 | 32 | 40) => {
      render(<CloudConnectionLogo provider={CloudProvider.AWS} size={size} />);

      expect(
        classesOf(logoIn(screen.getByTestId("cloud-connection-logo-aws"))!),
      ).toEqual(
        expect.arrayContaining(
          getProviderLogoTileSizeClassName(pixels).split(" "),
        ),
      );
    },
  );

  test("a cloud this build does not know is a cloud on the same tile", () => {
    render(<CloudConnectionLogo provider="oracle" />);

    const mark: HTMLElement = screen.getByTestId("cloud-connection-logo-oracle");

    expect(logoIn(mark)).toBeNull();
    expect(
      mark.querySelector(`[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
    ).not.toBeNull();
  });
});

describe("AI / LLM > Connect", () => {
  test.each(LlmConnectionCatalog)(
    "$title shows its product's logo, decorative",
    (definition: { provider: LlmConnectionProvider; logo: ProviderLogo }) => {
      render(<LlmConnectionLogo provider={definition.provider} />);

      const mark: HTMLElement = screen.getByTestId(
        `llm-connection-logo-${definition.provider}`,
      );

      expect(logoIn(mark)).toHaveAttribute("data-provider-logo", definition.logo);
      expect(logoIn(mark)).toHaveAttribute("aria-hidden", "true");
    },
  );

  test("a provider this build does not know is AI's sparkles on the same tile", () => {
    render(<LlmConnectionLogo provider={undefined} />);

    const mark: HTMLElement = screen.getByTestId("llm-connection-logo-unknown");

    expect(logoIn(mark)).toBeNull();
    expect(
      mark.querySelector(`[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
    ).not.toBeNull();
  });
});

describe("the workspaces", () => {
  test("Slack and Microsoft Teams carry their official logos", () => {
    expect(WORKSPACE_CONNECTION_COPY[WorkspaceType.Slack].logo).toBe(
      ProviderLogo.Slack,
    );
    expect(WORKSPACE_CONNECTION_COPY[WorkspaceType.MicrosoftTeams].logo).toBe(
      ProviderLogo.MicrosoftTeams,
    );
  });
});

describe("the setup checklist", () => {
  function slackStep(status: SetupStepStatus): SetupStep {
    return {
      key: "slack",
      title: "Connect Slack",
      description: "Get notified in Slack.",
      detail: "",
      status,
      importance: SetupStepImportance.Optional,
      icon: IconProp.Slack,
      iconBackgroundClassName: "bg-fuchsia-500",
      logo: ProviderLogo.Slack,
      pageMap: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
      actionTitle: "Connect Slack",
    };
  }

  test("a Slack step to do shows Slack's logo, not a white glyph on fuchsia", () => {
    render(<SetupChecklistTile step={slackStep(SetupStepStatus.Incomplete)} />);

    const tile: HTMLElement = screen.getByTestId("setup-checklist-step-slack");

    expect(logoIn(tile)).toHaveAttribute("data-provider-logo", "slack");
    expect(logoIn(tile)).toHaveAttribute("aria-hidden", "true");
    expect(tile.querySelector(".bg-fuchsia-500")).toBeNull();
  });

  test("a done step shows the green check, as every done step does", () => {
    render(<SetupChecklistTile step={slackStep(SetupStepStatus.Complete)} />);

    const tile: HTMLElement = screen.getByTestId("setup-checklist-step-slack");

    expect(logoIn(tile)).toBeNull();
    expect(tile.querySelector(".bg-emerald-100 svg")).not.toBeNull();
  });
});

describe("the Developer pages", () => {
  test("Terraform's menu entry draws Terraform's own mark, not a cube", () => {
    const terraform: { title: string; icon: IconProp } | undefined =
      DEVELOPER_DOCS_PAGES.find((page: { title: string }): boolean => {
        return page.title === "Terraform";
      });

    expect(terraform?.icon).toBe(IconProp.Terraform);
  });
});
