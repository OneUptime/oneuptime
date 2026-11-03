/**
 * @timezone UTC
 */
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

/*
 * The pieces every resource product's part pages are built from
 * (Components/ResourcePart): what needs attention, the hero above a part's
 * tabs, its details, what is open on it and which of its alerts are on -
 * each rendered for real, with only the reads behind the last two stood in.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

let mockOpenIssues: {
  records: Array<Record<string, unknown>>;
  incidentCount: number | null;
  alertCount: number | null;
} = { records: [], incidentCount: 0, alertCount: 0 };
const mockOpenIssueReads: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssuesLoader",
  () => {
    return {
      __esModule: true,
      loadOpenIssues: (request: Record<string, unknown>): Promise<unknown> => {
        mockOpenIssueReads.push(request);
        return Promise.resolve(mockOpenIssues);
      },
    };
  },
);

let mockCoverage: Array<Record<string, unknown>> | Error = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertCoverage",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertCoverage",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...actual,
      loadResourcePartAlertCoverage: (): Promise<unknown> => {
        return mockCoverage instanceof Error
          ? Promise.reject(mockCoverage)
          : Promise.resolve(mockCoverage);
      },
    };
  },
);

import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import NeedsAttentionCard, {
  NEEDS_ATTENTION_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  countResourceAttention,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import ResourcePartHero from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartHero";
import ResourcePartDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard, {
  RESOURCE_PART_OPEN_EVENTS_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartOpenEventsCard";
import ResourcePartAlertsCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard";
import ResourcePartRow from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartRow";
import ResourcePartTabs from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTabs";
import { RecommendationStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";

const NOW: Date = new Date("2026-11-01T12:00:00.000Z");

function item(
  name: string,
  severity: ResourceAttentionSeverity,
  fields: Partial<ResourceAttentionItem> = {},
): ResourceAttentionItem {
  return {
    key: `Guest:${name}`,
    kind: "Guest",
    icon: IconProp.Cube,
    name: name,
    severity: severity,
    reasons: [{ text: "Stopped" }],
    ...fields,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockOpenIssues = { records: [], incidentCount: 0, alertCount: 0 };
  mockOpenIssueReads.length = 0;
  mockCoverage = [];
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what needs attention, ordered and counted", () => {
  test("critical first, then the product's kinds in turn, then names as people number them", () => {
    const sorted: Array<string> = sortResourceAttention(
      [
        item("web-10", ResourceAttentionSeverity.Warning),
        item("web-2", ResourceAttentionSeverity.Warning),
        item("pve3", ResourceAttentionSeverity.Warning, { kind: "Node" }),
        item("db", ResourceAttentionSeverity.Critical),
        item("other", ResourceAttentionSeverity.Warning, { kind: "Other" }),
      ],
      ["Node", "Guest"],
    ).map((entry: ResourceAttentionItem): string => {
      return entry.name;
    });
    expect(sorted).toEqual(["db", "pve3", "web-2", "web-10", "other"]);
  });

  test("the health is the worst of the list", () => {
    expect(getResourceAttentionHealth([])).toBe("Healthy");
    expect(
      getResourceAttentionHealth([
        item("a", ResourceAttentionSeverity.Warning),
      ]),
    ).toBe("Degraded");
    expect(
      getResourceAttentionHealth([
        item("a", ResourceAttentionSeverity.Warning),
        item("b", ResourceAttentionSeverity.Critical),
      ]),
    ).toBe("Unhealthy");
    expect(
      countResourceAttention([
        item("a", ResourceAttentionSeverity.Warning),
        item("b", ResourceAttentionSeverity.Critical),
        item("c", ResourceAttentionSeverity.Warning),
      ]),
    ).toEqual({ critical: 1, warning: 2 });
  });

  test("a part's findings merge to the worst severity", () => {
    expect(mergeResourceAttentionSeverity([])).toBeNull();
    expect(
      mergeResourceAttentionSeverity([ResourceAttentionSeverity.Warning]),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      mergeResourceAttentionSeverity([
        ResourceAttentionSeverity.Warning,
        ResourceAttentionSeverity.Critical,
      ]),
    ).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("the Needs attention card", () => {
  test("draws nothing while nothing needs attention", () => {
    const { container } = render(<NeedsAttentionCard items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a list it could not read is said in the card's own frame, with Refresh - never an all-clear", () => {
    const retries: Array<number> = [];

    render(
      <NeedsAttentionCard
        testId="attention"
        items={[]}
        description="What about this node is broken or needs a look."
        error="Something went wrong on the server. Please try again."
        onRetry={() => {
          retries.push(1);
        }}
      />,
    );

    const frame: HTMLElement = screen.getByTestId("attention-error");
    // The reader is told what could not be read: the card's own title.
    expect(
      within(frame).getByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
    expect(frame).toHaveTextContent(
      "What about this node is broken or needs a look.",
    );
    expect(frame).toHaveTextContent(
      "Something went wrong on the server. Please try again.",
    );
    // No rows, no counts: nothing it could not read.
    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
    expect(screen.queryByTestId("attention-summary")).not.toBeInTheDocument();

    fireEvent.click(within(frame).getByRole("button", { name: "Refresh?" }));
    expect(retries).toEqual([1]);
  });

  test("its error wins over a list it read before, and without a way to read again offers no Refresh", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        items={[item("pve3", ResourceAttentionSeverity.Critical)]}
        error="The cluster could not be read."
      />,
    );

    expect(screen.getByTestId("attention-error")).toHaveTextContent(
      "The cluster could not be read.",
    );
    expect(screen.queryByTestId("attention-item")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh?" }),
    ).not.toBeInTheDocument();
  });

  test("each row: its part, a step from its page; its kind; why, in its own words", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        items={[
          item("pve3", ResourceAttentionSeverity.Critical, {
            key: "Node:node/pve3",
            kind: "Node",
            icon: IconProp.ServerStack,
            detail: "node/pve3",
            reasons: [{ text: "Offline" }],
            route: new Route("/nodes/node%2Fpve3"),
          }),
          item("local-zfs", ResourceAttentionSeverity.Warning, {
            key: "Storage:storage/pve2/local-zfs",
            kind: "Storage",
            reasons: [{ text: "{{percent}} full", values: { percent: "91%" } }],
          }),
          item("101-0 (web)", ResourceAttentionSeverity.Warning, {
            key: "Replication:101-0",
            kind: "Replication job",
            reasons: [
              {
                text: "{{count}} failed syncs",
                plural: { one: "{{count}} failed sync", count: 1 },
              },
            ],
          }),
        ]}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("attention-item");
    expect(
      rows.map((row: HTMLElement) => {
        return [
          row.getAttribute("data-key"),
          row.getAttribute("data-severity"),
        ];
      }),
    ).toEqual([
      ["Node:node/pve3", "critical"],
      ["Storage:storage/pve2/local-zfs", "warning"],
      ["Replication:101-0", "warning"],
    ]);
    expect(within(rows[0]!).getByText("pve3").closest("a")).toHaveAttribute(
      "href",
      "/nodes/node%2Fpve3",
    );
    /*
     * The whole row is the link, as on Home's Needs attention card: its
     * name, kind, reasons and identifier are all inside it.
     */
    const link: HTMLElement = within(rows[0]!).getByRole("link");
    expect(link).toHaveTextContent("pve3NodeOfflinenode/pve3");
    expect(within(rows[0]!).getAllByRole("link")).toHaveLength(1);
    // Without a page to go to, the row is plain text.
    expect(within(rows[1]!).getByText("local-zfs").closest("a")).toBeNull();
    expect(within(rows[1]!).queryByRole("link")).toBeNull();
    expect(
      screen.getAllByTestId("attention-name").map((name: HTMLElement) => {
        return name.textContent;
      }),
    ).toEqual(["pve3", "local-zfs", "101-0 (web)"]);
    expect(within(rows[0]!).getByText("Node")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("attention-reason").map((reason: HTMLElement) => {
        return reason.textContent;
      }),
    ).toEqual(["Offline", "91% full", "1 failed sync"]);
    // The identifier under a name is isolated, so a right-to-left page keeps it whole.
    expect(within(rows[0]!).getByText("node/pve3").tagName).toBe("BDI");
    expect(screen.getByTestId("attention-summary")).toHaveTextContent(
      "1 critical2 to look at",
    );
  });

  test("the card's title and description are the product's, when it gives them", () => {
    render(
      <NeedsAttentionCard
        items={[item("a", ResourceAttentionSeverity.Warning)]}
        title="Needs a look"
        description="What on this node needs a look."
      />,
    );
    expect(screen.getByText("Needs a look")).toBeInTheDocument();
    expect(
      screen.getByText("What on this node needs a look."),
    ).toBeInTheDocument();
    // Warnings alone have no critical pill.
    expect(screen.getByTestId("needs-attention-summary")).toHaveTextContent(
      /^1 to look at$/,
    );
  });

  test(`a long list shows its first ${NEEDS_ATTENTION_SHOWN} and opens the rest in place`, () => {
    const items: Array<ResourceAttentionItem> = Array.from(
      { length: NEEDS_ATTENTION_SHOWN + 3 },
      (_: unknown, index: number): ResourceAttentionItem => {
        return item(`guest-${index + 1}`, ResourceAttentionSeverity.Warning);
      },
    );
    render(<NeedsAttentionCard items={items} />);

    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(
      NEEDS_ATTENTION_SHOWN,
    );
    const toggle: HTMLElement = screen.getByTestId("needs-attention-toggle");
    expect(toggle).toHaveTextContent("Show 3 more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(
      NEEDS_ATTENTION_SHOWN + 3,
    );
    expect(toggle).toHaveTextContent("Show fewer");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(
      NEEDS_ATTENTION_SHOWN,
    );
  });

  test("a list no longer than the limit has no toggle", () => {
    render(
      <NeedsAttentionCard
        items={[item("a", ResourceAttentionSeverity.Warning)]}
        shown={1}
      />,
    );
    expect(screen.queryByTestId("needs-attention-toggle")).toBeNull();
  });

  test("the part whose page this is says so, and is no link to the page the reader is on", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        current={{ key: "Node:node/pve3", label: "This node" }}
        items={[
          item("pve3", ResourceAttentionSeverity.Critical, {
            key: "Node:node/pve3",
            kind: "Node",
            detail: "node/pve3",
            reasons: [{ text: "Offline" }],
            route: new Route("/nodes/node%2Fpve3"),
          }),
          item("mail", ResourceAttentionSeverity.Critical, {
            key: "Guest:qemu/104",
            detail: "qemu/104",
            reasons: [
              { text: "HA state: {{state}}", values: { state: "error" } },
            ],
            route: new Route("/guests/qemu%2F104"),
          }),
        ]}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("attention-item");
    // The node's own row: what is wrong, without its name, kind and id again.
    expect(rows[0]).toHaveAttribute("data-current", "true");
    expect(within(rows[0]!).getByTestId("attention-name")).toHaveTextContent(
      /^This node$/,
    );
    expect(rows[0]).toHaveTextContent(/^This nodeOffline$/);
    expect(within(rows[0]!).queryByRole("link")).toBeNull();
    // Every other part keeps its name and its one step to its page.
    expect(rows[1]).not.toHaveAttribute("data-current");
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
      "href",
      "/guests/qemu%2F104",
    );
    expect(rows[1]).toHaveTextContent("mailGuestHA state: errorqemu/104");
  });

  test("a long name breaks after its own dots and slashes, never mid-letter where a word fits", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        items={[
          item(
            "backup-store.example.internal",
            ResourceAttentionSeverity.Warning,
            {
              key: "Storage:storage/pve-node-number-one/backup-store",
              detail: "storage/pve-node-number-one/backup-store",
            },
          ),
        ]}
      />,
    );

    const name: HTMLElement = screen.getByTestId("attention-name");
    expect(name.className).toContain("[overflow-wrap:anywhere]");
    expect(name.className).not.toContain("break-all");
    expect(name.querySelectorAll("wbr").length).toBeGreaterThan(0);
    // The text itself is unchanged: a copy or a search reads it as written.
    expect(name.textContent).toBe("backup-store.example.internal");
    // Isolated, so a mount's leading slash stays at its start on a Persian page.
    expect(name.querySelector("bdi")).not.toBeNull();
    expect(name.querySelector("bdi")!.textContent).toBe(
      "backup-store.example.internal",
    );
  });

  test("a list of one kind of part leaves out the kind's chip", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        showKind={false}
        items={[
          item("db-01", ResourceAttentionSeverity.Critical, { kind: "Host" }),
          item("web-03", ResourceAttentionSeverity.Warning, { kind: "Host" }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("attention-item")).toHaveLength(2);
    expect(screen.queryAllByTestId("attention-kind")).toEqual([]);
    expect(screen.queryByText("Host")).toBeNull();
  });

  test("a part that stopped reporting says when it last did; the others do not", () => {
    render(
      <NeedsAttentionCard
        testId="attention"
        items={[
          item("web-03", ResourceAttentionSeverity.Critical, {
            reasons: [{ text: "Not reporting" }],
            lastReportAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
          }),
          item("db-01", ResourceAttentionSeverity.Warning),
        ]}
      />,
    );

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "attention-last-report",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("Last reported 3 hours ago");
    expect(
      within(screen.getAllByTestId("attention-item")[0]!).getByTestId(
        "attention-last-report",
      ),
    ).toBe(lines[0]);
  });
});

