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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  KubernetesEventFields,
  issue5179Events,
  normalPodEvent,
} from "../../Helpers/KubernetesEventRecords";
import {
  RecordedListRequest,
  eventLogStore,
  putEvent,
  resetEventLogStore,
} from "./KubernetesEventsLogStore";

/*
 * A cluster's Events page (issue #5179), rendered for real over a store of
 * Event logs that answers the logs list the way the server does: it filters
 * on the attributes asked for, leaves the body out unless it is selected,
 * and stops at the limit. The customer's warnings - kernel-monitor's
 * OOMKilling on AKS nodes, the horizontal-pod-autoscaler's
 * FailedGetResourceMetric and FailedComputeMetricsReplicas in
 * aks-istio-system and app-routing-system - sit among a busy cluster's
 * Normal events and another cluster's.
 */

const CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000005";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER: string = "aks-prod-westeurope";
const OTHER_CLUSTER: string = "aks-staging";
const NOW: Date = new Date();

const getItemMock: MockFunction = getJestMockFunction();
const setQueryStringMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
let queryString: Record<string, string> = {};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-2222-4aaa-8bbb-000000000005");
      },
      getQueryStringByName: (name: string): string | null => {
        return queryString[name] ?? null;
      },
      setQueryString: (params: Record<string, string>) => {
        setQueryStringMock(params);
      },
      navigate: (...args: Array<unknown>) => {
        navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (range: { range: string }) => void;
    }): React.ReactElement => {
      return (
        <span>
          <span data-testid="range">
            {props.dashboardStartAndEndDate.range}
          </span>
          <button
            type="button"
            data-testid="pick-past-hour"
            onClick={() => {
              props.onChange({ range: "Past 1 Hour" });
            }}
          >
            past hour
          </button>
        </span>
      );
    },
  };
});

// The logs list, answered by a store of Event logs that filters like the server.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  const store: {
    eventLogStoreGetList: (...args: Array<unknown>) => unknown;
  } = jest.requireActual("./KubernetesEventsLogStore");

  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return store.eventLogStoreGetList(...args);
      },
    },
  };
});

import KubernetesClusterEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

function put(
  fields: KubernetesEventFields,
  options: {
    clusterName?: string;
    watchType?: "ADDED" | "MODIFIED" | "DELETED";
    stamped?: boolean;
  } = {},
): void {
  putEvent(fields, {
    clusterName: options.clusterName || CLUSTER,
    watchType: options.watchType,
    stamped: options.stamped,
  });
}

// Every read the page made, in order (the store's list, renewed by each reset).
const listRequestsOf: { current: Array<RecordedListRequest> } = {
  current: eventLogStore.requests,
};

const ISSUE_EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);

// The issue's warnings, each added and then repeated, among Normal events.
function aBusyClusterDay(normalEvents: number = 40): void {
  for (const fields of ISSUE_EVENTS) {
    put(
      { ...fields, count: 1, lastSeen: fields.firstSeen },
      {
        watchType: "ADDED",
      },
    );
    put(fields, { watchType: "MODIFIED" });
  }

  for (let index: number = 0; index < normalEvents; index++) {
    put(normalPodEvent(index, NOW));
  }

  // Another cluster's warning: never on this page.
  put(
    {
      ...ISSUE_EVENTS[0]!,
      uid: "99999999-0000-4000-8000-000000000001",
      reason: "FailedMount",
      object: { kind: "Pod", name: "staging-db-0", namespace: "staging" },
    },
    { clusterName: OTHER_CLUSTER },
  );
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(): Promise<void> {
  render(<KubernetesClusterEvents {...({} as PageComponentProps)} />);
  await flush();
}

function typeButton(name: string): HTMLElement {
  return within(screen.getByTestId("kubernetes-events-filters")).getByRole(
    "radio",
    { name: new RegExp(`^${name}`) },
  );
}

function shownReasons(): Array<string> {
  return screen
    .queryAllByTestId("kubernetes-event-reason")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function rowOf(reason: string, objectName: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .queryAllByTestId("kubernetes-event")
    .map((cell: HTMLElement): HTMLElement => {
      return cell.closest("tr") as HTMLElement;
    })
    .find((candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId("kubernetes-event-reason").textContent ===
          reason &&
        (
          within(candidate).queryByTestId("kubernetes-event-object")
            ?.textContent || ""
        ).includes(objectName)
      );
    });

  if (!row) {
    throw new Error(`No row for ${reason} on ${objectName}`);
  }

  return row;
}

beforeEach(() => {
  resetEventLogStore();
  listRequestsOf.current = eventLogStore.requests;
  queryString = {};
  getItemMock.mockReset();
  setQueryStringMock.mockReset();
  navigateMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: CLUSTER_ID,
    clusterIdentifier: CLUSTER,
  });
});

afterEach(() => {
  cleanup();
});

