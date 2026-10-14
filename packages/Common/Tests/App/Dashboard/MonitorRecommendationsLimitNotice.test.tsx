import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * MONITOR RECOMMENDATIONS AT THE PLAN'S LIMIT ON ACTIVE MONITORS.
 *
 * Every recommended monitor is an active monitor (a Host, Kubernetes,
 * Docker ... monitor), so a project with no room under its plan's limit can
 * create none of them. The create panel says so above its form - with the
 * same notice Create Monitor shows: which limit, how many, what to do, the
 * plan a click away - and its Create button stays off, instead of starting a
 * batch whose every row the server refuses in the same three sentences.
 * The page reads the limit as the panel opens and again when Create is
 * pressed, before any row is seeded; with room left the batch runs as
 * before, and the server holds each create to the limit.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import MonitorRecommendationCreateSideOver from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateSideOver";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
} from "../../../Types/Monitor/ActiveMonitorLimit";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorRecommendation } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

const onSubmitMock: MockFunction = getJestMockFunction();

const RECOMMENDATION: MonitorRecommendation = {
  recommendationId: "Host:host-high-cpu",
  recommendationType: "Monitor",
  resourceType: "Host",
  monitorType: MonitorType.Host,
  templateId: "host-high-cpu",
  name: "High CPU",
  description: "CPU above 90% for 5 minutes.",
  category: "Resources",
  severity: "Critical",
  getMonitorStep: () => {
    throw new Error("Not built in this test.");
  },
} as unknown as MonitorRecommendation;

const OVER: ActiveMonitorLimitStatus = {
  limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
  activeMonitors: 2881,
};

function renderPanel(limitReached?: ActiveMonitorLimitStatus): void {
  render(
    <MemoryRouter>
      <MonitorRecommendationCreateSideOver
        selectedRecommendations={[RECOMMENDATION]}
        resourceLabel="Host"
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        incidentSeverityOptions={[]}
        alertSeverityOptions={[]}
        isCreating={false}
        limitReached={limitReached}
        onClose={() => {}}
        onSubmit={(...args: Array<unknown>) => {
          onSubmitMock(...args);
        }}
      />
    </MemoryRouter>,
  );
}

function createButton(): HTMLElement {
  return screen.getByRole("button", { name: "Create Monitors" });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/hosts`);
  onSubmitMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the create panel at the plan's limit", () => {
  test("says so above the form, with the plan a click away", () => {
    renderPanel(OVER);

    const notice: HTMLElement = screen.getByTestId(
      "active-monitor-limit-notice",
    );

    expect(notice).toHaveTextContent("You're over your plan's monitor limit");
    expect(notice).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 2,881.",
    );
    expect(notice).toHaveTextContent(
      "To add more, delete monitors you no longer need or change your plan.",
    );
    expect(
      within(notice).getByRole("link", { name: "View plan" }),
    ).toHaveAttribute("href", routeFor(PageMap.SETTINGS_BILLING));

    // First in the panel: before the question the form starts with.
    const question: HTMLElement = screen.getByText("When one of these fires");
    expect(
      notice.compareDocumentPosition(question) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps Create off, so nothing is started", () => {
    renderPanel(OVER);

    expect(createButton()).toBeDisabled();

    fireEvent.click(createButton());

    expect(onSubmitMock).not.toHaveBeenCalled();
  });

  test("with room - or a limit it could not read - the panel is as it was", () => {
    renderPanel(undefined);

    expect(screen.queryByTestId("active-monitor-limit-notice")).toBeNull();
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());

    expect(onSubmitMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * The page's half, held against its source: the limit is read as the panel
 * opens and again in the create handler - after the billing consent, before
 * the first row is seeded - and a project with no room starts nothing.
 */
describe("the page reads the limit before a batch starts", () => {
  const COMMENTS: RegExp = /\/\*[\s\S]*?\*\//g;

  const page: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendations.tsx",
      ),
      "utf8",
    )
    .replace(COMMENTS, "");

  const handler: string =
    page.split("const createMonitors:")[1]?.split("type DismissFunction")[0] ||
    "";

  test("in the create handler: after the billing consent, before any row is seeded", () => {
    const consent: number = handler.indexOf(
      "setActionError(MONITOR_CONSENT_ERROR);",
    );
    const limit: number = handler.indexOf("await readLimit()");
    const seed: number = handler.indexOf(
      "MonitorRecommendationCreateRunner.getInitialProgress(",
    );

    expect(consent).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(consent);
    expect(seed).toBeGreaterThan(limit);

    // At the limit it returns before anything is created.
    const limitBranch: string = handler.slice(limit, seed);
    expect(limitBranch).toContain("if (limitStatus) {");
    expect(limitBranch).toContain("return;");
    expect(limitBranch).not.toContain("createOrUpdate");
  });

  test("as the panel opens - from either Create button - and handed to it", () => {
    const opener: string =
      page.split("const openCreatePanel:")[1]?.split("};")[0] || "";

    expect(opener).toContain("setShowCreateSideOver(true);");
    expect(opener).toContain("setLimitReached(null);");
    expect(opener).toContain("readLimit()");

    // Every read goes through one place, where the newest answer wins.
    const reader: string =
      page.split("const readLimit:")[1]?.split("const [projectDefaults")[0] ||
      "";
    expect(reader).toContain("await readActiveMonitorLimitIfReached()");
    expect(reader).toContain("sequence === limitReadSequence.current");
    expect(reader).toContain("setLimitReached(status);");
    expect(page.split("readActiveMonitorLimitIfReached()").length - 1).toBe(1);

    // Both buttons open it this way, and nothing opens it any other way.
    expect(page.split("openCreatePanel").length - 1).toBe(3);
    expect(page.split("setShowCreateSideOver(true)").length - 1).toBe(1);

    expect(page).toContain("limitReached={limitReached || undefined}");
  });
});
