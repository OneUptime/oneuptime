import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import RunbookPicker, {
  RUNBOOK_PICKER_SEARCH_DEBOUNCE_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import { RUNNABLE_RUNBOOKS_PAGE_SIZE } from "../../../Utils/Runbook/RunnableRunbooks";

// What the dialog hands ModelAPI.getList.
type ListOptions = Parameters<typeof ModelAPI.getList<Runbook>>[0];

/*
 * RUN A RUNBOOK SEARCHES THE SERVER (#10580).
 *
 * The dialog read the project's first 200 enabled runbooks by name when it
 * opened and searched them in the browser: a runbook past the 200th, by
 * name, was never offered, and a search for it said "No matches". Now each
 * search goes to the server - the enabled runbooks whose name holds what
 * was typed, 50 by name - and the dialog shows what the server answered,
 * with how many match when that is more than it shows.
 *
 * What Postgres answers to that query, through the real runbook list route,
 * is pinned in Tests/Server/API/RunbookPickerSearchPostgres.test.ts.
 */

interface ListCall {
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

let instance: i18n;

beforeAll(async () => {
  instance = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  // The project id is read from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const runbookNamed: (name: string) => Runbook = (name: string): Runbook => {
  const runbook: Runbook = new Runbook();
  runbook._id = ObjectID.generate().toString();
  runbook.name = name;
  return runbook;
};

/*
 * The server, faked: each read answered by `answer` for what it searched
 * (the name's Search, or nothing), its calls kept.
 */
const fakeServer: (
  answer: (searchText: string) => { names: Array<string>; count?: number },
) => Array<ListCall> = (
  answer: (searchText: string) => { names: Array<string>; count?: number },
): Array<ListCall> => {
  const calls: Array<ListCall> = [];

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: ListOptions,
  ): Promise<ListResult<Runbook>> => {
    const query: Record<string, unknown> = options.query as Record<
      string,
      unknown
    >;

    calls.push({
      query: query,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort as Record<string, unknown>,
    });

    const name: unknown = query["name"];
    const searchText: string =
      name instanceof Search ? (name as Search<string>).toString() : "";
    const answered: { names: Array<string>; count?: number } =
      answer(searchText);

    return {
      data: answered.names.map(runbookNamed),
      count: answered.count ?? answered.names.length,
      skip: 0,
      limit: options.limit,
    };
  }) as never);

  return calls;
};

const draw: () => void = (): void => {
  render(
    <I18nextProvider i18n={instance}>
      <RunbookPicker isOpen={true} onClose={() => {}} />
    </I18nextProvider>,
  );
};

const shownNames: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId("runbook-picker-name")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
};

const typeSearch: (text: string) => void = (text: string): void => {
  fireEvent.change(screen.getByPlaceholderText("Search runbooks..."), {
    target: { value: text },
  });
};

describe("Run a Runbook, searched on the server", () => {
  test("opens on the project's enabled runbooks, a page of 50 by name, nothing read up front beyond it", async () => {
    const calls: Array<ListCall> = fakeServer(() => {
      return { names: ["Clear disk", "Restart checkout"] };
    });

    draw();

    await waitFor(() => {
      expect(shownNames()).toEqual(["Clear disk", "Restart checkout"]);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.query["isEnabled"]).toBe(true);
    expect(String(calls[0]!.query["projectId"])).toBe(PROJECT_ID);
    // Nothing typed: no condition on the name.
    expect(calls[0]!.query["name"]).toBeUndefined();
    expect(calls[0]!.limit).toBe(RUNNABLE_RUNBOOKS_PAGE_SIZE);
    expect(calls[0]!.limit).toBe(50);
    expect(calls[0]!.skip).toBe(0);
    expect(calls[0]!.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("a search goes to the server once typing pauses, and shows what it found", async () => {
    const calls: Array<ListCall> = fakeServer((searchText: string) => {
      return searchText === "WB1500"
        ? { names: ["WB1500 Restart kiosk"] }
        : { names: ["AP0001 Restart kiosk"], count: 10050 };
    });

    draw();

    await waitFor(() => {
      expect(shownNames()).toEqual(["AP0001 Restart kiosk"]);
    });

    jest.useFakeTimers();
    typeSearch("  WB1500 ");

    // Not yet: the search waits for typing to pause.
    expect(calls).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(RUNBOOK_PICKER_SEARCH_DEBOUNCE_MS);
    });
    jest.useRealTimers();

    await waitFor(() => {
      expect(shownNames()).toEqual(["WB1500 Restart kiosk"]);
    });

    expect(calls).toHaveLength(2);
    // Trimmed, and searched on the server - never filtered here.
    expect(calls[1]!.query["name"]).toBeInstanceOf(Search);
    expect((calls[1]!.query["name"] as Search<string>).toString()).toBe(
      "WB1500",
    );
    expect(calls[1]!.query["isEnabled"]).toBe(true);
    expect(calls[1]!.limit).toBe(50);
  });

  test("says how many match when more do than it shows", async () => {
    fakeServer(() => {
      return {
        names: Array.from({ length: 50 }, (_value: unknown, index: number) => {
          return `Runbook ${String(index).padStart(3, "0")}`;
        }),
        count: 1234,
      };
    });

    draw();

    expect(await screen.findByTestId("runbook-picker-more")).toHaveTextContent(
      "Showing 50 of 1,234. Type to narrow the list.",
    );
  });

  test("says nothing more when it shows every match", async () => {
    fakeServer(() => {
      return { names: ["Clear disk"], count: 1 };
    });

    draw();

    await waitFor(() => {
      expect(shownNames()).toEqual(["Clear disk"]);
    });

    expect(screen.queryByTestId("runbook-picker-more")).toBeNull();
  });

  test("a search that finds nothing says No matches, not No runbooks yet", async () => {
    fakeServer((searchText: string) => {
      return searchText ? { names: [] } : { names: ["Clear disk"] };
    });

    draw();

    await waitFor(() => {
      expect(shownNames()).toEqual(["Clear disk"]);
    });

    typeSearch("nothing like it");

    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(
      screen.getByText("Try a different search term."),
    ).toBeInTheDocument();
  });

  test("a project with no runbook says No runbooks yet, whatever is typed", async () => {
    fakeServer(() => {
      return { names: [] };
    });

    draw();

    expect(await screen.findByText("No runbooks yet")).toBeInTheDocument();

    typeSearch("restart");

    await waitFor(() => {
      expect(screen.getByText("No runbooks yet")).toBeInTheDocument();
    });
    expect(screen.queryByText("No matches")).toBeNull();
  });

  test("an answer to an older search never replaces the latest one's", async () => {
    let releaseFirst: (() => void) | null = null;

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: ListOptions,
    ): Promise<ListResult<Runbook>> => {
      const name: unknown = (options.query as Record<string, unknown>)["name"];

      if (!(name instanceof Search)) {
        // The first read, with nothing typed, answers last.
        await new Promise<void>((resolve: () => void) => {
          releaseFirst = resolve;
        });

        return {
          data: [runbookNamed("Stale first page")],
          count: 1,
          skip: 0,
          limit: 50,
        };
      }

      return {
        data: [runbookNamed("WB1500 Restart kiosk")],
        count: 1,
        skip: 0,
        limit: 50,
      };
    }) as never);

    draw();

    typeSearch("WB1500");

    await waitFor(() => {
      expect(shownNames()).toEqual(["WB1500 Restart kiosk"]);
    });

    await act(async () => {
      releaseFirst?.();
    });

    expect(shownNames()).toEqual(["WB1500 Restart kiosk"]);
  });
});
