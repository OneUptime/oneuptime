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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
 *
 * Hiding the Powered by OneUptime line - an Enterprise feature few pages
 * use - waits folded under More settings, between what the page shows and
 * the export: "Please audit the entire project for advanced features just
 * like these and move them to More as well" - the maintainer. Folded, the
 * header names it, and says "Off" while the line is hidden; a link to
 * #powered-by-oneuptime opens it there.
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

/*
 * The Powered by OneUptime line has a card of its own, folded under More
 * settings: hiding it is an Enterprise feature, behind a core shell
 * EnterpriseSettingShells holds.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePoweredBySettings",
  () => {
    return { __esModule: true, default: mockRecorder("powered-by") };
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

import StatusPageSettings, {
  STATUS_PAGE_SETTINGS_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings";
import StatusPagePoweredByCopy, {
  STATUS_PAGE_POWERED_BY_PLACE,
  STATUS_PAGE_SETTINGS_MORE_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePoweredByCopy";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";
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
  test("is what the page shows, the Powered by line, its export, then Archive, in that order", async () => {
    await renderPage();

    expect(
      screen
        .getAllByTestId("recorded-card")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-card");
        }),
    ).toEqual(["display-settings", "powered-by", "export", "archive"]);
  });

  test("the What your status page shows card is for this status page", async () => {
    await renderPage();

    expect(
      (propsOf("display-settings")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("the Powered by OneUptime card, under it, is for this status page", async () => {
    await renderPage();

    expect((propsOf("powered-by")["statusPageId"] as ObjectID).toString()).toBe(
      STATUS_PAGE_ID,
    );
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

describe("the Powered by OneUptime line, under More settings", () => {
  function fold(): HTMLElement {
    return screen.getByTestId(STATUS_PAGE_SETTINGS_MORE_TEST_ID);
  }

  function header(): HTMLElement {
    return within(fold()).getByRole("button", { name: "More settings" });
  }

  // What the Powered by shell reads, handed to the page as the shell would.
  async function report(isShown: boolean): Promise<void> {
    const onPoweredByChange: (isShown: boolean) => void = propsOf("powered-by")[
      "onPoweredByChange"
    ] as (isShown: boolean) => void;

    await act(async () => {
      onPoweredByChange(isShown);
    });
  }

  function cardsIn(container: HTMLElement): Array<string | null> {
    return within(container)
      .getAllByTestId("recorded-card")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-card");
      });
  }

  afterEach(() => {
    window.history.replaceState(null, "", "#");
  });

  test("holds the Powered by card alone: what the page shows, the export and Archive stay outside", async () => {
    await renderPage();

    expect(cardsIn(fold())).toEqual(["powered-by"]);
    expect(fold()).not.toHaveTextContent("display-settings");
  });

  test("is folded, names the card it holds, and says what it holds once open", async () => {
    await renderPage();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(header())).toEqual([StatusPagePoweredByCopy.cardTitle]);
    expect(setChips(fold())).toEqual([]);

    fireEvent.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(fold()).toHaveTextContent(STATUS_PAGE_SETTINGS_MORE_DESCRIPTION);
  });

  test("the shell is handed a way to say whether visitors see the line", async () => {
    await renderPage();

    expect(typeof propsOf("powered-by")["onPoweredByChange"]).toBe("function");
  });

  test("while the line is shown - where every page starts - nothing is marked", async () => {
    await renderPage();
    await report(true);

    expect(setChips(fold())).toEqual([]);
  });

  test("while the line is hidden, folded, it says so: Powered by OneUptime: Off", async () => {
    await renderPage();
    await report(false);

    expect(setChips(fold())).toEqual([
      `${StatusPagePoweredByCopy.cardTitle}: Off`,
    ]);
    // Saying so does not open it.
    expect(header()).toHaveAttribute("aria-expanded", "false");

    // Shown again: no longer marked.
    await report(true);

    expect(setChips(fold())).toEqual([]);
  });

  test("opened at #powered-by-oneuptime, it opens there", async () => {
    expect(STATUS_PAGE_POWERED_BY_PLACE).toBe("powered-by-oneuptime");

    window.history.replaceState(null, "", `#${STATUS_PAGE_POWERED_BY_PLACE}`);

    await renderPage();

    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  test("opened at any other place, it stays folded", async () => {
    window.history.replaceState(null, "", "#what-your-status-page-shows");

    await renderPage();

    expect(header()).toHaveAttribute("aria-expanded", "false");
  });
});
