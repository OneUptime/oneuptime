import HostCollectorConfigPolicy, {
  ConfigReference,
  HostCollectorConfigCheckResult,
  HostCollectorConfigProblem,
  findConfigReferences,
  getComponentTypeFromId,
  getReferencedEnvironmentVariable,
  isEnvironmentVariableName,
} from "../../../../Server/Utils/HostCollector/HostCollectorConfigPolicy";
import { HOST_COLLECTOR_CONFIG_MAX_BYTES } from "../../../../Types/HostCollector/HostCollector";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * A Collector Config runs on every host it applies to, as the user the
 * installer gave the collector, so what it may do is checked on every save,
 * before OneUptime sends it anywhere: read the host and the services on it,
 * and send that to this OneUptime with the host's own key - nothing a config
 * could use to run a program, send a file off the host, or send anything
 * anywhere else.
 */

const EXPORTER: string = `exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`;

const PIPELINE: string = `service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      processors: [batch]
      exporters: [otlp_http/oneuptime]`;

// A config with one receiver, one processor, and the exporter to OneUptime.
function configWith(parts: {
  receivers?: string;
  processors?: string;
  exporters?: string;
  extensions?: string;
  connectors?: string;
  service?: string;
}): string {
  return [
    `receivers:\n${parts.receivers ?? "  host_metrics:\n    collection_interval: 30s"}`,
    `processors:\n${parts.processors ?? "  batch:"}`,
    parts.exporters ?? EXPORTER,
    parts.extensions ? `extensions:\n${parts.extensions}` : "",
    parts.connectors ? `connectors:\n${parts.connectors}` : "",
    parts.service ?? PIPELINE,
  ]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join("\n");
}

function check(text: string): HostCollectorConfigCheckResult {
  return HostCollectorConfigPolicy.check(text);
}

function problemsOf(text: string): Array<HostCollectorConfigProblem> {
  return check(text).problems;
}

function expectRefused(text: string, path: string, message?: string): void {
  const problems: Array<HostCollectorConfigProblem> = problemsOf(text);
  const atPath: Array<HostCollectorConfigProblem> = problems.filter(
    (problem: HostCollectorConfigProblem): boolean => {
      return problem.path === path;
    },
  );

  expect(check(text).isValid).toBe(false);
  expect(atPath.length).toBeGreaterThan(0);

  if (message) {
    expect(
      atPath.some((problem: HostCollectorConfigProblem): boolean => {
        return problem.message.includes(message);
      }),
    ).toBe(true);
  }
}

function expectAllowed(text: string): void {
  expect(problemsOf(text)).toEqual([]);
  expect(check(text).isValid).toBe(true);
}

