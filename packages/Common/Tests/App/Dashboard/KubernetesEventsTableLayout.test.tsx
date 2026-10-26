import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * The Events table's layout (issue #5179's UI review): what each row draws,
 * where, at a laptop's width and on a phone.
 *
 * - Four columns - Event, Object, Count, Last seen. The namespace sits
 *   beside the object's name, as the Overview draws it: a Namespace column
 *   of its own left the message a narrow strip at 1280px and pushed the
 *   table past its card at 1024px.
 * - "Warning" / "Normal" is drawn on each row only where the view mixes
 *   them (All); a view of one type keeps the word for screen readers.
 * - On a phone each Event is one card that reads like the Overview's Recent
 *   Warnings - the reason and when, the message, the object, its namespace
 *   and how many times, who reported it - not five labelled fields.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import KubernetesEventsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTable";
import { KubernetesEventRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import ObjectID from "../../../Types/ObjectID";

const CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000005";
const NOW: number = Date.now();
const NODE: string = "aks-userpool-11935137-vmss00000o";

function minutesAgo(minutes: number): Date {
  return new Date(NOW - minutes * 60 * 1000);
}

const OOM_KILL: KubernetesEventRow = {
  id: "7c1d2e3f-0000-4000-8000-000000000001",
  type: "Warning",
  isWarning: true,
  reason: "OOMKilling",
  message:
    "Memory cgroup out of memory: Killed process 318623 (MainThread) total-vm:10568040kB",
  objectKind: "Node",
  objectName: NODE,
  objectFieldPath: "",
  namespace: "default",
  source: "kernel-monitor",
  sourceHost: NODE,
  count: 2,
  firstSeenAt: minutesAgo(40),
  lastSeenAt: minutesAgo(12),
};

const HPA_WARNING: KubernetesEventRow = {
  id: "7c1d2e3f-0000-4000-8000-000000000002",
  type: "Warning",
  isWarning: true,
  reason: "FailedComputeMetricsReplicas",
  message:
    "invalid metrics (1 invalid out of 1), first error is: failed to get cpu resource metric value",
  objectKind: "HorizontalPodAutoscaler",
  objectName: "istiod",
  objectFieldPath: "",
  namespace: "aks-istio-system",
  source: "horizontal-pod-autoscaler",
  sourceHost: "",
  count: 3,
  firstSeenAt: minutesAgo(30),
  lastSeenAt: minutesAgo(4),
};

const PULLED: KubernetesEventRow = {
  id: "7c1d2e3f-0000-4000-8000-000000000003",
  type: "Normal",
  isWarning: false,
  reason: "Pulled",
  message: 'Container image "mcr.microsoft.com/oss/kubernetes/coredns:v1.11.3"',
  objectKind: "Pod",
  objectName: "coredns-7b9f8d6c5-hj4kl",
  objectFieldPath: "spec.containers{coredns}",
  namespace: "kube-system",
  source: "kubelet",
  sourceHost: NODE,
  count: 1,
  firstSeenAt: minutesAgo(38),
  lastSeenAt: minutesAgo(38),
};

const ROWS: Array<KubernetesEventRow> = [HPA_WARNING, OOM_KILL, PULLED];

// The table reads window.innerWidth at mount: under 768px it draws cards.
function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function renderTable(options: {
  width?: number;
  showObject?: boolean;
  showNamespace?: boolean;
  showType?: boolean;
  rows?: Array<KubernetesEventRow>;
}): Promise<void> {
  setViewportWidth(options.width || 1280);

  render(
    <KubernetesEventsTable
      id="kubernetes-events-table"
      rows={options.rows || ROWS}
      clusterId={new ObjectID(CLUSTER_ID)}
      showObject={options.showObject !== false}
      showNamespace={options.showNamespace !== false}
      showType={options.showType}
    />,
  );

  // The table settles its phone-or-laptop layout in an effect.
  await act(async () => {
    await Promise.resolve();
  });
}

// The cell (laptop) or card (phone) of one Event, by its reason.
function eventOf(reason: string): HTMLElement {
  const event: HTMLElement | undefined = screen
    .getAllByTestId("kubernetes-event")
    .find((element: HTMLElement): boolean => {
      return (
        within(element).getByTestId("kubernetes-event-reason").textContent ===
        reason
      );
    });

  if (!event) {
    throw new Error(`No Event ${reason}`);
  }

  return event;
}

function rowOf(reason: string): HTMLElement {
  return eventOf(reason).closest("tr") as HTMLElement;
}

function headerTitles(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    });
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("the Events table at a laptop's width", () => {
  test("has four columns - Event, Object, Count, Last seen - and no Namespace column", async () => {
    await renderTable({});

    expect(headerTitles()).toEqual(["Event", "Object", "Count", "Last seen"]);
    expect(headerTitles()).not.toContain("Namespace");
  });

  test("draws the namespace beside the object's name, in the Object cell", async () => {
    await renderTable({});

    const object: HTMLElement = within(rowOf("OOMKilling")).getByTestId(
      "kubernetes-event-object",
    );
    expect(object).toHaveTextContent("Node");
    expect(within(object).getByRole("link", { name: NODE })).toHaveAttribute(
      "href",
      expect.stringContaining(`/kubernetes/${CLUSTER_ID}/nodes/${NODE}`),
    );
    expect(
      within(object).getByTestId("kubernetes-event-namespace"),
    ).toHaveTextContent("default");

    expect(
      within(
        within(rowOf("FailedComputeMetricsReplicas")).getByTestId(
          "kubernetes-event-object",
        ),
      ).getByTestId("kubernetes-event-namespace"),
    ).toHaveTextContent("aks-istio-system");

    // Which part of the pod, under its name.
    expect(
      within(rowOf("Pulled")).getByTestId("kubernetes-event-object"),
    ).toHaveTextContent("spec.containers{coredns}");
  });

  test("a view of one namespace leaves the namespace out; a view of one object, the Object column", async () => {
    await renderTable({ showNamespace: false });
    expect(screen.queryAllByTestId("kubernetes-event-namespace")).toEqual([]);
    expect(screen.getAllByTestId("kubernetes-event-object")).toHaveLength(3);
    cleanup();

    await renderTable({ showObject: false });
    expect(headerTitles()).toEqual(["Event", "Count", "Last seen"]);
    expect(screen.queryAllByTestId("kubernetes-event-object")).toEqual([]);
  });

  test("the Event cell holds the reason, the message and who reported it - its count and time are their own columns", async () => {
    await renderTable({});

    const event: HTMLElement = eventOf("OOMKilling");
    expect(
      within(event).getByTestId("kubernetes-event-message"),
    ).toHaveTextContent("Memory cgroup out of memory: Killed process 318623");
    expect(
      within(event).getByTestId("kubernetes-event-source"),
    ).toHaveTextContent(`Reported by kernel-monitor · ${NODE}`);
    expect(
      within(event).queryByTestId("kubernetes-event-count"),
    ).not.toBeInTheDocument();
    expect(
      within(event).queryByTestId("kubernetes-event-last-seen"),
    ).not.toBeInTheDocument();
    expect(
      within(rowOf("OOMKilling")).getByTestId("kubernetes-event-count"),
    ).toHaveTextContent("2");
    expect(
      within(rowOf("OOMKilling")).getByTestId("kubernetes-event-last-seen"),
    ).toHaveAttribute("dateTime", OOM_KILL.lastSeenAt!.toISOString());
  });

  test("a reason is never broken mid-word: it wraps only between words", async () => {
    await renderTable({});

    const reason: HTMLElement = within(
      eventOf("FailedComputeMetricsReplicas"),
    ).getByTestId("kubernetes-event-reason");
    expect(reason).toHaveClass("break-words");
    expect(reason.className).not.toContain("anywhere");
  });
});

