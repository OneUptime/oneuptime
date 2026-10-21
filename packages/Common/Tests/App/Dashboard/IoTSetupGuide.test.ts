import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import vm from "vm";
import yaml from "js-yaml";
import {
  DEFAULT_IOT_INGESTION_METHOD,
  IOT_EXAMPLE_DEVICE_ID,
  IOT_EXAMPLE_FLEET_NAME,
  IOT_EXAMPLE_GATEWAY_FLEET_NAME,
  IOT_INGESTION_METHODS,
  IOT_METRIC_CONVENTIONS,
  IOT_MQTT_TOPIC_PREFIX,
  IoTIngestionMethod,
  IoTMetricConvention,
  getIoTMqttWebSocketUrl,
  getIoTSetupGuide,
  resolveIoTIngestionMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  MQTT_DEVICE_UP_METRIC_NAME,
  MQTT_MAX_METRICS_PER_PUBLISH,
  MQTT_MAX_PAYLOAD_BYTES,
  MQTT_TOPIC_PREFIX,
  MqttMetricPoint,
  MqttPublishParseResult,
  buildOtlpMetricsBody,
  parseMqttPublish,
} from "../../../../App/FeatureSet/Telemetry/Utils/MqttTelemetryMapper";
import { IOT_SNAPSHOT_METRIC_NAMES } from "../../../Server/Utils/Telemetry/IoTSnapshotScan";
import {
  IoTMetricDefinition,
  getAllIoTMetrics,
} from "../../../Types/Monitor/IotMetricCatalog";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "../../../Types/Telemetry/TelemetryIngestSurface";
import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * The IoT guide asks how the devices send data — an OpenTelemetry SDK on
 * the device, a Collector on a gateway, or MQTT — and shows only that
 * path. These tests pin, for every option:
 *
 *   - the endpoint step 1 shows (the OTLP endpoint, or the MQTT WebSocket
 *     URL with the key as the password) and the URL and key in every
 *     snippet;
 *   - that an option shows its own instructions and none of another's —
 *     MQTT topics only on MQTT, environment variables only on the SDK;
 *   - that the examples work against the real ingest: the Node.js example
 *     is run against a stand-in client and everything it publishes goes
 *     through the MQTT ingest's own parser, and the metric names, limits,
 *     ports and paths the guide quotes are read from the code that
 *     enforces them.
 */

type YamlMap = Record<string, any>;

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const readRepoFile: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

const squash: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ");
};

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const METHOD_KEYS: Array<IoTIngestionMethod> = IOT_INGESTION_METHODS.map(
  (option: SetupGuideOption<IoTIngestionMethod>): IoTIngestionMethod => {
    return option.key;
  },
);

const OTLP_METHODS: Array<IoTIngestionMethod> = [
  "opentelemetry-sdk",
  "opentelemetry-collector",
];

const EXAMPLE_TOPIC: string = `${IOT_MQTT_TOPIC_PREFIX}/${IOT_EXAMPLE_FLEET_NAME}/${IOT_EXAMPLE_DEVICE_ID}`;

const guideFor: (
  method: IoTIngestionMethod,
  overrides?: { apiKey?: string; oneuptimeUrl?: string },
) => SetupGuideContent = (
  method: IoTIngestionMethod,
  overrides?: { apiKey?: string; oneuptimeUrl?: string },
): SetupGuideContent => {
  return getIoTSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: overrides?.apiKey ?? KEY,
    method: method,
  });
};

const stepTitled: (
  guide: SetupGuideContent,
  title: string,
) => SetupGuideStep = (
  guide: SetupGuideContent,
  title: string,
): SetupGuideStep => {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  if (!step) {
    throw new Error(`No step titled "${title}"`);
  }
  return step;
};

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

const topicTitled: (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
) => SetupGuideTopic | undefined = (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic | undefined => {
  return (topics || []).find((topic: SetupGuideTopic): boolean => {
    return topic.title === title;
  });
};

const codeBlocksOf: (markdown: string, language: string) => Array<string> = (
  markdown: string,
  language: string,
): Array<string> => {
  return Array.from(
    markdown.matchAll(
      new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, "g"),
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1] || "";
  });
};

// One publish through the MQTT ingest's own parser.
const publish: (topic: string, payload: string) => MqttPublishParseResult = (
  topic: string,
  payload: string,
): MqttPublishParseResult => {
  return parseMqttPublish({
    topic: topic,
    payload: Buffer.from(payload, "utf8"),
    nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
  });
};

const pointsOf: (result: MqttPublishParseResult) => Record<string, number> = (
  result: MqttPublishParseResult,
): Record<string, number> => {
  expect(result.error).toBeUndefined();
  const values: Record<string, number> = {};
  for (const point of result.payload?.points || []) {
    values[point.name] = point.value;
  }
  return values;
};

