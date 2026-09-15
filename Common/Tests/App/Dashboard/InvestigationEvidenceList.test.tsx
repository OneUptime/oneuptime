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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Evidence checked" is where a responder verifies the AI: which queries ran,
 * what each one asked, and the rows behind it. Loading rows re-runs a query
 * with the viewer's own permissions, so these tests pin the request contract
 * (one POST per citation per run, the exact body, stale responses ignored)
 * as well as what each state tells the reader.
 */

const postMock: MockFunction = getJestMockFunction();
const getFriendlyMessageMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const widgetRendererMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>) => {
        return getFriendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<unknown>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        widgets: Array<AIChatWidget>;
      }): React.ReactElement => {
        widgetRendererMock(props);
        return React.createElement(
          "div",
          { "data-testid": "evidence-widget" },
          props.widgets
            .map((widget: AIChatWidget): string => {
              return widget.title;
            })
            .join(","),
        );
      },
    };
  },
);

import InvestigationEvidenceList, {
  ComponentProps as EvidenceListProps,
  EVIDENCE_HIGHLIGHT_DURATION_MS,
  EvidenceFocusRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationEvidenceList";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import { InvestigationEvidenceCheckedEntry } from "../../../Utils/AI/InvestigationReport";
import { formatEvidenceLabel } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  headers: JSONObject;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const NEXT_RUN_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";
const EXECUTED_AT: string = "2026-09-14T18:01:00.000Z";

const incidentsItem: InvestigationEvidenceItem = {
  citationId: "C1",
  toolName: "query_incidents",
  label: "Active incidents (7 total)",
  rowCount: 7,
  durationInMs: 1234,
  queryArguments: { state: "active", limit: 20 },
  target: { type: AIChatCitationTargetType.Incidents },
  executedAt: EXECUTED_AT,
  canLoadRows: true,
};

const logsItem: InvestigationEvidenceItem = {
  citationId: "C2",
  toolName: "search_logs",
  label: "Logs 2026-09-14T17:20:00Z – 2026-09-14T18:20:00Z (1 shown)",
  rowCount: 1,
  durationInMs: 340,
  queryArguments: {
    startTime: "2026-09-14T17:20:00.000Z",
    endTime: "2026-09-14T18:20:00.000Z",
    bodySearchText: "timeout",
  },
  target: { type: AIChatCitationTargetType.Logs },
  executedAt: EXECUTED_AT,
  canLoadRows: true,
};

const emptyItem: InvestigationEvidenceItem = {
  citationId: "C3",
  toolName: "top_exceptions",
  label: "Top exceptions, last 24h (0 found)",
  rowCount: 0,
  queryArguments: {},
  canLoadRows: false,
};

const incidentViewItem: InvestigationEvidenceItem = {
  citationId: "C4",
  toolName: "get_incident_timeline",
  label: "Incident #6954 timeline (12 entries)",
  rowCount: 12,
  queryArguments: { incidentId: INCIDENT_ID },
  target: {
    type: AIChatCitationTargetType.IncidentView,
    params: { incidentId: INCIDENT_ID },
  },
  canLoadRows: true,
};

const legacyEntries: Array<InvestigationEvidenceCheckedEntry> = [
  { citationId: "C1", label: "Active incidents (7 total)", rowCount: 7 },
  { citationId: "C2", label: "Monitors (2 found)", rowCount: 0 },
];

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
  };
}

function rowsResponse(overrides: JSONObject = {}): { data: JSONObject } {
  return {
    data: {
      citationId: "C1",
      toolName: "query_incidents",
      label: "Active incidents (7 total)",
      rowCount: 7,
      isTruncated: false,
      executedAt: "2026-09-15T09:00:00.000Z",
      isPinnedToInvestigationTime: false,
      investigatedAt: EXECUTED_AT,
      text: "id | title\n1 | Checkout down",
      ...overrides,
    },
  };
}

function renderList(
  overrides: Partial<EvidenceListProps> = {},
): ReturnType<typeof render> {
  return render(<InvestigationEvidenceList {...listProps(overrides)} />);
}

function listProps(
  overrides: Partial<EvidenceListProps> = {},
): EvidenceListProps {
  return {
    items: [incidentsItem, logsItem, emptyItem],
    legacyEntries: [],
    subjectType: "incident",
    subjectId: INCIDENT_ID,
    runId: RUN_ID,
    focusRequest: null,
    ...overrides,
  };
}

