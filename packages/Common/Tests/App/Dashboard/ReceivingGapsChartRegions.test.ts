import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

const postMock: Mock<(options: unknown) => Promise<unknown>> = jest.fn();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (options: unknown): Promise<unknown> => {
        return postMock(options);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ChartEventKind from "../../../UI/Components/Charts/Types/ChartEventKind";
import ChartReferenceRegionProps from "../../../UI/Components/Charts/Types/ReferenceRegionProps";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { APP_API_URL } from "../../../UI/Config";
import {
  ReceivingGap,
  ReceivingGapReason,
} from "../../../Utils/Telemetry/ReceivingGaps";
import {
  NOT_MONITORED_EXPLANATIONS,
  NOT_MONITORED_LABEL,
  NOT_MONITORED_REGION_COLOR,
  RECEIVING_GAPS_ROUTE,
  fetchReceivingGaps,
  getNotMonitoredRegions,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ReceivingGaps";

/*
 * Issue #2825: the host, Docker host, Podman host and Kubernetes cluster
 * availability charts ask when OneUptime itself was not receiving data,
 * and shade that time "Not monitored" instead of drawing it as Down.
 */

const WINDOW: { startsAt: Date; endsAt: Date } = {
  startsAt: new Date("2026-10-09T10:00:00.000Z"),
  endsAt: new Date("2026-10-09T12:00:00.000Z"),
};

function at(hhmm: string): Date {
  return new Date(`2026-10-09T${hhmm}:00.000Z`);
}

function gap(
  from: string,
  to: string,
  reason: ReceivingGapReason,
): ReceivingGap {
  return { startsAt: at(from), endsAt: at(to), reason };
}

// Marks every string it is asked for, to prove the copy goes through it.
const translator: Translator = {
  translateText: (text: string): string => {
    return `[${text}]`;
  },
} as unknown as Translator;

describe("fetchReceivingGaps", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks the API for the chart's window, with the project's headers", async () => {
    postMock.mockResolvedValue(new HTTPResponse(200, { gaps: [] }, {}));

    await fetchReceivingGaps(WINDOW);

    const options: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    };
    expect(options.url.toString()).toBe(
      `${APP_API_URL.toString()}${RECEIVING_GAPS_ROUTE}`,
    );
    expect(options.data).toEqual({
      startsAt: "2026-10-09T10:00:00.000Z",
      endsAt: "2026-10-09T12:00:00.000Z",
    });
    expect(options.headers).toEqual({ tenantid: "project-1" });
  });

  test("reads the gaps the API answers", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(
        200,
        {
          gaps: [
            {
              startsAt: "2026-10-09T10:40:00.000Z",
              endsAt: "2026-10-09T10:52:00.000Z",
              reason: "NotReceiving",
            },
          ],
        },
        {},
      ),
    );

    expect(await fetchReceivingGaps(WINDOW)).toEqual([
      gap("10:40", "10:52", ReceivingGapReason.NotReceiving),
    ]);
  });

  test("an error answer, a thrown request or a strange body is no gaps, never a broken chart", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "No access" }, {}),
    );
    expect(await fetchReceivingGaps(WINDOW)).toEqual([]);

    postMock.mockRejectedValue(new Error("offline"));
    expect(await fetchReceivingGaps(WINDOW)).toEqual([]);

    postMock.mockResolvedValue(new HTTPResponse(200, { gaps: "x" }, {}));
    expect(await fetchReceivingGaps(WINDOW)).toEqual([]);

    postMock.mockResolvedValue(undefined);
    expect(await fetchReceivingGaps(WINDOW)).toEqual([]);
  });
});

describe("getNotMonitoredRegions", () => {
  test("an outage and the reconnect grace after it are one region, explained as the outage", () => {
    const regions: Array<ChartReferenceRegionProps> = getNotMonitoredRegions({
      gaps: [
        gap("10:40", "10:52", ReceivingGapReason.NotReceiving),
        gap("10:52", "10:54", ReceivingGapReason.Reconnecting),
      ],
      translator,
    });

    expect(regions).toEqual([
      {
        startDate: at("10:40"),
        endDate: at("10:54"),
        label: `[${NOT_MONITORED_LABEL}]`,
        subtitle: `[${NOT_MONITORED_EXPLANATIONS[ReceivingGapReason.NotReceiving]}]`,
        color: NOT_MONITORED_REGION_COLOR,
        kind: ChartEventKind.Generic,
      },
    ]);
  });

  test("separate gaps are separate regions, each with its own reason", () => {
    const regions: Array<ChartReferenceRegionProps> = getNotMonitoredRegions({
      gaps: [
        gap("11:50", "12:00", ReceivingGapReason.CatchingUp),
        gap("10:10", "10:12", ReceivingGapReason.Reconnecting),
      ],
      translator,
    });

    expect(
      regions.map((region: ChartReferenceRegionProps) => {
        return [region.startDate, region.endDate, region.subtitle];
      }),
    ).toEqual([
      [
        at("10:10"),
        at("10:12"),
        `[${NOT_MONITORED_EXPLANATIONS[ReceivingGapReason.Reconnecting]}]`,
      ],
      [
        at("11:50"),
        at("12:00"),
        `[${NOT_MONITORED_EXPLANATIONS[ReceivingGapReason.CatchingUp]}]`,
      ],
    ]);
  });

  test("no gaps, no regions", () => {
    expect(getNotMonitoredRegions({ gaps: [], translator })).toEqual([]);
  });

  test("the copy says the time is left out of uptime, and names nothing but OneUptime", () => {
    expect(NOT_MONITORED_LABEL).toBe("Not monitored");
    for (const explanation of Object.values(NOT_MONITORED_EXPLANATIONS)) {
      expect(explanation).toContain("OneUptime");
      expect(explanation).toContain("left out of uptime");
    }
  });
});