describe("a config that only reads the host and sends to OneUptime", () => {
  test("is allowed", () => {
    expectAllowed(configWith({}));
  });

  test("may use the names older collector releases gave components", () => {
    expectAllowed(
      configWith({
        receivers: "  hostmetrics:\n    collection_interval: 10s",
        processors: "  resourcedetection:\n    detectors: [system]\n  batch:",
        exporters: `exporters:
  otlphttp:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`,
        service: `service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp]`,
      }),
    );
  });

  test("may read log files, its own environment variables, and use TLS files for a handshake", () => {
    expectAllowed(
      configWith({
        receivers: `  host_metrics:
    collection_interval: 30s
  file_log/app:
    include: [/var/log/app/*.log]
    start_at: end
  postgresql:
    endpoint: localhost:5432
    username: \${env:PG_USER}
    password: \${env:PG_PASSWORD:-}
    tls:
      ca_file: /etc/ssl/certs/ca.pem
      cert_file: /etc/ssl/client.pem
      key_file: /etc/ssl/client.key`,
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics, postgresql]
      exporters: [otlp_http/oneuptime]
    logs/app:
      receivers: [file_log/app]
      exporters: [otlp_http/oneuptime]`,
      }),
    );
  });

  test("may keep a literal $ ($$) and a $ that starts nothing (a regular expression's end)", () => {
    expectAllowed(
      configWith({
        processors: `  filter:
    logs:
      log_record:
        - 'IsMatch(body, "price: $$5")'
        - 'IsMatch(body, "done$")'
  batch:`,
      }),
    );
  });

  test("may set the collector's own log and metric levels", () => {
    expectAllowed(
      configWith({
        service: `${PIPELINE}
  telemetry:
    logs:
      level: debug
    metrics:
      level: basic`,
      }),
    );
  });

  test("may use connectors between its pipelines, and the debug exporter beside OneUptime", () => {
    expectAllowed(
      configWith({
        exporters: `${EXPORTER}
  debug:
    verbosity: basic`,
        connectors: "  forward:",
        service: `service:
  pipelines:
    logs/in:
      receivers: [journald]
      exporters: [forward]
    logs/out:
      receivers: [forward]
      exporters: [otlp_http/oneuptime, debug]`,
        receivers: "  journald:\n    priority: info",
      }),
    );
  });

  test("may turn on health_check and file_storage extensions it names in service.extensions", () => {
    expectAllowed(
      configWith({
        extensions: "  health_check:\n  file_storage:",
        service: `${PIPELINE}
  extensions: [health_check, file_storage]`,
      }),
    );
  });
});

describe("components a config may not use", () => {
  test.each([
    ["receiver_creator", "receivers"],
    ["sql_query", "receivers"],
    ["sqlquery", "receivers"],
    ["prometheus", "receivers"],
    ["k8s_cluster", "receivers"],
    ["k8s_events", "receivers"],
    ["aws_cloudwatch", "receivers"],
    ["azure_monitor", "receivers"],
    ["google_cloud_pubsub", "receivers"],
    ["exec", "receivers"],
    ["k8s_attributes", "processors"],
    ["remotetap", "processors"],
    ["pprof", "extensions"],
    ["zpages", "extensions"],
    ["opamp", "extensions"],
    ["basicauth", "extensions"],
    ["bearertokenauth", "extensions"],
  ])("the %s component (%s)", (type: string, section: string) => {
    const settings: string = `  ${type}:\n    endpoint: localhost:1`;
    const text: string =
      section === "receivers"
        ? configWith({ receivers: `  host_metrics:\n${settings}` })
        : section === "processors"
          ? configWith({ processors: `  batch:\n${settings}` })
          : configWith({ extensions: settings });

    expectRefused(
      text,
      `${section}.${type}`,
      "is not one a config OneUptime sends to hosts may use",
    );
  });

  test.each([
    ["otlp", "grpc to any address"],
    ["file", "a file on the host"],
    ["kafka", "a Kafka broker"],
    ["prometheusremotewrite", "a Prometheus server"],
    ["loki", "a Loki server"],
    ["otlp_grpc", "grpc to any address"],
  ])("the %s exporter, which would send %s", (type: string) => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
  ${type}:
    endpoint: https://elsewhere.example.com`,
      }),
      `exporters.${type}`,
      "is not one a config OneUptime sends to hosts may use",
    );
  });

  test("a receiver's name is not allowed as an exporter, nor the other way round", () => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
  host_metrics:`,
      }),
      "exporters.host_metrics",
    );
    expectRefused(
      configWith({
        receivers: `  host_metrics:
  otlp_http:`,
      }),
      "receivers.otlp_http",
    );
  });

  test("a component's name may not start or end with a space", () => {
    expectRefused(
      configWith({
        receivers: `  host_metrics:
  " file_log":`,
      }),
      "receivers. file_log",
      "may not start or end with a space",
    );
  });
});

describe("where data may go", () => {
  test.each([
    ["an address of its own", "https://elsewhere.example.com/otlp"],
    ["this OneUptime's URL written out", "https://oneuptime.com/otlp"],
    ["the URL without /otlp", "${env:ONEUPTIME_URL}"],
    ["another variable", "${env:SOMEWHERE}/otlp"],
    ["a path after /otlp", "${env:ONEUPTIME_URL}/otlp/../x"],
  ])(
    "an otlphttp exporter may not send to %s",
    (_label: string, endpoint: string) => {
      expectRefused(
        configWith({
          exporters: `exporters:
  otlp_http/oneuptime:
    endpoint: ${endpoint}
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`,
        }),
        "exporters.otlp_http/oneuptime.endpoint",
        "sends only to this OneUptime",
      );
    },
  );

  test("an otlphttp exporter with no endpoint is refused", () => {
    expectRefused(
      configWith({
        exporters: `exporters:
  otlp_http/oneuptime:
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.otlp_http/oneuptime.endpoint",
    );
  });

  test.each([
    ["traces_endpoint"],
    ["metrics_endpoint"],
    ["logs_endpoint"],
    ["profiles_endpoint"],
    ["auth"],
  ])("an otlphttp exporter may not set %s", (setting: string) => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
    ${setting}: https://elsewhere.example.com/v1/x`,
      }),
      `exporters.otlp_http/oneuptime.${setting}`,
      "would send data somewhere else",
    );
  });

  test.each([
    ["no header", "    headers: {}"],
    ["a key written out", "    headers:\n      x-oneuptime-token: abc-123"],
    [
      "another variable",
      "    headers:\n      x-oneuptime-token: ${env:OTHER_KEY}",
    ],
  ])(
    "an otlphttp exporter with %s for its token is refused",
    (_label: string, headers: string) => {
      expectRefused(
        configWith({
          exporters: `exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
${headers}`,
        }),
        "exporters.otlp_http/oneuptime.headers.x-oneuptime-token",
        "each host sends with the key it was installed with",
      );
    },
  );

  test("a config with no pipeline sending to OneUptime is refused", () => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
  debug:`,
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      exporters: [debug]`,
      }),
      "service.pipelines",
      "No pipeline sends to OneUptime",
    );
  });
});

