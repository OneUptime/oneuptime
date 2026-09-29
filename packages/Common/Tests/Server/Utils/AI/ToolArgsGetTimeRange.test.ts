import { ToolArgs } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * getTimeRange turns untrusted LLM-supplied time arguments into a concrete
 * window. It must reject garbage rather than silently answer for the default
 * window (which would answer a different question than the user asked).
 */
describe("ToolArgs.getTimeRange", () => {
  test("uses explicit ISO 8601 start and end", () => {
    const args: JSONObject = {
      startTime: "2024-01-31T13:00:00Z",
      endTime: "2024-01-31T14:00:00Z",
    };
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: 30,
    });
    expect(startTime.toISOString()).toBe("2024-01-31T13:00:00.000Z");
    expect(endTime.toISOString()).toBe("2024-01-31T14:00:00.000Z");
  });

  test("throws on an unparseable endTime instead of falling back", () => {
    expect(() => {
      ToolArgs.getTimeRange({ endTime: "yesterday 2am" }, { defaultHours: 1 });
    }).toThrow(BadDataException);
  });

  test("throws on an unparseable startTime instead of falling back", () => {
    expect(() => {
      ToolArgs.getTimeRange(
        { startTime: "last tuesday", endTime: "2024-01-31T14:00:00Z" },
        { defaultHours: 1 },
      );
    }).toThrow(BadDataException);
  });

  test("defaults the window when no timestamps are supplied", () => {
    const { startTime, endTime } = ToolArgs.getTimeRange(
      {},
      { defaultHours: 2 },
    );
    const spanHours: number =
      (endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000);
    expect(spanHours).toBeCloseTo(2, 5);
  });

  test("clamps a window wider than maxDays", () => {
    const { startTime, endTime } = ToolArgs.getTimeRange(
      {
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-06-01T00:00:00Z",
      },
      { defaultHours: 1, maxDays: 30 },
    );
    const spanDays: number =
      (endTime.getTime() - startTime.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(30);
  });
});