describe("a cluster's Events page opens on its warnings", () => {
  test("every warning of the issue, among forty Normal events, one row per Event", async () => {
    aBusyClusterDay();
    await renderPage();

    expect(typeButton("Warnings")).toHaveAttribute("aria-checked", "true");
    expect(shownReasons()).toHaveLength(ISSUE_EVENTS.length);
    expect(shownReasons().sort()).toEqual(
      ISSUE_EVENTS.map((fields: KubernetesEventFields) => {
        return fields.reason;
      }).sort(),
    );
    // Another cluster's warning is not this cluster's.
    expect(shownReasons()).not.toContain("FailedMount");
  });

  test("a row says what the customer asked to see: message, type, reason, source, object, namespace and count", async () => {
    aBusyClusterDay();
    await renderPage();

    const oom: HTMLElement = rowOf(
      "OOMKilling",
      "aks-userpool-11935137-vmss00000o",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-message"),
    ).toHaveTextContent(
      "Memory cgroup out of memory: Killed process 318623 (MainThread)",
    );
    expect(within(oom).getByTestId("kubernetes-event-type")).toHaveTextContent(
      "Warning",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-source"),
    ).toHaveTextContent(
      "Reported by kernel-monitor · aks-userpool-11935137-vmss00000o",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-object"),
    ).toHaveTextContent("Node");
    expect(
      within(oom).getByTestId("kubernetes-event-namespace"),
    ).toHaveTextContent("default");
    expect(within(oom).getByTestId("kubernetes-event-count")).toHaveTextContent(
      "2",
    );
    expect(
      within(oom).getByTestId("kubernetes-event-last-seen"),
    ).toHaveAttribute("dateTime", ISSUE_EVENTS[0]!.lastSeen);

    const istiod: HTMLElement = rowOf("FailedGetResourceMetric", "istiod");
    expect(
      within(istiod).getByTestId("kubernetes-event-namespace"),
    ).toHaveTextContent("aks-istio-system");
    expect(
      within(istiod).getByTestId("kubernetes-event-source"),
    ).toHaveTextContent("Reported by horizontal-pod-autoscaler");
    expect(
      within(istiod).getByTestId("kubernetes-event-count"),
    ).toHaveTextContent("3");
    expect(
      within(rowOf("FailedComputeMetricsReplicas", "nginx")).getByTestId(
        "kubernetes-event-namespace",
      ),
    ).toHaveTextContent("app-routing-system");
  });

  test("an Event's object links to its page in OneUptime", async () => {
    aBusyClusterDay();
    await renderPage();

    const nodeLink: HTMLElement = within(
      rowOf("OOMKilling", "aks-userpool-11935137-vmss00000o"),
    ).getByRole("link", { name: "aks-userpool-11935137-vmss00000o" });
    expect(nodeLink.getAttribute("href")).toContain(
      `/kubernetes/${CLUSTER_ID}/nodes/aks-userpool-11935137-vmss00000o`,
    );

    const hpaLink: HTMLElement = within(
      rowOf("FailedGetResourceMetric", "istiod"),
    ).getByRole("link", { name: "istiod" });
    expect(hpaLink.getAttribute("href")).toContain(
      `/kubernetes/${CLUSTER_ID}/hpas/istiod`,
    );
  });

  test("the buttons count every Event, the warnings and the Normal ones", async () => {
    aBusyClusterDay();
    await renderPage();

    expect(typeButton("All")).toHaveTextContent(
      String(ISSUE_EVENTS.length + 40),
    );
    expect(typeButton("Warnings")).toHaveTextContent(
      String(ISSUE_EVENTS.length),
    );
    expect(typeButton("Normal")).toHaveTextContent("40");
  });

  test("the warnings are read on their own, and every read is this cluster's", async () => {
    aBusyClusterDay();
    await renderPage();

    expect(listRequestsOf.current).toHaveLength(2);
    for (const request of listRequestsOf.current) {
      expect(request.attributes["resource.k8s.cluster.name"]).toBe(CLUSTER);
      expect(request.attributes["event.domain"]).toBe("k8s");
      expect(request.attributes["k8s.resource.name"]).toBe("events");
      // The bodies are not read: everything shown is in the attributes.
      expect(request.select["body"]).toBeUndefined();
    }
    expect(
      listRequestsOf.current.map(
        (request: { attributes: Record<string, unknown> }) => {
          return request.attributes["k8s.event.type"];
        },
      ),
    ).toEqual(["Warning", undefined]);
  });

  test("the warnings are found however busy the cluster is", async () => {
    // Far more Normal events than one read takes.
    aBusyClusterDay(1200);
    await renderPage();

    expect(shownReasons()).toHaveLength(ISSUE_EVENTS.length);
    expect(typeButton("Warnings")).toHaveTextContent(
      String(ISSUE_EVENTS.length),
    );
    // All is the newest of a range that holds more than was read: no count.
    expect(typeButton("All").textContent).toBe("All");
  });
});

