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
import { MemoryRouter } from "react-router-dom";
import { Edge, Node } from "reactflow";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as FlowViewportGuardProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard";

/*
 * The Queues topology as a person uses it: what they see first, how they
 * narrow it (search, a broker, Needs attention, folding by broker, a
 * focus), the table for a project too large to draw, the drawer on a queue,
 * a service or a line, and what it says when there is nothing to draw. React
 * Flow is stood in for by buttons for its nodes and lines (their data
 * written out), and the viewport guard by a stand-in that reports an
 * instance; the broker numbers' hook is answered by the test.
 */

const mockSetQuery: MockFunction = getJestMockFunction();
mockSetQuery.mockImplementation((values: Record<string, string | null>) => {
  const url: URL = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState({}, "", url.toString());
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (key: string) => {
        return new URLSearchParams(window.location.search).get(key);
      },
      setQueryString: (values: Record<string, string | null>) => {
        mockSetQuery(values);
      },
      navigate: () => {},
      getCurrentRoute: () => {
        return { toString: () => "/" };
      },
    },
  };
});

let mockHeadlines: Map<string, unknown> = new Map<string, unknown>();
const mockHeadlineAsks: Array<Array<string>> = [];
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/UseMessageQueueBrokerHeadlines",
  () => {
    return {
      __esModule: true,
      default: (data: { queues: Array<{ id: string }> }) => {
        mockHeadlineAsks.push(
          data.queues
            .map((queue: { id: string }) => {
              return queue.id;
            })
            .sort(),
        );
        return mockHeadlines;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard",
  () => {
    return {
      __esModule: true,
      default: (props: FlowViewportGuardProps) => {
        React.useEffect(() => {
          props.onInstance({ fitView: () => true } as never);
        }, []);
        return <></>;
      },
    };
  },
);

interface MockFlowProps {
  nodes: Array<Node>;
  edges: Array<Edge>;
  children?: React.ReactNode;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
}

jest.mock("reactflow", () => {
  return {
    __esModule: true,
    MarkerType: { ArrowClosed: "arrowclosed" },
    BackgroundVariant: { Dots: "dots" },
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    default: (props: MockFlowProps) => {
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map((node: Node) => {
            const data: {
              title: string;
              subtitle: string;
              dimmed: boolean;
              card: {
                statusLabel: string;
                stats: Array<{ label: string; value: string }>;
                footer?: string;
              };
            } = node.data;
            return (
              <button
                key={node.id}
                data-testid={`map-node-${node.id}`}
                data-dimmed={String(data.dimmed)}
                onClick={(event: React.MouseEvent) => {
                  props.onNodeClick(event, node);
                }}
              >
                {data.title} | {data.subtitle} | {data.card.statusLabel} |{" "}
                {data.card.stats
                  .map((stat: { label: string; value: string }) => {
                    return `${stat.value} ${stat.label}`;
                  })
                  .join(", ")}{" "}
                | {data.card.footer || ""}
              </button>
            );
          })}
          {props.edges.map((edge: Edge) => {
            return (
              <button
                key={edge.id}
                data-testid={`map-edge-${edge.id}`}
                data-animated={String(Boolean(edge.animated))}
                onClick={(event: React.MouseEvent) => {
                  props.onEdgeClick(event, edge);
                }}
              >
                {String(edge.label ?? "")}
              </button>
            );
          })}
          {props.children}
        </div>
      );
    },
  };
});

import MessageQueueTopologyExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyExplorer";
import {
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import { getMessageQueueHeadlineDescriptors } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueBrokerHeadlines";

const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-07T11:00:00.000Z"),
  end: new Date("2026-11-07T12:00:00.000Z"),
};