describe("Warning and Normal on each row", () => {
  test("All - a view that mixes them - says which each one is", async () => {
    await renderTable({ showType: true });

    const warning: HTMLElement = within(eventOf("OOMKilling")).getByTestId(
      "kubernetes-event-type",
    );
    expect(warning).toHaveTextContent("Warning");
    expect(warning).not.toHaveClass("sr-only");
    expect(warning).toHaveClass("bg-amber-50");

    const normal: HTMLElement = within(eventOf("Pulled")).getByTestId(
      "kubernetes-event-type",
    );
    expect(normal).toHaveTextContent("Normal");
    expect(normal).not.toHaveClass("sr-only");
    expect(normal).toHaveClass("bg-gray-100");
  });

  test("a view of one type does not repeat it on every row, and keeps the word for screen readers", async () => {
    await renderTable({ showType: false, rows: [HPA_WARNING, OOM_KILL] });

    const types: Array<HTMLElement> = screen.getAllByTestId(
      "kubernetes-event-type",
    );
    expect(types).toHaveLength(2);
    for (const type of types) {
      expect(type).toHaveClass("sr-only");
      expect(type).toHaveTextContent("Warning");
    }
  });

  test("the word is drawn unless a view says otherwise", async () => {
    await renderTable({});

    for (const type of screen.getAllByTestId("kubernetes-event-type")) {
      expect(type).not.toHaveClass("sr-only");
    }
  });
});

