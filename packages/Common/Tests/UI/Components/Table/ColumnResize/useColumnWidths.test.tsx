import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import useColumnWidths, {
  UseColumnWidthsResult,
} from "../../../../../UI/Components/Table/ColumnResize/useColumnWidths";
import ColumnWidthsStore, {
  useColumnWidthsSnapshot,
  useColumnWidthsValue,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidthsStore";
import {
  ColumnWidths,
  EMPTY_COLUMN_WIDTHS,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import User from "../../../../../UI/Utils/User";
import ObjectID from "../../../../../Types/ObjectID";
import { UserPreferenceType } from "../../../../../Utils/UserPreferences";

/*
 * Where a table's column widths are remembered: in the browser, one entry
 * per person and per table, beside the table's column choices and page
 * size - read when the table is drawn, written when a width is kept, taken
 * away when they are reset. A browser that refuses storage still sizes the
 * columns while the page is open; the same table open in another tab
 * follows what is sized there.
 *
 * And who is drawn again when a width is kept: only what reads it - the
 * header row and the rules of the sized columns - never a table's rows.
 */

const PERSON_A: string = "8a3b0c3e-0000-4000-8000-0000000000aa";

/*
 * The browser's storage, as its two methods: @jest/globals types
 * spyOn(Storage.prototype, ...) as never, Storage having a string index
 * signature.
 */
const STORAGE: {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} = Storage.prototype;
const PERSON_B: string = "8a3b0c3e-0000-4000-8000-0000000000bb";

let person: string = PERSON_A;

beforeEach(() => {
  person = PERSON_A;
  window.localStorage.clear();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(person);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

const keyOf: (tableKey: string, personId?: string) => string = (
  tableKey: string,
  personId: string = PERSON_A,
): string => {
  return `${UserPreferenceType.TableColumnWidths}.${personId}.${tableKey}`;
};

interface Harness {
  latest: () => UseColumnWidthsResult;
  widths: () => ColumnWidths;
  rerender: (tableKey: string | null) => void;
  renders: () => number;
}

const renderHook: (tableKey: string | null) => Harness = (
  tableKey: string | null,
): Harness => {
  let result: UseColumnWidthsResult | null = null;
  let renders: number = 0;

  const Probe: (props: { tableKey: string | null }) => ReactElement = (props: {
    tableKey: string | null;
  }): ReactElement => {
    result = useColumnWidths({ tableKey: props.tableKey });
    renders++;

    return <></>;
  };

  const view: ReturnType<typeof render> = render(<Probe tableKey={tableKey} />);

  return {
    latest: (): UseColumnWidthsResult => {
      return result as unknown as UseColumnWidthsResult;
    },
    widths: (): ColumnWidths => {
      return (result as unknown as UseColumnWidthsResult).store.getWidths();
    },
    rerender: (next: string | null): void => {
      view.rerender(<Probe tableKey={next} />);
    },
    renders: (): number => {
      return renders;
    },
  };
};

describe("reading a table's widths", () => {
  test("the widths this person kept for this table", () => {
    window.localStorage.setItem(
      keyOf("incidents-table"),
      JSON.stringify({ incidentNumber: 240, title: 410 }),
    );

    expect(renderHook("incidents-table").widths()).toEqual({
      incidentNumber: 240,
      title: 410,
    });
  });

  test("another person's widths for the same table are not this person's", () => {
    window.localStorage.setItem(
      keyOf("incidents-table", PERSON_B),
      JSON.stringify({ incidentNumber: 500 }),
    );

    expect(renderHook("incidents-table").widths()).toBe(EMPTY_COLUMN_WIDTHS);
  });

  test("another table's widths are not this table's", () => {
    window.localStorage.setItem(
      keyOf("alerts-table"),
      JSON.stringify({ title: 300 }),
    );

    expect(renderHook("incidents-table").widths()).toBe(EMPTY_COLUMN_WIDTHS);
  });

  test("an entry an older release or a hand wrote wrong reads as no widths, or only its good ones", () => {
    window.localStorage.setItem(keyOf("a"), "not json at all {");
    window.localStorage.setItem(keyOf("b"), JSON.stringify([240, 300]));
    window.localStorage.setItem(
      keyOf("c"),
      JSON.stringify({ title: "wide", owner: 180 }),
    );

    expect(renderHook("a").widths()).toBe(EMPTY_COLUMN_WIDTHS);
    expect(renderHook("b").widths()).toBe(EMPTY_COLUMN_WIDTHS);
    expect(renderHook("c").widths()).toEqual({ owner: 180 });
  });

  test("a browser that refuses to be read draws the table's own widths", () => {
    jest.spyOn(STORAGE, "getItem").mockImplementation((): string => {
      throw new Error("SecurityError: storage is blocked");
    });

    expect(renderHook("incidents-table").widths()).toBe(EMPTY_COLUMN_WIDTHS);
  });

  test("a page with no one signed in reads the widths kept for whoever reads it", () => {
    person = "";
    window.localStorage.setItem(
      `${UserPreferenceType.TableColumnWidths}.anyone.status-page-table`,
      JSON.stringify({ name: 220 }),
    );

    expect(renderHook("status-page-table").widths()).toEqual({ name: 220 });
  });
});

describe("keeping a width", () => {
  test("is written for this person and this table, and read back the same", () => {
    const harness: Harness = renderHook("incidents-table");

    act(() => {
      harness.latest().setColumnWidth("title", 410);
    });

    expect(harness.widths()).toEqual({ title: 410 });
    expect(
      JSON.parse(window.localStorage.getItem(keyOf("incidents-table")) || "{}"),
    ).toEqual({ title: 410 });
    expect(renderHook("incidents-table").widths()).toEqual({ title: 410 });
  });

  test("null gives the column back to the table, and the last one taken away leaves no entry", () => {
    const harness: Harness = renderHook("incidents-table");

    act(() => {
      harness.latest().setColumnWidth("title", 410);
      harness.latest().setColumnWidth("owner", 200);
      harness.latest().setColumnWidth("title", null);
    });

    expect(harness.widths()).toEqual({ owner: 200 });

    act(() => {
      harness.latest().setColumnWidth("owner", null);
    });

    expect(harness.widths()).toBe(EMPTY_COLUMN_WIDTHS);
    expect(window.localStorage.getItem(keyOf("incidents-table"))).toBeNull();
  });

  test("resetting takes every width away", () => {
    const harness: Harness = renderHook("incidents-table");

    act(() => {
      harness.latest().setColumnWidth("title", 410);
      harness.latest().setColumnWidth("owner", 200);
      harness.latest().resetColumnWidths();
    });

    expect(harness.widths()).toBe(EMPTY_COLUMN_WIDTHS);
    expect(window.localStorage.getItem(keyOf("incidents-table"))).toBeNull();
  });

  test("a browser that refuses to store still sizes the column while the page is open", () => {
    jest.spyOn(STORAGE, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });

    const harness: Harness = renderHook("incidents-table");

    expect(() => {
      act(() => {
        harness.latest().setColumnWidth("title", 410);
      });
    }).not.toThrow();
    expect(harness.widths()).toEqual({ title: 410 });
  });

  test("a table with no key keeps its widths only while the page is open", () => {
    const harness: Harness = renderHook(null);

    act(() => {
      harness.latest().setColumnWidth("title", 410);
    });

    expect(harness.widths()).toEqual({ title: 410 });
    expect(window.localStorage.length).toBe(0);
  });

  test("keeping a width draws the hook's own component again not at all: only what reads the widths is drawn", () => {
    const harness: Harness = renderHook("incidents-table");
    const before: number = harness.renders();

    act(() => {
      harness.latest().setColumnWidth("title", 410);
      harness.latest().setColumnWidth("title", 380);
    });

    expect(harness.renders()).toBe(before);
  });
});

describe("another tab, another table", () => {
  test("a width kept for the same table in another tab is drawn here too", () => {
    const harness: Harness = renderHook("incidents-table");

    window.localStorage.setItem(
      keyOf("incidents-table"),
      JSON.stringify({ title: 333 }),
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: keyOf("incidents-table") }),
      );
    });

    expect(harness.widths()).toEqual({ title: 333 });
  });

  test("another table's change in another tab is not this table's", () => {
    const harness: Harness = renderHook("incidents-table");

    act(() => {
      harness.latest().setColumnWidth("title", 410);
    });

    window.localStorage.setItem(
      keyOf("alerts-table"),
      JSON.stringify({ x: 1 }),
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: keyOf("alerts-table") }),
      );
    });

    expect(harness.widths()).toEqual({ title: 410 });
  });

  test("signing out in another tab (storage cleared) clears the widths here", () => {
    const harness: Harness = renderHook("incidents-table");

    act(() => {
      harness.latest().setColumnWidth("title", 410);
    });

    window.localStorage.clear();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(harness.widths()).toBe(EMPTY_COLUMN_WIDTHS);
  });

  test("a component that draws another table reads that table's widths", () => {
    window.localStorage.setItem(
      keyOf("alerts-table"),
      JSON.stringify({ title: 280 }),
    );

    const harness: Harness = renderHook("incidents-table");

    harness.rerender("alerts-table");

    expect(harness.widths()).toEqual({ title: 280 });

    act(() => {
      harness.latest().setColumnWidth("owner", 150);
    });

    expect(
      JSON.parse(window.localStorage.getItem(keyOf("alerts-table")) || "{}"),
    ).toEqual({ title: 280, owner: 150 });
    expect(window.localStorage.getItem(keyOf("incidents-table"))).toBeNull();
  });
});

