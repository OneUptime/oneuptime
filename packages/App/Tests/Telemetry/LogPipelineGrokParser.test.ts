import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { JSONObject } from "Common/Types/JSON";
import { clearGrokCompileCache } from "Common/Utils/Grok/Grok";
import { readOwnValue } from "Common/Utils/LookupTable";
import logger from "Common/Server/Utils/Logger";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";

/*
 * GrokParser was a defined processor type with a documented config
 * shape, a place in the API and a place in the enum - and no branch in
 * applyProcessor. A processor created with it fell through to
 * `default: return logRow`, so every log flowed past it untouched and
 * nothing said so (OneUptime/oneuptime#2515).
 *
 * These tests pin the wiring itself (the regression), then the
 * behaviour a user configuring one depends on: where the parsed fields
 * land, what happens when a line does not match, and that a broken
 * pattern degrades to "leave the log alone" instead of taking ingest
 * down with it.
 */

type ProcessorSpec = {
  processorType: string;
  configuration: JSONObject | string;
  name?: string;
};

function pipelineWith(
  processors: Array<ProcessorSpec>,
  filterQuery?: string,
): Array<LoadedPipeline> {
  return [
    {
      pipeline: { name: "test-pipeline" },
      compiledFilter: compileFilter(filterQuery || ""),
      processors: processors.map((processor: ProcessorSpec) => {
        return {
          name: processor.name || "grok",
          processorType: processor.processorType,
          configuration: processor.configuration,
        };
      }),
    },
  ] as unknown as Array<LoadedPipeline>;
}

function grokPipeline(
  configuration: JSONObject | string,
): Array<LoadedPipeline> {
  return pipelineWith([
    {
      processorType: LogPipelineProcessorType.GrokParser,
      configuration,
    },
  ]);
}

const NGINX_LINE: string =
  '10.0.1.5 - - [10/Oct/2023:13:55:36 -0700] "GET /health HTTP/1.1" 200 1234';

function logRowWithBody(body: string): JSONObject {
  return {
    body: body,
    severityText: LogSeverity.Unspecified,
    severityNumber: 0,
    attributes: { "service.name": "api" },
    attributeKeys: ["service.name"],
  };
}

describe("GrokParser processor is wired into the pipeline", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  it("extracts fields from the log body into attributes", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody(NGINX_LINE),
      grokPipeline({
        source: "body",
        pattern:
          '%{IPV4:client_ip} %{USER:ident} %{USER:auth} \\[%{HTTPDATE:ts}\\] "%{WORD:verb} %{NOTSPACE:request} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int}',
      }),
    );

    expect(out["attributes"]).toEqual({
      "service.name": "api",
      client_ip: "10.0.1.5",
      ident: "-",
      auth: "-",
      ts: "10/Oct/2023:13:55:36 -0700",
      verb: "GET",
      request: "/health",
      http_version: "1.1",
      status: 200,
      bytes: 1234,
    });
  });

  it("keeps attributeKeys in step with the attributes it added", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("level=warn msg=disk-full"),
      grokPipeline({
        source: "body",
        pattern: "level=%{WORD:level} msg=%{NOTSPACE:message}",
      }),
    );

    expect(out["attributeKeys"]).toEqual(
      expect.arrayContaining(["service.name", "level", "message"]),
    );
    expect((out["attributeKeys"] as Array<string>).sort()).toEqual(
      Object.keys(out["attributes"] as JSONObject).sort(),
    );
  });

  it("leaves the log untouched when the line does not match", () => {
    const row: JSONObject = logRowWithBody("this line has no ip address");

    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({ source: "body", pattern: "%{IPV4:client_ip}" }),
    );

    expect(out["attributes"]).toEqual({ "service.name": "api" });
    expect(out["attributeKeys"]).toEqual(["service.name"]);
  });

  it("does not mutate the row it was given", () => {
    const row: JSONObject = logRowWithBody("status=500");

    LogPipelineService.processLog(
      row,
      grokPipeline({ source: "body", pattern: "status=%{NUMBER:status:int}" }),
    );

    expect(row["attributes"]).toEqual({ "service.name": "api" });
  });

  it("only runs when the pipeline filter matches the log", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("status=500"),
      pipelineWith(
        [
          {
            processorType: LogPipelineProcessorType.GrokParser,
            configuration: {
              source: "body",
              pattern: "status=%{NUMBER:status:int}",
            },
          },
        ],
        "severityText = 'Error'",
      ),
    );

    expect(out["attributes"]).toEqual({ "service.name": "api" });
  });
});

