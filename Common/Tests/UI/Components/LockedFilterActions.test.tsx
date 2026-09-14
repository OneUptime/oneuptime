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
} from "@testing-library/react";
import React from "react";
import LockedFilterActions, {
  formatNotCarriedSuffix,
  getCopyLockedFiltersAriaLabel,
  getOpenExplorerAriaLabel,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterActions";
import { COPIED_FEEDBACK_MS } from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Protocol from "../../../Types/API/Protocol";
import Hostname from "../../../Types/API/Hostname";

/*
 * The "Copy filter" / "Open in <explorer>" pair that follows the locked chips.
 * It exists so a whole pinned scope — every locked chip at once — can be taken
 * to the main explorer for that signal. The caveat about what the link
 * cannot carry must reach a screen reader before the link is activated, and
 * a copy that reached no clipboard must not be reported as a success.
 */

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let writeText: WriteTextMock;

const originalExecCommand: unknown = (
  document as unknown as Record<string, unknown>
)["execCommand"];

function installClipboard(mock: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: mock ? { writeText: mock } : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  writeText = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  installClipboard(writeText);
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  Object.defineProperty(document, "execCommand", {
    value: originalExecCommand,
    configurable: true,
    writable: true,
  });
});

const COPY_TEXT: string =
  "@resource.host.name:web-01 @resource.container.runtime:docker";

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

