/** @timezone UTC */

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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NAMES INSTEAD OF BARE ADDRESSES on the Traffic page (issue #5340),
 * rendered: the top sources, destinations and devices, both views of the
 * conversations, the filter chips, the card a page narrowed to one address
 * opens with, the senders that are no device yet, and "find" by a name.
 *
 *   - An address the project names is shown by its name, the address under
 *     it (left to right, in the mono face), the subnet it is in beside the
 *     address; the whole of it is under the pointer and in what a screen
 *     reader hears.
 *   - An address nothing names is shown as it always was.
 *   - Narrowed to one address, the page says who it is and offers the next
 *     step: open its record, name it, or change the name someone gave on
 *     Network > Settings > Address Names (its one place) - each for who
 *     may.
 *   - Find takes a name: one address found narrows the page, several are
 *     listed to pick from, none is said.
 *
 * The network is replaced (the traffic and find POSTs), and so is the
 * Address Name dialog (ModelFormModal: its props are captured; the offline
 * NetworkTrafficNames suite drives the real one).
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const HOST_ID: string = "60000000-0000-4000-8000-000000000001";
const CLOUD_ID: string = "70000000-0000-4000-8000-000000000001";
const NAME_ROW_ID: string = "90000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-28T12:00:00.000Z");

const summaryPostMock: MockFunction = getJestMockFunction();
const findPostMock: MockFunction = getJestMockFunction();
const usagePostMock: MockFunction = getJestMockFunction();

interface CapturedModal {
  title: string;
  description?: string | undefined;
  modelIdToEdit?: { toString: () => string } | undefined;
  initialValues?: Record<string, unknown> | undefined;
  formProps: {
    formType: FormType;
    fields: Array<{ field: Record<string, unknown> }>;
  };
  onClose: () => void;
  onSuccess: () => void;
}

let capturedModal: CapturedModal | null = null;

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModal): React.ReactElement => {
      capturedModal = props;
      return (
        <div data-testid="address-name-dialog">
          <span>{props.title}</span>
          <button
            type="button"
            onClick={() => {
              props.onSuccess();
            }}
          >
            Saved
          </button>
          <button
            type="button"
            onClick={() => {
              props.onClose();
            }}
          >
            Closed
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Area/AreaChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <span data-testid="card-picker" />;
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        const url: string = String(
          (args[0] as { url?: unknown } | undefined)?.url,
        );

        if (url.includes("/usage-summary")) {
          return usagePostMock(...args);
        }

        if (url.includes("/find-address")) {
          return findPostMock(...args);
        }

        return summaryPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import NetworkTrafficView, {
  NetworkTrafficScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import { resetStandInCharts } from "./ChartZoomStandIn";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME } from "../../../UI/Components/Icon/Icon";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

interface PostedRequest {
  networkDeviceId?: string | undefined;
  networkSiteId?: string | undefined;
  startTime: string;
  endTime: string;
  filters?: Record<string, unknown> | undefined;
  query?: string | undefined;
}

const DEVICE_SCOPE: NetworkTrafficScope = {
  kind: "device",
  networkDeviceId: new ObjectID(DEVICE_ID),
};

const PERSIAN_NAME: string = "حقوق و دستمزد";
// An end of a conversation that is its address and nothing else.
const ONLY_198_51_100_7: RegExp = /^198\.51\.100\.7$/;
const ONLY_203_0_113_9: RegExp = /^203\.0\.113\.9$/;
const LONG_NAME: string =
  "mumbai-fileserver-primary-replica-01.storage.corp.acme-networks.example";

const NAMES: JSONObject = {
  "10.18.167.35": {
    name: "mumbai-fs01",
    source: "host",
    resourceId: HOST_ID,
    subnetName: "Mumbai office",
    subnet: "10.18.167.0/24",
  },
  "10.18.167.36": { subnetName: "Mumbai office", subnet: "10.18.167.0/24" },
  "10.18.167.31": { name: "mum-print-02.corp.example", source: "dns" },
  "158.115.141.143": {
    name: "Payroll SaaS",
    source: "address-name",
    resourceId: NAME_ROW_ID,
  },
  "10.114.167.16": {
    name: "orders-db-primary",
    source: "cloud-resource",
    resourceId: CLOUD_ID,
  },
  "10.200.221.245": {
    name: "core-sw-01",
    source: "network-device",
    resourceId: DEVICE_ID,
  },
  "10.242.167.220": { name: "checkout-api-7f9c6d", source: "kubernetes-pod" },
  "10.34.167.20": { name: "node-a", source: "kubernetes-node" },
  "10.0.0.77": { name: PERSIAN_NAME, source: "address-name" },
  "10.0.0.78": { name: LONG_NAME, source: "dns" },
};

function summary(overrides: JSONObject = {}): JSONObject {
  return {
    windowStartAt: "2026-10-28T11:00:00.000Z",
    windowEndAt: "2026-10-28T12:00:00.000Z",
    bucketSeconds: 60,
    totals: { octets: 600_000_000, packets: 500_000, flows: 1200 },
    maxSamplingRate: 1,
    series: [{ time: "2026-10-28 11:00:00", octets: 600_000_000 }],
    topSources: [
      { ip: "10.18.167.35", octets: 300_000_000, packets: 1 },
      { ip: "10.18.167.36", octets: 100_000_000, packets: 1 },
      { ip: "198.51.100.7", octets: 50_000_000, packets: 1 },
      { ip: "10.0.0.77", octets: 40_000_000, packets: 1 },
      { ip: "10.0.0.78", octets: 30_000_000, packets: 1 },
    ],
    topDestinations: [
      { ip: "158.115.141.143", octets: 200_000_000, packets: 1 },
      { ip: "10.114.167.16", octets: 100_000_000, packets: 1 },
    ],
    topConversations: [
      {
        sourceIp: "10.18.167.35",
        destinationIp: "158.115.141.143",
        octets: 200_000_000,
        packets: 1,
      },
      {
        sourceIp: "198.51.100.7",
        destinationIp: "203.0.113.9",
        octets: 50_000_000,
        packets: 1,
      },
    ],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
    sources: [],
    lastFlowAt: "2026-10-28 11:59:30",
    addressNames: NAMES,
    ...overrides,
  };
}

let summaryAnswer: (request: PostedRequest) => JSONObject = () => {
  return summary();
};

function postedSummaries(): Array<PostedRequest> {
  return summaryPostMock.mock.calls.map(
    (call: Array<unknown>): PostedRequest => {
      return (call[0] as { data: PostedRequest }).data;
    },
  );
}

function lastSummaryRequest(): PostedRequest {
  const all: Array<PostedRequest> = postedSummaries();
  const last: PostedRequest | undefined = all[all.length - 1];

  if (!last) {
    throw new Error("The traffic was never fetched");
  }

  return last;
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderView(
  scope: NetworkTrafficScope = DEVICE_SCOPE,
): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTrafficView scope={scope} />
    </MemoryRouter>,
  );
  await flush();
}

function rowsOf(listTestId: string): Array<HTMLElement> {
  return within(screen.getByTestId(listTestId)).getAllByTestId(
    `${listTestId}-row`,
  );
}

function rowWith(listTestId: string, text: string): HTMLElement {
  const row: HTMLElement | undefined = rowsOf(listTestId).find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(text);
    },
  );

  if (!row) {
    throw new Error(`No row with "${text}" in ${listTestId}`);
  }

  return row;
}