function queue(
  id: string,
  extra?: Partial<MessageQueueTopologyQueue>,
): MessageQueueTopologyQueue {
  return {
    id: id,
    name: id,
    messagingSystem: "kafka",
    destinationName: id,
    brokerScope: "",
    brokerAddress: "",
    queueIdentifier: `kafka||${id}`,
    discoverySource: "traces",
    lastSeenAt: "2026-11-07T11:58:00.000Z",
    brokerMetricsLastSeenAt: null,
    spans: 3600,
    errors: 0,
    published: 3600,
    consumed: 3600,
    ...extra,
  };
}

function flow(
  queueId: string,
  serviceId: string,
  direction: "publish" | "consume",
  messages: number,
  errors: number = 0,
): MessageQueueTopologyFlow {
  return {
    queueId,
    serviceId,
    direction,
    messages,
    errors,
    errorRatePercent: (errors / messages) * 100,
    p95DurationMs: 12,
  };
}

function answer(
  queues: Array<MessageQueueTopologyQueue>,
  flows: Array<MessageQueueTopologyFlow>,
  extra?: Partial<MessageQueueTopologyResponse>,
): MessageQueueTopologyResponse {
  const ids: Set<string> = new Set<string>(
    flows.map((item: MessageQueueTopologyFlow) => {
      return item.serviceId;
    }),
  );
  return {
    startTime: WINDOW.start.toISOString(),
    endTime: WINDOW.end.toISOString(),
    queues: queues,
    services: Array.from(ids).map((id: string) => {
      return { id: id, name: id };
    }),
    flows: flows,
    truncation: { queues: false, flows: false },
    ...extra,
  };
}

// checkout -> orders -> fulfilment -> shipments -> notifier; billing also
// consumes orders; audit (RabbitMQ) is fed by checkout and fails a lot;
// archive has no traced message.
function pipeline(): MessageQueueTopologyResponse {
  return answer(
    [
      queue("orders"),
      queue("shipments"),
      queue("audit", { messagingSystem: "rabbitmq", queueIdentifier: "rabbitmq||audit", errors: 720, consumed: 0 }),
      queue("archive", { spans: 0, published: 0, consumed: 0 }),
    ],
    [
      flow("orders", "checkout", "publish", 3600),
      flow("orders", "fulfilment", "consume", 3600),
      flow("orders", "billing", "consume", 1800),
      flow("shipments", "fulfilment", "publish", 1800),
      flow("shipments", "notifier", "consume", 1800),
      flow("audit", "checkout", "publish", 3600, 720),
    ],
  );
}

function show(
  data: MessageQueueTopologyResponse,
  anchorQueueId?: string,
): void {
  render(
    <MemoryRouter>
      <MessageQueueTopologyExplorer
        data={data}
        window={WINDOW}
        anchorQueueId={anchorQueueId}
      />
    </MemoryRouter>,
  );
}

function node(key: string): HTMLElement {
  return screen.getByTestId(`map-node-${key}`);
}

function drawnNodes(): Array<string> {
  return screen
    .queryAllByTestId(/^map-node-/)
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-testid")!.replace("map-node-", "");
    })
    .sort();
}

beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard/p/queues/topology");
  mockSetQuery.mockClear();
  mockHeadlines = new Map<string, unknown>();
  mockHeadlineAsks.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what a person sees first", () => {
  test("the summary: queues with traced messages, services, messages, what needs attention", () => {
    show(pipeline());
    expect(
      screen.getByTestId("message-queue-topology-summary-queues"),
    ).toHaveTextContent("3with traced messages, of 4 live queues");
    expect(
      screen.getByTestId("message-queue-topology-summary-services"),
    ).toHaveTextContent("4");
    expect(
      screen.getByTestId("message-queue-topology-summary-messages"),
    ).toHaveTextContent("10.8k");
    expect(
      screen.getByTestId("message-queue-topology-summary-attention"),
    ).toHaveTextContent("2");
  });

  test("a small project opens on the map: every connected queue and service, the rest listed under it", () => {
    show(pipeline());
    expect(drawnNodes()).toEqual(
      [
        "queue:orders",
        "queue:shipments",
        "queue:audit",
        "service:checkout",
        "service:fulfilment",
        "service:billing",
        "service:notifier",
      ].sort(),
    );
    const unconnected: HTMLElement = screen.getByTestId(
      "message-queue-topology-unconnected",
    );
    expect(
      within(unconnected).getAllByTestId("message-queue-topology-unconnected-item"),
    ).toHaveLength(1);
    expect(unconnected).toHaveTextContent("archive");
    expect(unconnected).toHaveTextContent("No traced messages");
  });

  test("cards carry their numbers and status; lines their message rate", () => {
    show(pipeline());
    expect(node("queue:orders")).toHaveTextContent(
      "orders | Apache Kafka | Messages flowing | 1.0/s in, 1.0/s out, 0% errors | 1 producer · 2 consumers",
    );
    expect(node("queue:audit")).toHaveTextContent("High error rate");
    expect(node("service:checkout")).toHaveTextContent("Publishes to 2 queues");
    expect(
      screen.getByTestId("map-edge-publish:service:checkout:queue:orders"),
    ).toHaveTextContent("1.0/s");
  });

  test("the lines can carry their error rate or p95 instead, or nothing until hovered", () => {
    show(pipeline());
    const select: HTMLElement = screen.getByTestId(
      "message-queue-topology-edge-label",
    );
    fireEvent.change(select, { target: { value: "errors" } });
    expect(
      screen.getByTestId("map-edge-publish:service:checkout:queue:audit"),
    ).toHaveTextContent("20.0%");
    fireEvent.change(select, { target: { value: "latency" } });
    expect(
      screen.getByTestId("map-edge-publish:service:checkout:queue:audit"),
    ).toHaveTextContent("12 ms");
    fireEvent.change(select, { target: { value: "hover" } });
    expect(
      screen.getByTestId("map-edge-publish:service:checkout:queue:audit"),
    ).toHaveTextContent("");
  });

  test("the broker numbers are asked for the queues on screen, and shown on their cards", () => {
    mockHeadlines = new Map<string, unknown>([
      [
        "orders",
        {
          status: "ready",
          headline: {
            waiting: {
              descriptor: getMessageQueueHeadlineDescriptors("kafka").waiting[0]!,
              value: 4200,
            },
            deadLetter: null,
          },
        },
      ],
    ]);
    show(pipeline());
    expect(mockHeadlineAsks[mockHeadlineAsks.length - 1]).toEqual(
      ["audit", "orders", "shipments"].sort(),
    );
    expect(node("queue:orders")).toHaveTextContent("4.2k lag");
  });

  test("the truncation is said when the read hit a limit", () => {
    show({ ...pipeline(), truncation: { queues: false, flows: true } });
    expect(
      screen.getByTestId("message-queue-topology-truncation"),
    ).toHaveTextContent("It shows the busiest 50,000.");
  });
});

