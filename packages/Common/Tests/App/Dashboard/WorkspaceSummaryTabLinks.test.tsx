import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  WORKSPACE_PAGE_TAB_PARAM,
  WORKSPACE_SUMMARY_TAB,
  WORKSPACE_SUMMARY_TAB_NAME,
  getWorkspacePageInitialTabName,
  getWorkspaceSummaryTabQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTab";
import Tabs from "../../../UI/Components/Tabs/Tabs";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";

/*
 * A LINK TO A WORKSPACE NOTIFICATION SUMMARY OPENS ITS PAGE ON THE SUMMARY
 * TAB (#11020).
 *
 * A summary lives on the Summary tab of its workspace's Incidents or Alerts
 * page - Slack, Microsoft Teams or Mattermost. The duplicate-name warning
 * and Project Settings' list of names held twice link it there with
 * ?tab=summary (UniqueNames/RecordPages); each of the six pages opens on
 * that tab when its address asks, and on its first tab otherwise.
 */

const PAGES: ReadonlyArray<string> = [
  "Incidents/WorkspaceConnectionSlack.tsx",
  "Incidents/WorkspaceConnectionMicrosoftTeams.tsx",
  "Incidents/WorkspaceConnectionMattermost.tsx",
  "Alerts/WorkspaceConnectionSlack.tsx",
  "Alerts/WorkspaceConnectionMicrosoftTeams.tsx",
  "Alerts/WorkspaceConnectionMattermost.tsx",
];

const PAGES_FOLDER: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages",
);

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the address", () => {
  test("asks for the Summary tab with ?tab=summary", () => {
    expect(WORKSPACE_PAGE_TAB_PARAM).toBe("tab");
    expect(WORKSPACE_SUMMARY_TAB).toBe("summary");
    expect(getWorkspaceSummaryTabQuery()).toEqual({ tab: "summary" });
  });

  test("a page asked for it opens on Summary; otherwise on its first tab", () => {
    const query: jest.SpyInstance = getJestSpyOn(
      Navigation,
      "getQueryStringByName",
    );

    query.mockReturnValue("summary");
    expect(getWorkspacePageInitialTabName()).toBe(WORKSPACE_SUMMARY_TAB_NAME);
    expect(query).toHaveBeenCalledWith("tab");

    for (const value of [null, "", "Summary", "incidents", "summary "]) {
      query.mockReturnValue(value);
      expect({ value, tab: getWorkspacePageInitialTabName() }).toEqual({
        value,
        tab: undefined,
      });
    }
  });
});

describe("the tabs", () => {
  test("open on Summary when the address asks", () => {
    getJestSpyOn(Navigation, "getQueryStringByName").mockReturnValue("summary");

    render(
      <Tabs
        label="Slack"
        tabs={[
          { name: "Incidents", children: <p>The incident rules.</p> },
          { name: "Incident Episodes", children: <p>The episode rules.</p> },
          { name: "Summary", children: <p>The summaries.</p> },
        ]}
        initialTabName={getWorkspacePageInitialTabName()}
        onTabChange={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("The summaries.")).toBeInTheDocument();
    expect(screen.queryByText("The incident rules.")).toBeNull();
  });

  test("open on the first tab otherwise", () => {
    getJestSpyOn(Navigation, "getQueryStringByName").mockReturnValue(null);

    render(
      <Tabs
        label="Slack"
        tabs={[
          { name: "Incidents", children: <p>The incident rules.</p> },
          { name: "Summary", children: <p>The summaries.</p> },
        ]}
        initialTabName={getWorkspacePageInitialTabName()}
        onTabChange={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Incidents" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("The incident rules.")).toBeInTheDocument();
  });
});

describe("the six pages", () => {
  test.each(PAGES)(
    "%s holds its summaries under the Summary tab, and opens on it when asked",
    (page: string) => {
      const source: string = fs.readFileSync(
        path.join(PAGES_FOLDER, page),
        "utf-8",
      );

      // Its summaries, under the tab the link names.
      expect(source).toContain(`name: "${WORKSPACE_SUMMARY_TAB_NAME}",`);
      const summaryTab: string = source.slice(
        source.indexOf(`name: "${WORKSPACE_SUMMARY_TAB_NAME}",`),
      );
      expect(summaryTab).toContain("<WorkspaceSummaryTable");

      // Its tabs open where the address asks.
      expect(source).toContain(
        "initialTabName={getWorkspacePageInitialTabName()}",
      );
      expect(source.match(/<Tabs\b/g)).toHaveLength(1);
    },
  );
});
