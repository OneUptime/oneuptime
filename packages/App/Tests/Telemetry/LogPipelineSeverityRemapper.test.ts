import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import evaluateFilter from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogSeverity from "Common/Types/Log/LogSeverity";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import { JSONObject } from "Common/Types/JSON";

/*
 * The severity remapper writes straight onto the log row, after ingest has
 * already derived severityText. It used to write whatever the saved config
 * said, and the config came from a dropdown that emitted "INFO" / "WARNING" —
 * values ingest never produces and no filter can match. That put unmatchable
 * severities into the column.
 *
 * Fixing the dropdown does not fix the pipelines already saved, so the
 * remapper normalises on the way in. These tests cover that rescue path, since
 * it is the one that runs against existing customer data.
 */
describe("severity remapper writes only values a filter can match", () => {
  const pipelineWithMapping: (
    severityText: string,
    severityNumber: number,
  ) => Array<LoadedPipeline> = (
    severityText: string,
    severityNumber: number,
  ): Array<LoadedPipeline> => {
    return [
      {
        pipeline: { name: "test-pipeline" },
        compiledFilter: { kind: "always-true" },
        processors: [
          {
            name: "remap",
            processorType: LogPipelineProcessorType.SeverityRemapper,
            configuration: {
              sourceKey: "level",
              mappings: [{ matchValue: "oops", severityText, severityNumber }],
            },
          },
        ],
      },
    ] as unknown as Array<LoadedPipeline>;
  };

  const logRow: JSONObject = {
    severityText: LogSeverity.Unspecified,
    severityNumber: 0,
    attributes: { level: "oops" },
  };

  describe("a pipeline saved with the OLD dropdown values is rescued", () => {
    test.each([
      ["INFO", LogSeverity.Information, 9],
      ["WARNING", LogSeverity.Warning, 13],
      ["ERROR", LogSeverity.Error, 17],
      ["DEBUG", LogSeverity.Debug, 5],
      ["TRACE", LogSeverity.Trace, 1],
      ["FATAL", LogSeverity.Fatal, 21],
    ])(
      "legacy %s is written as %s / %i",
      (legacy: string, expectedText: LogSeverity, expectedNumber: number) => {
        const out: JSONObject = LogPipelineService.processLog(
          logRow,
          pipelineWithMapping(legacy, expectedNumber),
        );
        expect(out["severityText"]).toBe(expectedText);
        expect(out["severityNumber"]).toBe(expectedNumber);
      },
    );

    test("the rescued row is then findable by a filter built in the UI", () => {
      const out: JSONObject = LogPipelineService.processLog(
        logRow,
        pipelineWithMapping("INFO", 9),
      );
      expect(evaluateFilter(out, "severityText = 'Information'")).toBe(true);
    });
  });

  test("a pipeline saved with the new values passes through unchanged", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRow,
      pipelineWithMapping(LogSeverity.Warning, 13),
    );
    expect(out["severityText"]).toBe(LogSeverity.Warning);
    expect(out["severityNumber"]).toBe(13);
  });

  test("severityNumber is taken from the text, not from a config that disagrees", () => {
    // A config claiming Error but numbered 9 must not produce a self-contradicting row.
    const out: JSONObject = LogPipelineService.processLog(
      logRow,
      pipelineWithMapping(LogSeverity.Error, 9),
    );
    expect(out["severityText"]).toBe(LogSeverity.Error);
    expect(out["severityNumber"]).toBe(17);
  });

  test("an unrecognisable severity leaves the ingest-derived value alone", () => {
    const out: JSONObject = LogPipelineService.processLog(
      { ...logRow, severityText: LogSeverity.Error, severityNumber: 17 },
      pipelineWithMapping("NONSENSE", 99),
    );
    expect(out["severityText"]).toBe(LogSeverity.Error);
    expect(out["severityNumber"]).toBe(17);
  });

  test("a row the mapping does not match is untouched", () => {
    const out: JSONObject = LogPipelineService.processLog(
      { ...logRow, attributes: { level: "something-else" } },
      pipelineWithMapping("INFO", 9),
    );
    expect(out["severityText"]).toBe(LogSeverity.Unspecified);
  });
});