describe("narrowing it down", () => {
  test("a search keeps the match and its neighbours, dimmed", () => {
    jest.useFakeTimers();
    show(pipeline());
    fireEvent.change(screen.getByTestId("message-queue-topology-search"), {
      target: { value: "notifier" },
    });
    expect(drawnNodes()).toEqual(["queue:shipments", "service:notifier"]);
    expect(node("queue:shipments")).toHaveAttribute("data-dimmed", "true");
    expect(node("service:notifier")).toHaveAttribute("data-dimmed", "false");
    expect(
      screen.getByTestId("message-queue-topology-result-count"),
    ).toHaveTextContent("1 of 8 · 1 shown for context");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(new URLSearchParams(window.location.search).get("search")).toBe(
      "notifier",
    );
  });

  test("Needs attention shows what fails, with its neighbours", () => {
    show(pipeline());
    fireEvent.click(screen.getByTestId("message-queue-topology-attention"));
    // audit fails, and so does checkout: a fifth of what it publishes there.
    expect(drawnNodes()).toEqual(
      ["queue:audit", "queue:orders", "service:checkout"].sort(),
    );
    expect(node("queue:audit")).toHaveAttribute("data-dimmed", "false");
    expect(node("service:checkout")).toHaveAttribute("data-dimmed", "false");
    expect(node("queue:orders")).toHaveAttribute("data-dimmed", "true");
  });

  test("a broker shows its queues and the services on them", () => {
    show(pipeline());
    fireEvent.change(screen.getByTestId("message-queue-topology-broker"), {
      target: { value: "rabbitmq|" },
    });
    expect(drawnNodes()).toEqual(["queue:audit", "service:checkout"]);
    expect(new URLSearchParams(window.location.search).get("broker")).toBe(
      "rabbitmq|",
    );
    fireEvent.click(screen.getByTestId("message-queue-topology-reset"));
    expect(drawnNodes()).toHaveLength(7);
  });

  test("folding by broker draws a card per broker; selecting one opens into its queues", () => {
    show(pipeline());
    fireEvent.click(screen.getByTestId("message-queue-topology-group"));
    expect(drawnNodes()).toEqual(
      [
        "broker:kafka|",
        "broker:rabbitmq|",
        "service:billing",
        "service:checkout",
        "service:fulfilment",
        "service:notifier",
      ].sort(),
    );
    expect(node("broker:kafka|")).toHaveTextContent("Select to see its queues");
    fireEvent.click(node("broker:kafka|"));
    expect(drawnNodes()).toEqual(
      [
        "queue:orders",
        "queue:shipments",
        "service:billing",
        "service:checkout",
        "service:fulfilment",
        "service:notifier",
      ].sort(),
    );
    expect(
      screen.getByTestId("message-queue-topology-group"),
    ).not.toBeChecked();
  });

  test("a filter that matches nothing says so, and clears", () => {
    show(pipeline());
    fireEvent.change(screen.getByTestId("message-queue-topology-search"), {
      target: { value: "no-such-thing" },
    });
    expect(
      screen.getByTestId("message-queue-topology-no-results"),
    ).toHaveTextContent("Nothing matches your filters");
    fireEvent.click(screen.getByText("Clear filters"));
    expect(drawnNodes()).toHaveLength(7);
  });
});

describe("following one queue's messages", () => {
  test("Show its flow follows the queue upstream and downstream, and Show everything comes back", () => {
    show(pipeline());
    fireEvent.click(node("queue:shipments"));
    const drawer: HTMLElement = screen.getByTestId(
      "message-queue-topology-drawer-queue",
    );
    fireEvent.click(
      within(drawer).getByTestId("message-queue-topology-drawer-focus"),
    );
    expect(drawnNodes()).toEqual(
      [
        "queue:orders",
        "queue:shipments",
        "service:checkout",
        "service:fulfilment",
        "service:notifier",
      ].sort(),
    );
    expect(
      screen.getByTestId("message-queue-topology-focus"),
    ).toHaveTextContent(
      "Where messages through shipments come from and go",
    );
    expect(new URLSearchParams(window.location.search).get("focus")).toBe(
      "queue:shipments",
    );
    // Grouping is for the whole map.
    expect(screen.queryByTestId("message-queue-topology-group")).toBeNull();

    fireEvent.click(screen.getByTestId("message-queue-topology-clear-focus"));
    expect(drawnNodes()).toHaveLength(7);
    expect(new URLSearchParams(window.location.search).get("focus")).toBeNull();
  });

  test("a focus in the URL opens focused", () => {
    window.history.replaceState({}, "", "/x?focus=service%3Anotifier");
    show(pipeline());
    expect(drawnNodes()).toEqual(
      [
        "queue:orders",
        "queue:shipments",
        "service:checkout",
        "service:fulfilment",
        "service:notifier",
      ].sort(),
    );
  });

  test("a queue's own tab opens on its flow, with the way to the whole map and back to it", () => {
    show(pipeline(), "orders");
    expect(drawnNodes()).toEqual(
      [
        "queue:orders",
        "queue:shipments",
        "service:billing",
        "service:checkout",
        "service:fulfilment",
        "service:notifier",
      ].sort(),
    );
    const open: HTMLElement = screen.getByTestId(
      "message-queue-topology-open-full",
    );
    expect(open.getAttribute("href")).toContain("/queues/topology");
    expect(open.getAttribute("href")).toContain("focus=queue%3Aorders");
    expect(screen.queryByTestId("message-queue-topology-back-to-anchor")).toBeNull();
    // The anchor's focus is not written to the URL: it is the tab's own.
    expect(new URLSearchParams(window.location.search).get("focus")).toBeNull();

    fireEvent.click(node("service:notifier"));
    fireEvent.click(screen.getByTestId("message-queue-topology-drawer-focus"));
    fireEvent.click(screen.getByTestId("message-queue-topology-back-to-anchor"));
    expect(
      screen.getByTestId("message-queue-topology-focus"),
    ).toHaveTextContent("Where messages through orders come from and go");
  });
});

