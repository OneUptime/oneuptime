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
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import AttributesJSONView from "../../../../UI/Components/AttributesJSON/AttributesJSONView";
import AttributesViewToggle from "../../../../UI/Components/AttributesJSON/AttributesViewToggle";
import CopyAttributesAsJSONButton from "../../../../UI/Components/AttributesJSON/CopyAttributesAsJSONButton";
import {
  ATTRIBUTES_JSON_FORMAT_PREFERENCE,
  ATTRIBUTES_VIEW_PREFERENCE,
  AttributesView,
  readPreference,
  resetPreferencesForTesting,
  useAttributesJSONFormat,
  useAttributesView,
  writePreference,
} from "../../../../UI/Components/AttributesJSON/AttributesJSONPreferences";
import Clipboard from "../../../../UI/Utils/Clipboard";
import { AttributesJSONFormat } from "../../../../Utils/Telemetry/AttributesJSON";

/*
 * The JSON view beside an attribute list, the List / JSON switch above it,
 * and the two remembered choices behind them (which shape, which view). The
 * view shows exactly the text "Copy JSON" copies, coloured, with line
 * numbers - and renders values as text, never as markup.
 */

const ATTRIBUTES: Record<string, unknown> = {
  "http.request.method": "GET",
  "http.response.status_code": 200,
  "error.handled": false,
  "user.id": null,
};