/*
 * Commands and settings only one option uses. An option's guide must carry
 * its own and none of the others'.
 */
const OPTION_SIGNATURES: Record<IoTIngestionMethod, Array<string>> = {
  "opentelemetry-sdk": [
    "export OTEL_EXPORTER_OTLP_HEADERS=",
    "OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name",
    "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
  ],
  "opentelemetry-collector": [
    "processors: [resource, batch]",
    "docker run -d",
    "otelcol-contrib --config config.yaml",
    "encoding: json",
  ],
  mqtt: [
    "mqtt.connect(",
    "mosquitto_pub",
    "MQTT_INGEST_PORT",
    "Device Registry",
    `${EXAMPLE_TOPIC}/telemetry`,
  ],
};

describe("the ingestion option picker", () => {
  test("offers the SDK, a gateway Collector and MQTT, SDK first", () => {
    expect(METHOD_KEYS).toEqual([
      "opentelemetry-sdk",
      "opentelemetry-collector",
      "mqtt",
    ]);
    expect(DEFAULT_IOT_INGESTION_METHOD).toBe("opentelemetry-sdk");
    expect(
      IOT_INGESTION_METHODS.map(
        (option: SetupGuideOption<IoTIngestionMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["OpenTelemetry SDK", "OpenTelemetry Collector", "MQTT"]);
  });

  test("every option has a one-line description", () => {
    for (const option of IOT_INGESTION_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
  });

  test("an unknown or retired option resolves to the SDK", () => {
    // "opentelemetry" was the single OpenTelemetry option before the split.
    for (const value of [undefined, null, "", "opentelemetry", "MQTT"]) {
      expect(resolveIoTIngestionMethod(value)).toBe("opentelemetry-sdk");
    }
    for (const method of METHOD_KEYS) {
      expect(resolveIoTIngestionMethod(method)).toBe(method);
    }
  });
});

describe.each(METHOD_KEYS)("the %s guide", (method: IoTIngestionMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);
  const isMqtt: boolean = method === "mqtt";

  test("step 1 shows the endpoint the snippets send to", () => {
    if (isMqtt) {
      expect(guide.keyStep?.endpointLabel).toBe("MQTT WebSocket URL");
      expect(guide.keyStep?.endpointValue).toBe(
        "wss://oneuptime.example.com/mqtt",
      );
      expect(guide.keyStep?.endpointHint).toContain("MQTT password");
      expect(guide.keyStep?.description).toContain("password");
    } else {
      expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
      expect(guide.keyStep?.endpointValue).toBe(`${URL}/otlp`);
      expect(guide.keyStep?.endpointHint).toBeUndefined();
      expect(guide.keyStep?.description).toContain("x-oneuptime-token");
    }
    // Rendered as plain text next to the key picker.
    for (const text of [
      guide.keyStep?.description,
      guide.keyStep?.endpointHint || "",
    ]) {
      expect(text).not.toMatch(/[`*[\]]/);
    }
  });

  test("has the option's own short steps", () => {
    const titles: Array<string> = guide.steps.map(
      (step: SetupGuideStep): string => {
        return step.title;
      },
    );
    const expected: Record<IoTIngestionMethod, Array<string>> = {
      "opentelemetry-sdk": [
        "Point the SDK at OneUptime",
        "Record readings as iot_* metrics",
        "Check the fleet appears",
      ],
      "opentelemetry-collector": [
        "Save the gateway's collector config",
        "Run the collector on the gateway",
        "Check the fleet appears",
      ],
      mqtt: ["Publish a reading", "Check the fleet appears"],
    };
    expect(titles).toEqual(expected[method]);
  });

  test("every step has a one-sentence plain-text description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      expect(step.description).not.toMatch(/[`*[\]]/);
      expect(step.description).not.toContain("\n");
      expect(step.description).toMatch(/\.$/);
    }
  });

  test("the prerequisites are two to four one-liners", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    for (const line of prerequisites) {
      expect(line).not.toContain("\n");
    }
    expect(prerequisites.join("\n")).toMatch(/network access/i);
  });

  test("shows its own instructions and none of another option's", () => {
    for (const signature of OPTION_SIGNATURES[method]) {
      expect(markdown).toContain(signature);
    }
    for (const other of METHOD_KEYS) {
      if (other === method) {
        continue;
      }
      for (const signature of OPTION_SIGNATURES[other]) {
        expect({
          other,
          signature,
          present: markdown.includes(signature),
        }).toEqual({ other, signature, present: false });
      }
    }
  });

  test("MQTT topics appear only in the MQTT guide, the OTLP header only in the OTLP ones", () => {
    expect(markdown.includes(`${IOT_MQTT_TOPIC_PREFIX}/<fleet>`)).toBe(isMqtt);
    expect(markdown.includes("x-oneuptime-token")).toBe(!isMqtt);
    expect(markdown.includes("/otlp")).toBe(!isMqtt);
  });

  test("has the model and metric conventions, and the option's own topics", () => {
    const titles: Array<string> = topicTitles(guide.advanced);
    expect(titles.slice(0, 2)).toEqual([
      "How OneUptime models IoT",
      "Metric conventions",
    ]);
    expect(titles.includes("How the gateway config works")).toBe(
      method === "opentelemetry-collector",
    );
    for (const mqttOnly of [
      "Give each device its own credential",
      "Detect offline devices with a Last Will",
      "MQTT topics and payloads",
      "Raw MQTT over TCP (self-hosted)",
    ]) {
      expect(titles.includes(mqttOnly)).toBe(isMqtt);
    }
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("troubleshooting is titled by symptom and matches the option", () => {
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles[0]).toBe("The fleet does not appear");
    expect(titles).toContain("Devices are missing from the inventory");
    expect(titles).toContain("Readings do not show on the fleet's charts");
    expect(titles.includes("HTTP 401 or 422 from the exporter")).toBe(!isMqtt);
    expect(
      titles.includes(
        'The connection is refused with "bad username or password"',
      ),
    ).toBe(isMqtt);
    expect(
      titles.includes("Devices flip to offline while they are running"),
    ).toBe(isMqtt);
  });

  test("links to documentation that exists", () => {
    const urls: Array<string> = (guide.links || []).map(
      (link: SetupGuideLink): string => {
        return link.url;
      },
    );
    expect(urls).toEqual([
      "/docs/telemetry/iot-devices",
      "/docs/monitor/iot-device-monitor",
    ]);
    for (const url of urls) {
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "packages/App/FeatureSet/Docs/Content/en",
            `${url.replace(/^\/docs\//, "")}.md`,
          ),
        ),
      ).toBe(true);
    }
  });

  test("every code fence is closed", () => {
    expect((markdown.match(/```/g) || []).length % 2).toBe(0);
  });

  test("the verify step lists the fleet, its devices and its metrics", () => {
    const verify: string =
      stepTitled(guide, "Check the fleet appears").markdown || "";
    expect(verify).toContain("open the **IoT** section");
    expect(verify).toContain("fleet's **Devices** tab");
    expect(verify).toContain("Open **Metrics** under the fleet");
    if (isMqtt) {
      expect(verify).toContain("return code 4");
    } else {
      expect(verify).toContain("HTTP `401` or `422`");
    }
  });
});

describe("the OpenTelemetry SDK option", () => {
  const guide: SetupGuideContent = guideFor("opentelemetry-sdk");
  const configure: string =
    stepTitled(guide, "Point the SDK at OneUptime").markdown || "";
  const exports: Array<string> = (codeBlocksOf(configure, "bash")[0] || "")
    .trim()
    .split("\n");

  test("sets the endpoint, protocol, key and IoT resource attributes", () => {
    expect(exports).toEqual([
      `export OTEL_EXPORTER_OTLP_ENDPOINT=${URL}/otlp`,
      "export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
      `export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${KEY}`,
      `export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=${IOT_EXAMPLE_FLEET_NAME},device.id=${IOT_EXAMPLE_DEVICE_ID},service.name=iot/${IOT_EXAMPLE_FLEET_NAME}`,
    ]);
  });

  test("names the fleet's service after the fleet", () => {
    const attributes: Record<string, string> = {};
    for (const pair of exports[3]!
      .replace("export OTEL_RESOURCE_ATTRIBUTES=", "")
      .split(",")) {
      const [key, value] = pair.split("=");
      attributes[key!] = value!;
    }
    expect(attributes["service.name"]).toBe(
      `iot/${attributes["iot.fleet.name"]}`,
    );
  });

  test("quotes values the shell would otherwise mangle", () => {
    const placeholder: string =
      codeBlocksOf(
        stepTitled(
          guideFor("opentelemetry-sdk", {
            apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
            oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
          }),
          "Point the SDK at OneUptime",
        ).markdown || "",
        "bash",
      )[0] || "";
    // < and > are redirections in an unquoted shell word.
    expect(placeholder).toContain(
      `export OTEL_EXPORTER_OTLP_ENDPOINT='${SETUP_GUIDE_URL_PLACEHOLDER}/otlp'`,
    );
    expect(placeholder).toContain(
      `export OTEL_EXPORTER_OTLP_HEADERS='x-oneuptime-token=${SETUP_GUIDE_API_KEY_PLACEHOLDER}'`,
    );
  });

  test("puts device.id on every datapoint, where the inventory reads it", () => {
    const record: string =
      stepTitled(guide, "Record readings as iot_* metrics").markdown || "";
    expect(record).toContain(
      "The device inventory is keyed on the datapoint's `device.id`, not the resource's",
    );
    for (const name of [
      "iot_device_up",
      "iot_battery_percent",
      "iot_temperature_celsius",
    ]) {
      expect(record).toContain(`| \`${name}\` |`);
      expect(IOT_SNAPSHOT_METRIC_NAMES.has(name)).toBe(true);
    }
    expect(record).toContain(`\`device.id=${IOT_EXAMPLE_DEVICE_ID}\``);
  });

  test("the OTLP endpoint is one ingest serves", () => {
    // SDKs append /v1/metrics to OTEL_EXPORTER_OTLP_ENDPOINT.
    expect(
      readRepoFile("packages/App/FeatureSet/Telemetry/API/OTelIngest.ts"),
    ).toContain('"/otlp/v1/metrics"');
  });
});

