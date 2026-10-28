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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import * as React from "react";
import TraceHealthCard, {
  loadTraceHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceHealthCard";
import {
  TRACE_HEALTH_HINTS,
  TRACE_HEALTH_NO_LOGS,
  TRACE_HEALTH_TILE_LABELS,
  TraceHealthTile,
  TraceHealthTileKey,
  describeTraceHealthSample,
  formatTraceHealthShare,
  getTraceHealthTiles,
  isTraceHealthShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceHealthPresentation";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  TRACE_HEALTH_ROUTE,
  TraceHealthHint,
  TraceHealthReport,
} from "../../../Types/Telemetry/TraceHealth";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * "Trace health" at the top of a service's Traces page: three numbers on
 * how complete the service's traces are, a line under each that looks poor
 * saying what usually causes it and where the docs fix it, and what the
 * numbers were measured on in the (i). It is drawn only once it has numbers
 * to show.
 */

type PostArgs = {
  url: { toString: () => string };
  data: JSONObject;
  headers?: JSONObject;
};

const postMock: Mock<(args: PostArgs) => Promise<unknown>> =
  jest.fn<(args: PostArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: PostArgs) => {
        return postMock(args);
      },
    },
  };
});

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { default: typeof ObjectID } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: typeof ObjectID };
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
      getCurrentProject: (): null => {
        return null;
      },
    },
  };
});

const SERVICE_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000002",
);

const ENGLISH: Translator = createTranslator(undefined, "en");

const HEALTHY: TraceHealthReport = {
  startTime: "2026-10-27T10:00:00.000Z",
  endTime: "2026-10-27T11:00:00.000Z",
  samplePercent: 100,
  spanCount: 1520,
  traceCount: 400,
  orphanSpanShare: 0.002,
  singleSpanTraceShare: 0.12,
  logCount: 900,
  logsLinkedShare: 0.94,
  hints: [],
};

// The trace-quality review's project: lost parents, lone spans, no linked logs.
const POOR: TraceHealthReport = {
  ...HEALTHY,
  samplePercent: 4,
  spanCount: 21034,
  traceCount: 8120,
  orphanSpanShare: 0.26,
  singleSpanTraceShare: 0.35,
  logsLinkedShare: 0,
  hints: [
    TraceHealthHint.MissingParentSpans,
    TraceHealthHint.OneSpanTraces,
    TraceHealthHint.UnlinkedLogs,
  ],
};

function tileOf(
  tiles: Array<TraceHealthTile>,
  key: TraceHealthTileKey,
): TraceHealthTile {
  return tiles.find((tile: TraceHealthTile): boolean => {
    return tile.key === key;
  })!;
}

describe("a share as the card writes it", () => {
  test("is a whole percent", () => {
    expect(formatTraceHealthShare(0.12, "en")).toBe("12%");
    expect(formatTraceHealthShare(0.5, "en")).toBe("50%");
    expect(formatTraceHealthShare(0, "en")).toBe("0%");
    expect(formatTraceHealthShare(1, "en")).toBe("100%");
    expect(formatTraceHealthShare(0.987, "en")).toBe("99%");
  });

  test("never rounds a sliver away at either end", () => {
    expect(formatTraceHealthShare(0.998, "en")).toBe("99.8%");
    expect(formatTraceHealthShare(0.99996, "en")).toBe("99.9%");
    expect(formatTraceHealthShare(0.0004, "en")).toBe("0.1%");
    expect(formatTraceHealthShare(0.0042, "en")).toBe("0.5%");
  });

  test("is written the reader's way", () => {
    expect(formatTraceHealthShare(0.996, "de")).toMatch(/^99,6\s%$/);
    expect(formatTraceHealthShare(0.996, "not a language")).toBe("99.6%");
  });

  test("is a dash when it was not measured", () => {
    expect(formatTraceHealthShare(null, "en")).toBe("—");
    expect(formatTraceHealthShare(Number.NaN, "en")).toBe("—");
  });
});

