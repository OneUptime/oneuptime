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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Moving from entity to entity inside one open drawer, with the REAL
 * SideOver. Both maps keep a single drawer mounted while the user opens a
 * connection row or clicks another node: a remount per entity replayed the
 * side-over's slide-in and, because the row that had focus went away with
 * the old drawer, dropped keyboard focus to <body> — the next Tab went to
 * the top of the page. Pinned here:
 *
 *   - the side-over is the same element before and after the hop, and it
 *     does not slide in again;
 *   - focus that was in the drawer (or lost) lands on the drawer's focus
 *     target, which names the new entity for screen readers — also when the
 *     new entity turns out to be gone from inventory;
 *   - focus the user put outside the drawer stays there, and opening the
 *     drawer for the first entity takes no focus.
 */

const postMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string) => {
          return value;
        },
        translateValue: (value: React.ReactNode) => {
          return value;
        },
      };
    },
  };
});

import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import { EntityDetailTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyConnectionRowJSON,
  TopologyConnectionSectionJSON,
  TopologyEntityDetailJSON,
  TopologyEntityResponseJSON,
} from "../../../Types/Topology/TopologyApi";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import ProjectUtil from "../../../UI/Utils/Project";

const RANGE_START: Date = new Date("2026-09-26T10:00:00.000Z");

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

/* Requests for these keys wait until the test answers them. */
const held: Map<string, (value: JSONObject) => void> = new Map<
  string,
  (value: JSONObject) => void
>();

function asJSON(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function sectionOf(
  rows: Array<TopologyConnectionRowJSON>,
): TopologyConnectionSectionJSON {
  return { total: rows.length, unknownTotal: 0, rows: rows, nextOffset: null };
}

function call(
  direction: "out" | "in",
  otherKey: string,
  otherName: string,
  otherType: string,
): TopologyConnectionRowJSON {
  return {
    relationshipType: "depends-on",
    direction: direction,
    otherKey: otherKey,
    otherKnown: true,
    otherName: otherName,
    otherType: otherType,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
  };
}

function entityRow(
  key: string,
  type: string,
  name: string,
): TopologyEntityDetailJSON {
  return {
    id: new ObjectID(
      `1a1a0000-0000-4000-8000-${String(key.length).padStart(12, "0")}`,
    ).toString(),
    key: key,
    type: type,
    name: name,
    source: "telemetry",
    lastSeenAt: Date.parse("2026-09-26T10:14:00.000Z"),
    firstSeenAt: null,
    resourceType: null,
    resourceId: null,
    identifyingAttributes: {},
    descriptiveAttributes: {},
  };
}

function entityResponse(
  entity: TopologyEntityDetailJSON | null,
  calls: Array<TopologyConnectionRowJSON>,
  calledBy: Array<TopologyConnectionRowJSON>,
): JSONObject {
  const response: TopologyEntityResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-09-26T10:15:00.000Z",
    entity: entity,
    sections: {
      calls: sectionOf(calls),
      calledBy: sectionOf(calledBy),
      runsOn: sectionOf([]),
      related: sectionOf([]),
    },
    isScanLimited: false,
  };
  return asJSON(response);
}

const RESPONSES: Record<string, JSONObject> = {
  svc: entityResponse(
    entityRow("svc", EntityType.Service, "Checkout API"),
    [
      call("out", "db", "Orders database", EntityType.Database),
      /* Known when this drawer loaded; pruned before it is opened. */
      call("out", "gone", "Old cache", EntityType.Database),
    ],
    [call("in", "web", "Web frontend", EntityType.Service)],
  ),
  db: entityResponse(
    entityRow("db", EntityType.Database, "Orders database"),
    [],
    [call("in", "svc", "Checkout API", EntityType.Service)],
  ),
  web: entityResponse(
    entityRow("web", EntityType.Service, "Web frontend"),
    [call("out", "svc", "Checkout API", EntityType.Service)],
    [],
  ),
  gone: entityResponse(null, [], []),
};

function serve(): void {
  postMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: PostRequest = args[0] as PostRequest;
    const key: string = request.data["entityKey"] as string;
    const answer: JSONObject = held.has(key)
      ? await new Promise<JSONObject>(
          (resolve: (value: JSONObject) => void) => {
            held.set(key, resolve);
          },
        )
      : RESPONSES[key]!;
    return new HTTPResponse<JSONObject>(200, answer, {});
  });
}

const CHECKOUT: EntityDetailTarget = {
  entityKey: "svc",
  entityType: EntityType.Service,
  displayName: "Checkout API",
};

/*
 * A map in miniature, wired the way ServiceMapGraph and the Infrastructure
 * explorer wire the drawer: one selection, rows select in place, and no
 * `key` on the drawer. The "map" buttons stand in for nodes outside it.
 */
