import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

/*
 * ModelAPI is the only thing between the strip and the network. Stubbed
 * inline because jest.mock is hoisted above the imports — a helper module
 * would not be initialised when the factory runs. Names carry the "mock"
 * prefix jest requires of anything a hoisted factory closes over.
 */
interface CountRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
}

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

const mockCountCalls: Array<CountRequest> = [];
const mockListCalls: Array<ListRequest> = [];

let mockCountResponse: (
  request: CountRequest,
) => Promise<number> = (): Promise<number> => {
  return Promise.resolve(0);
};

// The ids of the unarchived environments the strip lists.
let mockEnvironmentIds: Array<string> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (request: CountRequest): Promise<number> => {
        mockCountCalls.push(request);
        return mockCountResponse(request);
      },
      getList: (
        request: ListRequest,
      ): Promise<{ data: Array<{ _id: string }>; count: number }> => {
        mockListCalls.push(request);
        return Promise.resolve({
          data: mockEnvironmentIds.map((id: string): { _id: string } => {
            return { _id: id };
          }),
          count: mockEnvironmentIds.length,
        });
      },
    },
  };
});

import CloudFleetSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudFleetSummary";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";

const LATIN_DIGIT: RegExp = /[0-9]/;

interface FleetCounts {
  total: number;
  connected: number;
  // Environments that never reported (no lastSeenAt).
  waiting?: number | undefined;
  byProvider: Record<string, number>;
  liveInstances: number;
  apps?: number | undefined;
  runningApps?: number | undefined;
  deploys?: number | undefined;
}

/*
 * Answers each count request from what it asks for, so the test describes
 * a fleet rather than a call order. The environments it lists are `total`
 * fresh ids.
 */
function fleet(
  counts: FleetCounts,
): (request: CountRequest) => Promise<number> {
  mockEnvironmentIds = Array.from({ length: counts.total }, (): string => {
    return ObjectID.generate().toString();
  });

  return (request: CountRequest): Promise<number> => {
    if (request.modelType.name === "CloudAppRevision") {
      return Promise.resolve(counts.deploys || 0);
    }
    if (request.modelType.name === "CloudApp") {
      return Promise.resolve(
        request.query["lastSeenAt"]
          ? counts.runningApps || 0
          : counts.apps || 0,
      );
    }
    if (request.modelType.name === "CloudResourceInstance") {
      return Promise.resolve(counts.liveInstances);
    }
    if (request.query["otelCollectorStatus"] === "connected") {
      return Promise.resolve(counts.connected);
    }
    if (request.query["lastSeenAt"] instanceof IsNull) {
      return Promise.resolve(counts.waiting || 0);
    }
    if (typeof request.query["cloudProvider"] === "string") {
      return Promise.resolve(
        counts.byProvider[request.query["cloudProvider"] as string] || 0,
      );
    }
    return Promise.resolve(counts.total);
  };
}

function countsOf(modelName: string): Array<CountRequest> {
  return mockCountCalls.filter((request: CountRequest): boolean => {
    return request.modelType.name === modelName;
  });
}

// Minutes between a GreaterThan lower bound on a date and now.
function minutesAgo(bound: unknown): number {
  expect(bound).toBeInstanceOf(GreaterThan);
  const since: Date = (bound as GreaterThan<Date>).value;
  return (Date.now() - since.getTime()) / 60000;
}

