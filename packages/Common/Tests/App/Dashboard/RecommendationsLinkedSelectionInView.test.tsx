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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A LINK THAT TICKS RECOMMENDATIONS LANDS ON THEM - AND STAYS THERE WHILE
 * THE PAGE SETTLES.
 *
 * "Turn on warning alerts" on a cluster's Events page opens its
 * Recommendations with Warning Events ticked (?select=), and an ESXi host's
 * "Turn on N alerts" its vCenter's. The page opens at the scroll position
 * the link was clicked from, so the first ticked card is brought into the
 * middle of the window once the list is drawn. It was brought there once,
 * at the moment the list was drawn - before the list was laid out: the
 * styles of the classes a page draws for the first time (the grid's two
 * columns, the cards' padding) arrive a frame or more later, the cards
 * above grow, and Warning Events, the last card of the list, ended half a
 * window under the bottom edge (KubernetesEvents' browser suite, once its
 * fixture navigated as the Dashboard does, 2026-11-03). Now it is kept
 * there while the page settles (PageAnchor's bringPageAnchorIntoView): on
 * the next frame, and again each time the page changes size, until the
 * settle time is up or the person scrolls, clicks, touches or types.
 *
 * The page is rendered for real (a Kubernetes cluster's Recommendations),
 * with the browser's frames and its ResizeObserver stood in for, so a test
 * says when a frame is drawn and when the page changes size.
 */

const CLUSTER_ID: string = "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const WARNING_EVENTS: string = "Kubernetes:k8s-warning-events";
// A Workload card: drawn well before Events, the list's last heading.
const CRASH_LOOP: string = "Kubernetes:k8s-crashloopbackoff";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { PAGE_ANCHOR_RELEASING_EVENTS } from "../../../UI/Utils/PageAnchor";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import KubernetesRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Recommendations";

type PageComponent = (props: PageComponentProps) => React.ReactElement | null;

const RECOMMENDATIONS_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/recommendations`;

// ---- frames, drawn when a test says so -----------------------------------

let frames: Map<number, FrameRequestCallback> = new Map();
let nextFrame: number = 1;

function drawFrames(): void {
  act(() => {
    const drawn: Array<FrameRequestCallback> = Array.from(frames.values());
    frames = new Map();

    for (const callback of drawn) {
      callback(0);
    }
  });
}

// ---- a page that changes size when a test says so ------------------------

class FakeResizeObserver {
  public static instances: Array<FakeResizeObserver> = [];

  public observed: Array<Element> = [];
  public isDisconnected: boolean = false;
  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }

  public unobserve(): void {
    // Nothing is observed one by one here.
  }

  public disconnect(): void {
    this.isDisconnected = true;
  }

  public resize(): void {
    this.callback();
  }
}

// The observers watching the whole page: the ones that keep a place in view.
function pageObservers(): Array<FakeResizeObserver> {
  return FakeResizeObserver.instances.filter(
    (observer: FakeResizeObserver): boolean => {
      return observer.observed.includes(document.body);
    },
  );
}

// The page changed size: every observer of it hears so.
function pageResizes(): void {
  for (const observer of pageObservers()) {
    if (!observer.isDisconnected) {
      observer.resize();
    }
  }
}

type GlobalSlots = Record<string, unknown>;

const globalSlots: GlobalSlots = globalThis as unknown as GlobalSlots;
const windowSlots: GlobalSlots = window as unknown as GlobalSlots;
const elementSlots: GlobalSlots =
  HTMLElement.prototype as unknown as GlobalSlots;

let originals: Record<string, unknown> = {};

// Which card scrollIntoView was asked to bring into view, and how.
let scrolls: Array<{ card: string; options: unknown }> = [];

// Everything MonitorRecommendations needs to build a monitor step.
function projectList(modelType: unknown): { data: Array<unknown> } {
  if (modelType === MonitorStatus) {
    const online: MonitorStatus = new MonitorStatus();
    online._id = ObjectID.generate().toString();
    online.isOperationalState = true;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = ObjectID.generate().toString();
    offline.isOfflineState = true;
    return { data: [online, offline] };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "Critical";
    return { data: [severity] };
  }

  // No monitors yet, no dismissals, no policies / teams / labels.
  return { data: [] };
}

function cluster(): KubernetesCluster {
  const row: KubernetesCluster = new KubernetesCluster();
  row._id = CLUSTER_ID;
  row.name = "production";
  row.clusterIdentifier = "production";
  return row;
}

// Opens the cluster's Recommendations, as a link with `query` does.
async function openRecommendations(query: string): Promise<void> {
  goTo(`${RECOMMENDATIONS_PATH}${query}`);

  const Page: PageComponent =
    KubernetesRecommendations as unknown as PageComponent;
  const page: React.ReactElement = (
    <MemoryRouter>
      <Page
        pageRoute={new Route(RECOMMENDATIONS_PATH)}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>
  );

  const view: RenderResult = render(page);

  // The list is drawn: its last card is there.
  await screen.findByTestId(`recommendation-card-${WARNING_EVENTS}`);

  /*
   * And its effects have run: findBy can resolve before the effects of the
   * render it found (a busy runner), and a render flushes them first.
   */
  await act(async () => {
    view.rerender(page);
  });
}

beforeEach(() => {
  originals = {
    requestAnimationFrame: windowSlots["requestAnimationFrame"],
    cancelAnimationFrame: windowSlots["cancelAnimationFrame"],
    ResizeObserver: globalSlots["ResizeObserver"],
    scrollIntoView: elementSlots["scrollIntoView"],
  };

  frames = new Map();
  nextFrame = 1;
  scrolls = [];
  FakeResizeObserver.instances = [];

  windowSlots["requestAnimationFrame"] = (
    callback: FrameRequestCallback,
  ): number => {
    const id: number = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  windowSlots["cancelAnimationFrame"] = (id: number): void => {
    frames.delete(id);
  };
  globalSlots["ResizeObserver"] = FakeResizeObserver;
  elementSlots["scrollIntoView"] = function (
    this: HTMLElement,
    options: unknown,
  ): void {
    scrolls.push({ card: this.getAttribute("data-testid") || "", options });
  };

  getItemMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockResolvedValue(cluster());
  getListMock.mockImplementation((args: unknown) => {
    return Promise.resolve(
      projectList((args as { modelType: unknown }).modelType),
    );
  });
});

afterEach(() => {
  cleanup();

  windowSlots["requestAnimationFrame"] = originals["requestAnimationFrame"];
  windowSlots["cancelAnimationFrame"] = originals["cancelAnimationFrame"];

  for (const [slots, name] of [
    [globalSlots, "ResizeObserver"],
    [elementSlots, "scrollIntoView"],
  ] as Array<[GlobalSlots, string]>) {
    if (originals[name] === undefined) {
      delete slots[name];
    } else {
      slots[name] = originals[name];
    }
  }

  window.history.replaceState(null, "", "/");
});

describe("a link that ticks recommendations", () => {
  test("lands on the first ticked card: in the middle of the window, once the list is drawn", async () => {
    await openRecommendations(`?select=${encodeURIComponent(WARNING_EVENTS)}`);

    expect(
      screen.getByTestId(`recommendation-card-select-${WARNING_EVENTS}`),
    ).toHaveAttribute("aria-pressed", "true");

    // Not before the browser has drawn it: the list is not laid out yet.
    expect(scrolls).toEqual([]);

    drawFrames();

    expect(scrolls).toEqual([
      {
        card: `recommendation-card-${WARNING_EVENTS}`,
        options: { block: "center" },
      },
    ]);
  });

  test("keeps it there as the page grows while it settles - once a frame, however many changes", async () => {
    await openRecommendations(`?select=${encodeURIComponent(WARNING_EVENTS)}`);
    drawFrames();

    // The grid's two columns and the cards' padding arrive a frame late.
    pageResizes();
    pageResizes();
    drawFrames();

    expect(scrolls).toHaveLength(2);

    pageResizes();
    drawFrames();

    expect(scrolls).toHaveLength(3);
    for (const scroll of scrolls) {
      expect(scroll).toEqual({
        card: `recommendation-card-${WARNING_EVENTS}`,
        options: { block: "center" },
      });
    }
  });

  test.each(
    PAGE_ANCHOR_RELEASING_EVENTS.map((name: string): [string] => {
      return [name];
    }),
  )(
    "lets the page be once the person takes it over (%s)",
    async (eventName: string) => {
      await openRecommendations(
        `?select=${encodeURIComponent(WARNING_EVENTS)}`,
      );
      drawFrames();

      window.dispatchEvent(new Event(eventName));
      pageResizes();
      drawFrames();

      expect(scrolls).toHaveLength(1);
      for (const observer of pageObservers()) {
        expect(observer.isDisconnected).toBe(true);
      }
    },
  );

  test("of several, lands on the first in the page's order, not the link's", async () => {
    await openRecommendations(
      `?select=${encodeURIComponent(`${WARNING_EVENTS},${CRASH_LOOP}`)}`,
    );
    drawFrames();
    pageResizes();
    drawFrames();

    expect(scrolls).toEqual([
      {
        card: `recommendation-card-${CRASH_LOOP}`,
        options: { block: "center" },
      },
      {
        card: `recommendation-card-${CRASH_LOOP}`,
        options: { block: "center" },
      },
    ]);
  });

  test("lets go of it when the page goes away: nothing scrolled after, no observer left watching", async () => {
    await openRecommendations(`?select=${encodeURIComponent(WARNING_EVENTS)}`);
    drawFrames();

    expect(pageObservers()).toHaveLength(1);

    cleanup();
    pageResizes();
    drawFrames();

    expect(scrolls).toHaveLength(1);
    expect(pageObservers()[0]!.isDisconnected).toBe(true);
  });
});

describe("without a link that ticks any", () => {
  test("the page is left where it was opened, however it settles", async () => {
    await openRecommendations("");
    drawFrames();
    pageResizes();
    drawFrames();

    expect(scrolls).toEqual([]);
    expect(pageObservers()).toEqual([]);
  });

  test("nor by a link whose ids name no card on the list", async () => {
    await openRecommendations(
      `?select=${encodeURIComponent("Kubernetes:not-a-template")}`,
    );
    drawFrames();
    pageResizes();
    drawFrames();

    expect(scrolls).toEqual([]);
    expect(pageObservers()).toEqual([]);
  });
});