describe("the host's key stays where it belongs", () => {
  test("anywhere but the token header of an otlphttp exporter", () => {
    expectRefused(
      configWith({
        processors: `  attributes:
    actions:
      - key: leaked
        value: \${env:ONEUPTIME_INGESTION_KEY}
        action: insert
  batch:`,
      }),
      "processors.attributes.actions[0].value",
      "may only be the x-oneuptime-token header of an exporter",
    );
  });

  test("inside a longer text, even in the header", () => {
    expectRefused(
      configWith({
        exporters: `exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: Bearer \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.otlp_http/oneuptime.headers.x-oneuptime-token",
    );
  });

  test("in another header of the exporter", () => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
      x-copy: \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.otlp_http/oneuptime.headers.x-copy",
    );
  });

  test("in a setting whose name only reads like the header", () => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
    x.headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.otlp_http/oneuptime.x.headers.x-oneuptime-token",
      "may only be the x-oneuptime-token header of an exporter",
    );
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
    "a.headers.x-oneuptime-token": \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.otlp_http/oneuptime.a.headers.x-oneuptime-token",
      "may only be the x-oneuptime-token header of an exporter",
    );
  });

  test("in the headers of an exporter that is not otlphttp", () => {
    expectRefused(
      configWith({
        exporters: `${EXPORTER}
  debug:
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}`,
      }),
      "exporters.debug.headers.x-oneuptime-token",
    );
  });

  test("as a list item under the header", () => {
    expectRefused(
      configWith({
        exporters: `exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: ["\${env:ONEUPTIME_INGESTION_KEY}"]`,
      }),
      "exporters.otlp_http/oneuptime.headers.x-oneuptime-token[0]",
    );
  });

  test("in a key", () => {
    expectRefused(
      configWith({
        processors: `  attributes:
    \${env:ONEUPTIME_INGESTION_KEY}: x
  batch:`,
      }),
      "processors.attributes.${env:ONEUPTIME_INGESTION_KEY}",
    );
  });

  test("bare, as $ONEUPTIME_INGESTION_KEY", () => {
    expectRefused(
      configWith({
        processors: `  resource:
    attributes:
      - key: k
        value: $ONEUPTIME_INGESTION_KEY
        action: upsert
  batch:`,
      }),
      "processors.resource.attributes[0].value",
    );
  });
});

describe("what a config may read", () => {
  test.each([
    ["a file", "${file:/etc/shadow}"],
    ["an address", "${https://attacker.example.com/x}"],
    ["an address by scheme", "${http:attacker.example.com}"],
    ["a secret store", "${s3:bucket/key}"],
    ["a variable whose default reads a file", "${env:X:-${file:/etc/passwd}}"],
    ["an unclosed reference to a file", "${file:/etc/passwd"],
    ["a reference that hides another", "${env:HOME ${file:/etc/passwd}"],
    ["a name that is not one", "${env:1BAD}"],
    ["a scheme with a default", "${file:/x:-y}"],
  ])("refuses %s", (_label: string, value: string) => {
    expectRefused(
      configWith({
        processors: `  resource:
    attributes:
      - key: k
        value: "${value}"
        action: upsert
  batch:`,
      }),
      "processors.resource.attributes[0].value",
      "The only ${...} a config OneUptime sends may use is ${env:NAME}",
    );
  });

  test.each([
    ["${env:DB_PASSWORD}"],
    ["${DB_PASSWORD}"],
    ["${env:DB_PASSWORD:-fallback}"],
    ["${DB_PASSWORD:-fallback}"],
    ["$DB_PASSWORD"],
    ["prefix-${env:A}-${env:B}-suffix"],
  ])("allows %p", (value: string) => {
    expectAllowed(
      configWith({
        processors: `  resource:
    attributes:
      - key: k
        value: "${value}"
        action: upsert
  batch:`,
      }),
    );
  });

  test.each([
    ["journald", "journalctl_path", "/usr/bin/curl"],
    ["journald", "root_path", "/"],
  ])(
    "refuses %s's %s, which would run a program",
    (component: string, setting: string, value: string) => {
      expectRefused(
        configWith({
          receivers: `  host_metrics:
  ${component}:
    ${setting}: ${value}`,
        }),
        `receivers.${component}.${setting}`,
        "This setting is not allowed in a config OneUptime sends to hosts.",
      );
    },
  );

  test("refuses a file_storage directory of its own choosing", () => {
    expectRefused(
      configWith({
        extensions: "  file_storage:\n    directory: /etc",
      }),
      "extensions.file_storage.directory",
    );
  });

  test.each([
    ["password_file", "receivers.postgresql.password_file"],
    ["bearer_token_file", "receivers.postgresql.bearer_token_file"],
    ["credentials_files", "receivers.postgresql.credentials_files"],
    ["file_sd_configs", "receivers.postgresql.file_sd_configs"],
    ["http_sd_configs", "receivers.postgresql.http_sd_configs"],
  ])(
    "refuses %s, which sends what a file holds",
    (setting: string, path: string) => {
      expectRefused(
        configWith({
          receivers: `  host_metrics:
  postgresql:
    ${setting}: /etc/secret`,
        }),
        path,
        "Settings that read a file and send its contents are not allowed",
      );
    },
  );

  test("a nested file setting is refused too", () => {
    expectRefused(
      configWith({
        receivers: `  host_metrics:
  postgresql:
    auth:
      token_file: /etc/secret`,
      }),
      "receivers.postgresql.auth.token_file",
    );
  });
});

describe("the service section", () => {
  test("may only set the collector's own log and metric levels", () => {
    expectRefused(
      configWith({
        service: `${PIPELINE}
  telemetry:
    logs:
      level: info
      output_paths: [/etc/cron.d/x]`,
      }),
      "service.telemetry.logs",
      "may only set service.telemetry.logs.level",
    );
    expectRefused(
      configWith({
        service: `${PIPELINE}
  telemetry:
    metrics:
      readers:
        - periodic:
            exporter:
              otlp:
                endpoint: https://elsewhere.example.com`,
      }),
      "service.telemetry.metrics",
    );
    expectRefused(
      configWith({
        service: `${PIPELINE}
  telemetry:
    traces:
      level: basic`,
      }),
      "service.telemetry.traces",
    );
  });

  test("has pipelines, extensions and telemetry only", () => {
    expectRefused(
      configWith({
        service: `${PIPELINE}
  something: else`,
      }),
      "service.something",
      "Unknown setting",
    );
  });

  test("names extensions it defines", () => {
    expectRefused(
      configWith({
        service: `${PIPELINE}
  extensions: [health_check]`,
      }),
      "service.extensions[0]",
      "This extension is not defined under extensions.",
    );
  });

  test("needs at least one pipeline", () => {
    expectRefused(
      configWith({ service: "service:\n  pipelines: {}" }),
      "service.pipelines",
      "needs at least one pipeline",
    );
    expectRefused(
      configWith({ service: "service:\n  telemetry: {}" }),
      "service.pipelines",
    );
  });

  test("a pipeline is named after what it carries", () => {
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    events:
      receivers: [host_metrics]
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.events",
      "A pipeline is named after what it carries",
    );
  });

  test("a pipeline names components the config defines", () => {
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics, docker_stats]
      processors: [batch, transform]
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.metrics.receivers[1]",
      "docker_stats is not defined under receivers or connectors.",
    );
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      processors: [transform]
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.metrics.processors[0]",
      "transform is not defined under processors.",
    );
  });

  test("a pipeline needs receivers and exporters, as lists of names", () => {
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.metrics.receivers",
      "This list is required.",
    );
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: host_metrics
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.metrics.receivers",
      "This must be a list of component names.",
    );
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      exporters: []`,
      }),
      "service.pipelines.metrics.exporters",
    );
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: [{ a: 1 }]
      exporters: [otlp_http/oneuptime]`,
      }),
      "service.pipelines.metrics.receivers[0]",
      "This must be a component name.",
    );
  });

  test("a pipeline has receivers, processors and exporters only", () => {
    expectRefused(
      configWith({
        service: `service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      exporters: [otlp_http/oneuptime]
      extra: [x]`,
      }),
      "service.pipelines.metrics.extra",
    );
  });
});

