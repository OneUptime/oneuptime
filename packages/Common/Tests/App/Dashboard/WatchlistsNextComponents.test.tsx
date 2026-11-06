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
  within,
} from "@testing-library/react";
import type { Mock, SpyInstance } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE NEW PIECES OF WATCHLISTS (#5391), drawn for real and driven as a
 * person drives them: what reads a list - a rule, a Security Events
 * monitor, a hunt - each saying what it is and opening its own page; a
 * value kept for a while, saying when it leaves; a list read from an
 * address - how many values it read and from where, its Read From an
 * Address card in each of its states, and Read Now; and where a new list's
 * values come from, the choices following what it holds.
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

import {
  WatchlistHoldsColumnCell,
  WatchlistNameCell,
  WatchlistReadByCell,
  WatchlistReadersList,
  WatchlistValueExpiresLine,
  WatchlistValueNoteCell,
  WatchlistValuesCell,
  getWatchlistReaderRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistCells";
import WatchlistSourceRadio from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistSourceRadio";
import WatchlistUrlCard, {
  WatchlistUrlFacts,
  WatchlistUrlReadState,
  getWatchlistUrlReadState,
  getWatchlistUrlScheduleKey,
  isHttpsAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistUrlCard";
import { WATCHLISTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { WatchlistReaderKind } from "../../../Types/SecurityEvent/SecurityWatchlistFilter";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const WATCHLIST_ID: string = "44444444-4444-4444-8444-444444444444";
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const HUNT_ID: string = "66666666-6666-4666-8666-666666666666";
const HOUR: number = 60 * 60 * 1000;

function flat(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function inFoldedRow(element: React.ReactElement): React.ReactElement {
  return (
    <TableCellContext.Provider value={true}>
      <TableFoldedColumnsContext.Provider value={true}>
        {element}
      </TableFoldedColumnsContext.Provider>
    </TableCellContext.Provider>
  );
}

const READERS: Array<{
  id: string;
  name: string;
  kind: WatchlistReaderKind;
}> = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "VIP sign-in",
    kind: WatchlistReaderKind.DetectionRule,
  },
  { id: MONITOR_ID, name: "VIP failures", kind: WatchlistReaderKind.Monitor },
  { id: HUNT_ID, name: "Weekly VIP review", kind: WatchlistReaderKind.Hunt },
];

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what reads a list", () => {
  test("a monitor or a hunt says what it is after its name, quieter; a rule needs no word", () => {
    render(
      <WatchlistReadByCell
        readers={READERS.slice(0, 2)}
        isLoaded={true}
        hasError={false}
      />,
    );

    const cell: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.readByCell,
    );
    const kinds: Array<HTMLElement> = within(cell).getAllByTestId(
      WATCHLISTS_TEST_IDS.readerKind,
    );

    expect(flat(cell)).toBe("VIP sign-inVIP failures (Monitor)");
    expect(kinds).toHaveLength(1);
    expect(kinds[0]).toHaveClass("text-gray-400", "whitespace-nowrap");
  });

  test("folded under the name: every kind, then how many more", () => {
    render(
      inFoldedRow(
        <WatchlistNameCell
          name="vip_users"
          entityType={SecurityEntityType.User}
          values={{ source: SecurityWatchlistSource.Values, valueCount: 3 }}
          readers={{
            readers: [READERS[1]!, READERS[2]!, READERS[0]!],
            isLoaded: true,
            hasError: false,
          }}
        />,
      ),
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameReadBy))).toBe(
      "Read by: VIP failures (Monitor), Weekly VIP review (Hunt) and 1 more",
    );
  });

  test("on a list's page, a monitor and a hunt open their own pages; a rule, which has none, does not", () => {
    render(
      <MemoryRouter>
        <WatchlistReadersList
          readers={READERS}
          isLoaded={true}
          hasError={false}
        />
      </MemoryRouter>,
    );

    const line: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.readByLine,
    );

    expect(flat(line)).toBe(
      "VIP sign-in, VIP failures (Monitor), Weekly VIP review (Hunt)",
    );
    expect(within(line).getByText("VIP sign-in").closest("a")).toBeNull();
    expect(within(line).getByText("VIP failures").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(
      within(line).getByText("Weekly VIP review").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/hunts/${HUNT_ID}`,
    );
  });

  test("where each reader opens: a monitor's page, a hunt's, none for a rule or a reader with no id", () => {
    expect(
      getWatchlistReaderRoute({
        kind: WatchlistReaderKind.Monitor,
        id: MONITOR_ID,
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`);
    expect(
      getWatchlistReaderRoute({
        kind: WatchlistReaderKind.DetectionRule,
        id: MONITOR_ID,
      }),
    ).toBeNull();
    expect(
      getWatchlistReaderRoute({ kind: WatchlistReaderKind.Hunt, id: "" }),
    ).toBeNull();
  });
});