const Host: React.FunctionComponent<{
  initial: EntityDetailTarget | null;
}> = (props: { initial: EntityDetailTarget | null }): React.ReactElement => {
  const [target, setTarget] = React.useState<EntityDetailTarget | null>(
    props.initial,
  );
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setTarget(CHECKOUT);
        }}
      >
        Map node Checkout API
      </button>
      <button
        type="button"
        onClick={() => {
          setTarget({ entityKey: "web", displayName: "Web frontend" });
        }}
      >
        Map node Web frontend
      </button>
      {target && (
        <EntityDetailPanel
          entity={target}
          rangeStart={RANGE_START}
          metricsWindowSeconds={60}
          onSelectEntity={setTarget}
          onClose={() => {
            setTarget(null);
          }}
        />
      )}
    </div>
  );
};

async function flushEntranceFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function sideOverPanel(): HTMLElement {
  return screen.getByTestId("side-over-layer").firstElementChild as HTMLElement;
}

function focusTarget(): HTMLElement {
  return screen.getByTestId("entity-detail-focus-target");
}

/* Focus a button the way a keyboard user reaches it, then activate it. */
function activate(button: HTMLElement): void {
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
}

async function openCheckout(): Promise<HTMLElement> {
  render(<Host initial={CHECKOUT} />);
  await screen.findByRole("button", {
    name: "View details for Orders database",
  });
  await flushEntranceFrame();
  const sideOver: HTMLElement = screen.getByTestId("side-over");
  expect(sideOverPanel()).not.toHaveClass("translate-x-full");
  return sideOver;
}

beforeEach(() => {
  held.clear();
  postMock.mockReset();
  serve();
  resetPageScrollLockForTesting();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("5b2f5b1c-0000-4000-8000-000000000001"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("opening a connection row in the open drawer", () => {
  test("keeps the same side-over, without replaying its slide-in", async () => {
    const sideOver: HTMLElement = await openCheckout();

    activate(
      screen.getByRole("button", { name: "View details for Orders database" }),
    );

    expect(screen.getByTestId("side-over")).toBe(sideOver);
    expect(sideOverPanel()).not.toHaveClass("translate-x-full");
    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      "Orders database",
    );
    await screen.findByRole("button", {
      name: "View details for Checkout API",
    });
    expect(screen.getByTestId("side-over")).toBe(sideOver);
  });

  test("keeps keyboard focus in the drawer, on a target that names the new entity", async () => {
    const sideOver: HTMLElement = await openCheckout();

    activate(
      screen.getByRole("button", { name: "View details for Orders database" }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(focusTarget());
    });
    expect(sideOver).toContainElement(focusTarget());
    expect(focusTarget()).toHaveTextContent("Orders database, Database");
    /* The next Tab starts inside the drawer, not at the top of the page. */
    expect(focusTarget()).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).not.toBe(document.body);

    /* And it stays there once the new entity's connections arrive. */
    const back: HTMLElement = await screen.findByRole("button", {
      name: "View details for Checkout API",
    });
    expect(document.activeElement).toBe(focusTarget());

    /* Hop again, back where we came from. */
    activate(back);
    await waitFor(() => {
      expect(focusTarget()).toHaveTextContent("Checkout API, Service");
    });
    expect(document.activeElement).toBe(focusTarget());
  });

  test("an entity that turns out to be gone keeps focus on the same target", async () => {
    held.set("gone", () => {
      return undefined;
    });
    const sideOver: HTMLElement = await openCheckout();

    activate(
      screen.getByRole("button", { name: "View details for Old cache" }),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(focusTarget());
    });
    const target: HTMLElement = focusTarget();
    expect(target).toHaveTextContent("Old cache, Database");

    /* The server no longer has the row: the drawer says so, focus stays. */
    await act(async () => {
      held.get("gone")!(RESPONSES["gone"]!);
    });
    expect(
      await screen.findByText("This resource is no longer in Inventory."),
    ).toBeInTheDocument();
    expect(focusTarget()).toBe(target);
    expect(document.activeElement).toBe(target);
    expect(screen.getByTestId("side-over")).toBe(sideOver);
  });

  test("focus the user put outside the drawer stays there", async () => {
    const sideOver: HTMLElement = await openCheckout();

    const mapNode: HTMLElement = screen.getByRole("button", {
      name: "Map node Web frontend",
    });
    activate(mapNode);

    await screen.findByRole("button", {
      name: "View details for Checkout API",
    });
    expect(screen.getByTestId("side-over")).toBe(sideOver);
    expect(document.activeElement).toBe(mapNode);
  });

  test("opening the drawer takes no focus", async () => {
    render(<Host initial={null} />);
    const opener: HTMLElement = screen.getByRole("button", {
      name: "Map node Checkout API",
    });

    activate(opener);
    await screen.findByRole("button", {
      name: "View details for Orders database",
    });

    expect(document.activeElement).toBe(opener);
  });

  test("opening the drawer from a click that left nothing focused takes no focus either", async () => {
    expect(document.activeElement).toBe(document.body);

    render(<Host initial={CHECKOUT} />);
    await screen.findByRole("button", {
      name: "View details for Orders database",
    });

    expect(document.activeElement).toBe(document.body);
  });
});