describe("the drawer", () => {
  test("a queue: its numbers, who publishes and who consumes, and the way to its page", () => {
    show(pipeline());
    fireEvent.click(node("queue:orders"));
    const drawer: HTMLElement = screen.getByTestId(
      "message-queue-topology-drawer-queue",
    );
    expect(
      within(drawer).getByTestId("message-queue-topology-drawer-published"),
    ).toHaveTextContent("Published3.6k1.0/s");
    expect(
      within(drawer).getByTestId("message-queue-topology-drawer-errors"),
    ).toHaveTextContent("0% of its spans");
    const producers: HTMLElement = within(drawer).getByTestId(
      "message-queue-topology-drawer-producers",
    );
    expect(producers).toHaveTextContent("checkout");
    expect(producers).toHaveTextContent("p95 publish 12 ms");
    const consumers: HTMLElement = within(drawer).getByTestId(
      "message-queue-topology-drawer-consumers",
    );
    expect(
      within(consumers).getAllByTestId(
        "message-queue-topology-drawer-consumers-row",
      ),
    ).toHaveLength(2);
    expect(
      within(drawer)
        .getByTestId("message-queue-topology-drawer-open-queue")
        .getAttribute("href"),
    ).toContain("/queues/orders");
    expect(
      within(drawer)
        .getByTestId("message-queue-topology-drawer-traces")
        .getAttribute("href"),
    ).toContain("/queues/orders/traces");
  });

  test("a queue nobody is seen consuming says what to instrument, even while it fails", () => {
    show(pipeline());
    fireEvent.click(node("queue:audit"));
    expect(
      screen.getByTestId("message-queue-topology-drawer-queue"),
    ).toHaveTextContent("High error rate");
    expect(
      screen.getByTestId("message-queue-topology-drawer-hint"),
    ).toHaveTextContent("instrument it with OpenTelemetry");
  });

  test("a row steps along the map: a producer opens the service", () => {
    show(pipeline());
    fireEvent.click(node("queue:orders"));
    fireEvent.click(
      within(
        screen.getByTestId("message-queue-topology-drawer-producers"),
      ).getByTestId("message-queue-topology-drawer-producers-row"),
    );
    const drawer: HTMLElement = screen.getByTestId(
      "message-queue-topology-drawer-service",
    );
    expect(
      within(drawer).getByTestId("message-queue-topology-drawer-publishes-to"),
    ).toHaveTextContent("orders");
    expect(
      within(drawer)
        .getByTestId("message-queue-topology-drawer-open-service")
        .getAttribute("href"),
    ).toContain("/service/checkout");
  });

  test("a line: its messages and failures, its p95, and both ends", () => {
    show(pipeline());
    fireEvent.click(
      screen.getByTestId("map-edge-publish:service:checkout:queue:audit"),
    );
    const drawer: HTMLElement = screen.getByTestId(
      "message-queue-topology-drawer-edge",
    );
    expect(
      within(drawer).getByTestId("message-queue-topology-drawer-errors"),
    ).toHaveTextContent("Errors72020.0%");
    expect(
      within(drawer).getByTestId("message-queue-topology-drawer-p95"),
    ).toHaveTextContent("p95 publish12 ms");
    expect(screen.getByText("checkout → audit")).toBeInTheDocument();
  });

  test("the selected node's lines are drawn moving", () => {
    show(pipeline());
    fireEvent.click(node("queue:orders"));
    expect(
      screen.getByTestId("map-edge-publish:service:checkout:queue:orders"),
    ).toHaveAttribute("data-animated", "true");
    expect(
      screen.getByTestId("map-edge-publish:service:fulfilment:queue:shipments"),
    ).toHaveAttribute("data-animated", "false");
  });
});