/*
 * Beside the cluster's side menu at 768px the card is 478px wide, and the
 * four columns needed 680px: the rows ran under the sticky last column.
 * Below lg (Column.hideBelowLargeScreen) how many times and when go in the
 * Event's own lines, as on a phone's card; the object keeps its column.
 */
describe("the Events table at a tablet's width, beside the side menu", () => {
  test("has two columns - Event and Object - below 1024px, and four from 1024px", async () => {
    for (const width of [1023, 900, 768]) {
      await renderTable({ width });
      expect([width, headerTitles()]).toEqual([width, ["Event", "Object"]]);
      cleanup();
    }

    await renderTable({ width: 1024 });
    expect(headerTitles()).toEqual(["Event", "Object", "Count", "Last seen"]);
  });

  test("the Event says how many times and when, each once in its row; the object stays in its own column", async () => {
    await renderTable({ width: 900 });

    const oom: HTMLElement = eventOf("OOMKilling");
    expect(within(oom).getByTestId("kubernetes-event-count")).toHaveTextContent(
      "2 times",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-last-seen"),
    ).toHaveAttribute("dateTime", OOM_KILL.lastSeenAt!.toISOString());

    const row: HTMLElement = rowOf("OOMKilling");
    expect(within(row).getAllByTestId("kubernetes-event-count")).toHaveLength(
      1,
    );
    expect(
      within(row).getAllByTestId("kubernetes-event-last-seen"),
    ).toHaveLength(1);

    // Its object in the Object column, not in the Event's lines as well.
    expect(
      within(oom).queryByTestId("kubernetes-event-object"),
    ).not.toBeInTheDocument();
    expect(within(row).getAllByTestId("kubernetes-event-object")).toHaveLength(
      1,
    );

    // An Event that happened once says no count, as on a phone.
    expect(
      within(eventOf("Pulled")).queryByTestId("kubernetes-event-count"),
    ).not.toBeInTheDocument();
  });

  test("a view of one object leaves the Object column out too: the Event alone", async () => {
    await renderTable({ width: 900, showObject: false });

    expect(headerTitles()).toEqual(["Event"]);
    expect(
      within(eventOf("OOMKilling")).getByTestId("kubernetes-event-count"),
    ).toHaveTextContent("2 times");
  });
});