describe("a value kept for a while", () => {
  test("says when it leaves the list, the moment whole under the pointer", () => {
    render(
      <WatchlistValueNoteCell
        note="Contractor"
        addedBy="Maya Chen"
        createdAt={new Date(Date.now() - 2 * HOUR)}
        expiresAt={new Date(Date.now() + 3 * 24 * HOUR + 60 * 1000)}
      />,
    );

    const expires: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.expiresLine,
    );

    expect(flat(expires)).toBe("Expires in 3 days");
    expect(expires.getAttribute("title")).toBeTruthy();
    expect(expires).toHaveClass("text-amber-700");
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.noteCell))).toBe(
      "ContractorAdded by Maya Chen 2 hours agoExpires in 3 days",
    );
  });

  test("a value that stays says nothing of leaving; nor does a moment that is no date", () => {
    const { rerender } = render(<WatchlistValueExpiresLine />);

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.expiresLine)).toBeNull();

    rerender(<WatchlistValueExpiresLine expiresAt="someday" />);

    expect(screen.queryByTestId(WATCHLISTS_TEST_IDS.expiresLine)).toBeNull();

    // As the API sends it: an ISO string.
    rerender(
      <WatchlistValueExpiresLine
        expiresAt={new Date(Date.now() + 2 * HOUR + 60 * 1000).toISOString()}
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.expiresLine))).toBe(
      "Expires in 2 hours",
    );
  });

  test("a value a read of the list's address put there says so, in place of who added it", () => {
    render(
      <WatchlistValueNoteCell
        note=""
        createdAt={new Date(Date.now() - 5 * 60 * 1000)}
        isReadFromUrl={true}
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.addedLine))).toBe(
      "Read from its address 5 minutes ago",
    );
  });
});

describe("a list read from an address, in a row", () => {
  test("how many values it read, and from where", () => {
    render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.Url}
        valueCount={1200}
        importUrl="https://hr.example.com/vip-users.csv"
        lastImportSucceededAt={new Date()}
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.valuesCell))).toBe(
      "1,200 values from hr.example.com",
    );
  });

  test("before its first read works, it waits for one, in the quieter grey", () => {
    render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.Url}
        valueCount={0}
        importUrl="https://hr.example.com/vip-users.csv"
      />,
    );

    const cell: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.valuesCell,
    );

    expect(flat(cell)).toBe("Waiting for its first read");
    expect(within(cell).getByText("Waiting for its first read")).toHaveClass(
      "text-gray-400",
    );
  });

  test("the list's Holds column says the same: what it holds, then how many values from where, and a failed read", () => {
    render(
      <WatchlistHoldsColumnCell
        entityType={SecurityEntityType.User}
        source={SecurityWatchlistSource.Url}
        valueCount={2}
        importUrl="https://hr.example.com/contractors.csv"
        lastImportSucceededAt={new Date(Date.now() - 24 * HOUR)}
        lastImportError={SECURITY_WATCHLIST_MESSAGES.urlNotRead.message}
      />,
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.holdsCell))).toBe(
      "Users",
    );
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.valuesCell))).toBe(
      "2 values from hr.example.comIts last read failed",
    );
  });

  test("folded under a row's name, too", () => {
    render(
      inFoldedRow(
        <WatchlistNameCell
          name="contractors"
          entityType={SecurityEntityType.User}
          values={{
            source: SecurityWatchlistSource.Url,
            valueCount: 2,
            importUrl: "https://hr.example.com/contractors.csv",
            lastImportSucceededAt: new Date(),
          }}
        />,
      ),
    );

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.nameFacts))).toBe(
      "Users · 2 values from hr.example.com",
    );
  });

  test("a list whose last read failed says so in red, wherever its values are named", () => {
    render(
      <WatchlistValuesCell
        source={SecurityWatchlistSource.Url}
        valueCount={12}
        importUrl="https://hr.example.com/vip-users.csv"
        lastImportSucceededAt={new Date(Date.now() - 24 * HOUR)}
        lastImportError={SECURITY_WATCHLIST_MESSAGES.urlNotRead.message}
      />,
    );

    const failed: HTMLElement = screen.getByText("Its last read failed");

    expect(failed).toHaveClass("text-red-700");
    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.valuesCell))).toBe(
      "12 values from hr.example.comIts last read failed",
    );
  });
});