describe("GrokParser - source field resolution", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  it("defaults to the log body when no source is configured", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("took 125ms"),
      grokPipeline({ pattern: "took %{NUMBER:duration_ms:int}ms" }),
    );

    expect((out["attributes"] as JSONObject)["duration_ms"]).toBe(125);
  });

  it("reads an attribute with the attributes. prefix", () => {
    const row: JSONObject = {
      body: "",
      attributes: { raw_line: "user=jane action=login" },
      attributeKeys: ["raw_line"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({
        source: "attributes.raw_line",
        pattern: "user=%{USERNAME:user} action=%{WORD:action}",
      }),
    );

    expect(out["attributes"]).toEqual({
      raw_line: "user=jane action=login",
      user: "jane",
      action: "login",
    });
  });

  it("reads a bare attribute key, like a filter query does", () => {
    const row: JSONObject = {
      body: "",
      attributes: { raw_line: "user=jane action=login" },
      attributeKeys: ["raw_line"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({
        source: "raw_line",
        pattern: "action=%{WORD:action}",
      }),
    );

    expect((out["attributes"] as JSONObject)["action"]).toBe("login");
  });

  it("leaves the log alone when the source field is empty or missing", () => {
    const row: JSONObject = logRowWithBody("");

    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({ source: "nosuchfield", pattern: "%{GREEDYDATA:all}" }),
    );

    expect(out["attributes"]).toEqual({ "service.name": "api" });
  });

  it("reads a source named like an Object member from the row's own fields only", () => {
    // The row has no field or attribute named constructor: nothing to parse.
    expect(
      LogPipelineService.processLog(
        logRowWithBody(""),
        grokPipeline({ source: "constructor", pattern: "%{GREEDYDATA:all}" }),
      )["attributes"],
    ).toEqual({ "service.name": "api" });

    const row: JSONObject = {
      body: "",
      attributes: { constructor: "user=jane" },
      attributeKeys: ["constructor"],
    };
    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({ source: "constructor", pattern: "user=%{USERNAME:user}" }),
    );

    expect(JSON.stringify(out["attributes"])).toBe(
      '{"constructor":"user=jane","user":"jane"}',
    );
  });
});

describe("GrokParser - target prefix", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  it("namespaces extracted fields under the prefix", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("GET /health 200"),
      grokPipeline({
        source: "body",
        pattern: "%{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}",
        targetPrefix: "http",
      }),
    );

    expect(out["attributes"]).toEqual({
      "service.name": "api",
      "http.method": "GET",
      "http.path": "/health",
      "http.status": 200,
    });
  });

  it("does not add a second separator when the prefix already ends with one", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("GET /health"),
      grokPipeline({
        source: "body",
        pattern: "%{WORD:method}",
        targetPrefix: "http_",
      }),
    );

    expect((out["attributes"] as JSONObject)["http_method"]).toBe("GET");
  });

  it("writes bare field names when no prefix is configured", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("GET /health"),
      grokPipeline({
        source: "body",
        pattern: "%{WORD:method}",
        targetPrefix: "  ",
      }),
    );

    expect((out["attributes"] as JSONObject)["method"]).toBe("GET");
  });

  it("writes fields named constructor and __proto__ as attributes", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("alpha beta"),
      grokPipeline({
        source: "body",
        pattern: "%{WORD:constructor} %{WORD:__proto__}",
      }),
    );

    expect(JSON.stringify(out["attributes"])).toBe(
      '{"service.name":"api","constructor":"alpha","__proto__":"beta"}',
    );
    expect(out["attributeKeys"]).toEqual([
      "service.name",
      "constructor",
      "__proto__",
    ]);
  });
});

