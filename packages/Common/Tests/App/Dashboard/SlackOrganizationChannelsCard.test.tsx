import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";

/*
 * The Slack Channels card of a project whose Slack connection is OneUptime
 * installed for a whole Slack Enterprise organization: the channels of
 * every workspace it was added to, each saying which workspace it is in -
 * two workspaces may each have a #general - and the card says it lists the
 * organization's workspaces. A project connected to one workspace sees the
 * card as before.
 */

let channels: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (options: { url: { toString: () => string } }) => {
        if (options.url.toString().endsWith("/slack/channels")) {
          return { data: { channels: channels } };
        }

        throw new Error(`Unexpected GET in test: ${options.url.toString()}`);
      },
      post: async () => {
        return { data: {} };
      },
      getFriendlyErrorMessage: () => {
        return "Something went wrong.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import SlackChannelsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackChannelsCard";

afterEach(() => {
  cleanup();
});

async function renderCard(list: Array<JSONObject>): Promise<void> {
  channels = list;

  await act(async () => {
    render(<SlackChannelsCard />);
  });

  await screen.findByText(`Channels (${list.length})`);
}

// Each row: the channel's name, and its workspace when it says one.
function rows(): Array<string> {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((row: HTMLElement): string => {
      const name: string =
        row.querySelector(".font-medium")?.textContent?.trim() || "";
      const workspace: string =
        within(row).queryByTestId("slack-channel-workspace")?.textContent || "";

      return workspace ? `${name} · ${workspace}` : name;
    });
}

describe("Slack Channels, installed for a whole organization", () => {
  test("each channel says its workspace, and the card says it lists the organization's", async () => {
    await renderCard([
      {
        id: "C0EASTGEN",
        name: "general",
        teamId: "T0EAST",
        workspaceName: "Acme East",
      },
      {
        id: "C0WESTGEN",
        name: "general",
        teamId: "T0WEST",
        workspaceName: "Acme West",
      },
      {
        id: "C0EASTINC",
        name: "incidents",
        teamId: "T0EAST",
        workspaceName: "Acme East",
      },
    ]);

    expect(rows()).toEqual([
      "general · Acme East",
      "general · Acme West",
      "incidents · Acme East",
    ]);
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Channels OneUptime can see in the workspaces of your Slack organization. Use these names when a notification rule posts to an existing channel. Use Send Test to confirm OneUptime can post to a channel.",
    );
    // Two #general rows, each its own Send Test, by the channel's id.
    expect(
      screen.getAllByRole("button", {
        name: /^Send test notification to #general/,
      }),
    ).toHaveLength(2);
  });

  test("the workspace's name sits under the channel's, in the name's block", async () => {
    await renderCard([
      {
        id: "C0EASTGEN",
        name: "general",
        teamId: "T0EAST",
        workspaceName: "Acme East",
      },
    ]);

    const workspace: HTMLElement = screen.getByTestId(
      "slack-channel-workspace",
    );

    expect(workspace).toHaveClass("truncate", "text-xs", "text-gray-500");
    // The same block as the name, whose floor keeps Send Test wrapping on a phone.
    expect(workspace.parentElement).toHaveClass("min-w-[8rem]", "flex-1");
    expect(workspace.parentElement).toContainElement(
      screen.getByText("general"),
    );
  });
});

describe("Slack Channels, connected to one workspace", () => {
  test("as before: no workspace under any channel, and the workspace's words", async () => {
    await renderCard([
      { id: "C0ALERTS", name: "alerts" },
      { id: "C0ONCALL", name: "on-call" },
    ]);

    expect(rows()).toEqual(["alerts", "on-call"]);
    expect(screen.queryByTestId("slack-channel-workspace")).toBeNull();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Channels OneUptime can see in your Slack workspace.",
    );
  });
});