describe("the gateway Collector option", () => {
  const guide: SetupGuideContent = guideFor("opentelemetry-collector");
  const configStep: string =
    stepTitled(guide, "Save the gateway's collector config").markdown || "";
  const config: YamlMap = yaml.load(
    codeBlocksOf(configStep, "yaml")[0] || "",
  ) as YamlMap;
  const run: SetupGuideStep = stepTitled(
    guide,
    "Run the collector on the gateway",
  );

  test("receives OTLP from devices on the standard ports", () => {
    expect(config["receivers"]["otlp"]["protocols"]).toEqual({
      grpc: { endpoint: "0.0.0.0:4317" },
      http: { endpoint: "0.0.0.0:4318" },
    });
  });

  test("stamps one fleet, and the matching service, on everything it forwards", () => {
    const attributes: Array<YamlMap> =
      config["processors"]["resource"]["attributes"];
    const byKey: Record<string, YamlMap> = {};
    for (const attribute of attributes) {
      expect(attribute["action"]).toBe("upsert");
      byKey[attribute["key"]] = attribute;
    }
    expect(byKey["iot.fleet.name"]?.["value"]).toBe(
      IOT_EXAMPLE_GATEWAY_FLEET_NAME,
    );
    expect(byKey["service.name"]?.["value"]).toBe(
      `iot/${IOT_EXAMPLE_GATEWAY_FLEET_NAME}`,
    );
  });

  test("exports to OneUptime with the key", () => {
    expect(config["exporters"]["otlphttp"]).toEqual({
      endpoint: `${URL}/otlp`,
      headers: { "x-oneuptime-token": KEY },
    });
    expect(config["service"]["pipelines"]).toEqual({
      metrics: {
        receivers: ["otlp"],
        processors: ["resource", "batch"],
        exporters: ["otlphttp"],
      },
    });
  });

  test("keeps the exporter's default protobuf encoding", () => {
    // OtlpIngestDocsClaims.test.ts: no example may set the JSON encoder.
    expect(config["exporters"]["otlphttp"]["encoding"]).toBeUndefined();
    const topic: string =
      topicTitled(guide.advanced, "How the gateway config works")?.markdown ||
      "";
    expect(topic).toContain(
      "Both the default protobuf encoding and `encoding: json` are accepted.",
    );
  });

  test("runs the collector with Docker or an existing binary", () => {
    expect(
      (run.variants || []).map((variant: { label: string }): string => {
        return variant.label;
      }),
    ).toEqual(["Docker", "otelcol-contrib binary"]);

    const docker: string = run.variants![0]!.markdown;
    expect(docker).toContain("-p 4317:4317");
    expect(docker).toContain("-p 4318:4318");
    expect(docker).toContain(
      "-v $(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml:ro",
    );
    expect(docker).toContain("--config /etc/otelcol-contrib/config.yaml");

    for (const variant of run.variants || []) {
      expect(variant.markdown).toContain(
        "OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318",
      );
    }
  });
});