describe("the widths' store", () => {
  test("tells those who read it, and only when the widths change", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore();
    const listener: Mock<() => void> = jest.fn<() => void>();
    const unsubscribe: () => void = store.subscribe(listener);
    const widths: ColumnWidths = { title: 300 };

    store.setWidths(widths);
    store.setWidths(widths);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setWidths({ title: 200 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("a reader of whether any column is sized is drawn again only when that changes", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore();
    let renders: number = 0;
    let latest: boolean = false;

    const Reader: () => ReactElement = (): ReactElement => {
      latest = useColumnWidthsValue(store, (widths: ColumnWidths): boolean => {
        return widths["title"] !== undefined;
      });
      renders++;

      return <></>;
    };

    render(<Reader />);
    expect(latest).toBe(false);

    act(() => {
      store.setWidths({ title: 300 });
    });
    const afterFirst: number = renders;
    expect(latest).toBe(true);

    act(() => {
      store.setWidths({ title: 320 });
      store.setWidths({ title: 340, owner: 100 });
    });

    expect(renders).toBe(afterFirst);

    act(() => {
      store.setWidths(EMPTY_COLUMN_WIDTHS);
    });
    expect(latest).toBe(false);
  });

  test("a reader of every width is drawn again with each", () => {
    const store: ColumnWidthsStore = new ColumnWidthsStore({ title: 100 });
    let latest: ColumnWidths = EMPTY_COLUMN_WIDTHS;

    const Reader: () => ReactElement = (): ReactElement => {
      latest = useColumnWidthsSnapshot(store);

      return <></>;
    };

    render(<Reader />);
    expect(latest).toEqual({ title: 100 });

    act(() => {
      store.setWidths({ title: 180 });
    });
    expect(latest).toEqual({ title: 180 });
  });

  test("no store reads as no widths", () => {
    let latest: ColumnWidths | null = null;

    const Reader: () => ReactElement = (): ReactElement => {
      latest = useColumnWidthsSnapshot(undefined);

      return <></>;
    };

    render(<Reader />);
    expect(latest).toBe(EMPTY_COLUMN_WIDTHS);
  });
});