function codeText(): string {
  const pre: HTMLElement = screen.getByLabelText(
    /Attributes as (flat|nested) JSON/,
  );
  // Each line is a row: gutter number, then the code.
  return Array.from(pre.querySelectorAll("code > div"))
    .map((row: Element) => {
      return (row.lastElementChild as HTMLElement).textContent || "";
    })
    .join("\n");
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesForTesting();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("AttributesJSONView", () => {
  test("shows the flat JSON, line by line, exactly as it will be copied", () => {
    render(<AttributesJSONView attributes={ATTRIBUTES} />);

    expect(codeText()).toBe(
      [
        "{",
        '  "error.handled": false,',
        '  "http.request.method": "GET",',
        '  "http.response.status_code": 200,',
        '  "user.id": null',
        "}",
      ].join("\n"),
    );
  });

  test("numbers every line", () => {
    render(<AttributesJSONView attributes={ATTRIBUTES} />);

    const pre: HTMLElement = screen.getByLabelText("Attributes as flat JSON");
    const gutters: Array<string> = Array.from(
      pre.querySelectorAll("code > div > span:first-child"),
    ).map((gutter: Element) => {
      return gutter.textContent || "";
    });

    expect(gutters).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("colours keys, strings, numbers, booleans and null differently", () => {
    render(<AttributesJSONView attributes={ATTRIBUTES} />);

    const pre: HTMLElement = screen.getByLabelText("Attributes as flat JSON");
    const classOf: (text: string) => string = (text: string): string => {
      const token: Element | undefined = Array.from(
        pre.querySelectorAll("span"),
      ).find((span: Element) => {
        return span.textContent === text && span.children.length === 0;
      });
      expect(token).toBeDefined();
      return token!.className;
    };

    expect(classOf('"http.request.method"')).toContain("text-indigo-700");
    expect(classOf('"GET"')).toContain("text-emerald-700");
    expect(classOf("200")).toContain("text-amber-700");
    expect(classOf("false")).toContain("text-sky-700");
    expect(classOf("null")).toContain("text-gray-400");
  });

  test("switches to nested JSON and remembers it", () => {
    render(<AttributesJSONView attributes={ATTRIBUTES} />);

    const shapes: HTMLElement = screen.getByRole("group", {
      name: "JSON shape",
    });
    const flat: HTMLElement = within(shapes).getByRole("button", {
      name: "Flat",
    });
    const nested: HTMLElement = within(shapes).getByRole("button", {
      name: "Nested",
    });

    expect(flat).toHaveAttribute("aria-pressed", "true");
    expect(nested).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(nested);

    expect(nested).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(codeText())).toEqual({
      error: { handled: false },
      http: { request: { method: "GET" }, response: { status_code: 200 } },
      user: { id: null },
    });
    expect(
      window.localStorage.getItem(ATTRIBUTES_JSON_FORMAT_PREFERENCE.storageKey),
    ).toBe("nested");
  });

  test("follows a shape picked in the Copy JSON menu beside it", async () => {
    jest.spyOn(Clipboard, "copyToClipboard").mockResolvedValue(true);

    render(
      <div>
        <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
        <AttributesJSONView attributes={ATTRIBUTES} />
      </div>,
    );

    expect(
      screen.getByLabelText("Attributes as flat JSON"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Choose JSON format" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Nested/ }));
    });

    expect(
      screen.getByLabelText("Attributes as nested JSON"),
    ).toBeInTheDocument();
  });

  test("renders values as text, never as markup", () => {
    const { container } = render(
      <AttributesJSONView
        attributes={{
          "http.user_agent": '<img src=x onerror="window.__pwned=1">',
          "<b>key</b>": "bold?",
        }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(codeText()).toContain(
      '"http.user_agent": "<img src=x onerror=\\"window.__pwned=1\\">"',
    );
  });

  test("explains the shape it is showing", () => {
    render(<AttributesJSONView attributes={ATTRIBUTES} />);
    expect(
      screen.getByText("Dotted keys, exactly as recorded"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nested" }));
    expect(screen.getByText("Dots expanded into objects")).toBeInTheDocument();
  });

  test("caps its height unless told otherwise", () => {
    const { rerender } = render(
      <AttributesJSONView attributes={ATTRIBUTES} dataTestId="json" />,
    );
    const scroller: () => HTMLElement = (): HTMLElement => {
      return screen.getByLabelText(/Attributes as/).parentElement!;
    };

    expect(scroller().className).toContain("max-h-80");

    rerender(
      <AttributesJSONView
        attributes={ATTRIBUTES}
        dataTestId="json"
        maxHeightClassName="max-h-none"
      />,
    );

    expect(scroller().className).toContain("max-h-none");
    expect(screen.getByTestId("json")).toBeInTheDocument();
  });

  test("shows an empty object when there are no attributes", () => {
    render(<AttributesJSONView attributes={undefined} />);
    expect(codeText()).toBe("{}");
  });
});

describe("AttributesViewToggle", () => {
  test("marks the current view and reports the other one when picked", () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();

    render(<AttributesViewToggle value="list" onChange={onChange} />);

    const group: HTMLElement = screen.getByRole("group", {
      name: "Show attributes as",
    });
    const list: HTMLElement = within(group).getByRole("button", {
      name: "List",
    });
    const json: HTMLElement = within(group).getByRole("button", {
      name: "JSON",
    });

    expect(list).toHaveAttribute("aria-pressed", "true");
    expect(json).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(json);
    expect(onChange).toHaveBeenCalledWith("json");
  });

  test("clicking the current view does nothing", () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();

    render(<AttributesViewToggle value="json" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("names the group after what it shows", () => {
    render(
      <AttributesViewToggle
        value="list"
        onChange={() => {}}
        subject="event attributes"
        dataTestId="toggle"
      />,
    );

    expect(
      screen.getByRole("group", { name: "Show event attributes as" }),
    ).toBe(screen.getByTestId("toggle"));
  });

  test("clicks do not bubble to a clickable row behind it", () => {
    const rowClick: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <div onClick={rowClick}>
        <AttributesViewToggle value="list" onChange={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    expect(rowClick).not.toHaveBeenCalled();
  });
});

describe("attribute preferences", () => {
  test("default to the flat shape and the list view", () => {
    expect(readPreference(ATTRIBUTES_JSON_FORMAT_PREFERENCE)).toBe("flat");
    expect(readPreference(ATTRIBUTES_VIEW_PREFERENCE)).toBe("list");
  });

  test("read a stored choice and ignore a value that is not one", () => {
    window.localStorage.setItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey, "json");
    expect(readPreference(ATTRIBUTES_VIEW_PREFERENCE)).toBe("json");

    window.localStorage.setItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey, "table");
    expect(readPreference(ATTRIBUTES_VIEW_PREFERENCE)).toBe("list");
  });

  test("still work for the session when storage is blocked", () => {
    // Blocked site data makes merely reading window.localStorage throw.
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: (): Storage => {
        throw new Error("SecurityError");
      },
    });

    try {
      expect(readPreference(ATTRIBUTES_JSON_FORMAT_PREFERENCE)).toBe("flat");
      expect(() => {
        writePreference(ATTRIBUTES_JSON_FORMAT_PREFERENCE, "nested");
      }).not.toThrow();
      expect(readPreference(ATTRIBUTES_JSON_FORMAT_PREFERENCE)).toBe("nested");
    } finally {
      if (original) {
        Object.defineProperty(window, "localStorage", original);
      }
    }
  });

  test("the view choice is shared by every section on the page", () => {
    const first: { current: [AttributesView, (view: AttributesView) => void] } =
      renderHook(() => {
        return useAttributesView();
      }).result;
    const second: {
      current: [AttributesView, (view: AttributesView) => void];
    } = renderHook(() => {
      return useAttributesView();
    }).result;

    act(() => {
      first.current[1]("json");
    });

    expect(first.current[0]).toBe("json");
    expect(second.current[0]).toBe("json");
    expect(
      window.localStorage.getItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey),
    ).toBe("json");
  });

  test("the shape and the view are separate choices", () => {
    const format: {
      current: [AttributesJSONFormat, (value: AttributesJSONFormat) => void];
    } = renderHook(() => {
      return useAttributesJSONFormat();
    }).result;
    const view: {
      current: [AttributesView, (view: AttributesView) => void];
    } = renderHook(() => {
      return useAttributesView();
    }).result;

    act(() => {
      view.current[1]("json");
    });

    expect(format.current[0]).toBe("flat");
  });

  test("a hook stops listening once unmounted", () => {
    const { unmount } = renderHook(() => {
      return useAttributesView();
    });
    const removeListener: ReturnType<typeof jest.spyOn> = jest.spyOn(
      window,
      "removeEventListener",
    );

    unmount();

    expect(removeListener).toHaveBeenCalledWith(
      ATTRIBUTES_VIEW_PREFERENCE.eventName,
      expect.any(Function),
    );
  });
});