/*
 * The MQTT guide against the MQTT ingest itself: the Node.js example runs
 * against a stand-in client, and every topic and payload it — or any other
 * snippet — publishes goes through the parser the broker uses.
 */
describe("the MQTT option works against the real MQTT ingest", () => {
  const guide: SetupGuideContent = guideFor("mqtt");
  const markdown: string = getSetupGuideMarkdown(guide);
  const publishStep: string =
    stepTitled(guide, "Publish a reading").markdown || "";

  interface RecordedPublish {
    topic: string;
    payload: string;
  }

  interface ExampleRun {
    url: string;
    options: YamlMap;
    publishes: Array<RecordedPublish>;
  }

  const runNodeExample: () => ExampleRun = (): ExampleRun => {
    const code: string = codeBlocksOf(publishStep, "javascript")[0] || "";
    const run: ExampleRun = { url: "", options: {}, publishes: [] };
    const handlers: Record<string, () => void> = {};

    const client: YamlMap = {
      on: (event: string, handler: () => void): void => {
        handlers[event] = handler;
      },
      publish: (topic: string, payload: string): void => {
        run.publishes.push({ topic: topic, payload: payload });
      },
    };

    vm.runInNewContext(code, {
      require: (name: string): YamlMap => {
        expect(name).toBe("mqtt");
        return {
          connect: (url: string, options: YamlMap): YamlMap => {
            run.url = url;
            run.options = options;
            return client;
          },
        };
      },
    });

    expect(handlers["connect"]).toBeDefined();
    handlers["connect"]!();
    return run;
  };

  test("the guide's topic prefix is the one the broker accepts", () => {
    expect(IOT_MQTT_TOPIC_PREFIX).toBe(MQTT_TOPIC_PREFIX);
  });

  test("the Node.js example connects to the WebSocket URL with the key as the password", () => {
    const run: ExampleRun = runNodeExample();
    expect(run.url).toBe(getIoTMqttWebSocketUrl(URL));
    expect(run.options["password"]).toBe(KEY);
    /*
     * A UUID username is taken as a device credential id; the example's
     * username must not look like one, or the key would be checked as a
     * device secret.
     */
    expect(run.options["username"]).toBe("oneuptime");
    expect(run.options["username"]).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("its Last Will marks the device down", () => {
    const run: ExampleRun = runNodeExample();
    const will: YamlMap = run.options["will"];
    expect(will["topic"]).toBe(`${EXAMPLE_TOPIC}/status`);
    expect(pointsOf(publish(will["topic"], will["payload"]))).toEqual({
      [MQTT_DEVICE_UP_METRIC_NAME]: 0,
    });
  });

  test("everything it publishes is accepted", () => {
    const run: ExampleRun = runNodeExample();
    expect(
      run.publishes.map((recorded: RecordedPublish): string => {
        return recorded.topic;
      }),
    ).toEqual([`${EXAMPLE_TOPIC}/status`, `${EXAMPLE_TOPIC}/telemetry`]);

    expect(
      pointsOf(publish(run.publishes[0]!.topic, run.publishes[0]!.payload)),
    ).toEqual({ [MQTT_DEVICE_UP_METRIC_NAME]: 1 });

    expect(
      pointsOf(publish(run.publishes[1]!.topic, run.publishes[1]!.payload)),
    ).toEqual({ iot_device_up: 1, iot_temperature_celsius: 21.5 });
  });

  test("the topic sets the fleet, its service and the device, as the model says", () => {
    const result: MqttPublishParseResult = publish(
      `${EXAMPLE_TOPIC}/telemetry`,
      '{"metrics":{"iot_battery_percent":87}}',
    );
    const body: JSONObject = buildOtlpMetricsBody(result.payload!);
    const resourceMetric: JSONObject = (
      body["resourceMetrics"] as JSONArray
    )[0] as JSONObject;
    const resourceAttributes: JSONArray = (
      resourceMetric["resource"] as JSONObject
    )["attributes"] as JSONArray;
    expect(resourceAttributes).toEqual([
      { key: "iot.fleet.name", value: { stringValue: IOT_EXAMPLE_FLEET_NAME } },
      {
        key: "service.name",
        value: { stringValue: `iot/${IOT_EXAMPLE_FLEET_NAME}` },
      },
    ]);
    expect(JSON.stringify(body)).toContain(
      JSON.stringify({
        key: "device.id",
        value: { stringValue: IOT_EXAMPLE_DEVICE_ID },
      }),
    );

    const model: string =
      topicTitled(guide.advanced, "How OneUptime models IoT")?.markdown || "";
    expect(model).toContain("with MQTT the topic sets both");
    expect(model).toContain("It becomes the `iot.fleet.name` of the readings");
    expect(model).toContain("It becomes the `device.id` of every reading");
  });

  test("the documented topic and payload are accepted", () => {
    const text: string = codeBlocksOf(publishStep, "text")[0] || "";
    expect(text).toContain(
      `Topic:   ${IOT_MQTT_TOPIC_PREFIX}/<fleet>/<device>/telemetry`,
    );
    const payload: string = text.match(/Payload: (\{.*\})/)![1]!;
    expect(pointsOf(publish(`${EXAMPLE_TOPIC}/telemetry`, payload))).toEqual({
      iot_device_up: 1,
      iot_battery_percent: 87,
      iot_temperature_celsius: 21.5,
    });
  });

  test("the raw TCP example publishes the documented payload with the key", () => {
    const topic: string =
      topicTitled(guide.advanced, "Raw MQTT over TCP (self-hosted)")
        ?.markdown || "";
    const command: string = codeBlocksOf(topic, "bash")[0] || "";
    expect(command).toContain("-p 1883");
    expect(command).toContain(`-P ${KEY}`);
    const target: string = command.match(/-t "([^"]+)"/)![1]!;
    const payload: string = command.match(/-m '([^']+)'/)![1]!;
    expect(pointsOf(publish(target, payload))).toEqual({
      iot_device_up: 1,
      iot_battery_percent: 87,
      iot_temperature_celsius: 21.5,
    });
  });

  test("every topic any snippet names is one the broker accepts", () => {
    const topics: Array<string> = Array.from(
      new Set(
        Array.from(
          markdown.matchAll(/oneuptime\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z/]+/g),
        ).map((match: RegExpMatchArray): string => {
          return match[0];
        }),
      ),
    );
    expect(topics.sort()).toEqual(
      [`${EXAMPLE_TOPIC}/status`, `${EXAMPLE_TOPIC}/telemetry`].sort(),
    );
    for (const topic of topics) {
      const payload: string = topic.endsWith("/status")
        ? "online"
        : '{"metrics":{"iot_device_up":1}}';
      expect(publish(topic, payload).error).toBeUndefined();
    }
  });

  test("the topics table matches what each topic accepts", () => {
    const table: string =
      topicTitled(guide.advanced, "MQTT topics and payloads")?.markdown || "";

    // A flat object whose numeric fields are the metrics.
    expect(table).toContain(
      "a flat object whose numeric fields are the metrics",
    );
    expect(
      pointsOf(
        publish(
          `${EXAMPLE_TOPIC}/telemetry`,
          '{"iot_temperature_celsius":21.5}',
        ),
      ),
    ).toEqual({ iot_temperature_celsius: 21.5 });

    // A single value, bare or wrapped.
    expect(table).toContain('a bare number (`23.4`) or `{"value":23.4}`');
    for (const payload of ["23.4", '{"value":23.4}']) {
      expect(
        pointsOf(
          publish(`${EXAMPLE_TOPIC}/metrics/iot_temperature_celsius`, payload),
        ),
      ).toEqual({ iot_temperature_celsius: 23.4 });
    }

    // The status topic, and the alternatives the Last Will topic lists.
    const lastWill: string =
      topicTitled(guide.advanced, "Detect offline devices with a Last Will")
        ?.markdown || "";
    for (const [payload, up] of [
      ["online", 1],
      ["offline", 0],
      ["1", 1],
      ["0", 0],
      ["true", 1],
      ["false", 0],
      ["up", 1],
      ["down", 0],
    ] as Array<[string, number]>) {
      expect(pointsOf(publish(`${EXAMPLE_TOPIC}/status`, payload))).toEqual({
        [MQTT_DEVICE_UP_METRIC_NAME]: up,
      });
      if (!["online", "offline"].includes(payload)) {
        expect(lastWill).toContain(`\`${payload}\``);
      }
    }
  });

  test("attributes are stamped on every datapoint and a timestamp is honoured", () => {
    const result: MqttPublishParseResult = publish(
      `${EXAMPLE_TOPIC}/telemetry`,
      JSON.stringify({
        metrics: { iot_battery_percent: 87, iot_temperature_celsius: 21.5 },
        attributes: { "iot.device.type": "temp-sensor" },
        timestamp: 1767225600,
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.payload?.timestampMs).toBe(1767225600000);
    for (const point of result.payload!.points) {
      expect((point as MqttMetricPoint).attributes).toEqual({
        "iot.device.type": "temp-sensor",
      });
    }
  });

  test("the segment rules are the parser's", () => {
    const table: string =
      topicTitled(guide.advanced, "MQTT topics and payloads")?.markdown || "";
    expect(table).toContain(
      "must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters",
    );
    expect(ColumnLength.ShortText).toBe(100);

    const reading: string = '{"metrics":{"iot_device_up":1}}';
    for (const fleet of ["bad+fleet", "bad#fleet", "$fleet", "x".repeat(101)]) {
      expect(
        publish(`${IOT_MQTT_TOPIC_PREFIX}/${fleet}/device/telemetry`, reading)
          .error,
      ).toBeDefined();
    }
    expect(
      publish(
        `${IOT_MQTT_TOPIC_PREFIX}/${"x".repeat(100)}/device/telemetry`,
        reading,
      ).error,
    ).toBeUndefined();
  });

  test("the size limits are the parser's", () => {
    const table: string =
      topicTitled(guide.advanced, "MQTT topics and payloads")?.markdown || "";
    expect(table).toContain("capped at 128 KB and 100 metrics");
    expect(MQTT_MAX_PAYLOAD_BYTES).toBe(128 * 1024);
    expect(MQTT_MAX_METRICS_PER_PUBLISH).toBe(100);

    const tooMany: Record<string, number> = {};
    for (let index: number = 0; index <= 100; index++) {
      tooMany[`metric_${index}`] = index;
    }
    expect(
      publish(
        `${EXAMPLE_TOPIC}/telemetry`,
        JSON.stringify({ metrics: tooMany }),
      ).error,
    ).toBeDefined();
  });
});

describe("the MQTT endpoint facts match the server", () => {
  const guide: SetupGuideContent = guideFor("mqtt");
  const markdown: string = getSetupGuideMarkdown(guide);
  const telemetryConfig: string = squash(
    readRepoFile("packages/App/FeatureSet/Telemetry/Config.ts"),
  );
  const mqttServer: string = squash(
    readRepoFile("packages/App/FeatureSet/Telemetry/MqttServer.ts"),
  );

  test("the WebSocket URL is the instance URL on ws(s) at /mqtt", () => {
    expect(getIoTMqttWebSocketUrl("https://oneuptime.example.com")).toBe(
      "wss://oneuptime.example.com/mqtt",
    );
    expect(getIoTMqttWebSocketUrl("http://localhost:8080")).toBe(
      "ws://localhost:8080/mqtt",
    );
    expect(getIoTMqttWebSocketUrl(SETUP_GUIDE_URL_PLACEHOLDER)).toBe(
      `${SETUP_GUIDE_URL_PLACEHOLDER}/mqtt`,
    );
    expect(telemetryConfig).toContain(
      'export const MQTT_WEBSOCKET_PATH: string = "/mqtt";',
    );
  });

  test("the ingress closes idle WebSocket connections after 300 seconds", () => {
    const nginx: string = readRepoFile("packages/Nginx/default.conf.template");
    const start: number = nginx.indexOf("location /mqtt {");
    expect(start).toBeGreaterThan(-1);
    // The block ends where the next location begins (${...} has braces too).
    const end: number = nginx.indexOf("location ", start + 1);
    const block: string = nginx.slice(start, end === -1 ? undefined : end);
    expect(block).toContain("proxy_read_timeout 300s;");
    expect(markdown).toContain(
      "idle WebSocket connections are closed after 300 seconds",
    );
    expect(markdown).toContain("under 5 minutes");
  });

  test("raw TCP listens on MQTT_INGEST_PORT, 1883 by default, and can be turned off", () => {
    expect(telemetryConfig).toContain(
      'export const MQTT_INGEST_PORT: number = parseBatchSize( "MQTT_INGEST_PORT", 1883, );',
    );
    expect(telemetryConfig).toContain(
      'process.env["MQTT_INGEST_ENABLED"] !== "false"',
    );
    expect(readRepoFile("config.example.env")).toContain(
      "MQTT_INGEST_PORT=1883",
    );
    expect(markdown).toContain("(`MQTT_INGEST_PORT`, default `1883`)");
    expect(markdown).toContain("`MQTT_INGEST_ENABLED=false`");
  });

  test("bad credentials are refused at CONNECT with return code 4", () => {
    expect(mqttServer).toContain(
      "const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;",
    );
    expect(markdown).toContain("return code 4");
  });

  test("browser keys are refused over MQTT", () => {
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Mqtt),
    ).toBe(false);
    expect(mqttServer).toContain("surface: TelemetryIngestSurface.Mqtt,");
    expect(markdown).toContain("browser keys are refused over MQTT");
  });

  test("subscriptions are refused and bad publishes are dropped with a warning", () => {
    expect(mqttServer).toContain("broker.authorizeSubscribe =");
    expect(mqttServer).toContain("MQTT: dropped publish to");
    expect(markdown).toContain("subscriptions are refused");
    expect(markdown).toContain("`MQTT: dropped publish to …`");
  });

  test("a revoked device credential is cut off within about a minute", () => {
    expect(
      squash(
        readRepoFile(
          "packages/Common/Server/Services/IoTDeviceCredentialService.ts",
        ),
      ),
    ).toContain("const POSITIVE_TTL_MS: number = 60 * 1000;");
    expect(markdown).toContain("cut off within about a minute");
  });

  test("the fleet's Device Registry tab exists", () => {
    expect(
      readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/SideMenu.tsx",
      ),
    ).toContain('title: "Device Registry"');
  });
});