describe("the tiles", () => {
  test("are the three numbers, in plain words, in order", () => {
    const tiles: Array<TraceHealthTile> = getTraceHealthTiles(HEALTHY, ENGLISH);

    expect(
      tiles.map((tile: TraceHealthTile): [string, string] => {
        return [tile.label, tile.value];
      }),
    ).toEqual([
      ["Traces with every span", "99.8%"],
      ["One-span traces", "12%"],
      ["Logs linked to a trace", "94%"],
    ]);
    expect(
      tiles.every((tile: TraceHealthTile): boolean => {
        return !tile.isPoor && tile.hint === null;
      }),
    ).toBe(true);
  });

  test("a tile the server calls poor carries what to do and where the docs say how", () => {
    const tiles: Array<TraceHealthTile> = getTraceHealthTiles(POOR, ENGLISH);

    expect(tileOf(tiles, TraceHealthTileKey.CompleteTraces)).toEqual({
      key: TraceHealthTileKey.CompleteTraces,
      label: TRACE_HEALTH_TILE_LABELS[TraceHealthTileKey.CompleteTraces],
      value: "74%",
      isPoor: true,
      hint: TRACE_HEALTH_HINTS[TraceHealthHint.MissingParentSpans],
    });
    expect(tileOf(tiles, TraceHealthTileKey.OneSpanTraces).hint).toBe(
      TRACE_HEALTH_HINTS[TraceHealthHint.OneSpanTraces],
    );
    expect(tileOf(tiles, TraceHealthTileKey.LinkedLogs)).toMatchObject({
      value: "0%",
      isPoor: true,
      hint: TRACE_HEALTH_HINTS[TraceHealthHint.UnlinkedLogs],
    });
  });

  test("only the tile a hint names is poor", () => {
    const tiles: Array<TraceHealthTile> = getTraceHealthTiles(
      { ...HEALTHY, hints: [TraceHealthHint.UnlinkedLogs] },
      ENGLISH,
    );

    expect(
      tiles.map((tile: TraceHealthTile): boolean => {
        return tile.isPoor;
      }),
    ).toEqual([false, false, true]);
  });

  test("a service with no logs says so instead of a percent, and is not poor for it", () => {
    const tile: TraceHealthTile = tileOf(
      getTraceHealthTiles(
        { ...HEALTHY, logCount: 0, logsLinkedShare: null },
        ENGLISH,
      ),
      TraceHealthTileKey.LinkedLogs,
    );

    expect(tile.value).toBe(TRACE_HEALTH_NO_LOGS);
    expect(tile.isPoor).toBe(false);
    expect(tile.hint).toBeNull();
  });

  test("hints say what causes it, what to do, and link a docs section", () => {
    expect(TRACE_HEALTH_HINTS[TraceHealthHint.MissingParentSpans].text).toBe(
      "Some spans arrive without the span they belong to: usually a sender dropping spans under load, or a database proxy the Kubernetes agent does not recognise (add it to ebpf.databaseProxyNames).",
    );
    expect(TRACE_HEALTH_HINTS[TraceHealthHint.UnlinkedLogs].text).toContain(
      "Turn on log correlation in the agent, or send logs through your OpenTelemetry SDK.",
    );

    for (const hint of Object.values(TraceHealthHint)) {
      expect(TRACE_HEALTH_HINTS[hint].docsUrl).toMatch(
        /^\/docs\/(telemetry|monitor)\/kubernetes-agent#[a-z0-9-]+$/,
      );
      expect(TRACE_HEALTH_HINTS[hint].linkText.length).toBeGreaterThan(0);
    }
  });
});

describe("what the numbers were measured on", () => {
  const start: string = OneUptimeDate.getDateAsLocalDayMonthTimeString(
    HEALTHY.startTime,
  );
  const end: string = OneUptimeDate.getDateAsLocalDayMonthTimeString(
    HEALTHY.endTime,
  );

  test("names the window, the spans, the traces and the logs", () => {
    expect(describeTraceHealthSample(HEALTHY, ENGLISH)).toBe(
      `Measured from ${start} to ${end} on every trace this service has spans in, 1,520 spans in 400 traces, and on all of its logs: 900 logs.`,
    );
  });

  test("says how much of the traces a sample read", () => {
    expect(describeTraceHealthSample(POOR, ENGLISH)).toBe(
      `Measured from ${start} to ${end} on a 4% sample of the traces this service has spans in, 21,034 spans in 8,120 traces, and on all of its logs: 900 logs.`,
    );
  });

  test("leaves the logs out when there are none", () => {
    expect(
      describeTraceHealthSample(
        {
          ...POOR,
          spanCount: 1,
          traceCount: 1,
          logCount: 0,
          logsLinkedShare: null,
        },
        ENGLISH,
      ),
    ).toBe(
      `Measured from ${start} to ${end} on a 4% sample of the traces this service has spans in: 1 span in 1 trace.`,
    );
  });
});

describe("when the card is shown", () => {
  test("only with a report that has spans in it", () => {
    expect(isTraceHealthShown(HEALTHY)).toBe(true);
    expect(isTraceHealthShown(null)).toBe(false);
    expect(isTraceHealthShown({ ...HEALTHY, spanCount: 0 })).toBe(false);
  });
});

