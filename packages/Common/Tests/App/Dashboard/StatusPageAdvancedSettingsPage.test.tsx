import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A status page's Advanced -> Advanced Settings page, wired: the one "What
 * your status page shows" card for this page, then the Overall Uptime
 * Percent and Downtime Monitor Statuses cards, then its JSON export, then
 * Archive, last. It used to be six cards with an Edit dialog each before the
 * Archive card, and the JSON export lived on a page no menu linked to. The
 * two uptime cards came from Branding's Overview Page screen when the
 * Branding section became one page: they are about what the page shows, not
 * how it looks.
 *
 * The cards are recorded rather than drawn (each has a suite of its own);
 * what matters here is what the page hands them, in what order, and that
 * nothing else is on it.
 */

type Recorded = { name: string; props: Record<string, unknown> };

// The two cards with an Edit dialog, by their analytics names.
const OVERALL_UPTIME_CARD: string = "Status Page > Settings";
const DOWNTIME_STATUSES_CARD: string =
  "Status Page > Branding > Downtime Monitor Statuses";

const recorded: Array<Recorded> = [];

(
  globalThis as unknown as { __advancedSettingsRecorded: Array<Recorded> }
).__advancedSettingsRecorded = recorded;

type Recorder = (
  name: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (name: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      globalThis as unknown as { __advancedSettingsRecorded: Array<Recorded> }
    ).__advancedSettingsRecorded.push({ name: name, props: props });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card":
        name === "card-model-detail"
          ? `${name}: ${String(props["name"])}`
          : name,
    });
  };
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCard",
  () => {
    return { __esModule: true, default: mockRecorder("display-settings") };
  },
);

jest.mock("../../../UI/Components/ImportExport/ExportModelCard", () => {
  return { __esModule: true, default: mockRecorder("export") };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return { __esModule: true, default: mockRecorder("archive") };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

import StatusPageSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

beforeEach(() => {
  recorded.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<StatusPageSettings {...PAGE_PROPS} />);
  });
}

function propsOf(name: string): Record<string, unknown> {
  const card: Recorded | undefined = recorded.find((entry: Recorded) => {
    return entry.name === name;
  });

  expect(card).toBeDefined();

  return card!.props;
}

function detailCard(name: string): Record<string, unknown> {
  const card: Recorded | undefined = recorded.find((entry: Recorded) => {
    return entry.name === "card-model-detail" && entry.props["name"] === name;
  });

  expect([name, Boolean(card)]).toEqual([name, true]);

  return card!.props;
}

function formColumns(props: Record<string, unknown>): Array<string> {
  return (props["formFields"] as Array<{ field: Record<string, unknown> }>).map(
    (field: { field: Record<string, unknown> }): string => {
      return Object.keys(field.field)[0] || "";
    },
  );
}

describe("Advanced Settings", () => {
  test("is what the page shows, the uptime % and downtime statuses, its export, then Archive, in that order", async () => {
    await renderPage();

    expect(
      screen
        .getAllByTestId("recorded-card")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-card");
        }),
    ).toEqual([
      "display-settings",
      `card-model-detail: ${OVERALL_UPTIME_CARD}`,
      `card-model-detail: ${DOWNTIME_STATUSES_CARD}`,
      "export",
      "archive",
    ]);
  });

  test("the What your status page shows card is for this status page", async () => {
    await renderPage();

    expect(
      (propsOf("display-settings")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("exports this status page", async () => {
    await renderPage();

    const props: Record<string, unknown> = propsOf("export");

    expect(props["modelType"]).toBe(StatusPage);
    expect((props["modelId"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
  });

  test("archives this status page, with the status page's own words, back to the list", async () => {
    await renderPage();

    const props: Record<string, unknown> = propsOf("archive");

    expect(props["modelType"]).toBe(StatusPage);
    expect((props["modelId"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(props["singularName"]).toBe(STATUS_PAGE_ARCHIVE_COPY.singularName);
    expect(props["archiveCardDescription"]).toBe(
      STATUS_PAGE_ARCHIVE_COPY.archiveCardDescription,
    );
    expect(props["unarchiveCardDescription"]).toBe(
      STATUS_PAGE_ARCHIVE_COPY.unarchiveCardDescription,
    );
    expect(props["archiveConfirmMessage"]).toBe(
      STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage,
    );
    expect(props["unarchiveConfirmMessage"]).toBe(
      STATUS_PAGE_ARCHIVE_COPY.unarchiveConfirmMessage,
    );
    expect((props["listRoute"] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/status-pages`,
    );
  });

  test("the only cards with an Edit dialog are the two that came from Branding's Overview Page", async () => {
    await renderPage();

    expect(
      recorded
        .filter((entry: Recorded) => {
          return entry.name === "card-model-detail";
        })
        .map((entry: Recorded): unknown => {
          return entry.props["name"];
        }),
    ).toEqual([OVERALL_UPTIME_CARD, DOWNTIME_STATUSES_CARD]);
  });

  test("Overall Uptime Percent: whether the page shows it, and to how many decimals, for this page", async () => {
    await renderPage();

    const props: Record<string, unknown> = detailCard(OVERALL_UPTIME_CARD);

    expect((props["cardProps"] as Record<string, unknown>)["title"]).toBe(
      "Overall Uptime Percent",
    );
    expect(formColumns(props)).toEqual([
      "showOverallUptimePercentOnStatusPage",
      "overallUptimePercentPrecision",
    ]);

    const detail: Record<string, unknown> = props["modelDetailProps"] as Record<
      string,
      unknown
    >;

    expect(detail["modelType"]).toBe(StatusPage);
    expect((detail["modelId"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
  });

  test("Downtime Monitor Statuses: which statuses count against uptime, for this page", async () => {
    await renderPage();

    const props: Record<string, unknown> = detailCard(DOWNTIME_STATUSES_CARD);

    expect((props["cardProps"] as Record<string, unknown>)["title"]).toBe(
      "Downtime Monitor Statuses",
    );
    expect(props["editButtonText"]).toBe("Edit Statuses");
    expect(formColumns(props)).toEqual(["downtimeMonitorStatuses"]);

    const detail: Record<string, unknown> = props["modelDetailProps"] as Record<
      string,
      unknown
    >;

    expect(detail["modelType"]).toBe(StatusPage);
    expect((detail["modelId"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    // Its own id: it was "default-bar-color", the bar color card's, beside it.
    expect(detail["id"]).toBe("downtime-monitor-statuses");
  });
});
