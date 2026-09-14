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
import LockedFilterChip, {
  COPIED_FEEDBACK_MS,
  COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
  COPY_FAILED_ANNOUNCEMENT,
  LockedFilterTooltipContent,
  getLockedFilterChipAriaLabel,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import { LockedFilterDetail } from "../../../Types/Telemetry/LockedFilterDetail";

/*
 * The grey lock chip on a resource page's telemetry tab. It used to say only
 * "(applied filter)"; with a LockedFilterDetail it explains what the filter
 * matches, why it is locked, and hands over the search syntax — from the
 * keyboard too, since the tooltip's own Copy button sits in a popover Tab
 * never reaches. Without a detail it must look and behave exactly as before:
 * a plain pill that is not a tab stop.
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

function clusterDetail(
  overrides: Partial<LockedFilterDetail> = {},
): LockedFilterDetail {
  return {
    source: "Pinned by this page",
    summary: "Only logs from this Kubernetes cluster are shown.",
    predicates: [
      {
        label: "Attribute",
        expression: 'resource.k8s.cluster.name = "prod-eks-01"',
        note: "Rows ingested before entity keys existed match on this attribute.",
      },
      {
        label: "Entity key",
        expression: "entityKeys has 3f9a1b2c4d5e6f70",
      },
    ],
    combinator: "any",
    searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    ...overrides,
  };
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
  test("is a button named for the filter, with the Enter hint, and no plain title", () => {
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
  });

  test("a chip whose syntax cannot be copied is named without the Enter hint", () => {
    render(
      <LockedFilterChip
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={clusterDetail({
          searchToken: undefined,
          searchTokenUnavailableReason: "Session filters have no syntax.",
        })}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: getLockedFilterChipAriaLabel("Session", "s-1"),
      }),
    ).toBeInTheDocument();
  });

  test("renders the trailing element beside the button, never inside it", () => {
    render(
      <LockedFilterChip
        displayKey="Trace"
        displayValue="abc"
        lockedDetail={clusterDetail({ searchToken: "trace:abc" })}
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
  });

  test("hover opens the explanation", async () => {
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

    expect(tooltip).toHaveTextContent("Locked filter");
    expect(tooltip).toHaveTextContent(
      "Only logs from this Kubernetes cluster are shown.",
    );
    expect(tooltip).toHaveTextContent("Pinned by this page");
    expect(tooltip).toHaveTextContent(
      'resource.k8s.cluster.name = "prod-eks-01"',
    );
    expect(tooltip).toHaveTextContent("@resource.k8s.cluster.name:prod-eks-01");
  });

  test("keyboard focus opens the explanation too", async () => {
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

    expect(screen.getByRole("tooltip")).toHaveTextContent("Locked filter");
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

    expect(writeText).toHaveBeenCalledWith(
      "@resource.k8s.cluster.name:prod-eks-01",
    );
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

  test("activating a chip without syntax copies nothing and announces nothing", async () => {
    render(
      <LockedFilterChip
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={clusterDetail({ searchToken: undefined })}
      />,
    );

    await activate(
      screen.getByRole("button", {
        name: getLockedFilterChipAriaLabel("Session", "s-1"),
      }),
    );

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
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

    expect(onClick).not.toHaveBeenCalled();
  });

  test("says so when nothing could be copied", async () => {
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
  });

  test("copies through the legacy command when the async clipboard is absent", async () => {
    installClipboard(undefined);
    const execCommand: ReturnType<
      typeof jest.fn<(command: string) => boolean>
    > = jest.fn<(command: string) => boolean>((): boolean => {
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
    expect(screen.getByRole("status")).toHaveTextContent(
      COPIED_SEARCH_SYNTAX_ANNOUNCEMENT,
    );
  });
});

describe("LockedFilterTooltipContent", () => {
  test("shows the chip, the summary, the source and every predicate", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const content: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(content).toHaveTextContent("Cluster: production");
    expect(content).toHaveTextContent(
      "Only logs from this Kubernetes cluster are shown.",
    );
    expect(content).toHaveTextContent("Pinned by this page");
    expect(screen.getByText("Attribute")).toBeInTheDocument();
    expect(
      screen.getByText('resource.k8s.cluster.name = "prod-eks-01"'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Rows ingested before entity keys existed match on this attribute.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Entity key")).toBeInTheDocument();
    expect(
      screen.getByText("entityKeys has 3f9a1b2c4d5e6f70"),
    ).toBeInTheDocument();
  });

  test("says (any of) for OR-ed predicates and (all of) otherwise", () => {
    const { unmount } = render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail({ combinator: "any" })}
      />,
    );

    expect(
      screen.getByText("How rows are matched (any of)"),
    ).toBeInTheDocument();

    unmount();

    render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail({ combinator: "all" })}
      />,
    );

    expect(
      screen.getByText("How rows are matched (all of)"),
    ).toBeInTheDocument();
  });

  test("names no combinator for a single predicate", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail({
          predicates: [
            {
              label: "Attribute",
              expression: 'resource.k8s.cluster.name = "prod-eks-01"',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("How rows are matched")).toBeInTheDocument();
    expect(screen.queryByText(/any of|all of/)).not.toBeInTheDocument();
  });

  test("omits the matching section when there are no predicates", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={clusterDetail({ predicates: [] })}
      />,
    );

    expect(screen.queryByText(/How rows are matched/)).not.toBeInTheDocument();
  });

  test("names the explorer the search syntax is for", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="traces"
      />,
    );

    expect(screen.getByTestId("locked-filter-search-token")).toHaveTextContent(
      "@resource.k8s.cluster.name:prod-eks-01",
    );
    expect(
      screen.getByText("Paste into the Traces explorer search bar."),
    ).toBeInTheDocument();
  });

  test("the copy button writes the token to the clipboard and says Copied! for a moment", async () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Copy search syntax",
    });

    await activate(button);

    expect(writeText).toHaveBeenCalledWith(
      "@resource.k8s.cluster.name:prod-eks-01",
    );
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
        displayKey="Cluster"
        displayValue="production"
        lockedDetail={clusterDetail()}
        signal="logs"
      />,
    );

    await activate(screen.getByRole("button", { name: "Copy search syntax" }));

    expect(
      screen.getByRole("button", { name: "Copy failed" }),
    ).toHaveTextContent("Copy failed");
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();

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
        <LockedFilterTooltipContent
          displayKey="Cluster"
          displayValue="production"
          lockedDetail={clusterDetail()}
        />
      </div>,
    );

    await activate(screen.getByRole("button", { name: "Copy search syntax" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  test("shows the reason instead of the syntax when the filter has none", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="logtype"
        displayValue="is any of web, api"
        lockedDetail={clusterDetail({
          searchToken: undefined,
          searchTokenUnavailableReason:
            "Operator filters have no search syntax yet.",
        })}
        signal="logs"
      />,
    );

    expect(screen.getByText("Search syntax")).toBeInTheDocument();
    expect(
      screen.getByText("Operator filters have no search syntax yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("locked-filter-search-token"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy search syntax" }),
    ).not.toBeInTheDocument();
  });

  test("omits the syntax section entirely when there is neither a token nor a reason", () => {
    render(
      <LockedFilterTooltipContent
        displayKey="Session"
        displayValue="s-1"
        lockedDetail={clusterDetail({
          searchToken: undefined,
          searchTokenUnavailableReason: undefined,
        })}
      />,
    );

    expect(screen.queryByText("Search syntax")).not.toBeInTheDocument();
  });
});
