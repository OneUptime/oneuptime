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
import useFacetSidebarWidth, {
  UseFacetSidebarWidthResult,
  forgetFacetSidebarWidths,
  getFacetSidebarWidthStorageKey,
  readStoredFacetSidebarWidth,
  writeStoredFacetSidebarWidth,
} from "../../../../UI/Components/TelemetryViewer/useFacetSidebarWidth";
import {
  FACET_SIDEBAR_MAX_WIDTH_IN_PX,
  FACET_SIDEBAR_MIN_WIDTH_IN_PX,
} from "../../../../UI/Components/TelemetryViewer/FacetSidebarWidth";
import User from "../../../../UI/Utils/User";
import ObjectID from "../../../../Types/ObjectID";
import { UserPreferenceType } from "../../../../Utils/UserPreferences";
import { KEYS_KEPT_AFTER_SIGN_OUT } from "../../../../UI/Utils/KeptAfterSignOut";

/*
 * Where the filters sidebar's width is remembered: in the browser, one entry
 * per person (UserPreferences' FacetSidebarWidth), beside a table's column
 * widths - read when a sidebar is drawn, written when a width is kept,
 * taken away when the sidebar is given back its own. Every sidebar on the
 * page draws the one width, and so does the same person's page in another
 * tab; a browser that refuses storage still sizes the sidebar while the
 * page is open.
 */

const PERSON_A: string = "8a3b0c3e-0000-4000-8000-0000000000aa";
const PERSON_B: string = "8a3b0c3e-0000-4000-8000-0000000000bb";

/*
 * The browser's storage, as its methods: @jest/globals types
 * spyOn(Storage.prototype, ...) as never, Storage having a string index
 * signature.
 */
const STORAGE: {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} = Storage.prototype;

let person: string = PERSON_A;

beforeEach(() => {
  person = PERSON_A;
  window.localStorage.clear();
  forgetFacetSidebarWidths();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(person);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  forgetFacetSidebarWidths();
});

const keyOf: (personId?: string) => string = (
  personId: string = PERSON_A,
): string => {
  return `${UserPreferenceType.FacetSidebarWidth}.${personId}`;
};

// What a sidebar reads: the hook, its width written out.
let latest: Record<string, UseFacetSidebarWidthResult> = {};

function Reader(props: { name: string }): ReactElement {
  const result: UseFacetSidebarWidthResult = useFacetSidebarWidth();
  latest[props.name] = result;

  return (
    <span data-testid={`width-${props.name}`}>
      {result.width === null ? "own" : String(result.width)}
    </span>
  );
}

const widthOf: (name: string) => string = (name: string): string => {
  return screen.getByTestId(`width-${name}`).textContent || "";
};

beforeEach(() => {
  latest = {};
});

// Another tab writes the width, and this one hears of it.
const anotherTabWrites: (key: string, value: string | null) => void = (
  key: string,
  value: string | null,
): void => {
  if (value === null) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, value);
  }

  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: key }));
  });
};

describe("reading the width", () => {
  test("nothing stored: the sidebar is its own width", () => {
    render(<Reader name="a" />);

    expect(widthOf("a")).toBe("own");
    expect(latest["a"]?.width).toBeNull();
  });

  test("a stored width is read under the person's own entry", () => {
    window.localStorage.setItem(keyOf(), "320");

    render(<Reader name="a" />);

    expect(widthOf("a")).toBe("320");
  });

  test("the storage key is the preference type, then the person", () => {
    expect(getFacetSidebarWidthStorageKey(PERSON_A)).toBe(
      `FacetSidebarWidth.${PERSON_A}`,
    );
  });

  test("a stored width out of bounds is held to them", () => {
    window.localStorage.setItem(keyOf(), "12");
    expect(readStoredFacetSidebarWidth(PERSON_A)).toBe(
      FACET_SIDEBAR_MIN_WIDTH_IN_PX,
    );

    window.localStorage.setItem(keyOf(), "100000");
    expect(readStoredFacetSidebarWidth(PERSON_A)).toBe(
      FACET_SIDEBAR_MAX_WIDTH_IN_PX,
    );
  });

  test("a stored value that is not a width is no width: the sidebar is its own", () => {
    for (const value of [
      "not json at all {",
      '"wide"',
      "[320]",
      '{"width":320}',
      "true",
      "0",
      "-5",
      "null",
    ]) {
      window.localStorage.setItem(keyOf(), value);
      forgetFacetSidebarWidths();

      render(<Reader name="a" />);

      expect({ value, width: widthOf("a") }).toEqual({ value, width: "own" });
      cleanup();
    }
  });

  test("another person's width is theirs: two people on one browser keep their own", () => {
    window.localStorage.setItem(keyOf(PERSON_B), "500");

    render(<Reader name="a" />);
    expect(widthOf("a")).toBe("own");
    cleanup();

    person = PERSON_B;
    render(<Reader name="b" />);
    expect(widthOf("b")).toBe("500");
  });

  test("with no one signed in, one width for whoever reads the page", () => {
    jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
      throw new Error("no one is signed in");
    });
    window.localStorage.setItem(
      `${UserPreferenceType.FacetSidebarWidth}.anyone`,
      "260",
    );

    render(<Reader name="a" />);

    expect(widthOf("a")).toBe("260");
  });

  test("a browser that refuses reads leaves the sidebar its own width", () => {
    jest.spyOn(STORAGE, "getItem").mockImplementation((): string | null => {
      throw new Error("SecurityError: storage is disabled");
    });

    render(<Reader name="a" />);

    expect(widthOf("a")).toBe("own");
  });
});

