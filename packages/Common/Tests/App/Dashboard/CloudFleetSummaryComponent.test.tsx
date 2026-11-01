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

const mockCountCalls: Array<CountRequest> = [];

let mockCountResponse: (
  request: CountRequest,
) => Promise<number> = (): Promise<number> => {
  return Promise.resolve(0);
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (request: CountRequest): Promise<number> => {
        mockCountCalls.push(request);
        return mockCountResponse(request);
      },
    },
  };
});

import CloudFleetSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudFleetSummary";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";

/*
 * Answers each of the six count requests from what it asks for, so the
 * test describes a fleet rather than a call order.
 */
function fleet(counts: {
  total: number;
  connected: number;
  byProvider: Record<string, number>;
  liveInstances: number;
}): (request: CountRequest) => Promise<number> {
  return (request: CountRequest): Promise<number> => {
    if (request.modelType.name === "CloudResourceInstance") {
      return Promise.resolve(counts.liveInstances);
    }
    if (request.query["otelCollectorStatus"] === "connected") {
      return Promise.resolve(counts.connected);
    }
    if (typeof request.query["cloudProvider"] === "string") {
      return Promise.resolve(
        counts.byProvider[request.query["cloudProvider"] as string] || 0,
      );
    }
    return Promise.resolve(counts.total);
  };
}

beforeEach(() => {
  mockCountCalls.length = 0;
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
      connected: 3,
      byProvider: { aws: 4, gcp: 1 },
      liveInstances: 12,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    expect(screen.getAllByTestId("cloud-fleet-summary-tile")).toHaveLength(4);

    expect(screen.getByText("Environments")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4 AWS · 1 Google Cloud")).toBeInTheDocument();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("60% of environments")).toBeInTheDocument();

    // Disconnected is derived: total - connected, never a seventh request.
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    expect(screen.getByText("Live instances")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("seen in the last 15 min")).toBeInTheDocument();
  });

  test("issues at most six count requests, all scoped to unarchived rows", async () => {
    mockCountResponse = fleet({
      total: 1,
      connected: 1,
      byProvider: { azure: 1 },
      liveInstances: 0,
    });

    render(<CloudFleetSummary />);

    await waitFor(() => {
      expect(screen.getByTestId("cloud-fleet-summary")).toBeInTheDocument();
    });

    expect(mockCountCalls.length).toBeLessThanOrEqual(6);

    const environmentCounts: Array<CountRequest> = mockCountCalls.filter(
      (request: CountRequest): boolean => {
        return request.modelType.name === "CloudResource";
      },
    );
    const instanceCounts: Array<CountRequest> = mockCountCalls.filter(
      (request: CountRequest): boolean => {
        return request.modelType.name === "CloudResourceInstance";
      },
    );

    // total, connected, and one per provider (aws, gcp, azure).
    expect(environmentCounts).toHaveLength(5);
    for (const request of environmentCounts) {
      expect(request.query["isArchived"]).toBe(false);
    }
    expect(
      environmentCounts
        .map((request: CountRequest): unknown => {
          return request.query["cloudProvider"];
        })
        .filter(Boolean)
        .sort(),
    ).toEqual(["aws", "azure", "gcp"]);

    /*
     * The live-instance count has to be a lower bound on lastSeenAt; a
     * plain equality or no filter would count every row ever written.
     */
    expect(instanceCounts).toHaveLength(1);
    const lastSeenAt: unknown = instanceCounts[0]!.query["lastSeenAt"];
    expect(lastSeenAt).toBeInstanceOf(GreaterThan);
    const since: Date = (lastSeenAt as GreaterThan<Date>).value;
    const ageInMinutes: number = (Date.now() - since.getTime()) / 60000;
    expect(ageInMinutes).toBeGreaterThan(14);
    expect(ageInMinutes).toBeLessThan(16);
  });

  test("renders nothing while there are no environments to summarise", async () => {
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
  test("draws every title and line under it in German, each title saying its language", async () => {
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
      "Umgebungen",
      "Verbunden",
      "Getrennt",
      "Aktive Instanzen",
    ]);
    tiles.forEach((tile: HTMLElement): void => {
      expect(tile.querySelector("span")).toHaveAttribute("lang", "de");
    });

    const sublabels: Array<string> = screen
      .getAllByTestId("cloud-fleet-summary-tile-sublabel")
      .map((line: HTMLElement): string => {
        return line.textContent || "";
      });

    expect(sublabels).toEqual([
      // Provider names are names, in every language.
      "2 AWS · 2 Azure · 2 Google Cloud",
      "67 % der Umgebungen",
      "in letzter Zeit keine Telemetrie",
      "in den letzten 15 Min. gesehen",
    ]);
  });
});
