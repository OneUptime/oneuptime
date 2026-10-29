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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type { Mock } from "jest-mock";

/*
 * THE PIECES OF THE WATCHLISTS PAGES, drawn for real and driven as a person
 * drives them: a list's row cells, the common lists to start with, the
 * Import Values dialog, Use It in a Rule, and the line under a detection
 * rule's YAML that says which lists the rule reads.
 *
 * Pinned: a name always as rules write it, in the mono type, a long one
 * breaking after its underscores; what a list holds, its values and its
 * readers in words - under the name when the table folds its columns below
 * lg; a value's note with who added it, under the value when folded; a
 * starter created empty and kept by hand, with its description, the tiles
 * two to a row only where the card is wide enough; an import's preview as
 * it is typed, its request, what it did, and a failure in the dialog; a
 * missing list on a line of its own in red, with the way to make it -
 * Create Watchlist with its name - read again when the window comes back.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../UI/Utils/ModelAPI/ModelAPI",
  ) as { default: Record<string, unknown> };

  return {
    __esModule: true,
    default: {
      ...actual.default,
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
    },
  };
});

import DetectionRuleWatchlists from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/DetectionRuleWatchlists";
import {
  WatchlistHoldsCell,
  WatchlistHoldsColumnCell,
  WatchlistNameCell,
  WatchlistNameText,
  WatchlistReadByCell,
  WatchlistReadersList,
  WatchlistValueCell,
  WatchlistValueNoteCell,
  WatchlistValuesCell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistCells";
import WatchlistImportModal, {
  WATCHLIST_IMPORT_MODE_LABEL_ID,
  WATCHLIST_IMPORT_TEXT_HEADER_CLASS_NAME,
  describeWatchlistImportSummary,
  readWatchlistImportSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistImportModal";
import WatchlistRuleSnippet from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistRuleSnippet";
import WatchlistStarters, {
  WATCHLIST_STARTERS_CLASS_NAME,
  WATCHLIST_STARTER_GRID_CLASS_NAME,
  buildWatchlistFromStarter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistStarters";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import { WATCHLISTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import { WATCHLIST_STARTERS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsModel";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SecurityWatchlistImportMode,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const WATCHLIST_ID: string = "44444444-4444-4444-8444-444444444444";
const ENGLISH: Translator = createTranslator(undefined, "en");

function watchlist(data: Partial<SecurityWatchlist>): SecurityWatchlist {
  const item: SecurityWatchlist = new SecurityWatchlist();
  Object.assign(item, data);
  return item;
}

function listOf(items: Array<SecurityWatchlist>): {
  data: Array<SecurityWatchlist>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: items, count: items.length, skip: 0, limit: 200 };
}

function flat(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

// Drawn in a row of a table that leaves a column out below lg, as TableBody tells its cells.
function inFoldedRow(element: React.ReactElement): React.ReactElement {
  return (
    <TableCellContext.Provider value={true}>
      <TableFoldedColumnsContext.Provider value={true}>
        {element}
      </TableFoldedColumnsContext.Provider>
    </TableCellContext.Provider>
  );
}

beforeEach(() => {
  getListMock.mockReset();
  createMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a list's row", () => {
  test("its name as rules write it, in the mono type, and what it is for under it", () => {
    render(
      <WatchlistNameCell
        name="vip_users"
        description="  Executives and their assistants. "
      />,
    );

    const cell: HTMLElement = screen.getByTestId(WATCHLISTS_TEST_IDS.nameCell);
    const name: HTMLElement = within(cell).getByText("vip_users");

    // An isolate, so a name never takes a right-to-left page's direction.
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveClass("font-mono");
    expect(name).toHaveAttribute("dir", "ltr");
    expect(
      within(cell).getByText("Executives and their assistants."),
    ).not.toHaveClass("font-mono");
  });

  test("a name with no description is the name alone", () => {
    render(<WatchlistNameCell name="critical_hosts" description="   " />);

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameCell))).toBe(
      "critical_hosts",
    );
  });

  test("what it holds, in words", () => {
    render(<WatchlistHoldsCell entityType={SecurityEntityType.IpAddress} />);

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.holdsCell))).toBe(
      "IP addresses",
    );
  });

  test("how many values it keeps, and none in a quieter grey", () => {
    const { unmount } = render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.Values}
        valueCount={12}
      />,
    );

    const counted: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.valuesCell,
    );
    expect(flat(counted)).toBe("12 values");
    expect(counted).toHaveClass("text-gray-700");
    unmount();

    render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.Values}
        valueCount={0}
      />,
    );

    const empty: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.valuesCell,
    );
    expect(flat(empty)).toBe("No values yet");
    expect(empty).toHaveClass("text-gray-400");
  });

  test("a list that follows a feed names it as written; one whose feed is gone says so", () => {
    const { unmount } = render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.ThreatIntelFeed}
        valueCount={0}
        threatIntelFeedId={new ObjectID(WATCHLIST_ID)}
        feedName="Feodo Tracker C2"
      />,
    );

    const cell: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.valuesCell,
    );
    expect(flat(cell)).toBe("Follows Feodo Tracker C2");
    expect(within(cell).getByText("Feodo Tracker C2").tagName).toBe("BDI");
    unmount();

    render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.ThreatIntelFeed}
        threatIntelFeedId={undefined}
        feedName="Feodo Tracker C2"
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.valuesCell))).toBe(
      "Its threat intel feed was deleted",
    );
  });

  test("the rules that read it: the first two, then how many more", () => {
    render(
      <WatchlistReadByCell
        readers={[
          { id: "1", name: "VIP sign-in from a new country" },
          { id: "2", name: "VIP MFA reset" },
          { id: "3", name: "VIP token theft" },
        ]}
        isLoaded={true}
        hasError={false}
      />,
    );

    const cell: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.readByCell,
    );
    expect(
      within(cell).getByText("VIP sign-in from a new country"),
    ).toBeInTheDocument();
    expect(within(cell).getByText("VIP MFA reset")).toBeInTheDocument();
    expect(within(cell).queryByText("VIP token theft")).toBeNull();
    expect(within(cell).getByText("and 1 more")).toBeInTheDocument();
  });

  test("no rule, rules not read, and rules still being read each say their own", () => {
    const { rerender } = render(
      <WatchlistReadByCell readers={[]} isLoaded={true} hasError={false} />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByCell))).toBe(
      "No rule reads it yet",
    );

    rerender(
      <WatchlistReadByCell readers={[]} isLoaded={true} hasError={true} />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByCell))).toBe(
      "Couldn't load the rules",
    );

    rerender(
      <WatchlistReadByCell
        readers={undefined}
        isLoaded={false}
        hasError={false}
      />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByCell))).toBe("");
  });
});

describe("a list's row, below lg and on a phone", () => {
  const READERS: Array<{ id: string; name: string }> = [
    { id: "1", name: "VIP sign-in from a new country" },
    { id: "2", name: "VIP MFA reset" },
    { id: "3", name: "VIP token theft" },
  ];

  test("at lg and above the name says nothing the columns say", () => {
    render(
      <TableCellContext.Provider value={true}>
        <WatchlistNameCell
          name="vip_users"
          entityType={SecurityEntityType.User}
          values={{ source: SecurityWatchlistSource.Values, valueCount: 3 }}
          readers={{ readers: READERS, isLoaded: true, hasError: false }}
        />
      </TableCellContext.Provider>,
    );

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.nameFacts)).toBeNull();
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.nameReadBy)).toBeNull();
  });

  test("folded, what the list holds with its values, then the rules that read it, go under the name", () => {
    render(
      inFoldedRow(
        <WatchlistNameCell
          name="vip_users"
          description="Executives and their assistants."
          entityType={SecurityEntityType.User}
          values={{ source: SecurityWatchlistSource.Values, valueCount: 3 }}
          readers={{ readers: READERS, isLoaded: true, hasError: false }}
        />,
      ),
    );

    const facts: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.nameFacts,
    );

    // Real spaces around the dot, so it reads as two facts; the dot itself is not read out.
    expect(flat(facts)).toBe("Users · 3 values");
    expect(within(facts).getByText("·")).toHaveAttribute("aria-hidden", "true");
    // One line of text: a long feed's name wraps on after the dot.
    expect(facts).toHaveClass("block", "whitespace-normal");
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameReadBy))).toBe(
      "Read by: VIP sign-in from a new country, VIP MFA reset and 1 more",
    );
  });

  test("folded, a list that follows a feed names it, and one no rule reads says so", () => {
    render(
      inFoldedRow(
        <WatchlistNameCell
          name="c2_addresses"
          entityType={SecurityEntityType.IpAddress}
          values={{
            source: SecurityWatchlistSource.ThreatIntelFeed,
            threatIntelFeedId: new ObjectID(WATCHLIST_ID),
            feedName: "Feodo Tracker C2",
          }}
          readers={{ readers: [], isLoaded: true, hasError: false }}
        />,
      ),
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameFacts))).toBe(
      "IP addresses · Follows Feodo Tracker C2",
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameReadBy))).toBe(
      "No rule reads it yet",
    );
  });

  test("folded, rules still being read say nothing yet, and rules that could not be read say so", () => {
    const { rerender } = render(
      inFoldedRow(
        <WatchlistNameCell
          name="vip_users"
          entityType={SecurityEntityType.User}
          values={{ source: SecurityWatchlistSource.Values, valueCount: 0 }}
          readers={{ readers: undefined, isLoaded: false, hasError: false }}
        />,
      ),
    );

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.nameReadBy)).toBeNull();
    // No values yet, in the quieter grey a list's count has nowhere else.
    expect(
      within(screen.getByTestId(WATCHLISTS_TEST_IDS.nameFacts)).getByText(
        "No values yet",
      ),
    ).toHaveClass("text-gray-400");

    rerender(
      inFoldedRow(
        <WatchlistNameCell
          name="vip_users"
          entityType={SecurityEntityType.User}
          values={{ source: SecurityWatchlistSource.Values, valueCount: 0 }}
          readers={{ readers: undefined, isLoaded: true, hasError: true }}
        />,
      ),
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameReadBy))).toBe(
      "Couldn't load the rules",
    );
  });

  test("Holds: what the list holds, and its values under it, lined up with its name", () => {
    render(
      <WatchlistHoldsColumnCell
        entityType={SecurityEntityType.FileHash}
        source={SecurityWatchlistSource.Values}
        valueCount={1200}
      />,
    );

    const kind: HTMLElement = screen.getByTestId(WATCHLISTS_TEST_IDS.holdsCell);
    const values: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.valuesCell,
    );

    expect(flat(kind)).toBe("File hashes");
    // A long kind's name wraps in a narrow column ("Hachages de" / "fichiers").
    expect(kind).not.toHaveClass("whitespace-nowrap");
    expect(flat(values)).toBe("1,200 values");
    // Under the kind's words, not under its icon.
    expect(values.parentElement).toHaveClass("ps-[1.375rem]");
  });
});

describe("a long list name", () => {
  test("breaks after its underscores, and reads as written", () => {
    const name: string = "executive_assistants_and_finance_admin_accounts";

    const { container } = render(<WatchlistNameText name={name} />);
    const bdi: HTMLElement = container.querySelector("bdi")!;

    expect(bdi).toHaveAttribute("dir", "ltr");
    expect(bdi).toHaveClass("font-mono");
    expect(bdi.textContent).toBe(name);
    expect(bdi.querySelectorAll("wbr")).toHaveLength(5);
  });

  test("a short one stays whole", () => {
    const { container } = render(<WatchlistNameText name="vip_users" />);

    expect(container.querySelectorAll("wbr")).toHaveLength(0);
    expect(container.textContent).toBe("vip_users");
  });
});

describe("a value's row", () => {
  test("its note, with who added it and when under it", () => {
    render(
      <WatchlistValueNoteCell
        note="  The finance team's admin accounts. "
        addedBy="Maya Chen"
        createdAt={new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)}
      />,
    );

    const cell: HTMLElement = screen.getByTestId(WATCHLISTS_TEST_IDS.noteCell);
    const added: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.addedLine,
    );

    expect(cell).toHaveTextContent("The finance team's admin accounts.");
    expect(flat(added)).toBe("Added by Maya Chen 3 days ago");
    // The date whole is under the pointer.
    expect(added.getAttribute("title")).toBeTruthy();
    // Never the bold of the row's first column it may sit in.
    expect(cell).toHaveClass("font-normal");
  });

  test("a value with no note says only who added it; one an API key added says so", () => {
    render(<WatchlistValueNoteCell note="   " />);

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.noteCell))).toBe(
      "Added through the API",
    );
  });

  test("the value in the mono type; folded, its note goes under it", () => {
    const { unmount } = render(
      <TableCellContext.Provider value={true}>
        <WatchlistValueCell value="10.20.0.0/16" note="Office network" />
      </TableCellContext.Provider>,
    );

    expect(screen.getByText("10.20.0.0/16")).toHaveClass("font-mono");
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.noteCell)).toBeNull();
    unmount();

    render(
      inFoldedRow(
        <WatchlistValueCell value="10.20.0.0/16" note="Office network" />,
      ),
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.noteCell))).toBe(
      "Office networkAdded through the API",
    );
  });
});

describe("Read By on a list's page", () => {
  test("every rule that reads it, by name", () => {
    render(
      <WatchlistReadersList
        readers={[
          { id: "1", name: "Admin sign-in from outside" },
          { id: "2", name: "Admin MFA reset" },
          { id: "3", name: "Admin token theft" },
        ]}
        isLoaded={true}
        hasError={false}
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByLine))).toBe(
      "Admin sign-in from outside, Admin MFA reset, Admin token theft",
    );
  });

  test("no rule, rules that could not be read, and rules still being read", () => {
    const { rerender } = render(
      <WatchlistReadersList readers={[]} isLoaded={true} hasError={false} />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByLine))).toBe(
      "No rule reads it yet",
    );

    rerender(
      <WatchlistReadersList readers={[]} isLoaded={true} hasError={true} />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByLine))).toBe(
      "Couldn't load the rules",
    );

    rerender(
      <WatchlistReadersList
        readers={undefined}
        isLoaded={false}
        hasError={false}
      />,
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.readByLine))).toBe("…");
  });
});

describe("the common lists to start with", () => {
  async function renderStarters(onAdded: () => void = () => {}): Promise<void> {
    await act(async () => {
      render(
        <WatchlistStarters
          projectId={new ObjectID(PROJECT_ID)}
          onAdded={onAdded}
        />,
      );
    });
  }

  test("a starter is the list it names, empty, kept by hand, described in the reader's words", () => {
    const german: Translator = createTranslator((key: string) => {
      return key === WATCHLIST_STARTERS[0]!.description
        ? "Die wichtigsten Konten."
        : undefined;
    }, "de");

    const list: SecurityWatchlist = buildWatchlistFromStarter({
      starter: WATCHLIST_STARTERS[0]!,
      projectId: new ObjectID(PROJECT_ID),
      translator: german,
    });

    expect(list.projectId?.toString()).toBe(PROJECT_ID);
    expect(list.name).toBe("vip_users");
    expect(list.entityType).toBe(SecurityEntityType.User);
    expect(list.source).toBe(SecurityWatchlistSource.Values);
    expect(list.description).toBe("Die wichtigsten Konten.");
  });

  test("the project is offered the ones it does not have", async () => {
    getListMock.mockResolvedValue(
      listOf([watchlist({ name: "VIP_Users" }), watchlist({ name: "other" })]),
    );

    await renderStarters();

    const starters: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.starters,
    );

    expect(
      within(starters).queryByTestId(
        `${WATCHLISTS_TEST_IDS.starter}-vip-users`,
      ),
    ).toBeNull();

    for (const key of [
      "critical-hosts",
      "known-bad-hashes",
      "admin-addresses",
    ]) {
      expect(
        within(starters).getByTestId(`${WATCHLISTS_TEST_IDS.starter}-${key}`),
      ).toBeInTheDocument();
    }

    const tile: HTMLElement = within(starters).getByTestId(
      `${WATCHLISTS_TEST_IDS.starter}-admin-addresses`,
    );
    expect(
      within(tile).getByText("Allowed admin addresses"),
    ).toBeInTheDocument();
    expect(within(tile).getByText("admin_addresses")).toHaveClass("font-mono");
    expect(
      within(tile).getByText("IP addresses", { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(tile).getByText(
        "Where administrators may sign in from: offices, the VPN and bastion hosts.",
      ),
    ).toBeInTheDocument();

    // One read of the project's lists, by name.
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toMatchObject({
      modelType: SecurityWatchlist,
      select: { _id: true, name: true },
    });
  });

  test("nothing is offered while the lists are read, nor once the project has them all", async () => {
    let resolve: (value: unknown) => void = () => {};
    getListMock.mockImplementation(() => {
      return new Promise((done: (value: unknown) => void) => {
        resolve = done;
      });
    });

    await renderStarters();
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.starters)).toBeNull();

    await act(async () => {
      resolve(
        listOf(
          WATCHLIST_STARTERS.map((starter: { name: string }) => {
            return watchlist({ name: starter.name });
          }),
        ),
      );
    });

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.starters)).toBeNull();
  });

  test("lists that cannot be read offer nothing, rather than a list the project may have", async () => {
    getListMock.mockRejectedValue(new Error("offline"));

    await renderStarters();

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.starters)).toBeNull();
  });

  test("Add creates the list and says Added in its place", async () => {
    getListMock.mockResolvedValue(listOf([]));
    createMock.mockResolvedValue({});
    const onAdded: Mock<() => void> = jest.fn<() => void>();

    await renderStarters(onAdded);

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(
          `${WATCHLISTS_TEST_IDS.starter}-add-known-bad-hashes`,
        ),
      );
    });

    expect(createMock).toHaveBeenCalledTimes(1);

    const created: SecurityWatchlist = (
      createMock.mock.calls[0]![0] as { model: SecurityWatchlist }
    ).model;

    expect(created.name).toBe("known_bad_hashes");
    expect(created.entityType).toBe(SecurityEntityType.FileHash);
    expect(created.source).toBe(SecurityWatchlistSource.Values);
    expect(created.description).toBe(
      "Hashes of malware and tools you never want to see run.",
    );
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId(
        `${WATCHLISTS_TEST_IDS.starter}-added-known-bad-hashes`,
      ),
    ).toHaveTextContent("Added");
    expect(
      screen.queryByTestId(
        `${WATCHLISTS_TEST_IDS.starter}-add-known-bad-hashes`,
      ),
    ).toBeNull();
  });

  test("a create that fails says why, and the tile stays to try again", async () => {
    getListMock.mockResolvedValue(listOf([]));
    createMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { error: "This project already has a watchlist named vip_users." },
        {},
      ),
    );

    await renderStarters();

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(
          `${WATCHLISTS_TEST_IDS.starter}-add-vip-users`,
        ),
      );
    });

    // An alert over the tiles, not an empty list's quiet line.
    const alert: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.startersError,
    );

    expect(alert).toHaveTextContent(
      "This project already has a watchlist named vip_users.",
    );
    expect(
      screen.getByTestId(`${WATCHLISTS_TEST_IDS.starter}-add-vip-users`),
    ).toBeInTheDocument();

    // Closed with its x.
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button"));
    });

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.startersError)).toBeNull();
  });

  test("the tiles sit two to a row only where their card is wide enough, by the card's width", async () => {
    getListMock.mockResolvedValue(listOf([]));

    await renderStarters();

    const starters: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.starters,
    );

    expect(starters).toHaveClass(...WATCHLIST_STARTERS_CLASS_NAME.split(" "));
    expect(WATCHLIST_STARTERS_CLASS_NAME).toContain(
      "[container-type:inline-size]",
    );
    expect(within(starters).getByRole("list")).toHaveClass(
      ...WATCHLIST_STARTER_GRID_CLASS_NAME.split(" "),
    );
    expect(WATCHLIST_STARTER_GRID_CLASS_NAME).toBe(
      "grid grid-cols-1 gap-4 [@container(min-width:36rem)]:grid-cols-2",
    );
  });

  test("a role that cannot create lists sees the tiles, their Add locked", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Your role cannot create watchlists.",
    });
    getListMock.mockResolvedValue(listOf([]));

    await renderStarters();

    expect(
      await screen.findByTestId(`${WATCHLISTS_TEST_IDS.starter}-add-vip-users`),
    ).toBeDisabled();
  });
});

describe("Import Values", () => {
  function renderImport(
    options: {
      entityType?: SecurityEntityType;
      onClose?: () => void;
      onImported?: () => void;
    } = {},
  ): void {
    render(
      <WatchlistImportModal
        watchlistId={new ObjectID(WATCHLIST_ID)}
        entityType={options.entityType || SecurityEntityType.User}
        onClose={options.onClose || (() => {})}
        onImported={options.onImported || (() => {})}
      />,
    );
  }

  function type(text: string): void {
    fireEvent.change(screen.getByTestId(WATCHLISTS_TEST_IDS.importText), {
      target: { value: text },
    });
  }

  function submit(): HTMLElement {
    return screen.getByTestId("modal-footer-submit-button");
  }

  test("nothing to import yet, until something is typed", () => {
    renderImport();

    expect(submit()).toHaveTextContent("Nothing to import yet");
    expect(submit()).toBeDisabled();
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.importPreview)).toBeNull();
  });

  test("the paste box keeps a text area's look, across the dialog, in the mono type", () => {
    renderImport();

    /*
     * TextArea's className replaces its own look: a box given only
     * font-mono was a bare, narrow one with a black border.
     */
    const box: HTMLElement = screen.getByTestId(WATCHLISTS_TEST_IDS.importText);

    expect(box).toHaveClass("block", "w-full", "rounded-md", "font-mono");
    expect(box).toHaveClass("border-gray-300", "focus:ring-indigo-500");
    // Values are written left to right, on a Persian page too.
    expect(box.closest("[dir]")).toHaveAttribute("dir", "ltr");
  });

  test("on a phone the box's label has its line, Choose a File under it; side by side from md", () => {
    renderImport();

    const header: HTMLElement = screen
      .getByText("Values to import")
      .closest("div")!;

    expect(header).toHaveClass(
      ...WATCHLIST_IMPORT_TEXT_HEADER_CLASS_NAME.split(" "),
    );
    expect(WATCHLIST_IMPORT_TEXT_HEADER_CLASS_NAME).toContain("flex-col");
    expect(WATCHLIST_IMPORT_TEXT_HEADER_CLASS_NAME).toContain("md:flex-row");
    expect(
      within(header).getByTestId(WATCHLISTS_TEST_IDS.importFile),
    ).toBeInTheDocument();
  });

  test("How to import names its choice for a screen reader", () => {
    renderImport();

    const group: HTMLElement = screen.getByRole("radiogroup");
    const label: HTMLElement = screen.getByText("How to import");

    expect(label).toHaveAttribute("id", WATCHLIST_IMPORT_MODE_LABEL_ID);
    expect(group).toHaveAttribute(
      "aria-labelledby",
      WATCHLIST_IMPORT_MODE_LABEL_ID,
    );
  });

  test("what it is about to do shows as it is typed, with each line it leaves out", () => {
    renderImport();

    type(
      [
        "value,note",
        "alice@example.com, CFO",
        "ALICE@EXAMPLE.COM",
        "bob@example.com",
        "*",
        "carol@example.com",
      ].join("\n"),
    );

    expect(
      flat(screen.getByTestId(WATCHLISTS_TEST_IDS.importPreview)),
    ).toContain(
      "3 values to import · 1 repeated line skipped · 1 line left out",
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.importProblems))).toBe(
      "Line 5: * - A value of only * would match everything.",
    );
    expect(submit()).toHaveTextContent("Import 3 Values");
    expect(submit()).not.toBeDisabled();
  });

  test("an IP address list takes addresses, ranges and patterns, and names the rest", () => {
    renderImport({ entityType: SecurityEntityType.IpAddress });

    type("10.0.0.1\n10.20.0.0/16\n10.30.*\nnot-an-address\n");

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.importProblems))).toBe(
      "Line 4: not-an-address - Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
    );
    expect(submit()).toHaveTextContent("Import 3 Values");
  });

  test("five lines it leaves out are named, the rest counted", () => {
    renderImport({ entityType: SecurityEntityType.FileHash });

    type(
      [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "d41d8cd98f00b204e9800998ecf8427e",
      ].join("\n"),
    );

    const problems: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.importProblems,
    );

    expect(within(problems).getAllByRole("listitem")).toHaveLength(6);
    expect(within(problems).getByText("and 2 more lines")).toBeInTheDocument();
    expect(submit()).toHaveTextContent("Import 1 Value");
  });

  test("an import adds by default, and what it did is the dialog's last word", async () => {
    const importMock: Mock<(data: unknown) => Promise<JSONObject>> = jest.fn<
      (data: unknown) => Promise<JSONObject>
    >(async () => {
      return {
        added: 2,
        removed: 0,
        unchanged: 1,
        duplicates: 0,
        problemCount: 0,
        valueCount: 14,
      };
    });
    jest
      .spyOn(SecurityCaseApi, "importWatchlistValues")
      .mockImplementation(importMock as never);
    const onImported: Mock<() => void> = jest.fn<() => void>();
    const onClose: Mock<() => void> = jest.fn<() => void>();

    renderImport({
      onImported,
      onClose,
    });

    type("alice@example.com\nbob@example.com\ncarol@example.com");

    await act(async () => {
      fireEvent.click(submit());
    });

    expect(importMock).toHaveBeenCalledTimes(1);
    expect(importMock.mock.calls[0]![0]).toEqual({
      watchlistId: new ObjectID(WATCHLIST_ID),
      text: "alice@example.com\nbob@example.com\ncarol@example.com",
      mode: SecurityWatchlistImportMode.Add,
    });
    expect(onImported).toHaveBeenCalledTimes(1);

    const summary: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.importSummary,
    );

    expect(
      within(summary)
        .getAllByRole("listitem")
        .map((item: HTMLElement) => {
          return flat(item);
        }),
    ).toEqual([
      "2 values added",
      "1 was already on the list",
      "The list now holds 14 values.",
    ]);
    expect(screen.getByText("Import finished")).toBeInTheDocument();
    // Done is the only way out: no Cancel to read as an undo, and no X.
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();
    expect(screen.queryByTestId("close-button")).toBeNull();
    expect(submit()).toHaveTextContent("Done");

    fireEvent.click(submit());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Replace the list sends a replace", async () => {
    const importMock: Mock<(data: unknown) => Promise<JSONObject>> = jest.fn<
      (data: unknown) => Promise<JSONObject>
    >(async () => {
      return { added: 1, removed: 3, unchanged: 0, valueCount: 1 };
    });
    jest
      .spyOn(SecurityCaseApi, "importWatchlistValues")
      .mockImplementation(importMock as never);

    renderImport();
    type("alice@example.com");

    fireEvent.click(
      screen.getByTestId(
        `card-select-option-${SecurityWatchlistImportMode.Replace}`,
      ),
    );

    await act(async () => {
      fireEvent.click(submit());
    });

    expect(importMock.mock.calls[0]![0]).toMatchObject({
      mode: SecurityWatchlistImportMode.Replace,
    });
    expect(
      within(await screen.findByTestId(WATCHLISTS_TEST_IDS.importSummary))
        .getAllByRole("listitem")
        .map((item: HTMLElement) => {
          return flat(item);
        }),
    ).toEqual([
      "1 value added",
      "3 values removed",
      "The list now holds 1 value.",
    ]);
  });

  test("an import the API refuses says why in the dialog, keeping what was typed", async () => {
    jest.spyOn(SecurityCaseApi, "importWatchlistValues").mockRejectedValue(
      new HTTPErrorResponse(
        400,
        {
          error:
            "Importing values takes a role that can add values to watchlists.",
        },
        {},
      ) as never,
    );

    renderImport();
    type("alice@example.com");

    await act(async () => {
      fireEvent.click(submit());
    });

    expect(
      await screen.findByText(
        "Importing values takes a role that can add values to watchlists.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId(WATCHLISTS_TEST_IDS.importText)).toHaveValue(
      "alice@example.com",
    );
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.importSummary)).toBeNull();
  });

  test("a chosen file is read into the box; one larger than 4 MB is refused", async () => {
    renderImport();

    const input: HTMLInputElement = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    expect(input).toHaveAttribute("accept", ".txt,.csv,text/plain,text/csv");

    const file: File = new File(["value\nalice@example.com\n"], "vips.csv", {
      type: "text/csv",
    });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByTestId(WATCHLISTS_TEST_IDS.importText)).toHaveValue(
        "value\nalice@example.com\n",
      );
    });
    expect(submit()).toHaveTextContent("Import 1 Value");

    const huge: File = new File(["x"], "huge.csv", { type: "text/csv" });
    Object.defineProperty(huge, "size", {
      value: SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS + 1,
    });

    await act(async () => {
      fireEvent.change(input, { target: { files: [huge] } });
    });

    expect(
      await screen.findByText(
        "The file is larger than 4 MB. Split it, and import it in parts.",
      ),
    ).toBeInTheDocument();
  });

  test("what an import did, read from the API's answer whatever it holds", () => {
    expect(
      readWatchlistImportSummary({
        added: 3,
        removed: "2",
        unchanged: null,
        valueCount: "lots",
      } as never),
    ).toEqual({
      added: 3,
      removed: 2,
      unchanged: 0,
      duplicates: 0,
      problemCount: 0,
      valueCount: 0,
    });

    expect(
      describeWatchlistImportSummary(ENGLISH, {
        added: 0,
        removed: 0,
        unchanged: 0,
        duplicates: 0,
        problemCount: 0,
        valueCount: 0,
      }),
    ).toEqual(["0 values added", "The list now holds 0 values."]);
  });
});

