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
 * your status page shows" card for this page, then its JSON export, then
 * Archive, last. It used to be six cards with an Edit dialog each before the
 * Archive card, and the JSON export lived on a page no menu linked to. Two
 * more cards with an Edit dialog - Overall Uptime Percent and Downtime
 * Monitor Statuses, from Branding's Overview Page screen - sat under the
 * card until they became rows of its uptime row, where the number of days
 * the uptime covers already was.
 *
 * The cards are recorded rather than drawn (each has a suite of its own);
 * what matters here is what the page hands them, in what order, and that
 * nothing else is on it.
 */

type Recorded = { name: string; props: Record<string, unknown> };

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

describe("Advanced Settings", () => {
  test("is what the page shows, its export, then Archive, in that order", async () => {
    await renderPage();

    expect(
      screen
        .getAllByTestId("recorded-card")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-card");
        }),
    ).toEqual(["display-settings", "export", "archive"]);
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

  /*
   * The overall uptime % and the downtime statuses are rows of the card's
   * uptime row (its own suite draws them): no card here opens a dialog, so
   * no card holds a column the project's plan may not change beside one it
   * may.
   */
  test("has no card with an Edit dialog", async () => {
    await renderPage();

    expect(
      recorded.filter((entry: Recorded) => {
        return entry.name === "card-model-detail";
      }),
    ).toEqual([]);
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  test("the card it hands the status page to is the only one about what the page shows", async () => {
    await renderPage();

    expect(
      recorded
        .map((entry: Recorded): string => {
          return entry.name;
        })
        .filter((name: string): boolean => {
          return name === "display-settings";
        }),
    ).toHaveLength(1);
  });
});