describe("Read From an Address", () => {
  function renderCard(
    facts: Partial<WatchlistUrlFacts> = {},
    onRead: () => void = () => {},
  ): void {
    render(
      <WatchlistUrlCard
        watchlistId={new ObjectID(WATCHLIST_ID)}
        watchlist={{
          importUrl: "https://hr.example.com/vip-users.csv",
          importSchedule: SecurityWatchlistImportSchedule.EverySixHours,
          ...facts,
        }}
        onRead={onRead}
      />,
    );
  }

  test("where a list's reads stand: waiting for the first, the last worked, or the last failed", () => {
    expect(getWatchlistUrlReadState({})).toBe(WatchlistUrlReadState.Waiting);
    expect(
      getWatchlistUrlReadState({ lastImportSucceededAt: new Date() }),
    ).toBe(WatchlistUrlReadState.Read);
    expect(
      getWatchlistUrlReadState({
        lastImportSucceededAt: new Date(),
        lastImportError: "x",
      }),
    ).toBe(WatchlistUrlReadState.Failed);
    expect(getWatchlistUrlScheduleKey(undefined)).toBe("Every Hour");
    expect(getWatchlistUrlScheduleKey("Every Day")).toBe("Every Day");
  });

  test("its address, opening in a new tab, left to right; and how often it is read", () => {
    renderCard();

    const address: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.urlAddress,
    );

    expect(address.tagName).toBe("A");
    expect(address).toHaveAttribute(
      "href",
      "https://hr.example.com/vip-users.csv",
    );
    expect(address).toHaveAttribute("target", "_blank");
    expect(address).toHaveAttribute("rel", "noopener noreferrer");
    expect(address).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId(WATCHLISTS_TEST_IDS.urlCard)).toHaveTextContent(
      "Every 6 Hours",
    );
  });

  test("an address that is not https is shown, never a link a browser would follow", () => {
    renderCard({ importUrl: "javascript:alert(1)" });

    const address: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.urlAddress,
    );

    expect(address.tagName).toBe("SPAN");
    expect(address).not.toHaveAttribute("href");
    expect(isHttpsAddress("https://example.com/a.csv")).toBe(true);
    expect(isHttpsAddress("http://example.com/a.csv")).toBe(false);
    expect(isHttpsAddress("javascript:alert(1)")).toBe(false);
    expect(isHttpsAddress("")).toBe(false);
  });

  test("waiting for its first read says it is read within a minute, or now", () => {
    renderCard();

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.urlStatus))).toBe(
      "Waiting for its first read - OneUptime reads the file within a minute of the list being saved, or now with Read Now.",
    );
  });

  test("a read that worked: when, and how many lines of the file it left out", () => {
    renderCard({
      lastImportAt: new Date(Date.now() - 2 * HOUR),
      lastImportSucceededAt: new Date(Date.now() - 2 * HOUR),
      lastImportLinesLeftOut: 1,
    });

    expect(flat(screen.getByTestId(WATCHLISTS_TEST_IDS.urlStatus))).toBe(
      "Last read 2 hours ago. 1 line of the file was left out.",
    );
  });

  test("a read that failed: when, why in the reader's words, what the address said, and which read the values are from", () => {
    renderCard({
      lastImportAt: new Date(Date.now() - 10 * 60 * 1000),
      lastImportSucceededAt: new Date(Date.now() - 26 * HOUR),
      lastImportError: SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message,
      lastImportErrorDetail: "Data source responded with HTTP 200",
    });

    const status: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.urlStatus,
    );

    expect(status).toHaveTextContent("The last read failed 10 minutes ago");
    expect(status).toHaveTextContent(
      SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message,
    );
    expect(
      within(status).getByText("Data source responded with HTTP 200"),
    ).toHaveAttribute("dir", "ltr");
    expect(status).toHaveTextContent(
      "The list keeps the values it read a day ago.",
    );
  });

  test("a list whose reads have all failed holds no values until one works", () => {
    renderCard({
      lastImportAt: new Date(),
      lastImportError: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
    });

    expect(screen.getByTestId(WATCHLISTS_TEST_IDS.urlStatus)).toHaveTextContent(
      "The list holds no values until a read works.",
    );
  });

  test("Read Now reads it at once, says what it did, and has the page read the list again", async () => {
    const readNow: SpyInstance<typeof SecurityCaseApi.readWatchlistNow> = jest
      .spyOn(SecurityCaseApi, "readWatchlistNow")
      .mockResolvedValue({
        error: null,
        errorDetail: null,
        added: 3,
        removed: 1,
        unchanged: 2,
        problemCount: 0,
        valueCount: 5,
      });
    const onRead: Mock<() => void> = jest.fn<() => void>();

    renderCard({ lastImportSucceededAt: new Date() }, onRead);

    await act(async () => {
      fireEvent.click(screen.getByText("Read Now"));
    });

    expect(readNow).toHaveBeenCalledWith({
      watchlistId: new ObjectID(WATCHLIST_ID),
    });
    expect(onRead).toHaveBeenCalledTimes(1);

    const result: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.urlReadNowResult,
    );

    expect(result).toHaveTextContent("Read just now");
    expect(result).toHaveTextContent("3 values added");
    expect(result).toHaveTextContent("1 value removed");
  });

  test("a Read Now that failed says why on the card, as a scheduled read does", async () => {
    jest.spyOn(SecurityCaseApi, "readWatchlistNow").mockResolvedValue({
      error: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
      errorDetail: "getaddrinfo ENOTFOUND",
    });
    const onRead: Mock<() => void> = jest.fn<() => void>();

    renderCard({ lastImportSucceededAt: new Date() }, onRead);

    await act(async () => {
      fireEvent.click(screen.getByText("Read Now"));
    });

    // The page reads the list again, and the card shows the failure from it.
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId(WATCHLISTS_TEST_IDS.urlReadNowResult),
    ).toBeNull();
  });

  test("a Read Now the API refused says why", async () => {
    jest.spyOn(SecurityCaseApi, "readWatchlistNow").mockRejectedValue(
      new HTTPErrorResponse(
        400,
        {
          error:
            "This list is being read right now. Its page shows what the read did when it ends.",
        },
        {},
      ),
    );

    renderCard({ lastImportSucceededAt: new Date() });

    await act(async () => {
      fireEvent.click(screen.getByText("Read Now"));
    });

    expect(
      screen.getByTestId(WATCHLISTS_TEST_IDS.urlReadNowResult),
    ).toHaveTextContent(
      "This list is being read right now. Its page shows what the read did when it ends.",
    );
  });

  test("a role that cannot edit watchlists is offered no Read Now", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });

    renderCard();

    expect(screen.queryByText("Read Now")).toBeNull();
  });
});