describe("the shape of a config", () => {
  test.each([
    ["empty", ""],
    ["only spaces", "   \n  "],
  ])("an %s config is refused", (_label: string, text: string) => {
    expect(problemsOf(text)).toEqual([
      { path: "", message: "The config is empty." },
    ]);
  });

  test("text that is not YAML is refused, saying why", () => {
    const problems: Array<HostCollectorConfigProblem> = problemsOf(
      "receivers: [unclosed",
    );

    expect(problems.length).toBe(1);
    expect(problems[0]?.message).toMatch(/^The config is not valid YAML: /);
  });

  test.each([
    ["a list", "- a\n- b"],
    ["a number", "42"],
    ["a string", "hello"],
  ])("YAML that is %s is not a config", (_label: string, text: string) => {
    expect(problemsOf(text)[0]?.message).toBe(
      "The config must be a YAML map with receivers, processors, exporters and service.",
    );
  });

  test("an unknown top-level section is refused", () => {
    expectRefused(
      `${configWith({})}\nextras:\n  a: 1`,
      "extras",
      "Unknown section",
    );
  });

  test("a component section must be a map, and the service section is required", () => {
    expectRefused(
      `receivers: [host_metrics]\n${EXPORTER}\n${PIPELINE}`,
      "receivers",
      "This section must be a map of components.",
    );
    expectRefused(
      `receivers:\n  host_metrics:\n${EXPORTER}`,
      "service",
      "needs a service section",
    );
  });

  test("a component's settings must be a map", () => {
    expectRefused(
      configWith({ receivers: "  host_metrics: [1, 2]" }),
      "receivers.host_metrics",
      "A component's settings must be a map.",
    );
  });

  test("YAML anchors and aliases are refused rather than read twice", () => {
    expectRefused(
      configWith({
        receivers: `  host_metrics: &settings
    collection_interval: 30s
  file_log: *settings`,
      }),
      "receivers.file_log",
      "YAML anchors and aliases are not supported",
    );
  });

  test("a merge key is refused like any alias", () => {
    expect(
      check(
        configWith({
          receivers: `  host_metrics: &settings
    collection_interval: 30s
  file_log:
    <<: *settings`,
        }),
      ).isValid,
    ).toBe(false);
  });

  test("a config larger than the limit is refused before it is read", () => {
    const text: string = `${configWith({})}\n# ${"x".repeat(
      HOST_COLLECTOR_CONFIG_MAX_BYTES,
    )}`;

    expect(problemsOf(text)).toEqual([
      {
        path: "",
        message: `The config is larger than ${Math.round(
          HOST_COLLECTOR_CONFIG_MAX_BYTES / 1024,
        )} KB.`,
      },
    ]);
  });

  test("a config nested too deeply is refused", () => {
    let nested: string = "x: 1";
    for (let level: number = 0; level < 40; level++) {
      nested = `a${level}:\n${nested
        .split("\n")
        .map((line: string): string => {
          return `  ${line}`;
        })
        .join("\n")}`;
    }

    const text: string = configWith({
      receivers: `  host_metrics:\n${nested
        .split("\n")
        .map((line: string): string => {
          return `    ${line}`;
        })
        .join("\n")}`,
    });

    expect(
      problemsOf(text).some((problem: HostCollectorConfigProblem): boolean => {
        return problem.message.includes("nests settings too deeply");
      }),
    ).toBe(true);
  });

  test("a config with too many settings is refused", () => {
    const items: string = Array.from({ length: 60000 }, (): string => {
      return "1";
    }).join(",");

    expect(
      problemsOf(
        configWith({
          receivers: `  file_log:\n    include: [${items}]`,
        }),
      ),
    ).toContainEqual({
      path: "",
      message: "This config has too many settings to check.",
    });
  });
});

