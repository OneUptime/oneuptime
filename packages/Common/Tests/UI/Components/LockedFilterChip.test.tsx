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
import React from "react";
import LockedFilterChip, {
  COPIED_FEEDBACK_MS,
  COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
  COPY_FAILED_ANNOUNCEMENT,
  LockedFilterTooltipContent,
  NO_SEARCH_SYNTAX_REASON,
  getLockedFilterChipAriaLabel,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import { LockedFilterDetail } from "../../../Types/Telemetry/LockedFilterDetail";

/*
 * The grey lock chip on a resource page's telemetry tab. A LockedFilterDetail
 * carries only the search syntax that reproduces the filter on the explorer,
 * or the reason there is none, and the chip's tooltip shows exactly that
 * under a "Search syntax" heading — the token with a Copy button and where to
 * paste it, or the reason. The chip hands the token over from the keyboard
 * too, since the tooltip's own Copy button sits in a popover Tab never
 * reaches. Without a detail it must look and behave exactly as before: a
 * plain pill that is not a tab stop.
 */

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let writeText: WriteTextMock;

const originalExecCommand: unknown = (
  document as unknown as Record<string, unknown>
)["execCommand"];

const CLUSTER_SEARCH_TOKEN: string = "@resource.k8s.cluster.name:prod-eks-01";
const TRACE_SEARCH_TOKEN: string = "trace:abc";
const SESSION_REASON: string = "Session filters have no syntax.";
const OPERATOR_REASON: string = "Operator filters have no search syntax yet.";

function installClipboard(mock: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: mock ? { writeText: mock } : undefined,
    configurable: true,
  });
}

function installExecCommand(
  execCommand: ((command: string) => boolean) | undefined,
): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  writeText = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  installClipboard(writeText);
  installExecCommand(undefined);
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

// A locked detail for a cluster chip: its search token, plus any overrides.
function clusterDetail(
  overrides: Partial<LockedFilterDetail> = {},
): LockedFilterDetail {
  return {
    searchToken: CLUSTER_SEARCH_TOKEN,
    ...overrides,
  };
}

/*
 * Everything a tooltip with syntax says, in document order: its heading, the
 * token, the Copy button's label and where to paste the token.
 */
function searchSyntaxText(
  searchToken: string,
  explorerLabel?: string | undefined,
): string {
  const pasteHint: string = explorerLabel
    ? `Paste into the ${explorerLabel} explorer search bar.`
    : "Paste into the explorer search bar.";

  return `Search syntax${searchToken}Copy${pasteHint}`;
}

// Everything a tooltip without syntax says: its heading and the reason.
function unavailableReasonText(reason: string): string {
  return `Search syntax${reason}`;
}

const CLUSTER_LABEL: string = getLockedFilterChipAriaLabel(
  "Cluster",
  "production",
  true,
);

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

async function activate(control: HTMLElement): Promise<void> {
  // Enter / Space on a native button arrive as a click.
  await act(async () => {
    fireEvent.click(control);
  });
}

describe("getLockedFilterChipAriaLabel", () => {
  test("names the filter and says it is locked", () => {
    expect(getLockedFilterChipAriaLabel("Cluster", "production")).toBe(
      "Cluster: production, locked filter",
    );
  });

  test("tells a keyboard user what Enter does when there is syntax to copy", () => {
    expect(getLockedFilterChipAriaLabel("Cluster", "production", true)).toBe(
      "Cluster: production, locked filter. Press Enter to copy its search syntax.",
    );
  });
});