describe("the card", () => {
  function answer(result: unknown): void {
    postMock.mockImplementation(async () => {
      return result;
    });
  }

  function renderCard(): void {
    render(
      <div data-testid="page">
        <TraceHealthCard serviceId={SERVICE_ID} />
      </div>,
    );
  }

  beforeEach(() => {
    postMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("asks the trace health route about this service, for the current project", async () => {
    answer(new HTTPResponse(200, HEALTHY as unknown as JSONObject, {}));
    renderCard();

    await screen.findByTestId("trace-health-card");

    expect(postMock).toHaveBeenCalledTimes(1);
    const args: PostArgs = postMock.mock.calls[0]![0];
    expect(args.url.toString()).toContain(TRACE_HEALTH_ROUTE);
    expect(args.data).toEqual({ serviceId: SERVICE_ID.toString() });
    expect(JSON.stringify(args.headers)).toContain(PROJECT_ID);
  });

  test("draws nothing while it loads", async () => {
    postMock.mockImplementation(() => {
      return new Promise(() => {
        // Never answers.
      });
    });
    renderCard();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("draws nothing for a service with no spans in the window", async () => {
    answer(
      new HTTPResponse(
        200,
        {
          ...HEALTHY,
          spanCount: 0,
          traceCount: 0,
          orphanSpanShare: null,
          singleSpanTraceShare: null,
        } as unknown as JSONObject,
        {},
      ),
    );
    renderCard();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("a refused, failed or garbled answer draws nothing", async () => {
    for (const respond of [
      async (): Promise<unknown> => {
        return new HTTPErrorResponse(403, { message: "Not allowed" }, {});
      },
      async (): Promise<unknown> => {
        throw new Error("network down");
      },
      async (): Promise<unknown> => {
        return new HTTPResponse(200, { buckets: [] }, {});
      },
    ]) {
      postMock.mockReset();
      postMock.mockImplementation(respond);
      renderCard();

      await waitFor(() => {
        expect(postMock).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
      expect(screen.getByTestId("page")).toBeEmptyDOMElement();
      cleanup();
    }
  });

  test("a healthy service: three numbers and no advice", async () => {
    answer(new HTTPResponse(200, HEALTHY as unknown as JSONObject, {}));
    renderCard();

    const card: HTMLElement = await screen.findByTestId("trace-health-card");

    expect(card).toHaveTextContent("Trace health");
    expect(
      within(card).getByTestId(
        `trace-health-tile-${TraceHealthTileKey.CompleteTraces}-value`,
      ),
    ).toHaveTextContent("99.8%");
    expect(
      within(card).getByTestId(
        `trace-health-tile-${TraceHealthTileKey.OneSpanTraces}-value`,
      ),
    ).toHaveTextContent("12%");
    expect(
      within(card).getByTestId(
        `trace-health-tile-${TraceHealthTileKey.LinkedLogs}-value`,
      ),
    ).toHaveTextContent("94%");
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
    // The sample and the window are behind the (i), not on the card.
    expect(card).not.toHaveTextContent("Measured from");
    expect(within(card).getByTestId("trace-health-sample")).toBeInTheDocument();
  });

  test("a poor number gets one line on what to do, linked to the docs", async () => {
    answer(new HTTPResponse(200, POOR as unknown as JSONObject, {}));
    renderCard();

    const card: HTMLElement = await screen.findByTestId("trace-health-card");

    for (const [key, hint] of [
      [TraceHealthTileKey.CompleteTraces, TraceHealthHint.MissingParentSpans],
      [TraceHealthTileKey.OneSpanTraces, TraceHealthHint.OneSpanTraces],
      [TraceHealthTileKey.LinkedLogs, TraceHealthHint.UnlinkedLogs],
    ] as Array<[TraceHealthTileKey, TraceHealthHint]>) {
      const tile: HTMLElement = within(card).getByTestId(
        `trace-health-tile-${key}`,
      );
      const line: HTMLElement = within(tile).getByTestId(
        `trace-health-tile-${key}-hint`,
      );

      expect(tile).toHaveAttribute("data-poor", "true");
      expect(line).toHaveTextContent(TRACE_HEALTH_HINTS[hint].text);

      const link: HTMLElement = within(line).getByRole("link", {
        name: TRACE_HEALTH_HINTS[hint].linkText,
      });
      expect(link).toHaveAttribute("href", TRACE_HEALTH_HINTS[hint].docsUrl);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("loadTraceHealth reads nothing from a refusal", async () => {
    answer(new HTTPErrorResponse(400, { message: "Bad" }, {}));

    expect(await loadTraceHealth(SERVICE_ID.toString())).toBeNull();
  });
});