describe("one message for every problem", () => {
  test("the first five, each with where it is, and how many more", () => {
    const problems: Array<HostCollectorConfigProblem> = [
      { path: "a", message: "One." },
      { path: "", message: "Two." },
      { path: "c", message: "Three." },
      { path: "d", message: "Four." },
      { path: "e", message: "Five." },
      { path: "f", message: "Six." },
      { path: "g", message: "Seven." },
    ];

    expect(HostCollectorConfigPolicy.describeProblems(problems)).toBe(
      "a: One. Two. c: Three. d: Four. e: Five. and 2 more problems.",
    );
    expect(HostCollectorConfigPolicy.describeProblems(problems, 6)).toBe(
      "a: One. Two. c: Three. d: Four. e: Five. f: Six. and 1 more problem.",
    );
    expect(HostCollectorConfigPolicy.describeProblems([])).toBe("");
  });
});

describe("the ${...} a config refers to", () => {
  test("every reference a collector would expand is found, in order", () => {
    expect(
      findConfigReferences(
        "a ${env:ONE} b $$ c $TWO d ${THREE:-x} e $ f $1 ${unclosed",
      ),
    ).toEqual([
      { body: "env:ONE", isBraced: true },
      { body: "TWO", isBraced: false },
      { body: "THREE:-x", isBraced: true },
      { body: "unclosed", isBraced: true },
    ]);
  });

  test.each([
    [{ body: "env:NAME", isBraced: true }, "NAME"],
    [{ body: "NAME", isBraced: true }, "NAME"],
    [{ body: "env:NAME:-default", isBraced: true }, "NAME"],
    [{ body: "NAME:-default", isBraced: true }, "NAME"],
    [{ body: "NAME", isBraced: false }, "NAME"],
    [{ body: "file:/etc/passwd", isBraced: true }, null],
    [{ body: "env:NAME:-${file:/x}", isBraced: true }, null],
    [{ body: "env:", isBraced: true }, null],
    [{ body: "env:A-B", isBraced: true }, null],
    [{ body: "https://x", isBraced: true }, null],
  ])(
    "%p reads the variable %p",
    (reference: ConfigReference, expected: string | null) => {
      expect(getReferencedEnvironmentVariable(reference)).toBe(expected);
    },
  );

  test("an environment variable's name is a letter or _, then letters, digits and _", () => {
    expect(isEnvironmentVariableName("_A1")).toBe(true);
    expect(isEnvironmentVariableName("a")).toBe(true);
    expect(isEnvironmentVariableName("1A")).toBe(false);
    expect(isEnvironmentVariableName("A-B")).toBe(false);
    expect(isEnvironmentVariableName("")).toBe(false);
    expect(isEnvironmentVariableName("A".repeat(129))).toBe(false);
  });

  test("a component's type is the part of its name before the slash", () => {
    expect(getComponentTypeFromId("file_log/app")).toBe("file_log");
    expect(getComponentTypeFromId("file_log")).toBe("file_log");
    expect(getComponentTypeFromId("a/b/c")).toBe("a");
  });
});