describe("where a new list's values come from", () => {
  function renderRadio(
    entityType: unknown,
    value: string,
    onChange: (value: string) => void = () => {},
  ): void {
    render(
      <WatchlistSourceRadio
        entityType={entityType}
        value={value}
        onChange={onChange}
        dataTestId="watchlist-source"
      />,
    );
  }

  test("a list of users: kept by hand, or a file at an address - no feed carries users", () => {
    renderRadio(SecurityEntityType.User, SecurityWatchlistSource.Values);

    expect(screen.getByText("Values you keep")).toBeInTheDocument();
    expect(screen.getByText("A file at an address")).toBeInTheDocument();
    expect(screen.queryByText("A threat intel feed")).toBeNull();
    expect(
      screen.getByText(
        "Read again on a schedule from an https address: a text or CSV file, one value a line.",
      ),
    ).toBeInTheDocument();
  });

  test("a list of addresses may follow a feed too; a choice hands its value back", () => {
    const chosen: Array<string> = [];

    renderRadio(
      SecurityEntityType.IpAddress,
      SecurityWatchlistSource.Values,
      (value: string) => {
        chosen.push(value);
      },
    );

    expect(screen.getByText("A threat intel feed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("A file at an address"));

    expect(chosen).toEqual([SecurityWatchlistSource.Url]);
  });
});