/*
 * Every name an object inherits - Object.prototype's own: constructor,
 * toString, valueOf, __proto__ and the rest - as a field a pattern names
 * and as the source a processor parses. A field so named is an attribute
 * like any other; a source so named is read only from the log's own
 * fields and attributes, so a log without one has nothing to parse.
 */
describe.each(INHERITED_PROPERTY_NAMES)(
  "GrokParser - the name %s",
  (name: string) => {
    beforeEach(() => {
      clearGrokCompileCache();
    });

    it("is a field written as the log's own attribute, with the type the pattern names", () => {
      const out: JSONObject = LogPipelineService.processLog(
        logRowWithBody("alpha 42"),
        grokPipeline({
          source: "body",
          pattern: `%{WORD:${name}} %{INT:count:int}`,
        }),
      );
      const attributes: JSONObject = out["attributes"] as JSONObject;

      expect(Object.keys(attributes)).toEqual(["service.name", name, "count"]);
      expect(out["attributeKeys"]).toEqual(["service.name", name, "count"]);
      expect(readOwnValue(attributes, name)).toBe("alpha");
      expect(JSON.stringify(attributes)).toBe(
        `{"service.name":"api","${name}":"alpha","count":42}`,
      );
      // Still a plain object: the field never became its prototype.
      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);

      const typed: JSONObject = LogPipelineService.processLog(
        logRowWithBody("7"),
        grokPipeline({ source: "body", pattern: `%{INT:${name}:int}` }),
      );

      expect(readOwnValue(typed["attributes"] as JSONObject, name)).toBe(7);
    });

    it("is a field under a target prefix too", () => {
      const out: JSONObject = LogPipelineService.processLog(
        logRowWithBody("alpha"),
        grokPipeline({
          source: "body",
          pattern: `%{WORD:${name}}`,
          targetPrefix: "parsed",
        }),
      );

      expect(out["attributes"]).toEqual({
        "service.name": "api",
        [`parsed.${name}`]: "alpha",
      });
    });

    it("is a source read only from the log's own fields and attributes", () => {
      // Neither a field nor an attribute of that name: nothing to parse.
      for (const row of [
        logRowWithBody(""),
        { ...logRowWithBody(""), attributes: {}, attributeKeys: [] },
      ]) {
        expect(
          LogPipelineService.processLog(
            row,
            grokPipeline({ source: name, pattern: "%{GREEDYDATA:all}" }),
          ),
        ).toEqual(row);
        expect(
          LogPipelineService.processLog(
            row,
            grokPipeline({
              source: `attributes.${name}`,
              pattern: "%{GREEDYDATA:all}",
            }),
          ),
        ).toEqual(row);
      }

      /*
       * A top-level field of that name. Not __proto__: processLog copies the
       * row with a spread, which drops a key so named (issue #8025), and no
       * ingest writes a top-level field so named.
       */
      if (name !== "__proto__") {
        const topLevel: JSONObject = LogPipelineService.processLog(
          { ...logRowWithBody(""), [name]: "user=jane" },
          grokPipeline({ source: name, pattern: "user=%{USERNAME:user}" }),
        );

        expect(readOwnValue(topLevel["attributes"] as JSONObject, "user")).toBe(
          "jane",
        );
      }

      // Built with a computed key, so the log has it as its own, __proto__ too.
      const fromAttribute: JSONObject = LogPipelineService.processLog(
        {
          body: "",
          attributes: { [name]: "user=jane" },
          attributeKeys: [name],
        },
        grokPipeline({
          source: `attributes.${name}`,
          pattern: "user=%{USERNAME:user}",
        }),
      );

      expect(
        readOwnValue(fromAttribute["attributes"] as JSONObject, "user"),
      ).toBe("jane");
    });
  },
);