describe("keeping a width", () => {
  test("is written under the person's own entry and drawn at once", () => {
    render(<Reader name="a" />);

    act(() => {
      latest["a"]?.setWidth(360);
    });

    expect(widthOf("a")).toBe("360");
    expect(window.localStorage.getItem(keyOf())).toBe("360");
  });

  test("is held to the bounds before it is written", () => {
    render(<Reader name="a" />);

    act(() => {
      latest["a"]?.setWidth(5000);
    });

    expect(widthOf("a")).toBe(String(FACET_SIDEBAR_MAX_WIDTH_IN_PX));
    expect(window.localStorage.getItem(keyOf())).toBe(
      String(FACET_SIDEBAR_MAX_WIDTH_IN_PX),
    );
  });

  test("null gives the sidebar back its own width, and forgets the entry", () => {
    window.localStorage.setItem(keyOf(), "360");
    render(<Reader name="a" />);

    act(() => {
      latest["a"]?.setWidth(null);
    });

    expect(widthOf("a")).toBe("own");
    expect(window.localStorage.getItem(keyOf())).toBeNull();
  });

  test("every sidebar on the page draws it: one width for every explorer", () => {
    render(
      <>
        <Reader name="logs" />
        <Reader name="traces" />
      </>,
    );

    act(() => {
      latest["logs"]?.setWidth(410);
    });

    expect(widthOf("logs")).toBe("410");
    expect(widthOf("traces")).toBe("410");
  });

  test("a sidebar drawn later reads the width kept before it", () => {
    render(<Reader name="metrics" />);

    act(() => {
      latest["metrics"]?.setWidth(300);
    });
    cleanup();

    render(<Reader name="logs" />);
    expect(widthOf("logs")).toBe("300");
  });

  test("touches no one else's entry, and nothing else in the browser", () => {
    window.localStorage.setItem(keyOf(PERSON_B), "500");
    window.localStorage.setItem("theme", "dark");
    render(<Reader name="a" />);

    act(() => {
      latest["a"]?.setWidth(250);
    });

    expect(window.localStorage.getItem(keyOf(PERSON_B))).toBe("500");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(window.localStorage.length).toBe(3);
  });

  test("a browser that refuses to store it still sizes the sidebar while the page is open", () => {
    jest.spyOn(STORAGE, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });
    render(
      <>
        <Reader name="a" />
        <Reader name="b" />
      </>,
    );

    act(() => {
      latest["a"]?.setWidth(330);
    });

    expect(widthOf("a")).toBe("330");
    expect(widthOf("b")).toBe("330");
  });

  test("writeStoredFacetSidebarWidth says when the browser refused it", () => {
    expect(writeStoredFacetSidebarWidth(PERSON_A, 300)).toBe(true);
    expect(window.localStorage.getItem(keyOf())).toBe("300");
    expect(writeStoredFacetSidebarWidth(PERSON_A, null)).toBe(true);
    expect(window.localStorage.getItem(keyOf())).toBeNull();

    jest.spyOn(STORAGE, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });
    jest.spyOn(STORAGE, "removeItem").mockImplementation((): void => {
      throw new Error("SecurityError");
    });

    expect(writeStoredFacetSidebarWidth(PERSON_A, 300)).toBe(false);
    expect(writeStoredFacetSidebarWidth(PERSON_A, null)).toBe(false);
  });

  test("keeping the width already kept draws nothing again", () => {
    let renders: number = 0;

    function Counter(): ReactElement {
      const result: UseFacetSidebarWidthResult = useFacetSidebarWidth();
      renders++;
      latest["counter"] = result;
      return <span>{String(result.width)}</span>;
    }

    render(<Counter />);

    act(() => {
      latest["counter"]?.setWidth(300);
    });
    const rendersAfterFirst: number = renders;

    act(() => {
      latest["counter"]?.setWidth(300);
    });

    expect(renders).toBe(rendersAfterFirst);
  });
});

describe("the same person's page in another tab", () => {
  test("a width kept there is drawn here", () => {
    render(<Reader name="a" />);

    anotherTabWrites(keyOf(), "440");

    expect(widthOf("a")).toBe("440");
  });

  test("a width taken away there is taken away here", () => {
    window.localStorage.setItem(keyOf(), "440");
    render(<Reader name="a" />);

    anotherTabWrites(keyOf(), null);

    expect(widthOf("a")).toBe("own");
  });

  test("another key's change is not this width's", () => {
    window.localStorage.setItem(keyOf(), "300");
    render(<Reader name="a" />);

    // Someone else's width, and an unrelated setting, change in another tab.
    window.localStorage.setItem(keyOf(), "999");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: keyOf(PERSON_B) }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
    });

    expect(widthOf("a")).toBe("300");
  });

  test("the browser's storage cleared there (signing out) gives this sidebar its own width", () => {
    window.localStorage.setItem(keyOf(), "300");
    render(<Reader name="a" />);

    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(widthOf("a")).toBe("own");
  });

  test("a sidebar no longer drawn stops listening", () => {
    const removeListener: jest.SpiedFunction<
      typeof window.removeEventListener
    > = jest.spyOn(window, "removeEventListener");

    render(<Reader name="a" />);
    cleanup();

    expect(
      removeListener.mock.calls.some((call: Array<unknown>): boolean => {
        return call[0] === "storage";
      }),
    ).toBe(true);
  });
});

describe("signing out", () => {
  test("forgets the width: it is not one of the keys a browser keeps for the next person", () => {
    for (const key of KEYS_KEPT_AFTER_SIGN_OUT) {
      expect(key.startsWith(UserPreferenceType.FacetSidebarWidth)).toBe(false);
    }
  });
});
