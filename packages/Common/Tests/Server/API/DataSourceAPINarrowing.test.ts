import {
  readNarrowingSeriesLabels,
  readNarrowingServiceIds,
} from "../../../Server/API/DataSourceAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * What narrows the built-in PromQL source for a monitor's charts (issue
 * #10227): the services the monitor reads and the labels of the one series
 * an incident or alert opened for. Only ever a narrowing: anything that is
 * not one of those is refused, never read as "no narrowing" - which would
 * chart every service and every series.
 */

const SERVICE_ID: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("the services a built-in source query reads", () => {
  test("none, or service ids", () => {
    expect(readNarrowingServiceIds(undefined)).toBeUndefined();
    expect(readNarrowingServiceIds(null)).toBeUndefined();
    expect(readNarrowingServiceIds([])).toBeUndefined();
    expect(readNarrowingServiceIds([SERVICE_ID])).toEqual([SERVICE_ID]);
  });

  test.each([
    ["an id that is no id", ["not-a-service"]],
    ["a number", [7]],
    ["one id, not a list", SERVICE_ID],
    ["an object", { id: SERVICE_ID }],
    ["more than 100", Array.from({ length: 101 }).fill(SERVICE_ID)],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(() => {
      return readNarrowingServiceIds(value);
    }).toThrow(BadDataException);
  });
});

describe("the labels of the one series a built-in source query reads", () => {
  test("none, or labels with text values, copied", () => {
    const labels: Record<string, string> = { job: "api", instance: "a:9090" };

    expect(readNarrowingSeriesLabels(undefined)).toBeUndefined();
    expect(readNarrowingSeriesLabels(null)).toBeUndefined();
    expect(readNarrowingSeriesLabels({})).toEqual({});
    expect(readNarrowingSeriesLabels(labels)).toEqual(labels);
    expect(readNarrowingSeriesLabels(labels)).not.toBe(labels);
  });

  test.each([
    ["a list", [{ job: "api" }]],
    ["text", "job=api"],
    ["a value that is no text", { job: 5 }],
    ["a value that is an object", { job: { $ne: "api" } }],
    ["a value too long", { job: "a".repeat(4097) }],
    [
      "more than 100 labels",
      Object.fromEntries(
        Array.from({ length: 101 }).map((_item: unknown, index: number) => {
          return [`l${index}`, "v"];
        }),
      ),
    ],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(() => {
      return readNarrowingSeriesLabels(value);
    }).toThrow(BadDataException);
  });
});