let mayCreateNames: boolean = true;
let mayUpdateNames: boolean = true;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  summaryPostMock.mockReset();
  findPostMock.mockReset();
  usagePostMock.mockReset();
  usagePostMock.mockResolvedValue({ data: { isAvailable: false } });
  resetStandInCharts();
  capturedModal = null;
  mayCreateNames = true;
  mayUpdateNames = true;
  summaryAnswer = () => {
    return summary();
  };
  summaryPostMock.mockImplementation(async (args: unknown) => {
    return { data: summaryAnswer((args as { data: PostedRequest }).data) };
  });

  const realCheck: typeof PermissionGate.check =
    PermissionGate.check.bind(PermissionGate);
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (
        model: Parameters<typeof PermissionGate.check>[0],
        action: ModelAction,
        options?: Parameters<typeof PermissionGate.check>[2],
      ): PermissionGateResult => {
        if (model instanceof NetworkAddressName) {
          return {
            isAllowed:
              action === ModelAction.Create
                ? mayCreateNames
                : action === ModelAction.Update
                  ? mayUpdateNames
                  : false,
          };
        }

        return realCheck(model, action, options);
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the top lists write a named address by its name, the address under it", () => {
  test("a named source: the name first, then the address and the subnet it is in", async () => {
    await renderView();

    const row: HTMLElement = rowWith("traffic-top-sources", "mumbai-fs01");
    const label: HTMLElement = within(row).getByTestId(
      "traffic-top-sources-row-label",
    );
    const sublabel: HTMLElement = within(row).getByTestId(
      "traffic-top-sources-row-sublabel",
    );

    expect(label).toHaveTextContent("mumbai-fs01");
    expect(label).not.toHaveTextContent("10.18.167.35");
    expect(label).toHaveAttribute("title", "mumbai-fs01 (10.18.167.35)");
    expect(sublabel).toHaveTextContent("10.18.167.35 · Mumbai office");
    expect(row).toHaveAccessibleName(
      "Show only the traffic from mumbai-fs01 (10.18.167.35)",
    );
  });

  test("the address reads left to right in the mono face, whatever the page's language", async () => {
    await renderView();

    const sublabel: HTMLElement = within(
      rowWith("traffic-top-sources", "mumbai-fs01"),
    ).getByTestId("traffic-top-sources-row-sublabel");
    const address: HTMLElement = within(sublabel).getByTestId(
      "traffic-address-text",
    );

    expect(address.tagName).toBe("BDI");
    expect(address).toHaveAttribute("dir", "ltr");
    expect(address).toHaveClass("font-mono");
    expect(address).toHaveTextContent("10.18.167.35");
  });

  test("an address only a subnet's name says anything about: the address first, the subnet under it", async () => {
    await renderView();

    const row: HTMLElement = rowWith("traffic-top-sources", "10.18.167.36");

    expect(
      within(row).getByTestId("traffic-top-sources-row-label"),
    ).toHaveTextContent("10.18.167.36");
    expect(
      within(row).getByTestId("traffic-top-sources-row-sublabel"),
    ).toHaveTextContent("Mumbai office");
  });

  test("an address nothing names is itself, with nothing under it", async () => {
    await renderView();

    const row: HTMLElement = rowWith("traffic-top-sources", "198.51.100.7");

    expect(
      within(row).getByTestId("traffic-top-sources-row-label"),
    ).toHaveTextContent("198.51.100.7");
    expect(
      within(row).queryByTestId("traffic-top-sources-row-sublabel"),
    ).not.toBeInTheDocument();
    expect(row).toHaveAccessibleName("Show only the traffic from 198.51.100.7");
  });

  test("a name written in Persian reads right to left beside its left-to-right address", async () => {
    await renderView();

    const row: HTMLElement = rowWith("traffic-top-sources", PERSIAN_NAME);
    const name: HTMLElement = within(
      within(row).getByTestId("traffic-top-sources-row-label"),
    ).getByText(PERSIAN_NAME);

    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "rtl");
    expect(within(row).getByTestId("traffic-address-text")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a long name is cut to its line, and is whole under the pointer", async () => {
    await renderView();

    const label: HTMLElement = within(
      rowWith("traffic-top-sources", LONG_NAME),
    ).getByTestId("traffic-top-sources-row-label");

    expect(label).toHaveClass("truncate");
    expect(label).toHaveAttribute("title", `${LONG_NAME} (10.0.0.78)`);
  });

  /*
   * The name is the box that is cut, in its own direction: on a Persian
   * page an English DNS name loses its last letters, never its first, and
   * still starts where the page's lines start (an inline box). Cut by the
   * row instead, it lost its start ("…ams23prdstr05a.store.core.windows").
   */
  test("a long name is cut from its own end, in its own direction, whatever the page's", async () => {
    await renderView();

    const label: HTMLElement = within(
      rowWith("traffic-top-sources", LONG_NAME),
    ).getByTestId("traffic-top-sources-row-label");
    const name: HTMLElement = within(label).getByText(LONG_NAME);

    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("inline-block", "max-w-full", "truncate");

    // An address with no name is cut the same way: left to right.
    const bare: HTMLElement = within(
      within(rowWith("traffic-top-sources", "198.51.100.7")).getByTestId(
        "traffic-top-sources-row-label",
      ),
    ).getByTestId("traffic-address-text");

    expect(bare).toHaveAttribute("dir", "ltr");
    expect(bare).toHaveClass("inline-block", "max-w-full", "truncate");
  });

  test("a name someone gave, and a cloud resource's, on the destinations", async () => {
    await renderView();

    expect(
      within(rowWith("traffic-top-destinations", "Payroll SaaS")).getByTestId(
        "traffic-top-destinations-row-sublabel",
      ),
    ).toHaveTextContent("158.115.141.143");
    expect(
      rowWith("traffic-top-destinations", "orders-db-primary"),
    ).toHaveAccessibleName(
      "Show only the traffic to orders-db-primary (10.114.167.16)",
    );
  });

  test("a click on a named row narrows the page to its address", async () => {
    await renderView();

    fireEvent.click(rowWith("traffic-top-sources", "mumbai-fs01"));
    await flush();

    expect(lastSummaryRequest().filters).toEqual({ sourceIp: "10.18.167.35" });
  });

  test("a page from a server that sends no names shows every address as itself", async () => {
    summaryAnswer = () => {
      const answer: JSONObject = summary();
      delete answer["addressNames"];
      return answer;
    };

    await renderView();

    expect(
      within(rowsOf("traffic-top-sources")[0]!).getByTestId(
        "traffic-top-sources-row-label",
      ),
    ).toHaveTextContent("10.18.167.35");
    expect(screen.queryByText("mumbai-fs01")).not.toBeInTheDocument();
  });
});

