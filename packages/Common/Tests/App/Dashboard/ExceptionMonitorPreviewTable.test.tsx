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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE EXCEPTIONS MONITOR'S "MATCHING EXCEPTIONS" IS A FRAMED LIST, AS ITS
 * NEIGHBOURS' ARE.
 *
 * Create Monitor's criteria step draws its cards as the sections of the
 * card or dialog it is in, at every width (CardFormSections), and a card
 * drawn anywhere inside one of them is drawn as a section too. The
 * Exceptions monitor's preview - the list under the "Matching exceptions"
 * fold of "Exceptions to watch" - was an ExceptionInstanceTable in a card
 * titled "Matching exceptions". In the step that card became a rule and a
 * second "Matching exceptions" title in the middle of the section, its
 * rows unframed, where the Logs and Traces monitors show a framed list
 * right under their fold.
 *
 * The preview is now the table on its own (isMinimalTable): framed as a
 * table outside a card is, no title of its own - the fold names it - and
 * empty, it says so in the fold's words. Like the Logs and Traces
 * previews, it never reads the page's address: a filter or a page restored
 * from it would replace the monitor's own filters.
 *
 * The REAL table is mounted, through AnalyticsModelTable and BaseModelTable;
 * only the edges are stubbed (the analytics API, the project, the viewer,
 * translation).
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
      // The card title asks, to badge a table the plan does not include.
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectMember];
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: Permission }>;
      } => {
        return { permissions: [{ permission: Permission.ProjectMember }] };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ExceptionInstanceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable";
import ExceptionMonitorStepForm, {
  MATCHING_EXCEPTIONS_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm";
import Card from "../../../UI/Components/Card/Card";
import CardFormSections from "../../../UI/Components/Card/CardFormSections";
import { MODEL_TABLE_FRAME_CLASS_NAME } from "../../../UI/Components/ModelTable/BaseModelTable";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const FULL_STOP_AT_END: RegExp = /\.$/;

// What the monitor form's preview says while nothing matches its filters.
const PREVIEW_EMPTY_WORDS: string =
  "No exceptions match these filters right now.";

// What every other ExceptionInstanceTable still says.
const TABLE_EMPTY_WORDS: string = "No exception instances found.";

/*
 * The empty state draws its message as a title, without the full stop: the
 * words are found with or without it.
 */
const wordsPattern: (words: string) => RegExp = (words: string): RegExp => {
  return new RegExp(escapeRegExp(words.replace(FULL_STOP_AT_END, "")));
};

const PREVIEW_EMPTY_PATTERN: RegExp = wordsPattern(PREVIEW_EMPTY_WORDS);
const TABLE_EMPTY_PATTERN: RegExp = wordsPattern(TABLE_EMPTY_WORDS);

// The table's preferences key, which names its state in the page's address.
const TABLE_URL_STATE_KEY: string = "exception-instance-table";

interface ListRequest {
  skip: number;
}

// Every list request the table made, in order.
let listRequests: Array<ListRequest> = [];

beforeEach(() => {
  listRequests = [];
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/monitors/create`,
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  analyticsGetListMock.mockImplementation(
    async (request: ListRequest): Promise<ListResult<ExceptionInstance>> => {
      listRequests.push(request);
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );
  // The resolved and archived exceptions the preview leaves out: none.
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({} as never);
  // The merged exceptions it leaves out: never answered, which it outlives.
  jest.spyOn(API, "post").mockImplementation((): never => {
    return new Promise(() => {}) as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// The table's frame when it is drawn without a card.
function tableFrames(root: ParentNode = document): Array<Element> {
  return Array.from(
    root.querySelectorAll(`[class="${MODEL_TABLE_FRAME_CLASS_NAME}"]`),
  );
}

/*
 * Sorts the list by its Time column the other way round, as a click on the
 * header does, and waits for the list to be read again.
 */
async function sortByTime(root: HTMLElement): Promise<void> {
  const readsBefore: number = listRequests.length;
  const header: HTMLElement = within(root).getByRole("columnheader", {
    name: /Time/,
  });

  await act(async () => {
    fireEvent.click(within(header).getByRole("button"));
  });
  await waitFor(() => {
    expect(listRequests.length).toBeGreaterThan(readsBefore);
  });
}

async function mountTable(table: React.ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{table}</MemoryRouter>);
  });
  await waitFor(() => {
    expect(listRequests.length).toBeGreaterThan(0);
  });
}

/*
 * The Exceptions monitor's filters as Create Monitor draws them: in the
 * "Exceptions to watch" section of the criteria step (MonitorStep), with
 * its "Matching exceptions" fold opened.
 */
async function openPreviewInTheStep(): Promise<HTMLElement> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CardFormSections className="mt-5 space-y-6">
          <Card
            title="Exceptions to watch"
            description="The exceptions this monitor counts. A filter left empty matches every exception."
          >
            <ExceptionMonitorStepForm
              monitorStepExceptionMonitor={MonitorStepExceptionMonitorUtil.getDefault()}
              onMonitorStepExceptionMonitorChanged={() => {
                // Not what these tests read.
              }}
              telemetryServices={[]}
              telemetryEntities={[]}
            />
          </Card>
        </CardFormSections>
      </MemoryRouter>,
    );
  });

  const fold: HTMLElement = screen.getByTestId(
    "exception-monitor-matching-exceptions",
  );

  fireEvent.click(
    within(fold).getByRole("button", { name: MATCHING_EXCEPTIONS_TITLE }),
  );

  await waitFor(() => {
    expect(listRequests.length).toBeGreaterThan(0);
  });
  // The list has drawn its first page.
  await within(fold).findByTestId("table-scroll");

  return fold;
}

describe("ExceptionInstanceTable", () => {
  test("is a card of its own by default, with its title, as the service, incident and alert pages show it", async () => {
    await mountTable(
      <ExceptionInstanceTable
        title="Exceptions"
        description="Exceptions recorded by this service."
        query={{}}
      />,
    );

    const card: HTMLElement = screen.getByTestId("card");

    expect(within(card).getByTestId("card-details-heading")).toHaveTextContent(
      "Exceptions",
    );
    expect(tableFrames()).toHaveLength(0);
    expect(await screen.findByText(TABLE_EMPTY_PATTERN)).toBeInTheDocument();
  });

  test("isMinimalTable draws the table on its own: no card, no title, framed as a table outside a card is", async () => {
    await mountTable(
      <ExceptionInstanceTable
        isMinimalTable={true}
        noItemsMessage={PREVIEW_EMPTY_WORDS}
        query={{}}
      />,
    );

    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("card-details-heading"),
    ).not.toBeInTheDocument();

    const frames: Array<Element> = tableFrames();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContainElement(screen.getByTestId("table-scroll"));
  });

  test("says what it is given when nothing matches, and its own words otherwise", async () => {
    await mountTable(
      <ExceptionInstanceTable
        isMinimalTable={true}
        noItemsMessage={PREVIEW_EMPTY_WORDS}
        query={{}}
      />,
    );

    expect(await screen.findByText(PREVIEW_EMPTY_PATTERN)).toBeInTheDocument();
    expect(screen.queryByText(TABLE_EMPTY_PATTERN)).not.toBeInTheDocument();

    cleanup();
    listRequests = [];

    await mountTable(
      <ExceptionInstanceTable isMinimalTable={true} query={{}} />,
    );

    expect(await screen.findByText(TABLE_EMPTY_PATTERN)).toBeInTheDocument();
  });

  test("a table that keeps its state in the page's address reads its page from it", async () => {
    // The control for the preview's test below: the address is read by default.
    TableFilterUrlState.write(TABLE_URL_STATE_KEY, "view", { page: 3 });

    await mountTable(
      <ExceptionInstanceTable
        title="Exceptions"
        description="Exceptions recorded by this service."
        query={{}}
      />,
    );

    // Page 3 at the default page size of 10.
    expect(listRequests[0]?.skip).toBe(20);
  });

  test("a table that keeps its state in the page's address writes a sort there", async () => {
    // The control for the preview's test below: a sort is written by default.
    await mountTable(
      <ExceptionInstanceTable
        title="Exceptions"
        description="Exceptions recorded by this service."
        query={{}}
      />,
    );

    expect(window.location.search).toBe("");

    await sortByTime(document.body);

    expect(window.location.search).not.toBe("");
    expect(
      TableFilterUrlState.read(TABLE_URL_STATE_KEY, "view"),
    ).not.toBeNull();
  });
});

describe("the Exceptions monitor's Matching exceptions, in Create Monitor's criteria step", () => {
  test("adds no card to the step: the section is the one card, and the list is framed under the fold", async () => {
    const fold: HTMLElement = await openPreviewInTheStep();

    const cards: Array<HTMLElement> = screen.getAllByTestId("card");

    // The "Exceptions to watch" section alone.
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-card-surface", "form-section");
    expect(
      within(cards[0]!).getByTestId("card-details-heading"),
    ).toHaveTextContent("Exceptions to watch");

    // The list, framed, inside the fold.
    const frames: Array<Element> = tableFrames(fold);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContainElement(
      within(fold).getByTestId("table-scroll"),
    );
  });

  test("names the list once: the fold's title, with no second title under it", async () => {
    const fold: HTMLElement = await openPreviewInTheStep();

    expect(
      within(fold).getAllByText(MATCHING_EXCEPTIONS_TITLE, { exact: true }),
    ).toHaveLength(1);
    expect(
      within(fold).queryByTestId("card-details-heading"),
    ).not.toBeInTheDocument();
    // Nor the old card's description.
    expect(
      screen.queryByText("Exceptions matching the current monitor filters."),
    ).not.toBeInTheDocument();
  });

  test("empty, it says so in the fold's words", async () => {
    const fold: HTMLElement = await openPreviewInTheStep();

    expect(
      await within(fold).findByText(PREVIEW_EMPTY_PATTERN),
    ).toBeInTheDocument();
    expect(
      within(fold).queryByText(TABLE_EMPTY_PATTERN),
    ).not.toBeInTheDocument();
  });

  test("reads nothing of the page's address: a page kept there for the table does not move the preview", async () => {
    TableFilterUrlState.write(TABLE_URL_STATE_KEY, "view", { page: 3 });

    await openPreviewInTheStep();

    // The first page, not page 3.
    expect(listRequests[0]?.skip).toBe(0);
  });

  test("writes nothing to the page's address, even when it is sorted", async () => {
    const fold: HTMLElement = await openPreviewInTheStep();

    await sortByTime(fold);

    expect(window.location.search).toBe("");
  });
});

describe("the preview's empty words, in every language", () => {
  test.each([...DASHBOARD_LANGUAGES])(
    "%s words them, as its own sentence",
    (language: string) => {
      const words: string | undefined =
        readDashboardLocale(language)[PREVIEW_EMPTY_WORDS];

      expect(words).toBeTruthy();
      expect(words).not.toBe(PREVIEW_EMPTY_WORDS);
    },
  );

  test("English reads as written", () => {
    expect(readDashboardLocale("en")[PREVIEW_EMPTY_WORDS]).toBe(
      PREVIEW_EMPTY_WORDS,
    );
  });
});
