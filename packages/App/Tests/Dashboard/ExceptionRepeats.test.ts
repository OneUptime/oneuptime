const getListMock: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import {
  buildRepeatsQuery,
  findRepeatedOccurrences,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionRepeats";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import { MATCH_WINDOW_MS } from "Common/Utils/Telemetry/AppleCrashMatch";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * #9923: the occurrences table says of an occurrence that KSCrash and
 * MetricKit both reported it - one read per page, for the repeats of the
 * page's occurrences, over the days the page covers and no more.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const NEWEST: Date = new Date("2026-11-20T09:00:00.000Z");
const OLDEST: Date = new Date("2026-11-18T09:00:00.000Z");

beforeEach(() => {
  getListMock.mockReset();
});

describe("the read for a page's repeats", () => {
  test("the repeats of its occurrences, within the pairing window either side of the page", () => {
    const query: Record<string, unknown> = buildRepeatsQuery({
      projectId: PROJECT_ID,
      occurrences: [
        { id: "a", time: NEWEST },
        { id: "b", time: OLDEST },
        { id: "a", time: NEWEST },
      ],
    })!;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect((query["duplicateOf"] as Includes).values).toEqual(["a", "b"]);

    const time: InBetween<Date> = query["time"] as InBetween<Date>;

    expect(time.startValue.getTime()).toBe(OLDEST.getTime() - MATCH_WINDOW_MS);
    expect(time.endValue.getTime()).toBe(NEWEST.getTime() + MATCH_WINDOW_MS);
  });

  test("a page with no occurrence it can place in time asks nothing", () => {
    expect(
      buildRepeatsQuery({
        projectId: PROJECT_ID,
        occurrences: [
          { id: "", time: NEWEST },
          { id: "c", time: undefined },
        ],
      }),
    ).toBe(null);
  });
});

describe("the occurrences reported twice", () => {
  test("are those a repeat names", async () => {
    const repeat: ExceptionInstance = new ExceptionInstance();
    repeat.duplicateOf = "a";
    getListMock.mockResolvedValue({ data: [repeat], count: 1 });

    const repeated: Set<string> = await findRepeatedOccurrences({
      projectId: PROJECT_ID,
      occurrences: [
        { id: "a", time: NEWEST },
        { id: "b", time: NEWEST },
      ],
    });

    expect([...repeated]).toEqual(["a"]);
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toMatchObject({
      modelType: ExceptionInstance,
      select: { duplicateOf: true },
      limit: 2,
    });
  });

  test("none when the page has no occurrence, and none when the read fails", async () => {
    expect(
      (
        await findRepeatedOccurrences({
          projectId: PROJECT_ID,
          occurrences: [],
        })
      ).size,
    ).toBe(0);
    expect(getListMock).not.toHaveBeenCalled();

    getListMock.mockRejectedValue(new Error("offline"));

    expect(
      (
        await findRepeatedOccurrences({
          projectId: PROJECT_ID,
          occurrences: [{ id: "a", time: NEWEST }],
        })
      ).size,
    ).toBe(0);
  });
});
