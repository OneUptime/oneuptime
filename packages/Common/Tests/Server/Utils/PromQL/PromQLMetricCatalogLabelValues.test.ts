import { listPromQLLabelValues } from "../../../../Server/Utils/PromQL/PromQLMetricCatalog";
import TelemetryAttributeService from "../../../../Server/Services/TelemetryAttributeService";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A label's values, as Grafana's label browser and /api/v1/label/<name>/
 * values ask for them. `le` and `quantile` used to answer nothing at all:
 * an OpenTelemetry histogram's and summary's are made from their points and
 * are no attribute. But a classic histogram or summary sent as its series
 * (Prometheus remote write) carries them as attributes, and those are its
 * values.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a1f0c2e-0000-4000-8000-000000000082",
);

describe("listPromQLLabelValues", () => {
  test.each<[string, string, Array<string>]>([
    ["le", "le", ["+Inf", "0.1", "0.5"]],
    ["quantile", "quantile", ["0.5", "0.99"]],
  ])(
    "%s answers the values its attribute holds",
    async (label: string, attributeKey: string, values: Array<string>) => {
      const fetchAttributes: SpyInstance<
        typeof TelemetryAttributeService.fetchAttributes
      > = jest
        .spyOn(TelemetryAttributeService, "fetchAttributes")
        .mockResolvedValue(["job", attributeKey, "resource.service.name"]);
      const fetchAttributeValues: SpyInstance<
        typeof TelemetryAttributeService.fetchAttributeValues
      > = jest
        .spyOn(TelemetryAttributeService, "fetchAttributeValues")
        .mockResolvedValue([...values].reverse());

      const answered: Array<string> = await listPromQLLabelValues({
        projectId: PROJECT_ID,
        props: { isRoot: true },
        serviceFilter: {},
        label: label,
        startTimeMs: 0,
        endTimeMs: 60000,
      });

      expect(answered).toEqual(values);
      expect(fetchAttributeValues).toHaveBeenCalledTimes(1);
      expect(fetchAttributeValues.mock.calls[0]![0].attributeKey).toBe(
        attributeKey,
      );

      fetchAttributes.mockRestore();
      fetchAttributeValues.mockRestore();
    },
  );

  test("le answers nothing where no series carries it as an attribute", async () => {
    const fetchAttributes: SpyInstance<
      typeof TelemetryAttributeService.fetchAttributes
    > = jest
      .spyOn(TelemetryAttributeService, "fetchAttributes")
      .mockResolvedValue(["job"]);
    const fetchAttributeValues: SpyInstance<
      typeof TelemetryAttributeService.fetchAttributeValues
    > = jest.spyOn(TelemetryAttributeService, "fetchAttributeValues");

    expect(
      await listPromQLLabelValues({
        projectId: PROJECT_ID,
        props: { isRoot: true },
        serviceFilter: {},
        label: "le",
        startTimeMs: 0,
        endTimeMs: 60000,
      }),
    ).toEqual([]);
    expect(fetchAttributeValues).not.toHaveBeenCalled();

    fetchAttributes.mockRestore();
    fetchAttributeValues.mockRestore();
  });
});