describe("Use It in a Rule", () => {
  function renderSnippet(
    props: Partial<React.ComponentProps<typeof WatchlistRuleSnippet>> = {},
  ): void {
    render(
      <MemoryRouter>
        <WatchlistRuleSnippet
          name="admin_addresses"
          entityType={SecurityEntityType.IpAddress}
          {...props}
        />
      </MemoryRouter>,
    );
  }

  test("the selection that reads the list, matched against its kind's field, left to right", () => {
    renderSnippet();

    const snippet: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.ruleSnippet,
    );

    expect(snippet).toHaveAttribute("dir", "ltr");
    expect(snippet.textContent).toContain(
      "principalIp|expand: '%admin_addresses%'",
    );
    expect(snippet.textContent).toContain("condition: selection");
    expect(
      within(snippet).getByTestId("code-block-copy-button"),
    ).toBeInTheDocument();
  });

  test("the way to Detection Rules, where the selection goes; the rules that read it are named in About This List", () => {
    renderSnippet();

    expect(
      screen.getByText("Open Detection Rules").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/detection-rules`,
    );
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.readByLine)).toBeNull();
  });

  test("a list of a kind with no field of its own is looked for among observables", () => {
    renderSnippet({
      name: "bad_domains",
      entityType: SecurityEntityType.Domain,
    });

    expect(
      screen.getByTestId(WATCHLISTS_TEST_IDS.ruleSnippet).textContent,
    ).toContain("observables|expand: '%bad_domains%'");
  });
});

describe("the line under a rule's YAML", () => {
  const YAML: string = [
    "title: Admin sign-in from outside",
    "logsource:",
    "  product: okta",
    "detection:",
    "  admin_sign_in:",
    "    principalUser|expand: '%admins%'",
    "  allowed:",
    "    principalIp|expand: '%Admin_Addresses%'",
    "  condition: admin_sign_in and not allowed",
  ].join("\n");

  async function renderLine(yaml: unknown): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <DetectionRuleWatchlists sigmaRuleYaml={yaml} />
        </MemoryRouter>,
      );
    });
  }

  test("a rule that names no list draws nothing, and reads nothing", async () => {
    await renderLine(
      "title: x\nlogsource:\n  product: okta\ndetection:\n  sel:\n    outcome: failure\n  condition: sel",
    );
    await renderLine("not: [yaml");
    await renderLine(undefined);

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.ruleWatchlists)).toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("each list the rule names, with its values and a link to it; a missing one in red", async () => {
    getListMock.mockResolvedValue(
      listOf([
        watchlist({
          _id: WATCHLIST_ID,
          name: "admin_addresses",
          source: SecurityWatchlistSource.Values,
          valueCount: 12,
        }),
      ]),
    );

    await renderLine(YAML);

    const line: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.ruleWatchlists,
    );
    const lists: Array<HTMLElement> = within(line).getAllByTestId(
      WATCHLISTS_TEST_IDS.ruleWatchlist,
    );

    expect(within(line).getByText("Reads watchlists")).toBeInTheDocument();
    expect(lists).toHaveLength(2);

    // The list the project has, on the Reads watchlists line, whatever case the rule wrote.
    expect(lists[0]).not.toHaveAttribute("data-missing");
    // The gap between the name and its values is the row's own (gap-1).
    expect(flat(lists[0]!)).toBe("admin_addresses(12 values)");
    expect(
      within(lists[0]!).getByText("admin_addresses").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/watchlists/${WATCHLIST_ID}`,
    );

    /*
     * A name the project has no list of: a line of its own after the
     * lists found, never among them - what is wrong, then the way to fix
     * it, Create Watchlist with the name in it.
     */
    expect(lists[1]).toHaveAttribute("data-missing", "true");
    expect(lists[1]).toHaveClass("text-red-700");
    expect(lists[1]!.tagName).toBe("DIV");
    expect(lists[1]!.querySelector("svg")).not.toBeNull();
    expect(flat(lists[1]!)).toBe(
      "No watchlist named admins · Create it in Watchlists",
    );
    expect(within(lists[1]!).getByText("admins")).toHaveClass("font-mono");
    expect(
      within(lists[1]!).getByText("Create it in Watchlists").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/watchlists?create=admins`,
    );

    // One read of the project's lists.
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toMatchObject({
      modelType: SecurityWatchlist,
      query: { projectId: new ObjectID(PROJECT_ID) },
    });
  });

  test("a rule that names only lists the project lacks has no Reads watchlists line, only what is missing", async () => {
    getListMock.mockResolvedValue(listOf([]));

    await renderLine(YAML);

    const line: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.ruleWatchlists,
    );

    expect(within(line).queryByText("Reads watchlists")).toBeNull();
    expect(
      within(line)
        .getAllByTestId(WATCHLISTS_TEST_IDS.ruleWatchlist)
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-missing");
        }),
    ).toEqual(["true", "true"]);
  });

  test("the lists are read again when the window comes back, so one just created is no longer missing", async () => {
    getListMock.mockResolvedValueOnce(listOf([]));

    await renderLine(YAML);

    const line: HTMLElement = await screen.findByTestId(
      WATCHLISTS_TEST_IDS.ruleWatchlists,
    );
    expect(line.querySelectorAll('[data-missing="true"]')).toHaveLength(2);

    // The reader created admins in the other tab, and comes back.
    getListMock.mockResolvedValueOnce(
      listOf([
        watchlist({
          _id: WATCHLIST_ID,
          name: "admins",
          source: SecurityWatchlistSource.Values,
          valueCount: 0,
        }),
      ]),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(
        screen
          .getByTestId(WATCHLISTS_TEST_IDS.ruleWatchlists)
          .querySelectorAll('[data-missing="true"]'),
      ).toHaveLength(1);
    });
    expect(getListMock).toHaveBeenCalledTimes(2);

    // A read that fails then keeps what the line said.
    getListMock.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(getListMock).toHaveBeenCalledTimes(3);
    expect(
      screen
        .getByTestId(WATCHLISTS_TEST_IDS.ruleWatchlists)
        .querySelectorAll('[data-missing="true"]'),
    ).toHaveLength(1);
  });

  test("a rule that names no list does not read them again on focus", async () => {
    await renderLine(
      "title: x\nlogsource:\n  product: okta\ndetection:\n  sel:\n    outcome: failure\n  condition: sel",
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("lists that cannot be read are not called missing", async () => {
    getListMock.mockRejectedValue(new Error("offline"));

    await renderLine(YAML);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.ruleWatchlists)).toBeNull();
  });
});