describe("a config built to be slow is checked quickly", () => {
  const LENGTH: number = 400000;

  const timeOf: (run: () => unknown) => number = (
    run: () => unknown,
  ): number => {
    const result: FastestRun<unknown> = fastestRun({
      run: run,
      limitInMs: 2000,
    });
    return result.inMs;
  };

  test.each([
    ["dollar signs", "$".repeat(LENGTH)],
    ["unclosed references", "${".repeat(LENGTH / 2)],
    ["bare names", "$a".repeat(LENGTH / 2)],
    ["literal dollars", "$$".repeat(LENGTH / 2)],
    ["references with defaults", "${a:-".repeat(LENGTH / 5)],
  ])("finding references in %s", (_label: string, text: string) => {
    expect(
      timeOf(() => {
        return findConfigReferences(text);
      }),
    ).toBeLessThan(2000);
  });

  test("checking a config as large as one may be, made of references", () => {
    const value: string = "${env:A}".repeat(
      Math.floor((HOST_COLLECTOR_CONFIG_MAX_BYTES - 2000) / 8),
    );
    const text: string = configWith({
      processors: `  resource:
    attributes:
      - key: k
        value: "${value}"
        action: upsert
  batch:`,
    });

    expect(
      timeOf(() => {
        return HostCollectorConfigPolicy.check(text);
      }),
    ).toBeLessThan(2000);
    expect(HostCollectorConfigPolicy.check(text).isValid).toBe(true);
  });

  test("checking a config as large as one may be, made of settings", () => {
    const lines: Array<string> = [];
    let size: number = 0;
    let index: number = 0;
    while (size < HOST_COLLECTOR_CONFIG_MAX_BYTES - 4000) {
      const line: string = `    s${index}: \${env:V${index}}`;
      lines.push(line);
      size += line.length + 1;
      index++;
    }

    const text: string = configWith({
      receivers: `  host_metrics:\n  file_log:\n${lines.join("\n")}`,
    });

    expect(
      timeOf(() => {
        return HostCollectorConfigPolicy.check(text);
      }),
    ).toBeLessThan(2000);
  });
});