describe("the conversations, in both views", () => {
  async function listRows(): Promise<Array<HTMLElement>> {
    await renderView();
    fireEvent.click(screen.getByTestId("traffic-conversations-list"));

    return screen.getAllByTestId("traffic-conversation-row");
  }

  // How often a text is in an element's text.
  function timesIn(element: HTMLElement, text: string): number {
    return (element.textContent || "").split(text).length - 1;
  }

  test("the list: each end once - its name, its address beside it - then the bytes", async () => {
    const named: HTMLElement = (await listRows())[0]!;
    const from: HTMLElement = within(named).getByTestId(
      "traffic-conversation-from",
    );
    const to: HTMLElement = within(named).getByTestId(
      "traffic-conversation-to",
    );

    expect(from).toHaveTextContent("mumbai-fs0110.18.167.35");
    expect(to).toHaveTextContent("Payroll SaaS158.115.141.143");
    expect(
      within(named).getByTestId("traffic-conversation-bytes"),
    ).toHaveTextContent("200 MB");
    // Each address is said once: no second line repeats them.
    expect(timesIn(named, "10.18.167.35")).toBe(1);
    expect(timesIn(named, "158.115.141.143")).toBe(1);
    // The address after a name is small and grey, left to right, in the mono face.
    const address: HTMLElement = within(from).getByTestId(
      "traffic-address-text",
    );
    expect(address).toHaveAttribute("dir", "ltr");
    expect(address).toHaveClass("font-mono", "text-xs", "text-gray-500");
    expect(
      within(named).getByTestId("traffic-conversation-row-label"),
    ).toHaveAttribute(
      "title",
      "mumbai-fs01 (10.18.167.35) → Payroll SaaS (158.115.141.143)",
    );
    expect(named).toHaveAccessibleName(
      "Show only the traffic from mumbai-fs01 (10.18.167.35) to Payroll SaaS (158.115.141.143)",
    );
  });

  test("the list: a pair nothing names is its two addresses, each once", async () => {
    const unnamed: HTMLElement = (await listRows())[1]!;

    expect(
      within(unnamed).getByTestId("traffic-conversation-from"),
    ).toHaveTextContent(ONLY_198_51_100_7);
    expect(
      within(unnamed).getByTestId("traffic-conversation-to"),
    ).toHaveTextContent(ONLY_203_0_113_9);
    expect(timesIn(unnamed, "198.51.100.7")).toBe(1);
    expect(timesIn(unnamed, "203.0.113.9")).toBe(1);
  });

  test("the arrow points from the sender to the receiver, and turns round on a page that reads right to left", async () => {
    const row: HTMLElement = (await listRows())[0]!;
    const arrow: Element | null = within(row)
      .getByTestId("traffic-conversation-to")
      .querySelector("svg");

    expect(arrow).not.toBeNull();
    expect(arrow).toHaveClass(ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME);
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    // Nothing forces the row to read left to right: it follows the page, as the top lists do.
    expect(row.querySelector('[dir="ltr"]:not(bdi)')).toBeNull();
  });

  /*
   * One line in three columns when the LIST is wide enough, two lines when
   * it is not: beside the side menu a laptop's list is as narrow as a
   * phone's, so the switch reads the list's width (a container query), not
   * the window's (sm:).
   */
  test("the list's rows lay out by the list's own width, not the window's", async () => {
    const row: HTMLElement = (await listRows())[0]!;
    const list: HTMLElement = row.closest("ol") as HTMLElement;
    const line: HTMLElement = within(row).getByTestId(
      "traffic-conversation-row-label",
    ).firstElementChild as HTMLElement;

    expect(list).toHaveClass("[container-type:inline-size]");
    expect(line).toHaveClass(
      "grid",
      "grid-cols-[minmax(0,1fr)_auto]",
      "[@container(min-width:40rem)]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem]",
    );
    expect(line.className).not.toContain("sm:");
    // Narrow: the receiver's line runs under the sender and the bytes.
    expect(within(row).getByTestId("traffic-conversation-to")).toHaveClass(
      "col-span-2",
      "[@container(min-width:40rem)]:col-span-1",
    );
  });

  test("in the list a long name gives way and its address stays whole", async () => {
    summaryAnswer = () => {
      return summary({
        topConversations: [
          {
            sourceIp: "10.0.0.78",
            destinationIp: "10.0.0.77",
            octets: 30_000_000,
            packets: 1,
          },
        ],
      });
    };
    const row: HTMLElement = (await listRows())[0]!;
    const from: HTMLElement = within(row).getByTestId(
      "traffic-conversation-from",
    );

    expect(within(from).getByText(LONG_NAME)).toHaveClass(
      "min-w-0",
      "truncate",
    );
    expect(within(from).getByTestId("traffic-address-text")).toHaveClass(
      "flex-shrink-0",
    );
    // A name written in Persian reads right to left beside its address.
    const to: HTMLElement = within(row).getByTestId("traffic-conversation-to");
    expect(within(to).getByText(PERSIAN_NAME)).toHaveAttribute("dir", "rtl");
  });

  test("the diagram: a named end by its name, its address and bytes under it; an unnamed one by its address", async () => {
    await renderView();

    const diagram: HTMLElement = screen.getByTestId(
      "traffic-conversation-diagram",
    );
    const labels: Array<string> = within(diagram)
      .getAllByTestId("traffic-conversation-label")
      .map((label: HTMLElement): string => {
        return label.textContent || "";
      });

    expect(labels).toContain("mumbai-fs01");
    expect(labels).toContain("Payroll SaaS");
    expect(
      labels.some((label: string): boolean => {
        return label.startsWith("198.51.100.7");
      }),
    ).toBe(true);

    const addressLines: Array<string> = within(diagram)
      .getAllByTestId("traffic-conversation-label-address")
      .map((line: HTMLElement): string => {
        return line.textContent || "";
      });

    expect(addressLines).toContain("10.18.167.35200 MB");
    expect(
      within(diagram).getAllByTestId("traffic-conversation-label-address")[0],
    ).toHaveAttribute("direction", "ltr");
  });

  test("the diagram reads left to right on every page: senders left, receivers right", async () => {
    await renderView();

    expect(screen.getByTestId("traffic-conversation-diagram")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("the diagram's bands and bars say who, whole, to the pointer and a screen reader", async () => {
    await renderView();

    const diagram: HTMLElement = screen.getByTestId(
      "traffic-conversation-diagram",
    );

    expect(diagram.textContent).toContain(
      "mumbai-fs01 (10.18.167.35) to Payroll SaaS (158.115.141.143): 200 MB",
    );
    expect(diagram.textContent).toContain(
      "mumbai-fs01 (10.18.167.35) sent 200 MB",
    );
  });
});

describe("the filter chips name the address", () => {
  test("a chip for a named address: its name, the address beside it, all of it under the pointer", async () => {
    window.history.replaceState(null, "", "/?src=10.18.167.35");

    await renderView();

    const chip: HTMLElement = screen.getByTestId("traffic-filter-source");

    expect(chip).toHaveTextContent("From mumbai-fs0110.18.167.35");
    expect(chip).toHaveAttribute("title", "From mumbai-fs01 (10.18.167.35)");
    expect(
      within(chip).getByRole("button", {
        name: "Remove the filter From mumbai-fs01 (10.18.167.35)",
      }),
    ).toBeInTheDocument();
  });

  /*
   * The sentence's words and the address keep their room, and a long name
   * gives way: on a phone the chip read "To or from …" - neither the name
   * nor the address - when the whole sentence was cut as one line.
   */
  test("a chip with a long name: the name gives way, the words and the address stay whole", async () => {
    window.history.replaceState(null, "", "/?host=10.0.0.78");

    await renderView();

    const chip: HTMLElement = screen.getByTestId("traffic-filter-host");
    const words: HTMLElement = within(chip).getByText("To or from");

    expect(words).toHaveClass("flex-shrink-0", "whitespace-pre");
    // The space the language puts between the words and the name is kept.
    expect(words.textContent).toBe("To or from ");
    expect(within(chip).getByText(LONG_NAME)).toHaveClass(
      "min-w-0",
      "truncate",
    );
    expect(within(chip).getByTestId("traffic-address-text")).toHaveClass(
      "flex-shrink-0",
    );
    expect(within(chip).getByTestId("traffic-filter-text")).toHaveClass(
      "flex",
      "min-w-0",
    );
    expect(chip).toHaveAttribute(
      "title",
      `To or from ${LONG_NAME} (10.0.0.78)`,
    );
  });

  test("the chips give way to the find box beside them, which keeps its room", async () => {
    window.history.replaceState(null, "", "/?host=10.0.0.78");

    await renderView();

    expect(screen.getByTestId("traffic-filters")).toHaveClass(
      "min-w-0",
      "lg:flex-1",
    );
  });

  test("a chip for an address nothing names is as it was", async () => {
    window.history.replaceState(null, "", "/?dst=203.0.113.9");

    await renderView();

    expect(screen.getByTestId("traffic-filter-destination")).toHaveTextContent(
      "To 203.0.113.9",
    );
  });
});

describe("narrowed to one address, the page says who it is and what to do next", () => {
  async function narrowTo(query: string): Promise<HTMLElement> {
    window.history.replaceState(null, "", `/?${query}`);
    await renderView();
    return screen.getByTestId("traffic-address-card");
  }

  test("a host: its name, Host, the address with a copy button, its subnet, and Open host", async () => {
    const card: HTMLElement = await narrowTo("host=10.18.167.35");

    expect(
      within(card).getByTestId("traffic-address-card-name"),
    ).toHaveTextContent("mumbai-fs01");
    expect(
      within(card).getByTestId("traffic-address-card-source"),
    ).toHaveTextContent("Host");
    expect(
      within(card).getByTestId("traffic-address-card-subnet"),
    ).toHaveTextContent("In Mumbai office");
    expect(
      within(card).getByTestId("traffic-address-card-subnet"),
    ).toHaveAttribute("title", "10.18.167.0/24");
    expect(
      within(card).getByRole("button", { name: "Copy the address" }),
    ).toBeInTheDocument();

    const open: HTMLElement = within(card).getByTestId(
      "traffic-address-card-open",
    );
    expect(open).toHaveTextContent("Open host");
    expect(open.getAttribute("href")).toContain(`/host/${HOST_ID}`);
    // A record's name is changed on the record, never here.
    expect(
      within(card).queryByTestId("traffic-address-card-name-button"),
    ).not.toBeInTheDocument();
  });

  test("the card's lines start under the name: what the name is, in a tile beside them both", async () => {
    const card: HTMLElement = await narrowTo("host=10.18.167.35");
    const tile: HTMLElement = within(card).getByTestId(
      "traffic-address-card-icon",
    );

    expect(tile.querySelector("svg")).not.toBeNull();
    // The name and the address line sit beside the tile, not under it.
    expect(tile.nextElementSibling).toContainElement(
      within(card).getByTestId("traffic-address-card-name"),
    );
    expect(tile.nextElementSibling).toContainElement(
      within(card).getByTestId("traffic-address-card-details"),
    );
  });

  test("no line of the card starts with a separator: where the name is from begins a group of its own", async () => {
    const card: HTMLElement = await narrowTo("host=10.18.167.35");
    const source: HTMLElement = within(card).getByTestId(
      "traffic-address-card-source",
    );
    const facts: HTMLElement = source.parentElement as HTMLElement;

    expect(facts.firstElementChild).toBe(source);
    // On a phone the facts take a line of their own, under the address.
    expect(facts).toHaveClass("max-sm:basis-full");
    // Between the facts, one separator, hidden from screen readers.
    expect(facts).toHaveTextContent("Host·In Mumbai office");
    expect(facts.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  test("a long name wraps on the card, after its own dots first, two lines at most", async () => {
    const card: HTMLElement = await narrowTo("host=10.0.0.78");
    const name: HTMLElement = within(card).getByTestId(
      "traffic-address-card-name",
    );

    expect(name).toHaveClass("line-clamp-2", "[overflow-wrap:anywhere]");
    expect(name).not.toHaveClass("truncate");
    expect(name.querySelectorAll("wbr").length).toBeGreaterThan(0);
    expect(name).toHaveTextContent(LONG_NAME);
    expect(name).toHaveAttribute("title", `${LONG_NAME} (10.0.0.78)`);
  });

  test("a network device and a cloud resource open their own records", async () => {
    let card: HTMLElement = await narrowTo("host=10.200.221.245");

    expect(
      within(card).getByTestId("traffic-address-card-open"),
    ).toHaveTextContent("Open device");
    expect(
      within(card)
        .getByTestId("traffic-address-card-open")
        .getAttribute("href"),
    ).toContain(DEVICE_ID);

    cleanup();
    card = await narrowTo("dst=10.114.167.16");

    expect(
      within(card).getByTestId("traffic-address-card-open"),
    ).toHaveTextContent("Open cloud resource");
    expect(
      within(card)
        .getByTestId("traffic-address-card-open")
        .getAttribute("href"),
    ).toContain(CLOUD_ID);
  });

  test("a Kubernetes pod says so, and has no page to open", async () => {
    const card: HTMLElement = await narrowTo("src=10.242.167.220");

    expect(
      within(card).getByTestId("traffic-address-card-source"),
    ).toHaveTextContent("Kubernetes pod");
    expect(
      within(card).queryByTestId("traffic-address-card-open"),
    ).not.toBeInTheDocument();
  });

  test("a DNS name can be given a friendlier one: Name this address, the address filled in", async () => {
    const card: HTMLElement = await narrowTo("host=10.18.167.31");

    expect(
      within(card).getByTestId("traffic-address-card-source"),
    ).toHaveTextContent("DNS name");

    fireEvent.click(
      within(card).getByTestId("traffic-address-card-name-button"),
    );
    await flush();

    expect(screen.getByTestId("address-name-dialog")).toHaveTextContent(
      "Name this address",
    );
    expect(capturedModal!.initialValues).toEqual({ address: "10.18.167.31" });
    expect(capturedModal!.modelIdToEdit).toBeUndefined();
    expect(capturedModal!.formProps.formType).toBe(FormType.Create);
    // Two fields need no paragraph over them: the Name field says where it shows.
    expect(capturedModal!.description).toBeUndefined();
  });

  test("an address with no name: the address in bold, No name yet, Name this address", async () => {
    const card: HTMLElement = await narrowTo("host=203.0.113.9");

    expect(
      within(card).getByTestId("traffic-address-card-name"),
    ).toHaveTextContent("203.0.113.9");
    expect(
      within(card).getByTestId("traffic-address-card-source"),
    ).toHaveTextContent("No name yet");
    expect(
      within(card).getByTestId("traffic-address-card-name-button"),
    ).toHaveTextContent("Name this address");
  });

  test("a name someone gave is changed in its one place: Edit in Settings opens Address Names, no second form here", async () => {
    const card: HTMLElement = await narrowTo("dst=158.115.141.143");

    expect(
      within(card).getByTestId("traffic-address-card-source"),
    ).toHaveTextContent("Address name");

    const edit: HTMLElement = within(card).getByTestId(
      "traffic-address-card-edit-in-settings",
    );
    expect(edit).toHaveTextContent("Edit in Settings");
    expect(edit.getAttribute("href")).toContain(
      "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/settings/address-names",
    );
    // No Name this address, no dialog: the name is not edited from two forms.
    expect(
      within(card).queryByTestId("traffic-address-card-name-button"),
    ).not.toBeInTheDocument();
    expect(capturedModal).toBeNull();
  });

  test("a saved name: the dialog closes and the page reads its names again", async () => {
    const card: HTMLElement = await narrowTo("host=203.0.113.9");
    const reads: number = summaryPostMock.mock.calls.length;

    fireEvent.click(
      within(card).getByTestId("traffic-address-card-name-button"),
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    await flush();

    expect(screen.queryByTestId("address-name-dialog")).not.toBeInTheDocument();
    expect(summaryPostMock.mock.calls.length).toBe(reads + 1);
  });

  test("closing the dialog changes nothing", async () => {
    const card: HTMLElement = await narrowTo("host=203.0.113.9");
    const reads: number = summaryPostMock.mock.calls.length;

    fireEvent.click(
      within(card).getByTestId("traffic-address-card-name-button"),
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    await flush();

    expect(screen.queryByTestId("address-name-dialog")).not.toBeInTheDocument();
    expect(summaryPostMock.mock.calls.length).toBe(reads);
  });

  test("who may not add Address Names is offered no Name this address; who may not change them, no Edit in Settings", async () => {
    mayCreateNames = false;
    let card: HTMLElement = await narrowTo("host=203.0.113.9");

    expect(
      within(card).queryByTestId("traffic-address-card-name-button"),
    ).not.toBeInTheDocument();

    cleanup();
    mayCreateNames = true;
    mayUpdateNames = false;
    card = await narrowTo("dst=158.115.141.143");

    expect(
      within(card).queryByTestId("traffic-address-card-edit-in-settings"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("traffic-address-card-name-button"),
    ).not.toBeInTheDocument();
  });

  test("a conversation is two addresses: no card", async () => {
    window.history.replaceState(
      null,
      "",
      "/?src=10.18.167.35&dst=158.115.141.143",
    );
    await renderView();

    expect(
      screen.queryByTestId("traffic-address-card"),
    ).not.toBeInTheDocument();
  });

  test("a page not narrowed to an address has no card", async () => {
    await renderView();

    expect(
      screen.queryByTestId("traffic-address-card"),
    ).not.toBeInTheDocument();
  });
});

describe("find takes a name", () => {
  function typeAndFind(text: string): void {
    fireEvent.change(screen.getByLabelText("Find a name or an IP address"), {
      target: { value: text },
    });
    fireEvent.submit(screen.getByTestId("traffic-find-address"));
  }

  function findRequests(): Array<PostedRequest> {
    return findPostMock.mock.calls.map(
      (call: Array<unknown>): PostedRequest => {
        return (call[0] as { data: PostedRequest }).data;
      },
    );
  }

  test("a name is searched in the page's window and scope; one address found narrows the page", async () => {
    findPostMock.mockResolvedValue({
      data: {
        matches: [
          {
            address: "10.18.167.35",
            name: "mumbai-fs01",
            source: "host",
            octets: 300_000_000,
          },
        ],
      },
    });
    await renderView();

    typeAndFind("  mumbai ");
    await flush();

    expect(findRequests()).toHaveLength(1);
    expect(findRequests()[0]).toMatchObject({
      networkDeviceId: DEVICE_ID,
      query: "mumbai",
    });
    expect(findRequests()[0]!.startTime).toBeTruthy();
    expect(findRequests()[0]!.endTime).toBeTruthy();
    expect(lastSummaryRequest().filters).toEqual({ hostIp: "10.18.167.35" });
    expect(screen.getByLabelText("Find a name or an IP address")).toHaveValue(
      "",
    );
  });

  test("several found: each is listed by its name, address and bytes, and a pick narrows the page", async () => {
    findPostMock.mockResolvedValue({
      data: {
        matches: [
          {
            address: "10.18.167.31",
            name: "mum-print-02.corp.example",
            source: "dns",
            octets: 8_110_000,
          },
          {
            address: "10.114.167.38",
            name: "lds-ws-0457.corp.example",
            source: "dns",
            octets: 3_280_000,
          },
        ],
      },
    });
    await renderView();

    typeAndFind("corp");
    await flush();

    const list: HTMLElement = screen.getByTestId(
      "traffic-find-address-matches",
    );
    const matches: Array<HTMLElement> = within(list).getAllByTestId(
      "traffic-find-address-match",
    );

    expect(list).toHaveTextContent("Pick the address:");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toHaveTextContent("mum-print-02.corp.example");
    expect(matches[0]).toHaveTextContent("10.18.167.31");
    expect(matches[0]).toHaveTextContent("8.11 MB");
    expect(matches[0]).toHaveAccessibleName(
      "Show only the traffic to or from mum-print-02.corp.example (10.18.167.31)",
    );

    fireEvent.click(matches[1]!);
    await flush();

    expect(lastSummaryRequest().filters).toEqual({ hostIp: "10.114.167.38" });
    expect(
      screen.queryByTestId("traffic-find-address-matches"),
    ).not.toBeInTheDocument();
  });

  test("the list closes on Escape, on a click elsewhere, and when the text changes", async () => {
    findPostMock.mockResolvedValue({
      data: {
        matches: [
          { address: "10.0.0.1", name: "a-corp", source: "dns", octets: 2 },
          { address: "10.0.0.2", name: "b-corp", source: "dns", octets: 1 },
        ],
      },
    });
    await renderView();

    typeAndFind("corp");
    await flush();
    expect(screen.getByTestId("traffic-find-address-matches")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await flush();
    expect(
      screen.queryByTestId("traffic-find-address-matches"),
    ).not.toBeInTheDocument();

    typeAndFind("corp");
    await flush();
    fireEvent.mouseDown(document.body);
    await flush();
    expect(
      screen.queryByTestId("traffic-find-address-matches"),
    ).not.toBeInTheDocument();

    typeAndFind("corp");
    await flush();
    fireEvent.change(screen.getByLabelText("Find a name or an IP address"), {
      target: { value: "corp2" },
    });
    expect(
      screen.queryByTestId("traffic-find-address-matches"),
    ).not.toBeInTheDocument();
    // Nothing was picked: the page is as it was.
    expect(lastSummaryRequest().filters).toEqual({});
  });

  test("nothing found says so, with what was typed, and the page stays as it was", async () => {
    findPostMock.mockResolvedValue({ data: { matches: [] } });
    await renderView();

    typeAndFind("printer-lobby");
    await flush();

    expect(screen.getByTestId("traffic-find-address-none")).toHaveTextContent(
      "No address with traffic in this time range matches “printer-lobby”.",
    );
    expect(lastSummaryRequest().filters).toEqual({});
  });

  test("nothing found is an answer, said in grey - not a failure, in red", async () => {
    findPostMock.mockResolvedValue({ data: { matches: [] } });
    await renderView();

    typeAndFind("printer-lobby");
    await flush();

    const none: HTMLElement = screen.getByTestId("traffic-find-address-none");
    expect(none).toHaveAttribute("role", "status");
    expect(none).toHaveClass("text-gray-500");
    expect(none).not.toHaveClass("text-red-600");
    expect(
      screen.queryByTestId("traffic-find-address-error"),
    ).not.toBeInTheDocument();

    // Typing again takes it away, as it does an error.
    fireEvent.change(screen.getByLabelText("Find a name or an IP address"), {
      target: { value: "printer" },
    });
    expect(
      screen.queryByTestId("traffic-find-address-none"),
    ).not.toBeInTheDocument();
  });

  test("a search that fails says why", async () => {
    findPostMock.mockRejectedValue(
      new Error("Searching this much traffic took longer than 45 seconds."),
    );
    await renderView();

    typeAndFind("printer");
    await flush();

    const error: HTMLElement = screen.getByTestId("traffic-find-address-error");
    expect(error).toHaveTextContent(
      "Searching this much traffic took longer than 45 seconds.",
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveClass("text-red-600");
    expect(
      screen.queryByTestId("traffic-find-address-none"),
    ).not.toBeInTheDocument();
  });

  test("only the newest search lands: an older answer that comes late is dropped", async () => {
    let answerFirst: (value: unknown) => void = () => {
      return undefined;
    };
    findPostMock
      .mockImplementationOnce(() => {
        return new Promise((resolve: (value: unknown) => void) => {
          answerFirst = resolve;
        });
      })
      .mockResolvedValueOnce({
        data: {
          matches: [
            { address: "10.0.0.2", name: "second", source: "dns", octets: 1 },
          ],
        },
      });
    await renderView();

    typeAndFind("first");
    await flush();
    typeAndFind("second");
    await flush();

    expect(lastSummaryRequest().filters).toEqual({ hostIp: "10.0.0.2" });

    answerFirst({
      data: {
        matches: [
          { address: "10.0.0.1", name: "first", source: "dns", octets: 1 },
        ],
      },
    });
    await flush();

    expect(lastSummaryRequest().filters).toEqual({ hostIp: "10.0.0.2" });
  });

  test("an address typed is never searched for by name", async () => {
    await renderView();

    typeAndFind("10.18.167.35");
    await flush();

    expect(findPostMock).not.toHaveBeenCalled();
    expect(lastSummaryRequest().filters).toEqual({ hostIp: "10.18.167.35" });
  });
});

describe("the network's page: devices and senders that are no device yet", () => {
  const UNKNOWN: string = "198.51.100.7";

  beforeEach(() => {
    summaryAnswer = () => {
      return summary({
        addressNames: {
          ...NAMES,
          [UNKNOWN]: { name: "branch-fw.corp.example", source: "dns" },
        },
        topDevices: [
          {
            networkDeviceId: DEVICE_ID,
            name: "core-sw-01",
            exporterIp: "10.200.221.245",
            octets: 500_000_000,
            packets: 1,
          },
          { exporterIp: UNKNOWN, octets: 100_000_000, packets: 1 },
          { exporterIp: "203.0.113.50", octets: 10_000_000, packets: 1 },
        ],
        sources: [
          {
            exporterIp: UNKNOWN,
            flowFormat: "sFlow",
            samplingRate: 1,
            lastFlowAt: "2026-10-28 11:58:00",
            flows: 10,
            octets: 100_000_000,
          },
          {
            exporterIp: "203.0.113.50",
            flowFormat: "IPFIX",
            samplingRate: 1,
            lastFlowAt: "2026-10-28 11:58:00",
            flows: 1,
            octets: 10_000_000,
          },
        ],
      });
    };
  });

  test("a sender that is no device yet but has a name: the name, its address, Not a device yet", async () => {
    await renderView({ kind: "network" });

    const row: HTMLElement = rowWith("traffic-top-devices", "branch-fw");

    expect(
      within(row).getByTestId("traffic-top-devices-row-label"),
    ).toHaveTextContent("branch-fw.corp.example");
    expect(
      within(row).getByTestId("traffic-top-devices-row-sublabel"),
    ).toHaveTextContent(`${UNKNOWN} · Not a device yet`);

    const nameless: HTMLElement = rowWith(
      "traffic-top-devices",
      "203.0.113.50",
    );
    expect(
      within(nameless).getByTestId("traffic-top-devices-row-sublabel"),
    ).toHaveTextContent("Not a device yet");
  });

  test("Sending flows names a sender by its name, the address beside it", async () => {
    await renderView({ kind: "network" });

    const senders: Array<HTMLElement> = screen.getAllByTestId("traffic-source");
    const named: HTMLElement = senders.find((sender: HTMLElement) => {
      return (sender.textContent || "").includes("branch-fw.corp.example");
    })!;

    expect(within(named).getByTestId("traffic-source-name")).toHaveTextContent(
      "branch-fw.corp.example",
    );
    expect(named).toHaveTextContent(UNKNOWN);
    expect(
      within(named).getByTestId("traffic-source-unknown"),
    ).toHaveTextContent("Not a device yet");
  });

  test("the names are those of the page's own answer, read once with it", async () => {
    await renderView({ kind: "network" });

    expect(postedSummaries()).toHaveLength(1);
    expect(postedSummaries()[0]!.networkDeviceId).toBeUndefined();
  });
});