describe("the metric conventions", () => {
  const names: Array<string> = IOT_METRIC_CONVENTIONS.map(
    (metric: IoTMetricConvention): string => {
      return metric.name;
    },
  );

  test("are exactly the metrics the inventory scan reads", () => {
    expect([...names].sort()).toEqual(
      Array.from(IOT_SNAPSHOT_METRIC_NAMES).sort(),
    );
  });

  test("cover every metric the IoT monitor offers", () => {
    for (const metric of getAllIoTMetrics()) {
      expect(names).toContain((metric as IoTMetricDefinition).metricName);
    }
  });

  test("include the metric the MQTT status topic maps to", () => {
    expect(names).toContain(MQTT_DEVICE_UP_METRIC_NAME);
  });

  test.each(METHOD_KEYS)(
    "are listed in full in the %s guide",
    (method: IoTIngestionMethod) => {
      const topic: string =
        topicTitled(guideFor(method).advanced, "Metric conventions")
          ?.markdown || "";
      for (const metric of IOT_METRIC_CONVENTIONS) {
        expect(topic).toContain(`| \`${metric.name}\` | ${metric.meaning} |`);
      }
    },
  );
});

describe("the attribute model matches the ingest", () => {
  const scan: string = readRepoFile(
    "packages/Common/Server/Utils/Telemetry/IoTSnapshotScan.ts",
  );

  test("device.id and the classifying attributes are read from each datapoint", () => {
    for (const key of ["device.id", "iot.device.kind", "iot.device.type"]) {
      expect(scan).toContain(`getStringAttribute(dpAttributes, "${key}")`);
    }
    expect(squash(scan)).toContain('dpAttributes, "iot.device.firmware",');

    const model: string =
      topicTitled(
        guideFor("opentelemetry-sdk").advanced,
        "How OneUptime models IoT",
      )?.markdown || "";
    expect(model).toContain("| `device.id` | Each datapoint | Yes |");
    for (const key of [
      "iot.device.kind",
      "iot.device.type",
      "iot.device.firmware",
    ]) {
      expect(model).toContain(`| \`${key}\` | Each datapoint | No |`);
    }
  });

  test("the fleet comes from the iot.fleet.name resource attribute", () => {
    expect(
      squash(
        readRepoFile(
          "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
        ),
      ),
    ).toContain('this.getStringAttribute(attributes, "iot.fleet.name") ||');
    const model: string =
      topicTitled(
        guideFor("opentelemetry-collector").advanced,
        "How OneUptime models IoT",
      )?.markdown || "";
    expect(model).toContain("| `iot.fleet.name` | Resource | Yes |");
  });
});