describe("LockedFilterChip without a detail", () => {
  test("renders the lock pill exactly as before: plain title, not a tab stop, no name of its own", () => {
    render(<LockedFilterChip displayKey="Cluster" displayValue="production" />);

    const chip: HTMLElement = screen.getByTestId("locked-filter-chip");

    expect(chip).toHaveAttribute(
      "title",
      "Cluster: production (applied filter)",
    );
    expect(chip).not.toHaveAttribute("tabindex");
    expect(chip).not.toHaveAttribute("aria-label");
    expect(chip).not.toHaveAttribute("role");
    expect(chip.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(chip.className).toContain("bg-gray-100");
    expect(screen.getByText("Cluster:")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  test("renders the trailing element inside the pill", () => {
    render(
      <LockedFilterChip
        displayKey="Trace"
        displayValue="abc"
        trailing={<a href="/traces/view/abc">open</a>}
      />,
    );

    const chip: HTMLElement = screen.getByTestId("locked-filter-chip");

    expect(chip.querySelector("a")).toHaveAttribute("href", "/traces/view/abc");
  });

  test("opens no tooltip on hover", async () => {
    render(<LockedFilterChip displayKey="Cluster" displayValue="production" />);

    await hover(screen.getByTestId("locked-filter-chip"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("LockedFilterChip with a detail", () => {
  test("is a button named for the filter, with the Enter hint, and no plain title", async () => {
    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const chip: HTMLElement = screen.getByTestId("locked-filter-chip");
    const control: HTMLElement = screen.getByRole("button", {
      name: CLUSTER_LABEL,
    });

    expect(chip).not.toHaveAttribute("title");
    expect(chip).toContainElement(control);
    expect(control).toHaveAttribute("type", "button");
    expect(control).toHaveTextContent("Cluster:");
    expect(control).toHaveTextContent("production");

    await hover(control);

    expect(
      within(screen.getByRole("tooltip")).getByTestId(
        "locked-filter-search-token",
      ).textContent,
    ).toBe(CLUSTER_SEARCH_TOKEN);
  });

  test("a chip whose syntax cannot be copied is named without the Enter hint and gives its reason", async () => {
    render(
      <LockedFilterChip
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={{ searchTokenUnavailableReason: SESSION_REASON }}
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Session", "s-1"),
    });

    expect(control).toBeInTheDocument();

    await hover(control);

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip.textContent).toBe(unavailableReasonText(SESSION_REASON));
    expect(
      within(tooltip).queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
  });

  test("renders the trailing element beside the button, never inside it", async () => {
    render(
      <LockedFilterChip
        displayKey="Trace"
        displayValue="abc"
        lockedDetail={{ searchToken: TRACE_SEARCH_TOKEN }}
        signal="traces"
        trailing={<a href="/traces/view/abc">open</a>}
      />,
    );

    const chip: HTMLElement = screen.getByTestId("locked-filter-chip");
    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Trace", "abc", true),
    });
    const link: HTMLElement = screen.getByRole("link", { name: "open" });

    expect(chip).toContainElement(link);
    expect(control).not.toContainElement(link);

    await hover(control);

    expect(screen.getByRole("tooltip").textContent).toBe(
      searchSyntaxText(TRACE_SEARCH_TOKEN, "Traces"),
    );
  });

  test("hover opens the search syntax and nothing else", async () => {
    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    await hover(screen.getByRole("button", { name: CLUSTER_LABEL }));

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Search syntax");
    expect(
      within(tooltip).getByTestId("locked-filter-search-token").textContent,
    ).toBe(CLUSTER_SEARCH_TOKEN);
    expect(tooltip).toHaveTextContent(
      "Paste into the Logs explorer search bar.",
    );
    // The heading, the token, its Copy button and the paste hint — no more.
    expect(tooltip.textContent).toBe(
      searchSyntaxText(CLUSTER_SEARCH_TOKEN, "Logs"),
    );
    expect(tooltip.querySelectorAll("code")).toHaveLength(1);
    expect(within(tooltip).getAllByRole("button")).toHaveLength(1);
  });

  test("keyboard focus opens the search syntax too", async () => {
    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: CLUSTER_LABEL,
    });

    act(() => {
      control.focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(150);
    });

    expect(
      within(screen.getByRole("tooltip")).getByTestId(
        "locked-filter-search-token",
      ).textContent,
    ).toBe(CLUSTER_SEARCH_TOKEN);
  });

  test("activating the chip copies its search syntax, shows the tick and announces it", async () => {
    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: CLUSTER_LABEL,
    });

    await activate(control);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CLUSTER_SEARCH_TOKEN);
    expect(screen.getByRole("status")).toHaveTextContent(
      COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
    );
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "text-emerald-500",
    );

    await act(async () => {
      jest.advanceTimersByTime(COPIED_FEEDBACK_MS + 10);
    });

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "text-gray-400",
    );
  });

  test("activating a chip without syntax copies nothing, announces nothing and says it has none", async () => {
    render(
      <LockedFilterChip
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={{ searchToken: undefined }}
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Session", "s-1"),
    });

    await activate(control);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");

    await hover(control);

    expect(screen.getByRole("tooltip").textContent).toBe(
      unavailableReasonText(NO_SEARCH_SYNTAX_REASON),
    );
  });

  test("activating a chip with only a reason copies nothing and announces nothing", async () => {
    render(
      <LockedFilterChip
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={{ searchTokenUnavailableReason: SESSION_REASON }}
        signal="logs"
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Session", "s-1"),
    });

    await activate(control);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "text-gray-400",
    );
  });

  test("an empty detail — neither a token nor a reason — is still a button, without the Enter hint, that copies nothing and gives the fallback reason", async () => {
    render(
      <LockedFilterChip
        displayKey="Resource"
        displayValue="3f9a1b2c4d5e6f70"
        lockedDetail={{}}
        signal="traces"
      />,
    );

    const chip: HTMLElement = screen.getByTestId("locked-filter-chip");
    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Resource", "3f9a1b2c4d5e6f70"),
    });

    expect(chip).not.toHaveAttribute("title");
    expect(chip).toContainElement(control);

    await activate(control);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");

    await hover(control);

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip.textContent).toBe(
      unavailableReasonText(NO_SEARCH_SYNTAX_REASON),
    );
    expect(
      within(tooltip).queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
    expect(within(tooltip).queryByRole("button")).not.toBeInTheDocument();
  });

  test("the activation does not bubble to whatever holds the chip row", async () => {
    const onClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <div onClick={onClick}>
        <LockedFilterChip
          displayKey="Cluster"
          displayValue="production"
          lockedDetail={clusterDetail()}
        />
      </div>,
    );

    await activate(screen.getByRole("button", { name: CLUSTER_LABEL }));

    expect(writeText).toHaveBeenCalledWith(CLUSTER_SEARCH_TOKEN);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("says so when nothing could be copied, and still shows the syntax to copy by hand", async () => {
    installClipboard(undefined);

    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: CLUSTER_LABEL,
    });

    await activate(control);

    expect(screen.getByRole("status")).toHaveTextContent(
      COPY_FAILED_ANNOUNCEMENT,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
    );
    expect(control.querySelector("svg")?.getAttribute("class")).toContain(
      "text-rose-500",
    );

    await hover(control);

    expect(
      within(screen.getByRole("tooltip")).getByTestId(
        "locked-filter-search-token",
      ).textContent,
    ).toBe(CLUSTER_SEARCH_TOKEN);
  });

  test("copies through the legacy command when the async clipboard is absent", async () => {
    installClipboard(undefined);
    const selectedTexts: Array<string | undefined> = [];
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
      // The legacy path copies whatever the hidden textarea holds right now.
      selectedTexts.push(
        document.querySelector<HTMLTextAreaElement>("textarea[readonly]")
          ?.value,
      );
      return true;
    });
    installExecCommand(execCommand);

    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
      />,
    );

    await activate(screen.getByRole("button", { name: CLUSTER_LABEL }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selectedTexts).toEqual([CLUSTER_SEARCH_TOKEN]);
    expect(screen.getByRole("status")).toHaveTextContent(
      COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
    );
  });
});