describe("switching what the page shows", () => {
  test("All shows the Normal events too, and the choice is kept in the URL", async () => {
    aBusyClusterDay();
    await renderPage();

    fireEvent.click(typeButton("All"));
    await flush();

    expect(typeButton("All")).toHaveAttribute("aria-checked", "true");
    expect(shownReasons()).toContain("Pulled");
    expect(shownReasons()).toContain("OOMKilling");
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "all" }),
    );
  });

  test("Normal shows only the Normal events", async () => {
    aBusyClusterDay();
    await renderPage();

    fireEvent.click(typeButton("Normal"));
    await flush();

    expect(new Set(shownReasons())).toEqual(new Set(["Pulled"]));
  });

  test("a cluster with no warnings opens on every event", async () => {
    for (let index: number = 0; index < 5; index++) {
      put(normalPodEvent(index, NOW));
    }
    await renderPage();

    expect(typeButton("All")).toHaveAttribute("aria-checked", "true");
    expect(shownReasons()).toHaveLength(5);
  });

  test("a view the URL asks for is the one shown", async () => {
    aBusyClusterDay();
    queryString = { type: "normal" };
    await renderPage();

    expect(typeButton("Normal")).toHaveAttribute("aria-checked", "true");
  });

  test("a namespace in the URL narrows both reads on the server", async () => {
    aBusyClusterDay();
    queryString = { namespace: "aks-istio-system" };
    await renderPage();

    for (const request of listRequestsOf.current) {
      expect(request.attributes["k8s.namespace.name"]).toBe("aks-istio-system");
    }
    expect(new Set(shownReasons())).toEqual(
      new Set(["FailedGetResourceMetric", "FailedComputeMetricsReplicas"]),
    );
  });

  test("a time range picked reads again over it", async () => {
    aBusyClusterDay();
    await renderPage();
    eventLogStore.requests.length = 0;

    fireEvent.click(screen.getByTestId("pick-past-hour"));
    await flush();

    expect(listRequestsOf.current).toHaveLength(2);
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: "Past 1 Hour" }),
    );
  });
});

describe("when there is nothing to show, or the read fails", () => {
  test("warnings asked for and none: the good news, and the way to every event", async () => {
    put(normalPodEvent(1, NOW));
    queryString = { type: "warning" };
    await renderPage();

    const empty: HTMLElement = screen.getByTestId(
      "kubernetes-events-empty-warnings",
    );
    expect(empty).toHaveTextContent("No warnings in this time range");

    fireEvent.click(
      within(empty).getByRole("button", { name: "Show all events" }),
    );
    await flush();

    expect(typeButton("All")).toHaveAttribute("aria-checked", "true");
    expect(shownReasons()).toEqual(["Pulled"]);
  });

  test("a filter that matches nothing says so, and clears", async () => {
    aBusyClusterDay();
    queryString = { reason: "ImagePullBackOff" };
    await renderPage();

    const empty: HTMLElement = screen.getByTestId(
      "kubernetes-events-empty-filtered",
    );
    expect(empty).toHaveTextContent("No events match these filters");

    fireEvent.click(
      within(empty).getByRole("button", { name: "Clear Filters" }),
    );
    await flush();

    expect(shownReasons()).toHaveLength(ISSUE_EVENTS.length);
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "", namespace: "", kind: "" }),
    );
  });

  test("no events at all: where they come from", async () => {
    await renderPage();

    expect(screen.getByTestId("kubernetes-events-empty")).toHaveTextContent(
      "No events in this time range",
    );
  });

  test("a read that fails says why, with a way to try again", async () => {
    aBusyClusterDay();
    eventLogStore.failNextRead = "The query took too long.";
    await renderPage();

    const error: HTMLElement = screen.getByTestId("kubernetes-events-error");
    expect(error).toHaveTextContent("The query took too long.");

    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    await flush();

    expect(shownReasons()).toHaveLength(ISSUE_EVENTS.length);
  });

  test("a cluster that is not found says so", async () => {
    getItemMock.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByTestId("kubernetes-events-error")).toHaveTextContent(
      "Cluster not found.",
    );
  });
});

describe("Events stored before the upgrade", () => {
  test("are read from their bodies, by id - a warning among them still opens the page on the warnings", async () => {
    put(ISSUE_EVENTS[0]!, { stamped: false });
    put(normalPodEvent(1, NOW), { stamped: false });
    await renderPage();

    /*
     * The server has no stamped type to find them by: the read of every
     * event finds them, and their bodies say which is a warning.
     */
    const bodyRead: { select: Record<string, boolean>; ids?: Array<string> } =
      listRequestsOf.current.find((request: { ids?: Array<string> }) => {
        return Boolean(request.ids);
      })!;
    expect(bodyRead.select["body"]).toBe(true);
    expect(bodyRead.ids).toHaveLength(2);

    expect(typeButton("Warnings")).toHaveAttribute("aria-checked", "true");
    expect(shownReasons()).toEqual(["OOMKilling"]);
    expect(
      within(rowOf("OOMKilling", "aks-userpool")).getByTestId(
        "kubernetes-event-type",
      ),
    ).toHaveTextContent("Warning");

    fireEvent.click(typeButton("All"));
    await flush();

    expect(shownReasons().sort()).toEqual(["OOMKilling", "Pulled"]);
  });
});