beforeEach(() => {
  mockCountCalls.length = 0;
  mockListCalls.length = 0;
  mockCountResponse = fleet({
    total: 0,
    connected: 0,
    byProvider: {},
    liveInstances: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("CloudFleetSummary", () => {
  test("renders one tile per summary entry from the counts it fetched", async () => {
    mockCountResponse = fleet({
      total: 5,
      connected: 5,
      byProvider: { aws: 4, gcp: 1 },
      liveInstances: 12,
      apps: 8,
      runningApps: 7,
      deploys: 3,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    expect(screen.getAllByTestId("cloud-fleet-summary-tile")).toHaveLength(4);

    expect(screen.getByText("Apps")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("1 not reporting")).toBeInTheDocument();

    expect(screen.getByText("Environments")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    const breakdown: HTMLElement = screen.getAllByTestId(
      "cloud-fleet-summary-tile-sublabel",
    )[1]!;
    expect(breakdown).toHaveTextContent("4 AWS · 1 Google Cloud");
    /*
     * Each provider is one part that never breaks ("1 Google" over "Cloud"
     * read as two things); a narrow tile wraps between the parts.
     */
    const parts: Array<HTMLElement> = Array.from(
      breakdown.querySelectorAll(
        "[data-testid='cloud-fleet-summary-tile-sublabel-part']",
      ),
    );
    expect(
      parts.map((part: HTMLElement): string => {
        return part.textContent || "";
      }),
    ).toEqual(["4 AWS", "1 Google Cloud"]);
    for (const part of parts) {
      expect(part).toHaveClass("whitespace-nowrap");
    }
    // Still isolated, so a right-to-left page keeps the list's order.
    expect(breakdown.querySelector("bdi")).not.toBeNull();
    expect(breakdown.querySelector("bdi")!.contains(parts[0]!)).toBe(true);

    expect(screen.getByText("Deploys")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("in the last 24 hours")).toBeInTheDocument();

    expect(screen.getByText("Live instances")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("seen in the last 15 min")).toBeInTheDocument();
  });

  test("names the disconnected environments first, over the providers", async () => {
    mockCountResponse = fleet({
      total: 5,
      connected: 3,
      byProvider: { aws: 4, gcp: 1 },
      liveInstances: 2,
      apps: 2,
      runningApps: 2,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    // Disconnected is derived: total - connected, never a request of its own.
    expect(screen.getByText("2 environments disconnected")).toBeInTheDocument();
    expect(screen.queryByText(/AWS/)).not.toBeInTheDocument();
    expect(screen.getByText("all running")).toBeInTheDocument();
  });

  /*
   * An environment that has never sent anything is new, not broken: grey
   * and "Waiting" on its platform's card, so the strip does not count it
   * disconnected either. It said "2 environments disconnected" over a card
   * that showed one disconnected and one waiting (#5511's UI review).
   */
  test("counts an environment that never reported as waiting, not disconnected", async () => {
    mockCountResponse = fleet({
      total: 6,
      connected: 4,
      waiting: 1,
      byProvider: { aws: 2, gcp: 2, azure: 2 },
      liveInstances: 7,
      apps: 6,
      runningApps: 4,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    // The quiet one comes first; the waiting one is not called disconnected.
    expect(screen.getByText("1 environment disconnected")).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();

    // The ones never heard from: environments with no lastSeenAt.
    const waitingCount: CountRequest = countsOf("CloudResource").find(
      (request: CountRequest): boolean => {
        return request.query["lastSeenAt"] instanceof IsNull;
      },
    )!;
    expect(waitingCount.query["isArchived"]).toBe(false);
    expect(waitingCount.query["cloudResourceKind"]).toBe("environment");
  });

  test("says how many wait for their first data when none went quiet", async () => {
    mockCountResponse = fleet({
      total: 3,
      connected: 1,
      waiting: 2,
      byProvider: { aws: 3 },
      liveInstances: 1,
      apps: 1,
      runningApps: 1,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(
        screen.getByText("2 environments waiting for first data"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument();
  });

  test("never counts more waiting environments than are not connected", async () => {
    // A connected row whose lastSeenAt is not written yet is not waiting.
    mockCountResponse = fleet({
      total: 2,
      connected: 2,
      waiting: 1,
      byProvider: { gcp: 2 },
      liveInstances: 2,
      apps: 2,
      runningApps: 2,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByText("2 Google Cloud")).toBeInTheDocument();
    });

    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument();
  });

  test("counts the environments unarchived, and their apps, running apps and deploys only", async () => {
    mockCountResponse = fleet({
      total: 2,
      connected: 2,
      byProvider: { azure: 2 },
      liveInstances: 0,
      apps: 3,
      runningApps: 1,
      deploys: 1,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    // total, connected, never reported, and one per provider (aws, gcp, azure).
    const environmentCounts: Array<CountRequest> = countsOf("CloudResource");
    expect(environmentCounts).toHaveLength(6);
    for (const request of environmentCounts) {
      expect(request.query["isArchived"]).toBe(false);
      expect(request.query["cloudResourceKind"]).toBe("environment");
    }
    expect(
      environmentCounts
        .map((request: CountRequest): unknown => {
          return request.query["cloudProvider"];
        })
        .filter(Boolean)
        .sort(),
    ).toEqual(["aws", "azure", "gcp"]);

    // The environments' ids are read once, unarchived, ids only.
    expect(mockListCalls).toHaveLength(1);
    expect(mockListCalls[0]!.modelType.name).toBe("CloudResource");
    expect(mockListCalls[0]!.query).toEqual({
      isArchived: false,
      cloudResourceKind: "environment",
    });
    expect(mockListCalls[0]!.select).toEqual({ _id: true });

    /*
     * The live-instance count has to be a lower bound on lastSeenAt; a
     * plain equality or no filter would count every row ever written.
     */
    const instanceCounts: Array<CountRequest> = countsOf(
      "CloudResourceInstance",
    );
    expect(instanceCounts).toHaveLength(1);
    expect(minutesAgo(instanceCounts[0]!.query["lastSeenAt"])).toBeGreaterThan(
      14,
    );
    expect(minutesAgo(instanceCounts[0]!.query["lastSeenAt"])).toBeLessThan(16);

    /*
     * Every app count is of the listed environments' apps, so an archived
     * environment's apps are left out, as All Apps leaves them out.
     */
    const appCounts: Array<CountRequest> = [
      ...countsOf("CloudApp"),
      ...countsOf("CloudAppRevision"),
    ];
    expect(appCounts).toHaveLength(3);
    for (const request of appCounts) {
      const scope: unknown = request.query["cloudResourceId"];
      expect(scope).toBeInstanceOf(Includes);
      expect(
        (scope as Includes).values.map((id: unknown): string => {
          return String(id);
        }),
      ).toEqual(mockEnvironmentIds);
    }

    const runningCount: CountRequest = countsOf("CloudApp").find(
      (request: CountRequest): boolean => {
        return Boolean(request.query["lastSeenAt"]);
      },
    )!;
    expect(minutesAgo(runningCount.query["lastSeenAt"])).toBeGreaterThan(14);
    expect(minutesAgo(runningCount.query["lastSeenAt"])).toBeLessThan(16);

    // A deploy replaced a revision, in the last day.
    const deployCount: CountRequest = countsOf("CloudAppRevision")[0]!;
    expect(deployCount.query["previousRevision"]).toBeInstanceOf(NotNull);
    expect(minutesAgo(deployCount.query["firstSeenAt"])).toBeGreaterThan(
      24 * 60 - 1,
    );
    expect(minutesAgo(deployCount.query["firstSeenAt"])).toBeLessThan(
      24 * 60 + 1,
    );

    expect(mockCountCalls.length).toBeLessThanOrEqual(10);
    expect(screen.getByText("2 not reporting")).toBeInTheDocument();
  });

  test("renders nothing while there are no environments to summarise, and counts no apps", async () => {
    mockCountResponse = fleet({
      total: 0,
      connected: 0,
      byProvider: {},
      liveInstances: 0,
    });

    const { container } = render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(mockCountCalls.length).toBeGreaterThan(0);
    });

    // Let the resolved promises settle before asserting on the absence.
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 0);
    });

    expect(screen.queryByTestId("cloud-fleet-summary")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    // No environment, so no Includes of nothing is ever sent.
    expect(countsOf("CloudApp")).toHaveLength(0);
    expect(countsOf("CloudAppRevision")).toHaveLength(0);
  });

  test("renders nothing, and does not throw, when a count fails", async () => {
    mockCountResponse = (): Promise<number> => {
      return Promise.reject(new Error("network down"));
    };

    const { container } = render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(mockCountCalls.length).toBeGreaterThan(0);
    });

    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 0);
    });

    expect(screen.queryByTestId("cloud-fleet-summary")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("refetches when the refresh token changes", async () => {
    mockCountResponse = fleet({
      total: 1,
      connected: 1,
      byProvider: { aws: 1 },
      liveInstances: 0,
    });

    const { rerender } = render(<CloudFleetSummary refreshToken={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    const callsAfterFirstLoad: number = mockCountCalls.length;

    mockCountResponse = fleet({
      total: 2,
      connected: 2,
      byProvider: { aws: 2 },
      liveInstances: 0,
    });

    rerender(<CloudFleetSummary refreshToken={2} />);

    await waitFor(() => {
      expect(screen.getByText("2 AWS")).toBeInTheDocument();
    });

    expect(mockCountCalls.length).toBeGreaterThan(callsAfterFirstLoad);
  });
});

/*
 * The strip is App Platforms' first card, and a German reader read it in
 * English: its titles were drawn as the summary names them, never looked
 * up. Drawn here with the Dashboard's own German words, through the same
 * i18next instance the page's sentences go through. Last in the file: it
 * sets the global instance's language.
 */
describe("CloudFleetSummary in the reader's language", () => {
  test("draws every title and line under it in German, each translated title saying its language", async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: false,
      resources: { de: { translation: germanLocale } },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });

    mockCountResponse = fleet({
      total: 6,
      connected: 4,
      byProvider: { aws: 2, gcp: 2, azure: 2 },
      liveInstances: 3,
      apps: 9,
      runningApps: 7,
      deploys: 4,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getAllByTestId("cloud-fleet-summary-tile")).toHaveLength(4);
    });

    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-fleet-summary-tile",
    );
    const titles: Array<string> = tiles.map((tile: HTMLElement): string => {
      return tile.querySelector("span")!.textContent || "";
    });

    expect(titles).toEqual([
      "Apps",
      "Umgebungen",
      "Deployments",
      "Aktive Instanzen",
    ]);
    // "Apps" reads the same in German, so it claims no language of its own.
    expect(tiles[0]!.querySelector("span")).not.toHaveAttribute("lang");
    tiles.slice(1).forEach((tile: HTMLElement): void => {
      expect(tile.querySelector("span")).toHaveAttribute("lang", "de");
    });

    const sublabels: Array<string> = screen
      .getAllByTestId("cloud-fleet-summary-tile-sublabel")
      .map((line: HTMLElement): string => {
        return line.textContent || "";
      });

    expect(sublabels).toEqual([
      "2 melden nicht",
      "2 Umgebungen getrennt",
      "in den letzten 24 Stunden",
      "in den letzten 15 Min. gesehen",
    ]);
  });

  test("draws the empty and all-well lines in German too", async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: false,
      resources: { de: { translation: germanLocale } },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });

    mockCountResponse = fleet({
      total: 2,
      connected: 2,
      byProvider: { aws: 2 },
      liveInstances: 1,
      apps: 0,
    });

    const { unmount } = render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getAllByTestId("cloud-fleet-summary-tile")).toHaveLength(4);
    });

    expect(
      screen.getAllByTestId("cloud-fleet-summary-tile-sublabel")[0],
    ).toHaveTextContent("noch keine gemeldet");

    unmount();

    mockCountResponse = fleet({
      total: 2,
      connected: 2,
      byProvider: { aws: 2 },
      liveInstances: 1,
      apps: 2,
      runningApps: 2,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(
        screen.getAllByTestId("cloud-fleet-summary-tile-sublabel")[0],
      ).toHaveTextContent("alle laufen");
    });
  });

  /*
   * A Persian reader read the strip's numbers in Latin digits beside the
   * platforms' counts in their own: every number the strip draws is written
   * the reader's way, as translatePlural writes its counts.
   */
  test("writes every number in a Persian reader's digits", async () => {
    await i18next.use(initReactI18next).init({
      lng: "fa",
      fallbackLng: false,
      resources: { fa: { translation: persianLocale } },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
    await i18next.changeLanguage("fa");

    mockCountResponse = fleet({
      total: 6,
      connected: 6,
      byProvider: { aws: 2, gcp: 2, azure: 2 },
      liveInstances: 3,
      apps: 8,
      runningApps: 7,
      deploys: 5,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getAllByTestId("cloud-fleet-summary-tile")).toHaveLength(4);
    });

    const values: Array<string> = screen
      .getAllByTestId("cloud-fleet-summary-tile")
      .map((tile: HTMLElement): string => {
        return tile.querySelector(".text-2xl")?.textContent || "";
      });

    expect(values).toEqual(["۸", "۶", "۵", "۳"]);

    const sublabels: Array<string> = screen
      .getAllByTestId("cloud-fleet-summary-tile-sublabel")
      .map((line: HTMLElement): string => {
        return line.textContent || "";
      });

    expect(sublabels[0]).toContain("۱");
    expect(sublabels[1]).toBe("۲ AWS · ۲ Azure · ۲ Google Cloud");
    expect(sublabels[2]).toContain("۲۴");
    expect(sublabels[3]).toContain("۱۵");
    // No Latin digit is left in any of them.
    for (const line of [...values, ...sublabels]) {
      expect(line).not.toMatch(LATIN_DIGIT);
    }
  });
});
