import { describe, expect, test } from "@jest/globals";
import {
  getPromQLMonitorSeriesNames,
  isSeriesNamed,
  withoutPromQLMetricName,
} from "../../../Utils/PromQL/PromQLMonitorSeries";

/*
 * How a PromQL monitor names the series it judges, and how an incident's
 * chart finds the one that opened it again (issues #7712, #10227): by its
 * labels without __name__, or with it where two series of a check are told
 * apart by their names alone.
 */

describe("the name each series of a check goes by", () => {
  test("its labels without __name__, as Prometheus names an alert", () => {
    expect(
      getPromQLMonitorSeriesNames([
        { __name__: "up", job: "api", instance: "a" },
        { __name__: "up", job: "api", instance: "b" },
      ]),
    ).toEqual([
      { job: "api", instance: "a" },
      { job: "api", instance: "b" },
    ]);
  });

  test("with __name__ where only the names tell two series apart", () => {
    expect(
      getPromQLMonitorSeriesNames([
        { __name__: "errors_total", job: "api" },
        { __name__: "requests_total", job: "api" },
        { __name__: "requests_total", job: "worker" },
      ]),
    ).toEqual([
      { __name__: "errors_total", job: "api" },
      { __name__: "requests_total", job: "api" },
      { job: "worker" },
    ]);
  });

  test("an aggregation's one series has no labels", () => {
    expect(getPromQLMonitorSeriesNames([{}])).toEqual([{}]);
  });

  test("a copy: the labels handed in are not changed", () => {
    const labels: Record<string, string> = { __name__: "up", job: "api" };

    expect(withoutPromQLMetricName(labels)).toEqual({ job: "api" });
    expect(labels).toEqual({ __name__: "up", job: "api" });
  });
});

describe("whether a series is the one an incident keeps the labels of", () => {
  test("the same labels, without __name__ or with it", () => {
    const labels: Record<string, string> = {
      __name__: "up",
      job: "api",
      instance: "a",
    };

    expect(
      isSeriesNamed({ labels, seriesLabels: { job: "api", instance: "a" } }),
    ).toBe(true);
    expect(isSeriesNamed({ labels, seriesLabels: { ...labels } })).toBe(true);
  });

  test("never a series with a label more or less, or another value", () => {
    const labels: Record<string, string> = { __name__: "up", job: "api" };

    for (const seriesLabels of [
      { job: "worker" },
      { job: "api", instance: "a" },
      {},
      { __name__: "down", job: "api" },
      { job: "API" },
    ]) {
      expect([seriesLabels, isSeriesNamed({ labels, seriesLabels })]).toEqual([
        seriesLabels,
        false,
      ]);
    }
  });

  test("a series of no labels is the incident's that kept none", () => {
    expect(isSeriesNamed({ labels: {}, seriesLabels: {} })).toBe(true);
    expect(isSeriesNamed({ labels: { __name__: "x" }, seriesLabels: {} })).toBe(
      true,
    );
  });

  test("a label named like an Object property is a label", () => {
    expect(
      isSeriesNamed({
        labels: { constructor: "a" },
        seriesLabels: { toString: "a" },
      }),
    ).toBe(false);
    expect(
      isSeriesNamed({
        labels: { constructor: "a" },
        seriesLabels: { constructor: "a" },
      }),
    ).toBe(true);
  });
});