describe("LockedFilterActions", () => {
  test("renders nothing when there is nothing to copy and nowhere to go", () => {
    const { container } = render(<LockedFilterActions signal="logs" />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });

  test("a blank copy text counts as nothing to copy", () => {
    const { container } = render(
      <LockedFilterActions signal="logs" copyText="   " />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("is a named group", () => {
    render(<LockedFilterActions signal="logs" copyText={COPY_TEXT} />);

    expect(
      screen.getByRole("group", { name: "Locked filter actions" }),
    ).toBeInTheDocument();
  });

  test("copy alone renders the copy button and no link", () => {
    render(<LockedFilterActions signal="logs" copyText={COPY_TEXT} />);

    expect(
      screen.getByRole("button", {
        name: getCopyLockedFiltersAriaLabel("Logs"),
      }),
    ).toHaveTextContent("Copy filter");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("the copy button writes every locked filter's syntax and says Copied! for a moment", async () => {
    render(<LockedFilterActions signal="logs" copyText={COPY_TEXT} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: getCopyLockedFiltersAriaLabel("Logs"),
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith(COPY_TEXT);
    expect(button).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(COPIED_FEEDBACK_MS + 10);
    });

    expect(button).toHaveTextContent("Copy filter");
  });

  test("the copy button says Copy failed, not Copied!, when no clipboard took the text", async () => {
    installClipboard(undefined);

    render(<LockedFilterActions signal="logs" copyText={COPY_TEXT} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: getCopyLockedFiltersAriaLabel("Logs"),
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toHaveTextContent("Copy failed");
    expect(button).not.toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(COPIED_FEEDBACK_MS + 10);
    });

    expect(button).toHaveTextContent("Copy filter");
  });

  test("the copy button's tooltip explains the paste target and shows the text", async () => {
    render(<LockedFilterActions signal="traces" copyText={COPY_TEXT} />);

    await hover(
      screen.getByRole("button", {
        name: getCopyLockedFiltersAriaLabel("Traces"),
      }),
    );

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Traces explorer search bar");
    expect(tooltip).toHaveTextContent(COPY_TEXT);
  });

  test("the copy click does not bubble to whatever holds the chip row", async () => {
    const onClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <div onClick={onClick}>
        <LockedFilterActions signal="logs" copyText={COPY_TEXT} />
      </div>,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: getCopyLockedFiltersAriaLabel("Logs"),
        }),
      );
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  test("the explorer link carries the route's href and is named by its visible text", () => {
    const route: Route = new Route(
      "/dashboard/p1/logs?filters=%5B%5B%22attributes.resource.host.name%22%2C%5B%22web-01%22%5D%5D%5D",
    );

    render(<LockedFilterActions signal="logs" openExplorerRoute={route} />);

    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Logs"),
    });

    expect(link).toHaveAttribute("href", route.toString());
    expect(link).toHaveTextContent("Open in Logs");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a full URL with query params is rendered as-is", () => {
    const url: URL = new URL(
      Protocol.HTTPS,
      new Hostname("oneuptime.test"),
      new Route("/dashboard/p1/traces"),
    );
    url.addQueryParam("filters", '[["attributes.k","v"]]', true);
    url.addQueryParam("range", "Past 1 Hour", true);

    render(<LockedFilterActions signal="traces" openExplorerRoute={url} />);

    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Traces"),
    });

    expect(link).toHaveAttribute("href", url.toString());
    expect(link.getAttribute("href")).toContain("/dashboard/p1/traces?");
    expect(link.getAttribute("href")).toContain("filters=");
    expect(link.getAttribute("href")).toContain("range=");
  });

  test("the caveat is part of the link's accessible name, not only of a hover bubble", () => {
    render(
      <LockedFilterActions
        signal="metrics"
        openExplorerRoute={new Route("/dashboard/p1/metrics")}
        notCarried={["session", "trace ID"]}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Metrics", ["session", "trace ID"]),
    });

    expect(link).toHaveAccessibleName(
      "Open in Metrics — not carried over: session, trace ID",
    );
    // The caveat is for the screen reader; the eye gets the tooltip.
    expect(link.querySelector(".sr-only")).toHaveTextContent(
      "not carried over: session, trace ID",
    );
  });

  test("no native title anywhere in the group — one bubble, the tooltip's", async () => {
    render(
      <LockedFilterActions
        signal="metrics"
        copyText={COPY_TEXT}
        openExplorerRoute={new Route("/dashboard/p1/metrics")}
        notCarried={["session", "trace ID"]}
      />,
    );

    const group: HTMLElement = screen.getByTestId("locked-filter-actions");

    expect(group.querySelectorAll("[title]")).toHaveLength(0);

    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Metrics", ["session", "trace ID"]),
    });

    expect(link).not.toHaveAttribute("title");

    /*
     * The tooltip is anchored to the span around the link (Tippy needs a
     * ref the Link component cannot take); a pointer entering the link has
     * entered the span, and mouseenter does not bubble, so hover the anchor.
     */
    await hover(link.parentElement!);

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Opens the Metrics explorer with these filters applied — not carried over: session, trace ID",
    );
  });

  test("the link's tooltip and name carry no caveat when everything travels", async () => {
    render(
      <LockedFilterActions
        signal="logs"
        openExplorerRoute={new Route("/dashboard/p1/logs")}
        notCarried={[]}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Logs"),
    });

    expect(link).toHaveAccessibleName("Open in Logs");
    expect(link.querySelector(".sr-only")).toBeNull();

    await hover(link.parentElement!);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Opens the Logs explorer with these filters applied",
    );
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("not carried");
  });

  test("copy and open render side by side in one group, copy first", () => {
    render(
      <LockedFilterActions
        signal="logs"
        copyText={COPY_TEXT}
        openExplorerRoute={new Route("/dashboard/p1/logs")}
      />,
    );

    const group: HTMLElement = screen.getByTestId("locked-filter-actions");
    const button: HTMLElement = screen.getByRole("button", {
      name: getCopyLockedFiltersAriaLabel("Logs"),
    });
    const link: HTMLElement = screen.getByRole("link", {
      name: getOpenExplorerAriaLabel("Logs"),
    });

    expect(group).toContainElement(button);
    expect(group).toContainElement(link);
    expect(
      button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test.each([
    ["logs", "Logs"],
    ["traces", "Traces"],
    ["metrics", "Metrics"],
  ] as Array<["logs" | "traces" | "metrics", string]>)(
    "%s names its explorer %s in both controls",
    (signal: "logs" | "traces" | "metrics", label: string) => {
      render(
        <LockedFilterActions
          signal={signal}
          copyText="@k:v"
          openExplorerRoute={new Route("/x")}
        />,
      );

      expect(
        screen.getByRole("button", {
          name: getCopyLockedFiltersAriaLabel(label),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: getOpenExplorerAriaLabel(label) }),
      ).toHaveTextContent(`Open in ${label}`);
    },
  );
});

describe("formatNotCarriedSuffix", () => {
  test("is empty for nothing, undefined or only blank labels", () => {
    expect(formatNotCarriedSuffix(undefined)).toBe("");
    expect(formatNotCarriedSuffix([])).toBe("");
    expect(formatNotCarriedSuffix(["", "  "])).toBe("");
  });

  test("lists the labels", () => {
    expect(formatNotCarriedSuffix(["session", "severity"])).toBe(
      " — not carried over: session, severity",
    );
  });
});

describe("getOpenExplorerAriaLabel", () => {
  test("is the visible text alone when everything travels", () => {
    expect(getOpenExplorerAriaLabel("Logs")).toBe("Open in Logs");
    expect(getOpenExplorerAriaLabel("Logs", [])).toBe("Open in Logs");
  });

  test("appends the caveat when something does not", () => {
    expect(getOpenExplorerAriaLabel("Traces", ["severity"])).toBe(
      "Open in Traces — not carried over: severity",
    );
  });
});