describe("GrokParser - broken configuration degrades safely", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  it("passes the log through when the pattern does not compile", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    try {
      const out: JSONObject = LogPipelineService.processLog(
        logRowWithBody("anything"),
        grokPipeline({ source: "body", pattern: "%{NOSUCHPATTERN:x}" }),
      );

      expect(out["attributes"]).toEqual({ "service.name": "api" });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs an uncompilable pattern once, not once per record", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    try {
      const pipelines: Array<LoadedPipeline> = grokPipeline({
        source: "body",
        pattern: "%{WORD:verb} (unclosed",
      });

      for (let i: number = 0; i < 25; i++) {
        LogPipelineService.processLog(logRowWithBody("GET /x"), pipelines);
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("passes the log through when the pattern is missing", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("anything"),
      grokPipeline({ source: "body" }),
    );

    expect(out["attributes"]).toEqual({ "service.name": "api" });
  });

  it("reads a configuration that was persisted as a JSON string", () => {
    /*
     * The dashboard's JSON form field has historically saved this column
     * as a JSON string literal rather than an object - see
     * LogPipelineService.normalizeProcessorConfig.
     */
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("status=418"),
      grokPipeline(
        JSON.stringify({
          source: "body",
          pattern: "status=%{NUMBER:status:int}",
        }),
      ),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBe(418);
  });

  it("refuses to parse an input over the length ceiling", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody(`status=418 ${"x".repeat(40000)}`),
      grokPipeline({ source: "body", pattern: "status=%{NUMBER:status:int}" }),
    );

    expect(out["attributes"]).toEqual({ "service.name": "api" });
  });
});

describe("GrokParser - composes with the rest of the pipeline", () => {
  beforeEach(() => {
    clearGrokCompileCache();
  });

  /*
   * Issue #8025: the parser copied the log's attributes with a spread
   * before writing its fields, which dropped an attribute named __proto__
   * the log already had - and one a first Grok parser wrote, before a
   * second one ran.
   */
  it("keeps a __proto__ attribute the log has, and one an earlier parser wrote", () => {
    const out: JSONObject = LogPipelineService.processLog(
      {
        ...logRowWithBody("alpha beta"),
        attributes: JSON.parse(
          '{"__proto__":"from-ingest","service.name":"api"}',
        ) as JSONObject,
        attributeKeys: ["__proto__", "service.name"],
      },
      pipelineWith([
        {
          name: "first",
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "body",
            pattern: "%{WORD:first} %{WORD:second}",
          },
        },
        {
          name: "second",
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "attributes.second",
            pattern: "%{WORD:third}",
          },
        },
      ]),
    );
    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(readOwnValue(attributes, "__proto__")).toBe("from-ingest");
    expect(readOwnValue(attributes, "first")).toBe("alpha");
    expect(readOwnValue(attributes, "third")).toBe("beta");
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(out["attributeKeys"]).toEqual([
      "__proto__",
      "service.name",
      "first",
      "second",
      "third",
    ]);
  });

  it("a field a first parser names __proto__ is kept by a second parser", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("alpha beta"),
      pipelineWith([
        {
          name: "first",
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "body",
            pattern: "%{WORD:__proto__} %{WORD:second}",
          },
        },
        {
          name: "second",
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "attributes.second",
            pattern: "%{WORD:third}",
          },
        },
      ]),
    );

    expect(JSON.stringify(out["attributes"])).toBe(
      '{"service.name":"api","__proto__":"alpha","second":"beta","third":"beta"}',
    );
  });

  it("feeds a severity remapper that runs after it", () => {
    const out: JSONObject = LogPipelineService.processLog(
      logRowWithBody("2023-10-10 warn disk is nearly full"),
      pipelineWith([
        {
          name: "parse",
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "body",
            pattern: "%{NOTSPACE:date} %{WORD:level} %{GREEDYDATA:message}",
          },
        },
        {
          name: "remap severity",
          processorType: LogPipelineProcessorType.SeverityRemapper,
          configuration: {
            sourceKey: "level",
            mappings: [
              {
                matchValue: "warn",
                severityText: "Warning",
                severityNumber: 13,
              },
            ],
          },
        },
      ]),
    );

    expect((out["attributes"] as JSONObject)["level"]).toBe("warn");
    expect(out["severityText"]).toBe(LogSeverity.Warning);
    expect(out["severityNumber"]).toBe(13);
  });

  it("overwrites an existing attribute of the same name", () => {
    const row: JSONObject = {
      body: "status=500",
      attributes: { status: "unknown" },
      attributeKeys: ["status"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      grokPipeline({ source: "body", pattern: "status=%{NUMBER:status:int}" }),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBe(500);
  });
});
