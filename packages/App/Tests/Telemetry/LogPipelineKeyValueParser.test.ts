import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { JSONObject } from "Common/Types/JSON";
import { MAX_KEY_VALUE_INPUT_LENGTH } from "Common/Utils/Log/KeyValueParser";
import logger from "Common/Server/Utils/Logger";

/*
 * The KeyValueParser processor at ingest: a Sophos XGS or Fortinet line
 * arrives as one opaque body, and after this processor its fields are
 * attributes a filter, a facet or a log monitor's group-by can use.
 *
 * These pin the wiring (a processor type nothing runs is the shape of
 * OneUptime/oneuptime#2515), where the parsed fields land, that an
 * attribute ingest already set is not rewritten by the line's own keys,
 * and that a broken configuration degrades to "leave the log alone".
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
      pipeline: { name: "firewall-pipeline" },
      compiledFilter: compileFilter(filterQuery || ""),
      processors: processors.map((processor: ProcessorSpec) => {
        return {
          name: processor.name || "kv",
          processorType: processor.processorType,
          configuration: processor.configuration,
        };
      }),
    },
  ] as unknown as Array<LoadedPipeline>;
}

function keyValuePipeline(
  configuration: JSONObject | string,
  filterQuery?: string,
): Array<LoadedPipeline> {
  return pipelineWith(
    [
      {
        processorType: LogPipelineProcessorType.KeyValueParser,
        configuration,
      },
    ],
    filterQuery,
  );
}

const SOPHOS_IPSEC_LINE: string =
  'device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."';

const SOPHOS_SDWAN_LINE: string =
  'log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"';

const FORTINET_LINE: string =
  'date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"';

// The attributes the probe's syslog receiver stamps on every line.
function syslogRow(body: string): JSONObject {
  return {
    body: body,
    severityText: LogSeverity.Information,
    severityNumber: 9,
    attributes: {
      "syslog.hostname": "SFW",
      "networkDevice.name": "hq-firewall",
    },
    attributeKeys: ["syslog.hostname", "networkDevice.name"],
  };
}

describe("KeyValueParser processor is wired into the pipeline", () => {
  it("turns a Sophos IPsec line into attributes", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow(SOPHOS_IPSEC_LINE),
      keyValuePipeline({ source: "body" }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(attributes["log_component"]).toBe("IPSec");
    expect(attributes["con_name"]).toBe("HQ-Branch1");
    expect(attributes["status"]).toBe("Terminated");
    expect(attributes["message"]).toBe(
      "IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.",
    );
    // What ingest set is still there.
    expect(attributes["syslog.hostname"]).toBe("SFW");
    expect(attributes["networkDevice.name"]).toBe("hq-firewall");
  });

  it("stores numbers from an SD-WAN SLA line as strings", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow(SOPHOS_SDWAN_LINE),
      keyValuePipeline({ source: "body" }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(attributes["latency"]).toBe("11");
    expect(attributes["packet_loss"]).toBe("0");
    expect(attributes["sla_status"]).toBe("SLA met");
  });

  it("parses a Fortinet line", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow(FORTINET_LINE),
      keyValuePipeline({ source: "body" }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(attributes["devname"]).toBe("FG100");
    expect(attributes["vpntunnel"]).toBe("HQ-to-Branch2");
    expect(attributes["time"]).toBe("10:00:00");
  });

  it("keeps attributeKeys in step with the attributes it added", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("level=warn msg=disk-full"),
      keyValuePipeline({ source: "body" }),
    );

    expect((out["attributeKeys"] as Array<string>).sort()).toEqual(
      Object.keys(out["attributes"] as JSONObject).sort(),
    );
    expect(out["attributeKeys"]).toEqual(
      expect.arrayContaining(["syslog.hostname", "level", "msg"]),
    );
  });

  it("leaves the log untouched when the line holds no pairs", () => {
    const row: JSONObject = syslogRow("just a plain sentence");

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "body" }),
    );

    expect(out["attributes"]).toEqual(row["attributes"]);
    expect(out["attributeKeys"]).toEqual(row["attributeKeys"]);
  });

  it("does not mutate the row it was given", () => {
    const row: JSONObject = syslogRow("status=500");

    LogPipelineService.processLog(row, keyValuePipeline({ source: "body" }));

    expect(row["attributes"]).toEqual({
      "syslog.hostname": "SFW",
      "networkDevice.name": "hq-firewall",
    });
  });

  it("only runs when the pipeline filter matches the log", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=500"),
      keyValuePipeline({ source: "body" }, "severityText = 'Error'"),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBeUndefined();
  });

  it("runs when the pipeline is scoped to the firewall that sent the line", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=500"),
      keyValuePipeline(
        { source: "body" },
        "attributes.networkDevice.name = 'hq-firewall'",
      ),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBe("500");
  });
});

describe("KeyValueParser - target prefix", () => {
  it("namespaces the extracted keys under the prefix", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow('con_name="HQ-Branch1" status=down'),
      keyValuePipeline({ source: "body", targetPrefix: "sophos" }),
    );

    expect(out["attributes"]).toEqual({
      "syslog.hostname": "SFW",
      "networkDevice.name": "hq-firewall",
      "sophos.con_name": "HQ-Branch1",
      "sophos.status": "down",
    });
  });

  it("does not add a second separator when the prefix already ends with one", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=down"),
      keyValuePipeline({ source: "body", targetPrefix: "fw_" }),
    );

    expect((out["attributes"] as JSONObject)["fw_status"]).toBe("down");
  });

  it("writes bare keys when the prefix is blank", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=down"),
      keyValuePipeline({ source: "body", targetPrefix: "  " }),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBe("down");
  });
});

describe("KeyValueParser - attributes the log already has", () => {
  it("does not overwrite an existing attribute by default", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow('networkDevice.name="spoofed" status=down'),
      keyValuePipeline({ source: "body" }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(attributes["networkDevice.name"]).toBe("hq-firewall");
    expect(attributes["status"]).toBe("down");
  });

  it("overwrites an existing attribute when overrideOnConflict is set", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow('networkDevice.name="renamed" status=down'),
      keyValuePipeline({ source: "body", overrideOnConflict: true }),
    );

    expect((out["attributes"] as JSONObject)["networkDevice.name"]).toBe(
      "renamed",
    );
  });

  it("checks the prefixed key, so a prefix avoids the collision", () => {
    const row: JSONObject = {
      body: "status=down",
      attributes: { status: "from-ingest" },
      attributeKeys: ["status"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "body", targetPrefix: "fw" }),
    );

    expect(out["attributes"]).toEqual({
      status: "from-ingest",
      "fw.status": "down",
    });
  });

  it("returns the row unchanged when every key already exists", () => {
    const row: JSONObject = {
      body: "status=down",
      attributes: { status: "from-ingest" },
      attributeKeys: ["status"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "body" }),
    );

    expect(out["attributes"]).toEqual({ status: "from-ingest" });
  });

  it("treats an inherited property name as a free key", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("constructor=x toString=y"),
      keyValuePipeline({ source: "body" }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(
      Object.prototype.hasOwnProperty.call(attributes, "constructor"),
    ).toBe(true);
    expect(attributes["constructor"]).toBe("x");
    expect(attributes["toString"]).toBe("y");
  });

  it("keeps the first value of a key the line repeats", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow('con_name="first" con_name="second"'),
      keyValuePipeline({ source: "body" }),
    );

    expect((out["attributes"] as JSONObject)["con_name"]).toBe("first");
  });
});

describe("KeyValueParser - source field and delimiters", () => {
  it("defaults to the log body when no source is configured", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=down"),
      keyValuePipeline({}),
    );

    expect((out["attributes"] as JSONObject)["status"]).toBe("down");
  });

  it("reads an attribute with the attributes. prefix", () => {
    const row: JSONObject = {
      body: "",
      attributes: { raw_line: "user=jane action=login" },
      attributeKeys: ["raw_line"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "attributes.raw_line" }),
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
      attributes: { raw_line: "user=jane" },
      attributeKeys: ["raw_line"],
    };

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "raw_line" }),
    );

    expect((out["attributes"] as JSONObject)["user"]).toBe("jane");
  });

  it("leaves the log alone when the source field is missing", () => {
    const row: JSONObject = syslogRow("status=down");

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "nosuchfield" }),
    );

    expect(out["attributes"]).toEqual(row["attributes"]);
  });

  it("uses configured pair and key-value delimiters", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("user: jane; action: log in"),
      keyValuePipeline({
        source: "body",
        pairDelimiter: ";",
        keyValueDelimiter: ":",
      }),
    );

    const attributes: JSONObject = out["attributes"] as JSONObject;

    expect(attributes["user"]).toBe("jane");
    expect(attributes["action"]).toBe("log in");
  });

  it("refuses to parse an input over the length ceiling", () => {
    const row: JSONObject = syslogRow(
      `status=500 ${"x".repeat(MAX_KEY_VALUE_INPUT_LENGTH)}`,
    );

    const out: JSONObject = LogPipelineService.processLog(
      row,
      keyValuePipeline({ source: "body" }),
    );

    expect(out["attributes"]).toEqual(row["attributes"]);
  });
});

describe("KeyValueParser - broken configuration degrades safely", () => {
  it("passes the log through when the delimiters do not validate", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    try {
      const row: JSONObject = syslogRow("a=1 b=2");

      const out: JSONObject = LogPipelineService.processLog(
        row,
        keyValuePipeline({ source: "body", pairDelimiter: "=" }),
      );

      expect(out["attributes"]).toEqual(row["attributes"]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs an invalid configuration once, not once per record", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    try {
      const pipelines: Array<LoadedPipeline> = keyValuePipeline({
        source: "body",
        pairDelimiter: "",
      });

      for (let i: number = 0; i < 25; i++) {
        LogPipelineService.processLog(syslogRow("a=1"), pipelines);
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reads a configuration that was persisted as a JSON string", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow("status=418"),
      keyValuePipeline(JSON.stringify({ source: "body", targetPrefix: "x" })),
    );

    expect((out["attributes"] as JSONObject)["x.status"]).toBe("418");
  });
});

describe("KeyValueParser - composes with the rest of the pipeline", () => {
  it("feeds a severity remapper that runs after it", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow('severity="Warning" con_name="HQ-Branch1"'),
      pipelineWith([
        {
          name: "parse",
          processorType: LogPipelineProcessorType.KeyValueParser,
          configuration: { source: "body" },
        },
        {
          name: "remap severity",
          processorType: LogPipelineProcessorType.SeverityRemapper,
          configuration: {
            sourceKey: "severity",
            mappings: [
              {
                matchValue: "Warning",
                severityText: "Warning",
                severityNumber: 13,
              },
            ],
          },
        },
      ]),
    );

    expect(out["severityText"]).toBe(LogSeverity.Warning);
    expect(out["severityNumber"]).toBe(13);
  });

  it("feeds a category processor whose filter reads a parsed field", () => {
    const out: JSONObject = LogPipelineService.processLog(
      syslogRow(SOPHOS_IPSEC_LINE),
      pipelineWith([
        {
          name: "parse",
          processorType: LogPipelineProcessorType.KeyValueParser,
          configuration: { source: "body" },
        },
        {
          name: "categorise",
          processorType: LogPipelineProcessorType.CategoryProcessor,
          configuration: {
            targetKey: "category",
            categories: [
              {
                name: "VPN tunnel down",
                filterQuery:
                  "attributes.log_component = 'IPSec' AND attributes.status = 'Terminated'",
              },
            ],
          },
        },
      ]),
    );

    expect((out["attributes"] as JSONObject)["category"]).toBe(
      "VPN tunnel down",
    );
  });
});