describe("a project too large to draw", () => {
  function large(): MessageQueueTopologyResponse {
    const queues: Array<MessageQueueTopologyQueue> = [];
    const flows: Array<MessageQueueTopologyFlow> = [];
    for (let index: number = 0; index < 45; index++) {
      queues.push(
        queue(`topic-${String(index).padStart(2, "0")}`, {
          published: 100 + index,
          consumed: 100 + index,
        }),
      );
      flows.push(flow(`topic-${String(index).padStart(2, "0")}`, `producer-${index % 20}`, "publish", 100 + index));
      flows.push(flow(`topic-${String(index).padStart(2, "0")}`, `consumer-${index % 10}`, "consume", 100 + index));
    }
    return answer(queues, flows);
  }

  test("opens as a table of queues, busiest first, a page at a time, and says why", () => {
    show(large());
    expect(screen.queryByTestId("rendered-graph")).toBeNull();
    expect(screen.getAllByTestId("message-queue-topology-table-row")).toHaveLength(40);
    expect(
      screen.getAllByTestId("message-queue-topology-table-row")[0],
    ).toHaveTextContent("topic-44");
    expect(
      screen.getByText(/too many queues and services to draw at once/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getAllByTestId("message-queue-topology-table-row")).toHaveLength(5);
  });

  test("Show its flow on a row draws a readable map of that queue's part", () => {
    show(large());
    fireEvent.click(
      screen.getAllByTestId("message-queue-topology-show-on-map")[0]!,
    );
    expect(drawnNodes()).toEqual(
      ["consumer-4", "producer-4", "topic-44"].map((name: string) => {
        return name.startsWith("topic") ? `queue:${name}` : `service:${name}`;
      }).sort(),
    );
  });
});

describe("when there is nothing to draw", () => {
  test("no queue: what makes queues appear, and where to set them up", () => {
    show(answer([], []));
    const empty: HTMLElement = screen.getByTestId(
      "message-queue-topology-empty-noQueues",
    );
    expect(empty).toHaveTextContent("No queues yet");
    expect(empty).toHaveTextContent("messaging.destination.name");
    expect(screen.getByText("How to instrument applications →")).toBeInTheDocument();
    expect(screen.queryByTestId("message-queue-topology-search")).toBeNull();
  });

  test("queues, but no traced message: pick a longer range or instrument, and the queues are listed", () => {
    show(
      answer(
        [
          queue("orders", { spans: 0, published: 0, consumed: 0 }),
          queue("emails", { spans: 0, published: 0, consumed: 0 }),
        ],
        [],
      ),
    );
    expect(
      screen.getByTestId("message-queue-topology-empty-noTraffic"),
    ).toHaveTextContent("You have 2 queues, but no instrumented service");
    expect(
      screen.getAllByTestId("message-queue-topology-queue-item"),
    ).toHaveLength(2);
  });

  test("spans, but no publish or consume: what to record", () => {
    show(answer([queue("orders")], []));
    expect(
      screen.getByTestId("message-queue-topology-empty-noFlows"),
    ).toHaveTextContent("PRODUCER spans");
  });
});