describe("a row that opens a page", () => {
  test("the whole row is one link, with a chevron at its end", () => {
    render(
      <ul>
        <li>
          <ResourcePartRow to={new Route("/nodes/node%2Fpve1")}>
            <span>pve1</span>
            <span>Online</span>
          </ResourcePartRow>
        </li>
      </ul>,
    );

    const link: HTMLElement = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/nodes/node%2Fpve1");
    expect(link).toHaveTextContent("pve1Online");
    // A tint under the pointer and a focus ring for a keyboard.
    expect(link.className).toContain("hover:bg-gray-50");
    expect(link.className).toContain("focus-visible:ring-2");
    // The chevron is decoration: a screen reader hears the row's words only.
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  test("a row with nowhere to go is plain, with no chevron", () => {
    render(
      <ResourcePartRow dataTestId="row">
        <span>pve1</span>
      </ResourcePartRow>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("row").querySelector("svg")).toBeNull();
    expect(screen.getByTestId("row")).toHaveTextContent("pve1");
  });
});

describe("a part's hero", () => {
  test("says which part it is, its state, where it sits, when it last reported and its facts", () => {
    render(
      <ResourcePartHero
        testId="hero"
        icon={IconProp.ServerStack}
        name="pve2"
        status={{
          label: "Online",
          tone: "positive",
          description: "Online or Offline, as Proxmox last reported.",
        }}
        badges={[
          {
            key: "ha",
            label: "HA: {{state}}",
            values: { state: "online" },
            tone: "positive",
          },
          { key: "shared", label: "Shared", tone: "neutral" },
        ]}
        location={<span>Node of cluster pve-prod</span>}
        lastReportAt={new Date(NOW.getTime() - 5 * 60 * 1000)}
        chips={[
          { key: "cores", icon: IconProp.CPUChip, label: "64 cores" },
          {
            key: "memory",
            icon: IconProp.SquareStack,
            label: "256 GiB memory",
          },
        ]}
        tags={["prod", " ", "web"]}
      />,
    );

    expect(screen.getByTestId("hero-name")).toHaveTextContent("pve2");
    const status: HTMLElement = screen.getByTestId("hero-status");
    expect(status).toHaveAttribute("data-tone", "positive");
    expect(status).toHaveAttribute(
      "title",
      "Online or Offline, as Proxmox last reported.",
    );
    // A screen reader hears what the status means after the word.
    expect(status).toHaveTextContent(
      "Online Online or Offline, as Proxmox last reported.",
    );
    expect(
      screen.getAllByTestId("hero-badge").map((badge: HTMLElement) => {
        return badge.textContent;
      }),
    ).toEqual(["HA: online", "Shared"]);
    expect(screen.getByTestId("hero-location")).toHaveTextContent(
      "Node of cluster pve-prod",
    );
    expect(screen.getByTestId("hero-last-report")).toHaveTextContent(
      "Last reported 5 minutes ago",
    );
    expect(
      screen.getByTestId("hero-last-report").getAttribute("title"),
    ).not.toBe("");
    expect(screen.getByTestId("hero-chips")).toHaveTextContent(
      "64 cores256 GiB memoryprodweb",
    );
    // Blank tags are dropped; each tag is isolated for a right-to-left page.
    const tags: Array<HTMLElement> = screen.getAllByTestId("hero-tag");
    expect(tags).toHaveLength(2);
    expect(tags[0]!.querySelector("bdi")).toHaveTextContent("prod");
  });

  test("a part with nothing more to say draws only its name", () => {
    render(<ResourcePartHero testId="hero" icon={IconProp.Cube} name="web" />);

    expect(screen.getByTestId("hero-name")).toHaveTextContent("web");
    for (const testId of [
      "hero-status",
      "hero-location",
      "hero-last-report",
      "hero-chips",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });
});

describe("a part's details", () => {
  test("each name over its value; an (i) where the value needs words; a copy button where it is pasted elsewhere", () => {
    render(
      <ResourcePartDetailsCard
        testId="details"
        description="What Proxmox VE reports about this node."
        rows={[
          { key: "name", label: "Node name", value: "pve2", copyText: "pve2" },
          {
            key: "uptime",
            label: "Uptime",
            value: "12d 2h",
            description: "How long this node has been running.",
          },
          {
            key: "id",
            label: "Proxmox ID",
            value: "node/pve2",
            mono: true,
            copyText: "node/pve2",
          },
        ]}
      />,
    );

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByTestId("details-name")).toHaveTextContent(
      "Node namepve2",
    );
    expect(
      within(screen.getByTestId("details-uptime")).getByRole("button", {
        name: "About Uptime",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("details-name")).queryByRole("button", {
        name: /^About /,
      }),
    ).toBeNull();
    expect(screen.getAllByTestId("details-copy")).toHaveLength(2);
    expect(
      within(screen.getByTestId("details-id")).getByText("node/pve2"),
    ).toHaveClass("font-mono");
  });

  test("no rows, no card", () => {
    const { container } = render(
      <ResourcePartDetailsCard
        testId="details"
        description="Nothing."
        rows={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * A value reads in its own direction: on a Persian page "8.0 MB" kept its
   * number before its unit only when its box is told to read it by its own
   * first letter. A value drawn as an element (a link) says its own.
   */
  test("a written value reads in its own direction; an element value is left as drawn", () => {
    render(
      <ResourcePartDetailsCard
        testId="details"
        description="What the agent reports about this container."
        rows={[
          { key: "rx", label: "Network RX (total)", value: "8.0 MB" },
          {
            key: "host",
            label: "Host",
            value: <a href="/hosts/web-01">web-01</a>,
          },
        ]}
      />,
    );

    expect(
      within(screen.getByTestId("details-rx")).getByText("8.0 MB"),
    ).toHaveAttribute("dir", "auto");
    expect(
      within(screen.getByTestId("details-host"))
        .getByRole("link", { name: "web-01" })
        .parentElement?.getAttribute("dir"),
    ).toBeNull();
  });
});

/*
 * A part page's tabs (ResourcePartTabs): a page with one tab draws its
 * cards without a row of one tab, a control that does nothing; with more,
 * the row wraps and its cards line up with the hero above them.
 */
describe("a part page's tabs", () => {
  test("one tab: its cards, and no tab row", () => {
    render(
      <ResourcePartTabs
        tabs={[{ name: "Overview", children: <p>Cards of the node</p> }]}
      />,
    );

    expect(screen.getByText("Cards of the node")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  test("more than one: a row that wraps, the first tab open, its cards in line with the hero", () => {
    render(
      <ResourcePartTabs
        tabs={[
          { name: "Overview", children: <p>Cards of the task</p> },
          { name: "Logs", children: <p>Logs of the task</p> },
        ]}
      />,
    );

    expect(screen.getByRole("tablist")).toHaveClass("flex-wrap");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText("Cards of the task")).toBeInTheDocument();
    expect(screen.queryByText("Logs of the task")).toBeNull();
    expect(screen.getByRole("tabpanel")).not.toHaveClass("ml-1");
  });
});

function openRecord(
  type: "incident" | "alert",
  number: number,
  labels: Record<string, unknown>,
  minutesAgo: number,
): Record<string, unknown> {
  return {
    type: type,
    id: `6${number}000000-0000-4000-8000-000000000001`,
    title: `${type} ${number}`,
    number: `#${number}`,
    severityName: type === "incident" ? "Critical" : "Warning",
    severityColor: "#ff0000",
    stateName: "Created",
    createdAt: new Date(NOW.getTime() - minutesAgo * 60 * 1000),
    seriesLabels: labels,
    relatedIds: {},
  };
}

function renderOpenEvents(refreshToken?: number): ReturnType<typeof render> {
  return render(
    <ResourcePartOpenEventsCard
      testId="open"
      title="Open on this node"
      description="Unresolved incidents and alerts about this node."
      resourceRelation="proxmoxClusters"
      resourceId={new ObjectID("71000000-0000-4000-8000-000000000001")}
      isAbout={(record: OpenIssueRecord): boolean => {
        return (
          (record.seriesLabels as Record<string, unknown>)["id"] === "node/pve2"
        );
      }}
      getIncidentRoute={(id: ObjectID): Route => {
        return new Route(`/incidents/${id.toString()}`);
      }}
      getAlertRoute={(id: ObjectID): Route => {
        return new Route(`/alerts/${id.toString()}`);
      }}
      incidentsRoute={new Route("/cluster/incidents")}
      alertsRoute={new Route("/cluster/alerts")}
      refreshToken={refreshToken}
    />,
  );
}

describe("what is open on a part", () => {
  test("only the records about this part: incidents first, each kind newest first", async () => {
    mockOpenIssues = {
      records: [
        openRecord("alert", 1, { id: "node/pve2" }, 5),
        openRecord("incident", 2, { id: "node/pve2" }, 60),
        openRecord("incident", 3, { id: "node/pve2" }, 10),
        openRecord("incident", 4, { id: "node/pve1" }, 1),
      ],
      incidentCount: 3,
      alertCount: 1,
    };

    renderOpenEvents();

    await waitFor(() => {
      expect(screen.getAllByTestId("open-item")).toHaveLength(3);
    });
    expect(
      screen.getAllByTestId("open-title").map((title: HTMLElement) => {
        return title.textContent;
      }),
    ).toEqual(["incident 3", "incident 2", "alert 1"]);
    // The whole row opens its record, as Home's Needs attention rows do.
    expect(
      within(screen.getAllByTestId("open-item")[0]!).getByRole("link"),
    ).toHaveAttribute(
      "href",
      "/incidents/63000000-0000-4000-8000-000000000001",
    );
    expect(
      within(screen.getAllByTestId("open-item")[2]!).getByRole("link"),
    ).toHaveAttribute("href", "/alerts/61000000-0000-4000-8000-000000000001");
    expect(screen.getAllByTestId("open-item")[0]).toHaveTextContent(
      "Incident · #3 · Created · 10 minutes ago",
    );
    expect(mockOpenIssueReads[0]!["resourceRelation"]).toBe("proxmoxClusters");
  });

  test(`past ${RESOURCE_PART_OPEN_EVENTS_SHOWN} records, the rest are a step away, by kind`, async () => {
    mockOpenIssues = {
      records: [
        ...Array.from({ length: 6 }, (_: unknown, index: number) => {
          return openRecord("incident", index + 1, { id: "node/pve2" }, index);
        }),
        openRecord("alert", 8, { id: "node/pve2" }, 1),
      ],
      incidentCount: 6,
      alertCount: 1,
    };

    renderOpenEvents();

    await waitFor(() => {
      expect(screen.getAllByTestId("open-item")).toHaveLength(
        RESOURCE_PART_OPEN_EVENTS_SHOWN,
      );
    });
    const more: HTMLElement = screen.getByTestId("open-more");
    expect(
      within(more).getByText("1 more incident").closest("a"),
    ).toHaveAttribute("href", "/cluster/incidents");
    expect(within(more).getByText("1 more alert").closest("a")).toHaveAttribute(
      "href",
      "/cluster/alerts",
    );
  });

  test("nothing open on the part: no card", async () => {
    mockOpenIssues = {
      records: [openRecord("incident", 1, { id: "node/pve1" }, 1)],
      incidentCount: 1,
      alertCount: 0,
    };

    renderOpenEvents();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("open")).toBeNull();
  });

  test("a refresh reads again", async () => {
    const { rerender } = renderOpenEvents(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockOpenIssueReads).toHaveLength(1);

    rerender(
      <ResourcePartOpenEventsCard
        testId="open"
        title="Open on this node"
        description="Unresolved incidents and alerts about this node."
        resourceRelation="proxmoxClusters"
        resourceId={new ObjectID("71000000-0000-4000-8000-000000000001")}
        isAbout={(): boolean => {
          return true;
        }}
        getIncidentRoute={(id: ObjectID): Route => {
          return new Route(`/incidents/${id.toString()}`);
        }}
        getAlertRoute={(id: ObjectID): Route => {
          return new Route(`/alerts/${id.toString()}`);
        }}
        incidentsRoute={new Route("/cluster/incidents")}
        alertsRoute={new Route("/cluster/alerts")}
        refreshToken={2}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockOpenIssueReads).toHaveLength(2);
  });
});

function viewModel(
  templateId: string,
  name: string,
  status: RecommendationStatus,
  monitorId?: string,
): Record<string, unknown> {
  return {
    recommendation: {
      recommendationId: `Proxmox:${templateId}`,
      templateId: templateId,
      name: name,
      summary: `${name} fires.`,
    },
    status: status,
    monitorId: monitorId ? new ObjectID(monitorId) : undefined,
  };
}

function renderAlerts(): void {
  render(
    <ResourcePartAlertsCard
      testId="alerts"
      title="Node alerts"
      description="The cluster's alerts that watch every node."
      resourceType={MonitorRecommendationResourceType.Proxmox}
      templateIds={["pve-node-offline", "pve-node-fenced", "pve-node-high-cpu"]}
      resourceId={new ObjectID("71000000-0000-4000-8000-000000000001")}
      resourceIdentifier="pve-prod"
      getRecommendationsRoute={(ids: Array<string>): Route => {
        return new Route(`/recommendations?select=${ids.join(",")}`);
      }}
      getMonitorRoute={(id: ObjectID): Route => {
        return new Route(`/monitors/${id.toString()}`);
      }}
    />,
  );
}

describe("which of a part's alerts are on", () => {
  test("each alert says On (a step to its monitor), Dismissed or Not set up; one button turns on the rest", async () => {
    mockCoverage = [
      viewModel(
        "pve-node-offline",
        "Node Offline",
        RecommendationStatus.Created,
        "70000000-0000-4000-8000-000000000001",
      ),
      viewModel(
        "pve-node-fenced",
        "Node Fenced",
        RecommendationStatus.Dismissed,
      ),
      viewModel(
        "pve-node-high-cpu",
        "High Node CPU Usage",
        RecommendationStatus.Available,
      ),
    ];

    renderAlerts();

    await waitFor(() => {
      expect(screen.getAllByTestId("alerts-item")).toHaveLength(3);
    });
    expect(
      screen.getAllByTestId("alerts-item").map((row: HTMLElement) => {
        return row.getAttribute("data-status");
      }),
    ).toEqual([
      RecommendationStatus.Created,
      RecommendationStatus.Dismissed,
      RecommendationStatus.Available,
    ]);
    expect(screen.getByText("On").closest("a")).toHaveAttribute(
      "href",
      "/monitors/70000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
    /*
     * Not set up reads grey, as it does everywhere in the product: a row of
     * amber pills read as that many warnings.
     */
    const notSetUp: HTMLElement = screen.getByText("Not set up");
    expect(notSetUp.className).toContain("text-gray-600");
    expect(notSetUp.className).not.toContain("amber");
    // Only what nobody turned on or dismissed is ticked.
    const turnOn: HTMLElement = screen.getByTestId("alerts-turn-on");
    expect(turnOn).toHaveTextContent("Turn on 1 alert");
    expect(turnOn).toHaveAttribute(
      "href",
      "/recommendations?select=Proxmox:pve-node-high-cpu",
    );
    /*
     * The template's name is the catalog's English, read in its own
     * direction: on a right-to-left page its summary's full stop stays at
     * its end.
     */
    expect(screen.getByText("High Node CPU Usage").tagName).toBe("BDI");
    expect(screen.getByText("High Node CPU Usage fires.").tagName).toBe("BDI");
  });

  test("every alert on: no button", async () => {
    mockCoverage = [
      viewModel(
        "pve-node-offline",
        "Node Offline",
        RecommendationStatus.Created,
        "70000000-0000-4000-8000-000000000001",
      ),
    ];

    renderAlerts();

    await waitFor(() => {
      expect(screen.getAllByTestId("alerts-item")).toHaveLength(1);
    });
    expect(screen.queryByTestId("alerts-turn-on")).toBeNull();
  });

  test("monitors the reader may not read: the card stays out of the way", async () => {
    mockCoverage = new Error("You do not have permission.");

    renderAlerts();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("alerts")).toBeNull();
  });
});