describe("LockedFilterTooltipContent", () => {
  test("shows only the search syntax: its heading, the token, a Copy button and where to paste it", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const content: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(screen.getByText("Search syntax")).toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-search-token").textContent).toBe(
      CLUSTER_SEARCH_TOKEN,
    );
    expect(
      screen.getByRole("button", { name: "Copy search syntax" }),
    ).toBeInTheDocument();
    // It does not repeat the chip it belongs to, or say anything else.
    expect(content).not.toHaveTextContent("Cluster: production");
    expect(content.textContent).toBe(
      searchSyntaxText(CLUSTER_SEARCH_TOKEN, "Logs"),
    );
  });

  test("the only code block and the only button belong to the search syntax", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const content: HTMLElement = screen.getByTestId("locked-filter-tooltip");
    const codeBlocks: NodeListOf<HTMLElement> =
      content.querySelectorAll("code");
    const buttons: Array<HTMLElement> = screen.getAllByRole("button");

    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]?.textContent).toBe(CLUSTER_SEARCH_TOKEN);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Copy search syntax");
  });

  test("shows the token, not the reason, when the detail carries both", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail({
          searchTokenUnavailableReason: OPERATOR_REASON,
        })}
        signal="metrics"
      />,
    );

    const content: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(screen.getByTestId("locked-filter-search-token").textContent).toBe(
      CLUSTER_SEARCH_TOKEN,
    );
    expect(screen.queryByText(OPERATOR_REASON)).not.toBeInTheDocument();
    expect(content.textContent).toBe(
      searchSyntaxText(CLUSTER_SEARCH_TOKEN, "Metrics"),
    );
  });

  test("names the explorer the search syntax is for", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail()}
        signal="traces"
      />,
    );

    expect(screen.getByTestId("locked-filter-search-token").textContent).toBe(
      CLUSTER_SEARCH_TOKEN,
    );
    expect(
      screen.getByText("Paste into the Traces explorer search bar."),
    ).toBeInTheDocument();
  });

  test("names no explorer without a signal", () => {
    render(<LockedFilterTooltipContent lockedDetail={clusterDetail()} />);

    expect(
      screen.getByText("Paste into the explorer search bar."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-tooltip").textContent).toBe(
      searchSyntaxText(CLUSTER_SEARCH_TOKEN),
    );
  });

  test("the copy button writes the token to the clipboard and says Copied! for a moment", async () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Copy search syntax",
    });

    await activate(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CLUSTER_SEARCH_TOKEN);
    expect(screen.getByRole("button", { name: "Copied" })).toHaveTextContent(
      "Copied!",
    );

    await act(async () => {
      jest.advanceTimersByTime(COPIED_FEEDBACK_MS + 10);
    });

    expect(
      screen.getByRole("button", { name: "Copy search syntax" }),
    ).toHaveTextContent("Copy");
  });

  test("the copy button says Copy failed, not Copied!, when nothing was copied", async () => {
    installClipboard(undefined);

    render(
      <LockedFilterTooltipContent
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    await activate(screen.getByRole("button", { name: "Copy search syntax" }));

    expect(
      screen.getByRole("button", { name: "Copy failed" }),
    ).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    // The token stays on screen to be selected by hand.
    expect(screen.getByTestId("locked-filter-search-token").textContent).toBe(
      CLUSTER_SEARCH_TOKEN,
    );

    await act(async () => {
      jest.advanceTimersByTime(COPIED_FEEDBACK_MS + 10);
    });

    expect(
      screen.getByRole("button", { name: "Copy search syntax" }),
    ).toHaveTextContent("Copy");
  });

  test("the copy click does not bubble to whatever holds the chip", async () => {
    const onClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <div onClick={onClick}>
        <LockedFilterTooltipContent lockedDetail={clusterDetail()} />
      </div>,
    );

    await activate(screen.getByRole("button", { name: "Copy search syntax" }));

    expect(writeText).toHaveBeenCalledWith(CLUSTER_SEARCH_TOKEN);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("shows the reason instead of the syntax when the filter has none", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={{ searchTokenUnavailableReason: OPERATOR_REASON }}
        signal="logs"
      />,
    );

    expect(screen.getByText("Search syntax")).toBeInTheDocument();
    expect(screen.getByText(OPERATOR_REASON)).toBeInTheDocument();
    expect(
      screen.queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy search syntax" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-tooltip").textContent).toBe(
      unavailableReasonText(OPERATOR_REASON),
    );
  });

  test("says the filter has no search syntax when the detail names neither a token nor a reason", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={{
          searchToken: undefined,
          searchTokenUnavailableReason: undefined,
        }}
      />,
    );

    expect(screen.getByText("Search syntax")).toBeInTheDocument();
    expect(screen.getByText(NO_SEARCH_SYNTAX_REASON)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-tooltip").textContent).toBe(
      unavailableReasonText(NO_SEARCH_SYNTAX_REASON),
    );
  });

  test("an empty detail object says the filter has no search syntax, with no token and no Copy button", () => {
    render(<LockedFilterTooltipContent lockedDetail={{}} signal="metrics" />);

    expect(
      screen.queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-tooltip").textContent).toBe(
      unavailableReasonText(NO_SEARCH_SYNTAX_REASON),
    );
  });

  test("the fallback reason reads word for word as the Dashboard describers' generic one", () => {
    /*
     * A detail the describers leave without a reason and one they give the
     * generic reason must read the same in the tooltip.
     */
    expect(NO_SEARCH_SYNTAX_REASON).toBe("This filter has no search syntax.");
  });

  test("an empty token and an empty reason count as none: nothing to copy, and the fallback reason", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={{ searchToken: "", searchTokenUnavailableReason: "" }}
        signal="logs"
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-filter-tooltip").textContent).toBe(
      unavailableReasonText(NO_SEARCH_SYNTAX_REASON),
    );
  });
});