describe("the Events table on a phone", () => {
  test("each Event is one card: the reason and when, the message, the object, its namespace, how many times and who reported it", async () => {
    await renderTable({ width: 390 });

    // No table: cards.
    expect(screen.queryAllByRole("columnheader")).toEqual([]);

    const oom: HTMLElement = eventOf("OOMKilling");
    expect(
      within(oom).getByTestId("kubernetes-event-last-seen"),
    ).toHaveAttribute("dateTime", OOM_KILL.lastSeenAt!.toISOString());
    expect(
      within(oom).getByTestId("kubernetes-event-message"),
    ).toHaveTextContent("Memory cgroup out of memory");

    const object: HTMLElement = within(oom).getByTestId(
      "kubernetes-event-object",
    );
    expect(object).toHaveTextContent(`Node${NODE}`);
    expect(within(object).getByRole("link", { name: NODE })).toHaveAttribute(
      "href",
      expect.stringContaining(`/nodes/${NODE}`),
    );
    expect(
      within(oom).getByTestId("kubernetes-event-namespace"),
    ).toHaveTextContent("default");
    expect(within(oom).getByTestId("kubernetes-event-count")).toHaveTextContent(
      "2 times",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-source"),
    ).toHaveTextContent(`Reported by kernel-monitor · ${NODE}`);
  });

  test("a card has no Event label over it, and no Object, Count or Last seen fields of their own", async () => {
    await renderTable({ width: 390 });

    const terms: Array<HTMLElement> = screen.getAllByRole("term");
    // One field a card: the Event, its name kept for screen readers alone.
    expect(terms).toHaveLength(ROWS.length);
    for (const term of terms) {
      expect(term).toHaveTextContent("Event");
      expect(term).toHaveClass("sr-only");
    }

    // Every object, count and time is inside its Event's card.
    for (const testId of [
      "kubernetes-event-object",
      "kubernetes-event-last-seen",
    ]) {
      for (const element of screen.getAllByTestId(testId)) {
        expect(element.closest("[data-testid='kubernetes-event']")).not.toBe(
          null,
        );
      }
    }
  });

  test("an Event that happened once says no count; a warning's count is amber, a Normal event's grey", async () => {
    await renderTable({
      width: 390,
      rows: [OOM_KILL, PULLED, { ...PULLED, id: "repeated", count: 4 }],
    });

    const cards: Array<HTMLElement> = screen.getAllByTestId("kubernetes-event");
    expect(
      within(cards[1]!).queryByTestId("kubernetes-event-count"),
    ).not.toBeInTheDocument();

    expect(within(cards[0]!).getByTestId("kubernetes-event-count")).toHaveClass(
      "bg-amber-100",
    );
    const normalCount: HTMLElement = within(cards[2]!).getByTestId(
      "kubernetes-event-count",
    );
    expect(normalCount).toHaveTextContent("4 times");
    expect(normalCount).toHaveClass("bg-gray-100");
    expect(normalCount).not.toHaveClass("bg-amber-100");
  });

  test("a long object name runs onto the next line rather than ending in ...: a phone has no pointer to show it", async () => {
    const longName: string =
      "prometheus-kube-prometheus-stack-prometheus-node-exporter-x7k2p";
    await renderTable({
      width: 390,
      rows: [{ ...PULLED, objectName: longName }],
    });

    const link: HTMLElement = within(
      screen.getByTestId("kubernetes-event-object"),
    ).getByRole("link", { name: longName });
    expect(link).toHaveTextContent(longName);
    expect(link).not.toHaveClass("truncate");
    expect(link.className).toContain("[overflow-wrap:anywhere]");
  });

  test("a view about one object leaves the object out of its cards, and a view of one namespace the namespace", async () => {
    await renderTable({ width: 390, showObject: false });
    expect(screen.queryAllByTestId("kubernetes-event-object")).toEqual([]);
    cleanup();

    await renderTable({ width: 390, showNamespace: false });
    expect(screen.getAllByTestId("kubernetes-event-object")).toHaveLength(3);
    expect(screen.queryAllByTestId("kubernetes-event-namespace")).toEqual([]);
  });
});
