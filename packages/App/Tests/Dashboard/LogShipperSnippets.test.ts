import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CompatibleIngestEndpoint } from "../../FeatureSet/Dashboard/src/Components/Telemetry/CompatibleIngestGuide";
import {
  FLUENTD_LOGS_PATH,
  FLUENT_BIT_LOGS_URI,
  getFluentBitConfig,
  getFluentBitDockerCompose,
  getFluentdConfig,
  getFluentdDockerCompose,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/LogShipperSnippets";

/*
 * The logs guide's Fluent Bit and Fluentd files (issue #7753), built from
 * the server's own address. The newcomer walk of 14.0.110 ran Fluent Bit
 * 3.2.10 with the file the guide gave a self-hosted server at
 * http://localhost:18811: Host localhost:18811 ("Misformatted domain
 * name"), Port 443, Tls On, and Logs_uri /v1/logs, which answered 404. Only
 * Host localhost, Port 18811, Tls Off and /otlp/v1/logs delivered.
 */

const KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";

// The walk's self-hosted server: plain HTTP, on a port of its own.
const SELF_HOSTED: CompatibleIngestEndpoint = {
  protocol: "http",
  host: "localhost:18811",
  key: KEY,
};

// OneUptime Cloud's shape: https, and no port.
const CLOUD: CompatibleIngestEndpoint = {
  protocol: "https",
  host: "oneuptime.com",
  key: KEY,
};

const endpointOf: (
  protocol: string,
  host: string,
) => CompatibleIngestEndpoint = (
  protocol: string,
  host: string,
): CompatibleIngestEndpoint => {
  return { protocol, host, key: KEY };
};

// The value of a setting in Fluent Bit's [OUTPUT] section.
const fluentBitSetting: (config: string, name: string) => string = (
  config: string,
  name: string,
): string => {
  const match: RegExpMatchArray | null = config.match(
    new RegExp(`^    ${name} +(.+)$`, "m"),
  );

  if (!match) {
    throw new Error(`No ${name} line in:\n${config}`);
  }

  return match[1]!;
};

const fluentdEndpoint: (config: string) => string = (
  config: string,
): string => {
  const match: RegExpMatchArray | null = config.match(/^ {2}endpoint (.+)$/m);

  if (!match) {
    throw new Error(`No endpoint line in:\n${config}`);
  }

  return match[1]!;
};

describe("Fluent Bit's file", () => {
  test("a self-hosted server at http://host:port: the host alone, its port, TLS off, and the OTLP logs path", () => {
    expect(getFluentBitConfig(SELF_HOSTED)).toBe(`# fluent-bit.conf
[SERVICE]
    Flush        5
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name         tail
    Path         /var/log/*.log
    Tag          app.logs

[OUTPUT]
    Name         opentelemetry
    Match        *
    Host         localhost
    Port         18811
    Tls          Off
    Header       x-oneuptime-token ${KEY}
    Logs_uri     /otlp/v1/logs`);
  });

  test("an https server with no port, as OneUptime Cloud: port 443 and TLS on", () => {
    expect(getFluentBitConfig(CLOUD)).toBe(`# fluent-bit.conf
[SERVICE]
    Flush        5
    Log_Level    info
    Parsers_File parsers.conf

[INPUT]
    Name         tail
    Path         /var/log/*.log
    Tag          app.logs

[OUTPUT]
    Name         opentelemetry
    Match        *
    Host         oneuptime.com
    Port         443
    Tls          On
    Header       x-oneuptime-token ${KEY}
    Logs_uri     /otlp/v1/logs`);
  });

  test.each<[string, string, string, string, string]>([
    ["http", "oneuptime.internal", "oneuptime.internal", "80", "Off"],
    [
      "https",
      "oneuptime.example.com:8443",
      "oneuptime.example.com",
      "8443",
      "On",
    ],
    ["http", "10.0.0.5:8080", "10.0.0.5", "8080", "Off"],
    // Fluent Bit cannot resolve a bracketed IPv6 host; the bare address connects.
    ["http", "[::1]:8080", "::1", "8080", "Off"],
    ["https", "[2001:db8::1]", "2001:db8::1", "443", "On"],
  ])(
    "%s://%s: Host %s, Port %s, Tls %s",
    (
      protocol: string,
      host: string,
      expectedHost: string,
      expectedPort: string,
      expectedTls: string,
    ) => {
      const config: string = getFluentBitConfig(endpointOf(protocol, host));

      expect(fluentBitSetting(config, "Host")).toBe(expectedHost);
      expect(fluentBitSetting(config, "Port")).toBe(expectedPort);
      expect(fluentBitSetting(config, "Tls")).toBe(expectedTls);
      expect(fluentBitSetting(config, "Logs_uri")).toBe("/otlp/v1/logs");
    },
  );

  test("before a key is picked, the token keeps its placeholder", () => {
    const config: string = getFluentBitConfig({
      protocol: "https",
      host: "oneuptime.com",
      key: "<YOUR_ONEUPTIME_TOKEN>",
    });

    expect(fluentBitSetting(config, "Header")).toBe(
      "x-oneuptime-token <YOUR_ONEUPTIME_TOKEN>",
    );
  });

  test("Docker Compose sets no address: Fluent Bit reads it from fluent-bit.conf", () => {
    const compose: string = getFluentBitDockerCompose();

    expect(compose).toContain(
      "./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf",
    );
    expect(compose).not.toContain("environment");
    expect(compose).not.toContain("HOST");
  });
});

describe("Fluentd's file", () => {
  test("a self-hosted server at http://host:port: its scheme, host and port, and the Fluentd path", () => {
    expect(getFluentdConfig(SELF_HOSTED)).toBe(`# fluentd.conf
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<source>
  @type tail
  path /var/log/*.log
  pos_file /var/log/fluentd.pos
  tag app.logs
  <parse>
    @type json
  </parse>
</source>

<match **>
  @type http
  endpoint http://localhost:18811/fluentd/logs
  headers {"x-oneuptime-token":"${KEY}"}
  json_array true
  <format>
    @type json
  </format>
  <buffer>
    @type memory
    flush_interval 5s
  </buffer>
</match>`);
  });

  test("an https server with no port, as OneUptime Cloud", () => {
    const config: string = getFluentdConfig(CLOUD);

    expect(fluentdEndpoint(config)).toBe("https://oneuptime.com/fluentd/logs");
    expect(config).toContain(`headers {"x-oneuptime-token":"${KEY}"}`);
  });

  test.each<[string, string, string]>([
    ["http", "oneuptime.internal", "http://oneuptime.internal/fluentd/logs"],
    [
      "https",
      "oneuptime.example.com:8443",
      "https://oneuptime.example.com:8443/fluentd/logs",
    ],
    // A URL keeps an IPv6 host in brackets.
    ["http", "[::1]:8080", "http://[::1]:8080/fluentd/logs"],
  ])(
    "%s://%s posts to %s",
    (protocol: string, host: string, expected: string) => {
      expect(
        fluentdEndpoint(getFluentdConfig(endpointOf(protocol, host))),
      ).toBe(expected);
    },
  );

  test("Docker Compose sets no address: Fluentd reads it from fluentd.conf", () => {
    const compose: string = getFluentdDockerCompose();

    expect(compose).toContain("./fluentd.conf:/fluentd/etc/fluentd.conf");
    expect(compose).not.toContain("http");
  });
});

describe("the paths are the ones a server serves", () => {
  const read: (relativePath: string) => string = (
    relativePath: string,
  ): string => {
    return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  };

  test("Fluent Bit posts to the App's OTLP logs route, under the /otlp of the OTLP endpoint", () => {
    expect(FLUENT_BIT_LOGS_URI).toBe("/otlp/v1/logs");
    expect(read("../../FeatureSet/Telemetry/API/OTelIngest.ts")).toContain(
      `"${FLUENT_BIT_LOGS_URI}"`,
    );
    // The bundled ingress sends /otlp to the App as it is, in every server.
    expect(read("../../../Nginx/default.conf.template")).toContain(
      "location /otlp {",
    );
  });

  test("Fluentd posts to the address the ingress rewrites to the App's Fluentd route", () => {
    const template: string = read("../../../Nginx/default.conf.template");

    expect(FLUENTD_LOGS_PATH).toBe("/fluentd/logs");
    expect(template).toContain(`location ${FLUENTD_LOGS_PATH} {`);
    expect(template).toContain(
      "rewrite ^/fluentd/logs(.*)$ /fluentd/v1/logs$1 break;",
    );
    expect(read("../../FeatureSet/Telemetry/API/Fluent.ts")).toContain(
      '"/fluentd/v1/logs"',
    );
  });
});