function rowToggle(label: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: label });
}

/*
 * The logs label carries ISO timestamps, which the row shows as local times.
 * The expected text is derived with the same formatter so these tests hold in
 * whatever timezone and clock the suite runs under.
 */
const LOGS_DISPLAY_LABEL: string = formatEvidenceLabel(logsItem.label);

function logsToggle(): HTMLElement {
  return screen.getByRole("button", {
    name: (accessibleName: string): boolean => {
      return accessibleName.includes(LOGS_DISPLAY_LABEL);
    },
  });
}

function postRequestAt(index: number): PostRequest {
  return postMock.mock.calls[index]![0] as PostRequest;
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const scrollIntoViewMock: MockFunction = getJestMockFunction();

beforeEach(() => {
  getCommonHeadersMock.mockReturnValue({ tenantid: "project-id" });
  getFriendlyMessageMock.mockImplementation((error: unknown): string => {
    if (error instanceof HTTPErrorResponse) {
      return error.message;
    }

    return "Request failed";
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoViewMock,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  postMock.mockReset();
  getFriendlyMessageMock.mockReset();
  getCommonHeadersMock.mockReset();
  widgetRendererMock.mockReset();
  scrollIntoViewMock.mockReset();
  delete (Element.prototype as unknown as { scrollIntoView?: unknown })
    .scrollIntoView;
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("InvestigationEvidenceList rows", () => {
  test("renders nothing without evidence or legacy entries", () => {
    const { container } = renderList({ items: [], legacyEntries: [] });

    expect(container).toBeEmptyDOMElement();
  });

  test("frames every query with a header, description and query count", () => {
    renderList();

    const section: HTMLElement = screen.getByRole("region", {
      name: "Evidence checked",
    });
    expect(
      within(section).getByRole("heading", { name: "Evidence checked" }),
    ).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "Every query OneUptime AI ran while investigating. Expand one to see what it asked and the rows it returned.",
    );
    expect(within(section).getByText("3 queries")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
  });

  test("uses the singular for a single query", () => {
    renderList({ items: [incidentsItem] });

    expect(screen.getByText("1 query")).toBeInTheDocument();
  });

  test("each row says what was checked, how and what it found", () => {
    renderList();

    const toggle: HTMLElement = rowToggle(/Active incidents \(7 total\)/);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle).getByText("C1")).toHaveClass(
      "bg-gray-900",
      "text-white",
      "tabular-nums",
    );
    expect(
      within(toggle).getByText("Active incidents (7 total)"),
    ).toHaveAttribute("title", "Active incidents (7 total)");
    // Two lines on a phone, one clamped line from the sm breakpoint.
    expect(within(toggle).getByText("Active incidents (7 total)")).toHaveClass(
      "line-clamp-2",
      "sm:line-clamp-1",
    );
    expect(toggle).toHaveTextContent("Searched incidents");
    expect(within(toggle).getByText("7 rows")).toBeInTheDocument();

    expect(within(logsToggle()).getByText("1 row")).toBeInTheDocument();
    expect(logsToggle()).toHaveTextContent("Searched logs");
  });

  test("shows a timestamped label in local time and keeps the raw label as its tooltip", () => {
    renderList();

    const toggle: HTMLElement = logsToggle();
    const label: HTMLElement = within(toggle).getByText(LOGS_DISPLAY_LABEL);

    expect(LOGS_DISPLAY_LABEL).not.toBe(logsItem.label);
    expect(LOGS_DISPLAY_LABEL).toMatch(/^Logs Sep 1[45], .+ – .+ \(1 shown\)$/);
    expect(label).toHaveAttribute("title", logsItem.label);
    expect(toggle).not.toHaveTextContent("2026-09-14T");
    expect(toggle).not.toHaveTextContent("00Z");

    // The details region is named after what the row shows.
    fireEvent.click(toggle);
    expect(
      screen.getByRole("region", { name: `${LOGS_DISPLAY_LABEL} details` }),
    ).toBeInTheDocument();
  });

  test("shows a label without timestamps exactly as written", () => {
    renderList({ items: [incidentViewItem] });

    expect(
      within(rowToggle(/Incident #6954 timeline/)).getByText(
        "Incident #6954 timeline (12 entries)",
      ),
    ).toHaveAttribute("title", "Incident #6954 timeline (12 entries)");
  });

  test("mutes a query that found nothing", () => {
    renderList();

    const toggle: HTMLElement = rowToggle(/Top exceptions/);
    expect(within(toggle).getByText("C3")).toHaveClass(
      "bg-gray-200",
      "text-gray-600",
    );
    expect(within(toggle).getByText("No rows")).toHaveClass("text-gray-400");
  });

  test("points aria-controls at a hidden details region until expanded", () => {
    renderList();

    const toggle: HTMLElement = rowToggle(/Active incidents/);
    const detailsId: string = toggle.getAttribute("aria-controls")!;
    const details: HTMLElement = document.getElementById(detailsId)!;

    expect(details).not.toBeNull();
    expect(details).toHaveAttribute("hidden");
    expect(
      screen.queryByRole("region", {
        name: "Active incidents (7 total) details",
      }),
    ).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("region", {
        name: "Active incidents (7 total) details",
      }),
    ).toBe(details);
    expect(details).not.toHaveAttribute("hidden");
  });

  test("renders hostile labels and arguments as text", () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const hostile: string = '<img src=x onerror="window.__evidencePwned=1">';

    const { container } = renderList({
      items: [
        {
          ...incidentsItem,
          label: hostile,
          queryArguments: { searchText: hostile },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /img src/ }));

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent(hostile);
    expect(
      (window as unknown as { __evidencePwned?: number }).__evidencePwned,
    ).toBeUndefined();
  });
});

describe("InvestigationEvidenceList details", () => {
  test("lists what was queried with friendly labels, run time, duration and tool", () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    renderList();

    fireEvent.click(logsToggle());

    const details: HTMLElement = screen.getByRole("region", {
      name: `${LOGS_DISPLAY_LABEL} details`,
    });
    expect(within(details).getByText("What was queried")).toBeInTheDocument();

    const terms: Array<string> = Array.from(
      details.querySelectorAll("dl dt"),
    ).map((term: Element): string => {
      return term.textContent || "";
    });
    expect(terms).toEqual(["Time window", "Search", "Ran at", "Took", "Tool"]);
    expect(within(details).getByText("“timeout”")).toBeInTheDocument();
    expect(within(details).getByText("340 ms")).toBeInTheDocument();
    expect(within(details).getByText("search_logs")).toBeInTheDocument();
  });

  test("says when a query ran with its defaults", () => {
    renderList();

    fireEvent.click(rowToggle(/Top exceptions/));

    expect(
      screen.getByText("No filters — the query ran with its defaults."),
    ).toBeInTheDocument();
  });

  test("offers Open in <page> for a query with a target", () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    renderList({ items: [incidentViewItem] });

    fireEvent.click(rowToggle(/Incident #6954 timeline/));

    const link: HTMLElement = screen.getByRole("link", {
      name: /Open in Incident/,
    });
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/incidents/${INCIDENT_ID}$`),
    );
  });

  test("offers a list page for a query targeting a list", () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    renderList({ items: [logsItem] });

    fireEvent.click(logsToggle());

    expect(
      screen.getByRole("link", { name: /Open in Logs/ }).getAttribute("href"),
    ).toMatch(/\/logs$/);
  });

  test("has no Open link without a target", () => {
    renderList({ items: [emptyItem] });

    fireEvent.click(rowToggle(/Top exceptions/));

    expect(screen.queryByRole("link")).toBeNull();
  });

  test("explains why rows are unavailable and never requests them", () => {
    renderList({ items: [emptyItem] });

    fireEvent.click(rowToggle(/Top exceptions/));

    expect(
      screen.getByText(/can't be re-run from the dashboard/),
    ).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("InvestigationEvidenceList loading rows", () => {
  test("the first expand POSTs exactly once with the run-bound body", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    await flush();

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: PostRequest = postRequestAt(0);
    expect(request.url.toString()).toContain("/ai-investigation/evidence");
    expect(request.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
      investigationRunId: RUN_ID,
      citationId: "C1",
    });
    expect(request.headers).toEqual({ tenantid: "project-id" });
  });

  test("sends the alert subject for an alert investigation", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderList({ subjectType: "alert" });

    fireEvent.click(rowToggle(/Active incidents/));
    await flush();

    expect(postRequestAt(0).data["subjectType"]).toBe("alert");
  });

  test("shows a loading placeholder while the rows load", async () => {
    const pending: Deferred<unknown> = createDeferred<unknown>();
    postMock.mockReturnValue(pending.promise as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    const details: HTMLElement = screen.getByRole("region", {
      name: "Active incidents (7 total) details",
    });
    const status: HTMLElement = within(details).getByRole("status");
    expect(status).toHaveTextContent("Loading rows");
    expect(status).toHaveAttribute("aria-live", "polite");

    await act(async (): Promise<void> => {
      pending.resolve(rowsResponse());
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(within(details).queryByRole("status")).toBeNull();
    });
  });

  test("caches rows across collapse and re-expand", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderList();

    const toggle: HTMLElement = rowToggle(/Active incidents/);
    fireEvent.click(toggle);
    expect(await screen.findByText(/Checkout down/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    await flush();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Checkout down/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("does not start a duplicate request when toggled quickly", async () => {
    const pending: Deferred<unknown> = createDeferred<unknown>();
    postMock.mockReturnValue(pending.promise as never);
    renderList();

    const toggle: HTMLElement = rowToggle(/Active incidents/);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("loads each citation independently", async () => {
    postMock
      .mockResolvedValueOnce(rowsResponse() as never)
      .mockResolvedValueOnce(
        rowsResponse({
          citationId: "C2",
          text: "18:01 ERROR upstream timeout",
          rowCount: 1,
        }) as never,
      );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    fireEvent.click(logsToggle());

    expect(await screen.findByText(/upstream timeout/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postRequestAt(1).data["citationId"]).toBe("C2");
  });

  test("renders a widget through the chat widget renderer", async () => {
    const widget: JSONObject = {
      id: "W1",
      citationId: "C1",
      type: AIChatWidgetType.IncidentList,
      title: "Active incidents",
      data: { items: [{ id: INCIDENT_ID, title: "Checkout down" }] },
    };
    postMock.mockResolvedValue(
      rowsResponse({ widget, text: undefined }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByTestId("evidence-widget")).toHaveTextContent(
      "Active incidents",
    );
    const props: { widgets: Array<AIChatWidget> } = widgetRendererMock.mock
      .calls[0]![0] as { widgets: Array<AIChatWidget> };
    expect(props.widgets).toHaveLength(1);
    expect(props.widgets[0]).toEqual(
      expect.objectContaining({
        id: "W1",
        type: AIChatWidgetType.IncidentList,
        title: "Active incidents",
      }),
    );
    expect(document.querySelector("pre")).toBeNull();
  });

  test("renders plain-text rows in a scrollable pre when there is no widget", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    const text: HTMLElement = await screen.findByText(/Checkout down/);
    expect(text.tagName).toBe("PRE");
    expect(text).toHaveClass("max-h-80", "overflow-auto");
    expect(text.textContent).toBe("id | title\n1 | Checkout down");
    expect(screen.queryByTestId("evidence-widget")).toBeNull();
  });

  test("shows an empty state when the re-run returns no rows", async () => {
    postMock.mockResolvedValue(
      rowsResponse({ rowCount: 0, text: "[]" }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByText("No rows returned.")).toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
  });

  test("keeps the server's explanation next to an empty re-run", async () => {
    const message: string =
      'No monitor status matches "Degraded". Statuses in this project: Operational, Offline.';
    postMock.mockResolvedValue(
      rowsResponse({ rowCount: 0, text: `\n${message}  ` }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    const details: HTMLElement = screen.getByRole("region", {
      name: "Active incidents (7 total) details",
    });
    const emptyState: HTMLElement =
      await within(details).findByText("No rows returned.");
    const explanation: HTMLElement = within(details).getByText(message);

    expect(explanation.tagName).toBe("P");
    expect(explanation.textContent).toBe(message);
    expect(explanation).toHaveClass("text-gray-500", "break-words");
    // Read after the empty state, inside the same box.
    expect(emptyState.parentElement).toBe(explanation.parentElement);
    expect(
      emptyState.compareDocumentPosition(explanation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Still an empty state, not a result.
    expect(document.querySelector("pre")).toBeNull();
    expect(screen.queryByTestId("evidence-widget")).toBeNull();
  });

  test("keeps the line breaks of a multi-line explanation", async () => {
    const message: string =
      "file: src/pool.ts\nrepository: acme/api@main\n\n(this file is empty — 0 bytes)";
    postMock.mockResolvedValue(
      rowsResponse({ rowCount: 0, text: message }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByText("No rows returned.")).toBeInTheDocument();
    const explanation: HTMLElement = screen.getByText(/this file is empty/);
    expect(explanation.textContent).toBe(message);
    expect(explanation).toHaveClass("whitespace-pre-line");
  });

  test.each([
    ["an empty JSON list", "[]"],
    ["an empty JSON object", "{}"],
    ["the serializer's empty rows", "(no rows found)"],
    ["the serializer's empty text", "  (no data found)\n"],
    ["blank text", "   "],
  ])(
    "adds nothing to an empty re-run whose text is %s",
    async (_description: string, text: string) => {
      postMock.mockResolvedValue(rowsResponse({ rowCount: 0, text }) as never);
      renderList();

      fireEvent.click(rowToggle(/Active incidents/));

      const emptyState: HTMLElement =
        await screen.findByText("No rows returned.");
      expect(emptyState.tagName).toBe("P");
      expect(emptyState).toHaveClass("text-center");
      expect(emptyState.textContent).toBe("No rows returned.");

      const rows: HTMLElement = screen.getByRole("group", { name: "Rows" });
      expect(rows.querySelectorAll("p")).toHaveLength(1);

      if (text.trim()) {
        expect(rows).not.toHaveTextContent(text.trim());
      }
    },
  );

  test("shows only the empty state when an empty re-run has no text", async () => {
    postMock.mockResolvedValue(
      rowsResponse({ rowCount: 0, text: undefined }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByText("No rows returned.")).toHaveClass(
      "text-center",
    );
    expect(
      screen.getByRole("group", { name: "Rows" }).querySelectorAll("p"),
    ).toHaveLength(1);
  });

  test("tells the reader when rows come from the same time window", async () => {
    postMock.mockResolvedValue(
      rowsResponse({ isPinnedToInvestigationTime: true }) as never,
    );
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(
      await screen.findByText(
        "Re-run with your permissions over the same time window the AI used.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Shows current data/)).toBeNull();
  });

  test("warns that live rows may differ from what the AI saw", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    const notice: HTMLElement = await screen.findByText(
      /Shows current data with your permissions — it may differ from what the AI saw at /,
    );
    expect(notice.textContent).toMatch(/at .+\.$/);
    expect(
      screen.queryByText(
        "Re-run with your permissions over the same time window the AI used.",
      ),
    ).toBeNull();
  });

  test("notes a truncated result", async () => {
    postMock.mockResolvedValue(rowsResponse({ isTruncated: true }) as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(
      await screen.findByText(
        "The result was long, so only part of it is shown.",
      ),
    ).toBeInTheDocument();
  });

  test("shows the API error and retries on Try again", async () => {
    postMock
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          { message: "This evidence is no longer available." },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(rowsResponse() as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load these rows");
    expect(alert).toHaveTextContent("This evidence is no longer available.");
    expect(screen.queryByText(/Checkout down/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/Checkout down/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postRequestAt(1).data).toEqual(postRequestAt(0).data);
  });

  test("keeps keyboard focus inside the details while a retry loads", async () => {
    const retry: Deferred<unknown> = createDeferred<unknown>();
    postMock
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          { message: "This evidence is no longer available." },
          {},
        ) as never,
      )
      .mockReturnValueOnce(retry.promise as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    await screen.findByRole("alert");

    const details: HTMLElement = screen.getByRole("region", {
      name: "Active incidents (7 total) details",
    });
    const rows: HTMLElement = within(details).getByRole("group", {
      name: "Rows",
    });
    expect(rows).toHaveAttribute("tabindex", "-1");

    const tryAgain: HTMLElement = within(details).getByRole("button", {
      name: "Try again",
    });
    tryAgain.focus();
    expect(document.activeElement).toBe(tryAgain);

    fireEvent.click(tryAgain);

    // The button is gone while the rows reload; focus stays on the Rows block.
    expect(within(rows).getByRole("status")).toHaveTextContent("Loading rows");
    expect(tryAgain).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(rows);
    expect(details).toContainElement(document.activeElement as HTMLElement);

    await act(async (): Promise<void> => {
      retry.resolve(rowsResponse());
      await Promise.resolve();
    });

    expect(await within(rows).findByText(/Checkout down/)).toBeInTheDocument();
    expect(document.activeElement).toBe(rows);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("keeps focus on the Rows block when a retry fails again", async () => {
    postMock.mockRejectedValue(new Error("offline") as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    await screen.findByRole("alert");

    const rows: HTMLElement = screen.getByRole("group", { name: "Rows" });
    const tryAgain: HTMLElement = within(rows).getByRole("button", {
      name: "Try again",
    });
    tryAgain.focus();
    fireEvent.click(tryAgain);

    expect(await within(rows).findByRole("alert")).toHaveTextContent(
      "Request failed",
    );
    expect(document.activeElement).toBe(rows);
    // The next Tab reaches a fresh Try again inside the same block.
    expect(
      within(rows).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("shows a network failure as an error", async () => {
    postMock.mockRejectedValue(new Error("offline") as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request failed",
    );
  });

  test("treats a response that is not rows as an error", async () => {
    postMock.mockResolvedValue({ data: { nope: true } } as never);
    renderList();

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The rows for this query could not be read.",
    );
  });

  test("never requests rows without a run id", async () => {
    renderList({ runId: null });

    fireEvent.click(rowToggle(/Active incidents/));
    await flush();

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The investigation run could not be identified.",
    );
  });

  test("ignores a response that lands after the subject changed", async () => {
    const stale: Deferred<unknown> = createDeferred<unknown>();
    postMock
      .mockReturnValueOnce(stale.promise as never)
      .mockResolvedValueOnce(
        rowsResponse({ text: "id | title\n2 | Other subject rows" }) as never,
      );
    const view: ReturnType<typeof render> = renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    expect(postMock).toHaveBeenCalledTimes(1);

    view.rerender(
      <InvestigationEvidenceList
        {...listProps({ subjectId: OTHER_INCIDENT_ID })}
      />,
    );
    await flush();

    // Nothing expanded for the previous subject carries over.
    expect(rowToggle(/Active incidents/)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await act(async (): Promise<void> => {
      stale.resolve(rowsResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(rowToggle(/Active incidents/));

    expect(await screen.findByText(/Other subject rows/)).toBeInTheDocument();
    expect(screen.queryByText(/Checkout down/)).toBeNull();
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postRequestAt(1).data).toEqual({
      subjectType: "incident",
      subjectId: OTHER_INCIDENT_ID,
      investigationRunId: RUN_ID,
      citationId: "C1",
    });
  });

  test("does not reuse cached rows for a new run on the same subject", async () => {
    postMock
      .mockResolvedValueOnce(rowsResponse() as never)
      .mockResolvedValueOnce(
        rowsResponse({
          text: "id | title\n3 | Rows from the new run",
        }) as never,
      );
    const view: ReturnType<typeof render> = renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    expect(await screen.findByText(/Checkout down/)).toBeInTheDocument();

    view.rerender(
      <InvestigationEvidenceList {...listProps({ runId: NEXT_RUN_ID })} />,
    );
    await flush();

    expect(screen.queryByText(/Checkout down/)).toBeNull();
    fireEvent.click(rowToggle(/Active incidents/));

    expect(
      await screen.findByText(/Rows from the new run/),
    ).toBeInTheDocument();
    expect(postRequestAt(1).data["investigationRunId"]).toBe(NEXT_RUN_ID);
  });

  test("ignores a response that lands after unmount", async () => {
    const pending: Deferred<unknown> = createDeferred<unknown>();
    postMock.mockReturnValue(pending.promise as never);
    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {
        return undefined;
      });
    const view: ReturnType<typeof render> = renderList();

    fireEvent.click(rowToggle(/Active incidents/));
    view.unmount();

    await act(async (): Promise<void> => {
      pending.resolve(rowsResponse());
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("InvestigationEvidenceList focus requests", () => {
  function focus(citationId: string, requestId: number): EvidenceFocusRequest {
    return { citationId, requestId };
  }

  test("expands, scrolls to and briefly highlights the requested citation", async () => {
    jest.useFakeTimers();
    postMock.mockResolvedValue(
      rowsResponse({ citationId: "C2", text: "18:01 ERROR timeout" }) as never,
    );
    const view: ReturnType<typeof render> = renderList();

    view.rerender(
      <InvestigationEvidenceList
        {...listProps({ focusRequest: focus("C2", 1) })}
      />,
    );
    await flush();

    const toggle: HTMLElement = logsToggle();
    const row: HTMLElement = toggle.closest("li")!;
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(row).toHaveClass("ring-2", "ring-indigo-400");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
    expect(document.activeElement).toBe(toggle);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postRequestAt(0).data["citationId"]).toBe("C2");
    expect(jest.getTimerCount()).toBe(1);

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(EVIDENCE_HIGHLIGHT_DURATION_MS);
    });

    expect(row).not.toHaveAttribute("data-highlighted");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("respects reduced motion when scrolling", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string): { matches: boolean } => {
        return { matches: query === "(prefers-reduced-motion: reduce)" };
      },
    });
    postMock.mockReturnValue(new Promise(() => {}) as never);

    renderList({ focusRequest: focus("C1", 1) });
    await flush();

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "auto",
    });
  });

  test("keeps a single highlight timer across repeated requests and clears it on unmount", async () => {
    jest.useFakeTimers();
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderList({
      focusRequest: focus("C1", 1),
    });
    await flush();
    expect(jest.getTimerCount()).toBe(1);

    view.rerender(
      <InvestigationEvidenceList
        {...listProps({ focusRequest: focus("C3", 2) })}
      />,
    );
    await flush();

    expect(jest.getTimerCount()).toBe(1);
    expect(rowToggle(/Top exceptions/).closest("li")).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    expect(rowToggle(/Active incidents/).closest("li")).not.toHaveAttribute(
      "data-highlighted",
    );

    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("repeats a request for the same citation with a new id", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderList({
      focusRequest: focus("C1", 1),
    });
    await flush();

    // The reader collapses it, then clicks the same chip again.
    fireEvent.click(rowToggle(/Active incidents/));
    expect(rowToggle(/Active incidents/)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    view.rerender(
      <InvestigationEvidenceList
        {...listProps({ focusRequest: focus("C1", 2) })}
      />,
    );
    await flush();

    expect(rowToggle(/Active incidents/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    // Still one request for that citation on this run.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("does nothing for a citation that is not in the list", async () => {
    jest.useFakeTimers();
    renderList({ focusRequest: focus("C42", 1) });
    await flush();

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
  });

  test("a re-render with the same request does not scroll again", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const request: EvidenceFocusRequest = focus("C1", 1);
    const view: ReturnType<typeof render> = renderList({
      focusRequest: request,
    });
    await flush();

    view.rerender(
      <InvestigationEvidenceList
        {...listProps({ focusRequest: { ...request } })}
      />,
    );
    await flush();

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});

describe("InvestigationEvidenceList legacy reports", () => {
  test("lists the report's own evidence entries without expanding rows", () => {
    renderList({ items: [], legacyEntries });

    const section: HTMLElement = screen.getByRole("region", {
      name: "Evidence checked",
    });
    expect(section).toHaveTextContent(
      "Every query OneUptime AI ran while investigating.",
    );
    expect(section).not.toHaveTextContent("Expand one");
    expect(within(section).getByText("2 queries")).toBeInTheDocument();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(section).getByText("Active incidents (7 total)"),
    ).toHaveAttribute("title", "Active incidents (7 total)");
    expect(within(section).getByText("7 rows")).toBeInTheDocument();
    expect(within(section).getByText("No rows")).toBeInTheDocument();
    expect(within(section).getByText("C2")).toHaveClass("bg-gray-200");
  });

  test("shows a legacy entry's timestamps in local time with the raw label as its tooltip", () => {
    const rawLabel: string =
      "Changes 2026-09-13T18:02:00.000Z → 2026-09-14T18:02:00.000Z (3 events)";

    renderList({
      items: [],
      legacyEntries: [{ citationId: "C5", label: rawLabel, rowCount: 3 }],
    });

    const section: HTMLElement = screen.getByRole("region", {
      name: "Evidence checked",
    });
    const label: HTMLElement = within(section).getByText(
      formatEvidenceLabel(rawLabel),
    );

    expect(label).toHaveAttribute("title", rawLabel);
    expect(label.textContent).toMatch(
      /^Changes Sep 1[34], .+ → Sep 1[45], .+ \(3 events\)$/,
    );
    expect(section).not.toHaveTextContent("2026-09-13T");
  });

  test("prefers structured evidence over the legacy entries", () => {
    renderList({ items: [incidentsItem], legacyEntries });

    expect(screen.getByText("1 query")).toBeInTheDocument();
    expect(screen.queryByText("Monitors (2 found)")).toBeNull();
  });

  test("highlights a legacy entry for a focus request without requesting rows", async () => {
    renderList({
      items: [],
      legacyEntries,
      focusRequest: { citationId: "C2", requestId: 1 },
    });
    await flush();

    const row: HTMLElement = screen
      .getByText("Monitors (2 found)")
      .closest("li")!;
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(postMock).not.toHaveBeenCalled();
  });
});