describe("401 and 422 from the exporter", () => {
  test("mean what ingest answers them for", () => {
    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    const middleware: string = squash(
      readRepoFile("packages/Common/Server/Middleware/TelemetryIngest.ts"),
    );
    expect(middleware).toContain(
      'new NotAuthenticatedException( "This telemetry ingestion key expired.", )',
    );
    expect(middleware).toContain(
      'new NotAuthorizedException( "This telemetry ingestion key has been disabled.", )',
    );

    for (const method of OTLP_METHODS) {
      const topic: string =
        topicTitled(
          guideFor(method).troubleshooting,
          "HTTP 401 or 422 from the exporter",
        )?.markdown || "";
      expect(topic).toContain(
        "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled",
      );
      // Ingest never answers 403 for a key.
      expect(getSetupGuideMarkdown(guideFor(method))).not.toContain("403");
    }
  });
});

describe("before a key is picked", () => {
  test.each(METHOD_KEYS)(
    "%s shows the placeholder and says where to pick a key",
    (method: IoTIngestionMethod) => {
      const markdown: string = getSetupGuideMarkdown(
        guideFor(method, { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }),
      );
      expect(markdown).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(markdown).toContain("Pick an ingestion key in step 1");
    },
  );

  test.each(METHOD_KEYS)(
    "%s drops the note and the placeholder once a key is picked",
    (method: IoTIngestionMethod) => {
      const markdown: string = getSetupGuideMarkdown(guideFor(method));
      expect(markdown).not.toContain("Pick an ingestion key in step 1");
      expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    },
  );

  test("the MQTT snippets carry the placeholder as the password", () => {
    const markdown: string = getSetupGuideMarkdown(
      guideFor("mqtt", { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }),
    );
    expect(markdown).toContain(
      `password: "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
    // Quoted, so the shell does not read < and > as redirections.
    expect(markdown).toContain(`-P '${SETUP_GUIDE_API_KEY_PLACEHOLDER}'`);
  });

  test("the gateway config carries the placeholder as the token", () => {
    const markdown: string = getSetupGuideMarkdown(
      guideFor("opentelemetry-collector", {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      }),
    );
    expect(markdown).toContain(
      `"x-oneuptime-token": "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
  });
});
