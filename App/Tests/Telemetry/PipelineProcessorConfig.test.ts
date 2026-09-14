import getPipelineProcessorConfig from "../../FeatureSet/Telemetry/Utils/PipelineProcessorConfig";
import { JSONObject } from "Common/Types/JSON";

describe("pipeline configuration normalization", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("parses a persisted JSON string once across a large record batch", () => {
    const raw: string = JSON.stringify({ sourceKey: "old", targetKey: "new" });
    const processor: { configuration: string } = { configuration: raw };
    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
    const first: JSONObject = getPipelineProcessorConfig(processor);
    let allReferencesMatch: boolean = true;

    for (let index: number = 0; index < 10_000; index++) {
      allReferencesMatch =
        getPipelineProcessorConfig(processor) === first && allReferencesMatch;
    }

    expect(allReferencesMatch).toBe(true);
    expect(first).toEqual({ sourceKey: "old", targetKey: "new" });
    expect(processor.configuration).toBe(raw);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("preserves object identity and observes in-place object edits", () => {
    const configuration: JSONObject = { sourceKey: "old", targetKey: "first" };
    const processor: { configuration: JSONObject } = { configuration };
    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");

    expect(getPipelineProcessorConfig(processor)).toBe(configuration);
    configuration["targetKey"] = "second";
    expect(getPipelineProcessorConfig(processor)["targetKey"]).toBe("second");
    expect(parse).not.toHaveBeenCalled();
  });

  test("reuses compiled metadata added to a normalized string configuration", () => {
    const processor: { configuration: string } = { configuration: "{}" };
    const normalized: JSONObject = getPipelineProcessorConfig(processor);
    normalized["compiledMetadata"] = { filter: "cached" };

    expect(getPipelineProcessorConfig(processor)["compiledMetadata"]).toBe(
      normalized["compiledMetadata"],
    );
    expect(processor.configuration).toBe("{}");
  });

  test("does not share parsed objects between processor instances", () => {
    const first: { configuration: string } = { configuration: "{}" };
    const second: { configuration: string } = { configuration: "{}" };

    getPipelineProcessorConfig(first)["privateMetadata"] = "first";

    expect(getPipelineProcessorConfig(second)).toEqual({});
    expect(getPipelineProcessorConfig(second)).not.toBe(
      getPipelineProcessorConfig(first),
    );
  });

  test("replaces cached parsed configuration when the raw string changes", () => {
    const processor: { configuration: string } = {
      configuration: '{"value":1}',
    };
    const first: JSONObject = getPipelineProcessorConfig(processor);
    first["compiledMetadata"] = true;
    processor.configuration = '{"value":2}';

    expect(getPipelineProcessorConfig(processor)).toEqual({ value: 2 });
    expect(getPipelineProcessorConfig(processor)).not.toBe(first);
  });

  test("refreshes across string, object and absent configuration transitions", () => {
    const processor: { configuration?: unknown } = {
      configuration: '{"value":1}',
    };
    expect(getPipelineProcessorConfig(processor)).toEqual({ value: 1 });
    const object: JSONObject = { value: 2 };
    processor.configuration = object;
    expect(getPipelineProcessorConfig(processor)).toBe(object);
    processor.configuration = { value: 3 };
    expect(getPipelineProcessorConfig(processor)).toEqual({ value: 3 });
    delete processor.configuration;
    expect(getPipelineProcessorConfig(processor)).toEqual({});
    processor.configuration = '{"value":4}';
    expect(getPipelineProcessorConfig(processor)).toEqual({ value: 4 });
  });

  test.each([
    undefined,
    null,
    false,
    true,
    0,
    10,
    "",
    "invalid json",
    "null",
    "false",
    "1",
    '"text"',
  ])("retains the empty-object fallback for %p", (raw: unknown) => {
    const processor: { configuration: unknown } = { configuration: raw };
    const first: JSONObject = getPipelineProcessorConfig(processor);
    expect(first).toEqual({});
    expect(getPipelineProcessorConfig(processor)).toBe(first);
  });

  test("does not repeatedly parse malformed JSON and accepts a later repair", () => {
    const processor: { configuration: string } = { configuration: "broken" };
    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
    for (let index: number = 0; index < 100; index++) {
      expect(getPipelineProcessorConfig(processor)).toEqual({});
    }
    expect(parse).toHaveBeenCalledTimes(1);
    processor.configuration = '{"repaired":true}';
    expect(getPipelineProcessorConfig(processor)).toEqual({ repaired: true });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  test("preserves the existing acceptance of array configurations", () => {
    const configuration: Array<string> = ["value"];
    expect(getPipelineProcessorConfig({ configuration })).toBe(configuration);
    expect(getPipelineProcessorConfig({ configuration: '["value"]' })).toEqual(
      configuration,
    );
  });

  test("works with frozen processor instances without adding properties", () => {
    const processor: Readonly<{ configuration: string }> = Object.freeze({
      configuration: '{"value":1}',
    });
    expect(getPipelineProcessorConfig(processor)).toEqual({ value: 1 });
    expect(Object.keys(processor)).toEqual(["configuration"]);
  });
});
