import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { CompatibleIngestEndpoint } from "../../FeatureSet/Dashboard/src/Components/Telemetry/CompatibleIngestGuide";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  FLUENTD_BUFFER_PATHS,
  FLUENTD_BUFFER_TOTAL_LIMIT,
  FLUENTD_COMPOSE_CAPABILITIES,
  FLUENTD_EVENT_TIME_KEY,
  FLUENTD_FORWARD_BINDS,
  FLUENTD_FORWARD_PORT,
  FLUENTD_FORWARD_PUBLISHED,
  FLUENTD_LOGS_PATH,
  FLUENTD_OTHER_HOSTS_DOCS_PATH,
  FLUENTD_POSITION_FILES,
  FLUENTD_RETRYABLE_RESPONSE_CODES,
  FLUENTD_STATE_FOLDERS,
  FLUENT_BIT_LOGS_URI,
  FluentdRunsIn,
  getFluentBitConfig,
  getFluentBitDockerCompose,
  getFluentdConfig,
  getFluentdDockerCompose,
  getFluentdHostCommands,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/LogShipperSnippets";
import FluentRecordTimeUtil, {
  FLUENTD_EVENT_TIME_FIELD,
  FLUENT_RECORD_TIME_FIELDS,
  FluentRecordTime,
} from "../../FeatureSet/Telemetry/Utils/FluentRecordTime";

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

// Where the guide runs Fluentd: its two tabs.
const RUNS_IN: Array<FluentdRunsIn> = [
  FluentdRunsIn.Host,
  FluentdRunsIn.DockerCompose,
];

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
  test("a self-hosted server at http://host:port, in Docker Compose: its scheme, host and port, and the Fluentd path", () => {
    expect(getFluentdConfig(SELF_HOSTED, FluentdRunsIn.DockerCompose))
      .toBe(`# fluentd.conf
<source>
  @type forward
  port 24224
  # Every address of the container: docker-compose.yml publishes the port to this host alone.
  # To take events from other hosts, with a shared key and TLS, see
  # http://localhost:18811/docs/telemetry/fluentd#take-records-from-other-hosts
  bind 0.0.0.0
</source>

<source>
  @type tail
  path /var/log/*.log
  pos_file /fluentd/log/fluentd.pos
  tag app.logs
  <parse>
    @type none
  </parse>
</source>

# A JSON line keeps its fields, its own time too; any other line is sent as it is
<filter app.**>
  @type parser
  key_name message
  reserve_data true
  reserve_time true
  remove_key_name_field true
  emit_invalid_record_to_error false
  <parse>
    @type json
    # Leave each line's "time" as it is, for OneUptime to read: Fluentd drops a line
    # whose "time" is null, true, a list or an object. The next filter adds fluentd_time.
    time_key fluentd_time
  </parse>
</filter>

# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time \${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

<match **>
  @type http
  endpoint http://localhost:18811/fluentd/logs
  headers {"x-oneuptime-token":"${KEY}"}
  json_array true
  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504
  <format>
    @type json
  </format>
  <buffer>
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path /fluentd/log/buffer/oneuptime
    # At most 512 MB: when it is full, the tail waits, at its place in each file
    total_limit_size 512m
    flush_interval 5s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>`);
  });

  test("on the host, the same file but for where it listens and keeps its state", () => {
    const host: Array<string> = getFluentdConfig(
      SELF_HOSTED,
      FluentdRunsIn.Host,
    ).split("\n");
    const docker: Array<string> = getFluentdConfig(
      SELF_HOSTED,
      FluentdRunsIn.DockerCompose,
    ).split("\n");

    expect(host.length).toBe(docker.length);
    expect(
      host
        .map((line: string, index: number): [string, string] => {
          return [line, docker[index]!];
        })
        .filter(([hostLine, dockerLine]: [string, string]): boolean => {
          return hostLine !== dockerLine;
        }),
    ).toEqual([
      [
        "  # This host alone may send here.",
        "  # Every address of the container: docker-compose.yml publishes the port to this host alone.",
      ],
      ["  bind 127.0.0.1", "  bind 0.0.0.0"],
      [
        "  pos_file /var/log/fluent/fluentd.pos",
        "  pos_file /fluentd/log/fluentd.pos",
      ],
      [
        "    path /var/log/fluent/buffer/oneuptime",
        "    path /fluentd/log/buffer/oneuptime",
      ],
    ]);
    expect(FLUENTD_STATE_FOLDERS).toEqual({
      [FluentdRunsIn.Host]: "/var/log/fluent",
      [FluentdRunsIn.DockerCompose]: "/fluentd/log",
    });
    expect(FLUENTD_POSITION_FILES).toEqual({
      [FluentdRunsIn.Host]: "/var/log/fluent/fluentd.pos",
      [FluentdRunsIn.DockerCompose]: "/fluentd/log/fluentd.pos",
    });
    expect(FLUENTD_BUFFER_PATHS).toEqual({
      [FluentdRunsIn.Host]: "/var/log/fluent/buffer/oneuptime",
      [FluentdRunsIn.DockerCompose]: "/fluentd/log/buffer/oneuptime",
    });
    expect(FLUENTD_FORWARD_BINDS).toEqual({
      [FluentdRunsIn.Host]: "127.0.0.1",
      [FluentdRunsIn.DockerCompose]: "0.0.0.0",
    });
  });

  test.each(RUNS_IN)(
    "%s: an https server with no port, as OneUptime Cloud",
    (runsIn: FluentdRunsIn) => {
      const config: string = getFluentdConfig(CLOUD, runsIn);

      expect(fluentdEndpoint(config)).toBe(
        "https://oneuptime.com/fluentd/logs",
      );
      expect(config).toContain(`headers {"x-oneuptime-token":"${KEY}"}`);
    },
  );

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
    "%s://%s posts to %s, on the host and in Docker Compose",
    (protocol: string, host: string, expected: string) => {
      for (const runsIn of RUNS_IN) {
        expect(
          fluentdEndpoint(getFluentdConfig(endpointOf(protocol, host), runsIn)),
        ).toBe(expected);
      }
    },
  );

  test("Docker Compose sets no address: Fluentd reads it from fluentd.conf", () => {
    const compose: string = getFluentdDockerCompose();

    expect(compose).toBe(`# docker-compose.yml
services:
  fluentd:
    image: fluent/fluentd:latest
    # Root reads every file in /var/log, the ones only root may read too
    user: root
    # Of root's powers, it keeps only reading and writing any file
    cap_drop:
      - ALL
    cap_add:
      - DAC_OVERRIDE
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
      - /var/log:/var/log:ro
      # Fluentd's place in each file, and the batches it has yet to send
      - fluentd-state:/fluentd/log
    ports:
      # This host alone may send: fluentd.conf says how to take events from other hosts
      - "127.0.0.1:24224:24224"

volumes:
  fluentd-state:`);
    expect(compose).not.toContain("http");
  });

  test("on the host: the package's service, with the file where it reads it", () => {
    expect(getFluentdHostCommands())
      .toBe(`# Fluentd's package runs its service with /etc/fluent/fluentd.conf
sudo cp fluentd.conf /etc/fluent/fluentd.conf
# Let the service read the logs only root and the adm group may read, such as auth.log
sudo usermod -aG adm _fluentd
sudo systemctl restart fluentd`);
  });
});

/*
 * Fluentd's two files, run as handed out (issue #7886). As they were built
 * before, Fluentd sent nothing: the Compose file mounted fluentd.conf where
 * the image does not read it. With the file read, the tail kept its place
 * on the read-only /var/log and its worker exited in a loop
 * (Errno::EROFS); with /var/log writable too, a plain line was refused
 * ("pattern not matched"), and <match **> sent Fluentd's own logs along.
 * Checked with fluent/fluentd 1.20.1, whose code the readers below follow.
 */

/*
 * What the fluent/fluentd image does: its entrypoint runs
 * `fluentd --config /fluentd/etc/${FLUENTD_CONF}`, its FLUENTD_CONF is
 * fluent.conf, and it runs as its user fluent, who owns /fluentd/log.
 */
const IMAGE_CONFIG_FOLDER: string = "/fluentd/etc/";
const IMAGE_FLUENTD_CONF: string = "fluent.conf";
const IMAGE_USER_FOLDER: string = "/fluentd/log";

// The tags Fluentd gives its own logs (Fluent::Log.event_tags).
const FLUENTD_OWN_LOG_TAGS: Array<string> = [
  "fluent.trace",
  "fluent.debug",
  "fluent.info",
  "fluent.warn",
  "fluent.error",
  "fluent.fatal",
];

// A section of a Fluentd file: <source>, <match **>, <parse>, ...
interface FluentdSection {
  name: string;
  argument: string;
  parameters: Record<string, string>;
  sections: Array<FluentdSection>;
}

const parseFluentd: (config: string) => FluentdSection = (
  config: string,
): FluentdSection => {
  const root: FluentdSection = {
    name: "ROOT",
    argument: "",
    parameters: {},
    sections: [],
  };
  const open: Array<FluentdSection> = [root];

  for (const rawLine of config.split("\n")) {
    const line: string = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const closing: RegExpMatchArray | null = line.match(/^<\/(\w+)>$/);

    if (closing) {
      expect(open.pop()?.name).toBe(closing[1]);
      continue;
    }

    const opening: RegExpMatchArray | null = line.match(/^<(\w+)\s*(.*)>$/);
    const current: FluentdSection = open[open.length - 1]!;

    if (opening) {
      const section: FluentdSection = {
        name: opening[1]!,
        argument: opening[2]!.trim(),
        parameters: {},
        sections: [],
      };

      current.sections.push(section);
      open.push(section);
      continue;
    }

    const parameter: RegExpMatchArray | null = line.match(/^(\S+)\s+(.+)$/);

    if (!parameter) {
      throw new Error(`A line this test does not read: ${line}`);
    }

    current.parameters[parameter[1]!] = parameter[2]!;
  }

  expect(open.length).toBe(1);

  return root;
};

const sectionsNamed: (
  section: FluentdSection,
  name: string,
) => Array<FluentdSection> = (
  section: FluentdSection,
  name: string,
): Array<FluentdSection> => {
  return section.sections.filter((child: FluentdSection): boolean => {
    return child.name === name;
  });
};

// The @type of a section's <parse>.
const parserOf: (section: FluentdSection) => string | undefined = (
  section: FluentdSection,
): string | undefined => {
  return sectionsNamed(section, "parse")[0]?.parameters["@type"];
};

// Braces, a regular expression or an escape, which takesParts does not read.
const UNREAD_PATTERN_SIGNS: RegExp = /[{}/\\[\]]/;

/*
 * Whether a <match> or <filter> pattern takes a tag: "*" stands for one
 * part of the tag, "**" for any number of parts, and a pattern may list
 * several, apart. Enough for these files; anything else throws.
 */
const takesParts: (pattern: Array<string>, parts: Array<string>) => boolean = (
  pattern: Array<string>,
  parts: Array<string>,
): boolean => {
  if (pattern.length === 0) {
    return parts.length === 0;
  }

  const [first, ...rest] = pattern as [string, ...Array<string>];

  if (first === "**") {
    for (let skipped: number = 0; skipped <= parts.length; skipped++) {
      if (takesParts(rest, parts.slice(skipped))) {
        return true;
      }
    }

    return false;
  }

  if (UNREAD_PATTERN_SIGNS.test(first)) {
    throw new Error(`A pattern this test does not read: ${first}`);
  }

  const part: RegExp = new RegExp(
    `^${first.split("*").map(escapeRegExp).join("[^.]*")}$`,
  );

  return (
    parts.length > 0 && part.test(parts[0]!) && takesParts(rest, parts.slice(1))
  );
};

const patternTakes: (patterns: string, tag: string) => boolean = (
  patterns: string,
  tag: string,
): boolean => {
  return patterns.split(/\s+/).some((pattern: string): boolean => {
    return takesParts(pattern.split("."), tag.split("."));
  });
};

/*
 * The output each of Fluentd's own logs reaches: the first <match> that
 * takes its tag in the @FLUENT_LOG label when the file has one, else the
 * first at the top (fluentd's FluentLogEventRouter.build, then its event
 * router), or "nothing".
 */
const ownLogOutputs: (config: string) => Array<string> = (
  config: string,
): Array<string> => {
  const root: FluentdSection = parseFluentd(config);
  const label: FluentdSection | undefined = sectionsNamed(root, "label").find(
    (section: FluentdSection): boolean => {
      return section.argument === "@FLUENT_LOG";
    },
  );
  const matches: Array<FluentdSection> = sectionsNamed(label || root, "match");

  return FLUENTD_OWN_LOG_TAGS.map((tag: string): string => {
    const match: FluentdSection | undefined = matches.find(
      (section: FluentdSection): boolean => {
        return patternTakes(section.argument, tag);
      },
    );

    return match ? match.parameters["@type"]! : "nothing";
  });
};

// The one top-level <match> that posts to OneUptime.
const httpOutput: (config: string) => FluentdSection = (
  config: string,
): FluentdSection => {
  const outputs: Array<FluentdSection> = sectionsNamed(
    parseFluentd(config),
    "match",
  ).filter((section: FluentdSection): boolean => {
    return section.parameters["@type"] === "http";
  });

  expect(outputs.length).toBe(1);

  return outputs[0]!;
};

const MB: number = 1024 * 1024;

/*
 * Fluentd's own limits when <buffer> sets none, by the buffer's @type
 * (memory when it names none): Buffer::DEFAULT_CHUNK_LIMIT_SIZE and
 * DEFAULT_TOTAL_LIMIT_SIZE, which buf_file sets again (Fluentd 1.20.1).
 */
const FLUENTD_BUFFER_DEFAULTS: Record<
  string,
  { chunkBytes: number; totalBytes: number }
> = {
  memory: { chunkBytes: 8 * MB, totalBytes: 512 * MB },
  file: { chunkBytes: 256 * MB, totalBytes: 64 * 1024 * MB },
};

// A Fluentd size parameter in bytes, as Fluentd reads one ("900k", "512m", "1g").
const fluentdBytes: (size: string) => number = (size: string): number => {
  const match: RegExpMatchArray | null = size.match(/^(\d+)([kmgt]?)$/i);

  if (!match) {
    throw new Error(`A size this test does not read: ${size}`);
  }

  const power: number = ["", "k", "m", "g", "t"].indexOf(
    match[2]!.toLowerCase(),
  );

  return parseInt(match[1]!, 10) * Math.pow(1024, power);
};

// An output's <buffer>, which every output here has.
const bufferOf: (output: FluentdSection) => FluentdSection = (
  output: FluentdSection,
): FluentdSection => {
  const buffers: Array<FluentdSection> = sectionsNamed(output, "buffer");

  expect(buffers.length).toBe(1);

  return buffers[0]!;
};

// A buffer's @type, as Fluentd reads it: memory when it names none.
const bufferType: (output: FluentdSection) => string = (
  output: FluentdSection,
): string => {
  return bufferOf(output).parameters["@type"] || "memory";
};

// A buffer limit in bytes: what the buffer sets, else its @type's default.
const bufferLimitBytes: (
  output: FluentdSection,
  setting: "chunk_limit_size" | "total_limit_size",
) => number = (
  output: FluentdSection,
  setting: "chunk_limit_size" | "total_limit_size",
): number => {
  const size: string | undefined = bufferOf(output).parameters[setting];

  if (size !== undefined) {
    return fluentdBytes(size);
  }

  const defaults: { chunkBytes: number; totalBytes: number } | undefined =
    FLUENTD_BUFFER_DEFAULTS[bufferType(output)];

  if (!defaults) {
    throw new Error(`A buffer this test does not read: ${bufferType(output)}`);
  }

  return setting === "chunk_limit_size"
    ? defaults.chunkBytes
    : defaults.totalBytes;
};

// A buffer chunk's most bytes: chunk_limit_size, as Fluentd reads a size.
const chunkLimitBytes: (output: FluentdSection) => number = (
  output: FluentdSection,
): number => {
  return bufferLimitBytes(output, "chunk_limit_size");
};

// A Compose volume line of the fluentd service: "source:target[:ro]".
interface ComposeMount {
  source: string;
  target: string;
  readOnly: boolean;
}

const composeMounts: (compose: string) => Array<ComposeMount> = (
  compose: string,
): Array<ComposeMount> => {
  return Array.from(
    compose.matchAll(/^ {6}- ([^:\s"]+):(\/[^:\s"]*)(?::(ro|rw))?$/gm),
  ).map((match: RegExpMatchArray): ComposeMount => {
    return {
      source: match[1]!,
      target: match[2]!,
      readOnly: match[3] === "ro",
    };
  });
};

// Whether a path is a mount's target or inside it.
const isUnder: (filePath: string, folder: string) => boolean = (
  filePath: string,
  folder: string,
): boolean => {
  return filePath === folder || filePath.startsWith(`${folder}/`);
};

const readFromHere: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
};

/*
 * The bundled ingress (packages/Nginx), which every server runs in front of
 * the App. A "#" starts a comment to the end of its line, and one of them
 * quotes a "{".
 */
const NGINX_COMMENT: RegExp = /#[^\n]*/g;

const nginxBlockFrom: (text: string, brace: number) => string = (
  text: string,
  brace: number,
): string => {
  let depth: number = 0;

  for (let index: number = brace; index < text.length; index++) {
    if (text[index] === "{") {
      depth++;
    } else if (text[index] === "}") {
      depth--;

      if (depth === 0) {
        return text.slice(brace, index + 1);
      }
    }
  }

  throw new Error(`No closing brace after ${brace}`);
};

// A block's own directives: its text outside the blocks inside it.
const nginxOwnText: (block: string) => string = (block: string): string => {
  let depth: number = 0;
  let own: string = "";

  for (const character of block) {
    if (character === "{" || character === "}") {
      depth += character === "{" ? 1 : -1;
      continue;
    }

    if (depth === 1) {
      own += character;
    }
  }

  return own;
};

// nginx's own client_max_body_size, wherever the configuration sets none.
const NGINX_DEFAULT_BODY_SIZE: string = "1m";

/*
 * The most the ingress takes in one request on a location, in bytes: the
 * client_max_body_size the location sets, else its server block's, else
 * nginx.conf's http block's, else nginx's own default. It reads the
 * ingress's two files: its default.conf.template and its nginx.conf.
 */
const ingressBodyLimitBytes: (
  templateText: string,
  nginxConfText: string,
  location: string,
) => number = (
  templateText: string,
  nginxConfText: string,
  location: string,
): number => {
  const template: string = templateText.replace(NGINX_COMMENT, "");
  const nginxConf: string = nginxConfText.replace(NGINX_COMMENT, "");
  const opening: string = `location ${location} {`;
  const at: number = template.indexOf(opening);

  expect(at).toBeGreaterThan(-1);
  expect(template.indexOf(opening, at + 1)).toBe(-1);

  const locationBlock: string = nginxBlockFrom(
    template,
    at + opening.length - 1,
  );
  const serverBlock: string | undefined = Array.from(
    template.matchAll(/^server \{$/gm),
  )
    .map((match: RegExpMatchArray): [number, string] => {
      const brace: number = match.index! + match[0].length - 1;

      return [brace, nginxBlockFrom(template, brace)];
    })
    .find(([brace, block]: [number, string]): boolean => {
      return brace < at && at < brace + block.length;
    })?.[1];
  const httpOpening: RegExpMatchArray | null = nginxConf.match(/^http \{$/m);

  expect(serverBlock).toBeDefined();
  expect(httpOpening).not.toBeNull();

  const httpBlock: string = nginxBlockFrom(
    nginxConf,
    httpOpening!.index! + httpOpening![0].length - 1,
  );
  let size: string = NGINX_DEFAULT_BODY_SIZE;

  for (const block of [locationBlock, serverBlock!, httpBlock]) {
    const set: RegExpMatchArray | null = nginxOwnText(block).match(
      /\bclient_max_body_size\s+(\S+);/,
    );

    if (set) {
      size = set[1]!;
      break;
    }
  }

  const match: RegExpMatchArray | null = size.match(/^(\d+)([kmg]?)$/i);

  if (!match) {
    throw new Error(`A size this test does not read: ${size}`);
  }

  const power: number = ["", "k", "m", "g"].indexOf(match[2]!.toLowerCase());

  return parseInt(match[1]!, 10) * Math.pow(1024, power);
};

describe("Fluentd's files run as handed out (issue #7886)", () => {
  const configText: string = getFluentdConfig(
    SELF_HOSTED,
    FluentdRunsIn.DockerCompose,
  );
  const config: FluentdSection = parseFluentd(configText);
  const compose: string = getFluentdDockerCompose();
  const tails: Array<FluentdSection> = sectionsNamed(config, "source").filter(
    (section: FluentdSection): boolean => {
      return section.parameters["@type"] === "tail";
    },
  );
  const tail: FluentdSection = tails[0]!;

  test("one tail, of /var/log, the folder the Compose file mounts from the host", () => {
    expect(tails.length).toBe(1);
    expect(tail.parameters["path"]).toBe("/var/log/*.log");
    expect(composeMounts(compose)).toContainEqual({
      source: "/var/log",
      target: "/var/log",
      readOnly: true,
    });
  });

  test("the Compose file mounts fluentd.conf where the image reads its file", () => {
    const fluentdConf: string =
      compose.match(/^\s+FLUENTD_CONF:\s*(\S+)$/m)?.[1] || IMAGE_FLUENTD_CONF;

    expect(
      composeMounts(compose)
        .filter((mount: ComposeMount): boolean => {
          return mount.source === "./fluentd.conf";
        })
        .map((mount: ComposeMount): string => {
          return mount.target;
        }),
    ).toEqual([`${IMAGE_CONFIG_FOLDER}${fluentdConf}`]);
  });

  test("the tail keeps its place in the folder the image's user owns, under no read-only mount", () => {
    const posFile: string = tail.parameters["pos_file"]!;

    expect(isUnder(posFile, IMAGE_USER_FOLDER)).toBe(true);
    expect(
      composeMounts(compose).filter((mount: ComposeMount): boolean => {
        return mount.readOnly && isUnder(posFile, mount.target);
      }),
    ).toEqual([]);
  });

  test("that folder is a volume, so the place lasts when the container is made again", () => {
    const posFile: string = tail.parameters["pos_file"]!;
    const holders: Array<ComposeMount> = composeMounts(compose).filter(
      (mount: ComposeMount): boolean => {
        return isUnder(posFile, mount.target);
      },
    );

    expect(holders).toEqual([
      {
        source: "fluentd-state",
        target: IMAGE_USER_FOLDER,
        readOnly: false,
      },
    ]);
    // A named volume, which a new one starts as a copy of the image's folder, owner and all.
    expect(compose).toMatch(/^volumes:\n {2}fluentd-state:$/m);
  });

  test("every line is sent: a JSON line with its own fields, any other line as it is", () => {
    // The tail takes each line whole, into "message": parsed as json there, a plain line is refused.
    expect(parserOf(tail)).toBe("none");

    const parsers: Array<FluentdSection> = sectionsNamed(
      config,
      "filter",
    ).filter((section: FluentdSection): boolean => {
      return (
        patternTakes(section.argument, tail.parameters["tag"]!) &&
        section.parameters["@type"] === "parser"
      );
    });

    // One filter reads a JSON line's fields out of "message".
    expect(
      parsers.map((section: FluentdSection): Array<string | undefined> => {
        return [section.parameters["key_name"], parserOf(section)];
      }),
    ).toEqual([["message", "json"]]);

    for (const parser of parsers) {
      // A line it cannot read goes on as it is: without reserve_data, the filter drops it,
      expect(parser.parameters["reserve_data"]).toBe("true");
      // and it is not logged as an error, one warning a line.
      expect(parser.parameters["emit_invalid_record_to_error"]).toBe("false");
      /*
       * A line it reads is no longer kept whole in "message", the first field
       * OneUptime takes a log's body from, so a JSON line's own "msg" or "log"
       * is the body.
       */
      expect(parser.parameters["remove_key_name_field"]).toBe("true");
    }
  });

  test("Fluentd's own logs stay out of OneUptime", () => {
    expect(ownLogOutputs(configText)).toEqual(
      FLUENTD_OWN_LOG_TAGS.map((): string => {
        return "null";
      }),
    );
  });

  test("the ingress's limit is read as nginx applies it", () => {
    const template: string = [
      "server {",
      "    client_max_body_size 3m;",
      "",
      "    location /own {",
      "        client_max_body_size 4M;",
      "    }",
      "",
      "    location /server {",
      '        # client_max_body_size 9m; a comment, which may quote a "{"',
      "        location /server/inner {",
      "            client_max_body_size 5k;",
      "        }",
      "    }",
      "}",
      "",
      "server {",
      "    location /http {",
      "    }",
      "}",
    ].join("\n");
    const nginxConf: (body: string) => string = (body: string): string => {
      return `events {\n}\n\nhttp {\n${body}    include /etc/nginx/conf.d/*.conf;\n}\n`;
    };
    const setting2m: string = nginxConf("    client_max_body_size 2m;\n");

    // The location's own,
    expect(ingressBodyLimitBytes(template, setting2m, "/own")).toBe(
      4 * 1024 * 1024,
    );
    // else its server block's (not a comment's, nor a block's inside it),
    expect(ingressBodyLimitBytes(template, setting2m, "/server")).toBe(
      3 * 1024 * 1024,
    );
    // else the http block's,
    expect(ingressBodyLimitBytes(template, setting2m, "/http")).toBe(
      2 * 1024 * 1024,
    );
    // else nginx's 1m.
    expect(ingressBodyLimitBytes(template, nginxConf(""), "/http")).toBe(
      1024 * 1024,
    );
  });

  test("a request is never more than the ingress takes on /fluentd/logs", () => {
    const limit: number = ingressBodyLimitBytes(
      readFromHere("../../../Nginx/default.conf.template"),
      readFromHere("../../../Nginx/nginx.conf"),
      FLUENTD_LOGS_PATH,
    );
    const output: FluentdSection = httpOutput(configText);

    expect(output.parameters["json_array"]).toBe("true");
    // json_array posts a chunk as "[", the chunk but for its last ",", and "]".
    expect(chunkLimitBytes(output) + 1).toBeLessThanOrEqual(limit);
  });
});

/*
 * The four faults the fixer of #7886 found running the files above
 * (PR #7966, fluent/fluentd 1.20.1, against a local App behind the bundled
 * ingress), each checked here the way Fluentd and Compose read the files,
 * and again in a run of the files as handed out (the pull request that
 * closes them has it).
 */

// A Compose setting of the fluentd service, as `    user: root` writes it.
const composeServiceSetting: (
  compose: string,
  name: string,
) => string | undefined = (
  compose: string,
  name: string,
): string | undefined => {
  return compose.match(new RegExp(`^ {4}${name}: *(\\S+)$`, "m"))?.[1];
};

/*
 * A Fluentd array parameter, as Fluentd reads one (Config::ARRAY_TYPE):
 * a JSON array, or values apart by commas.
 */
const fluentdArray: (value: string) => Array<string> = (
  value: string,
): Array<string> => {
  const text: string = value.trim();

  if (text.startsWith("[")) {
    return (JSON.parse(text) as Array<unknown>).map(String);
  }

  return text.split(",").map((part: string): string => {
    return part.trim();
  });
};

// A Fluentd time parameter in seconds ("30s", "72h", "1d", or plain seconds).
const fluentdSeconds: (value: string) => number = (value: string): number => {
  const match: RegExpMatchArray | null = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)([smhd]?)$/);

  if (!match) {
    throw new Error(`A time this test does not read: ${value}`);
  }

  const unit: number = { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[
    match[2] as "" | "s" | "m" | "h" | "d"
  ];

  return parseFloat(match[1]!) * unit;
};

/*
 * Whether a tail's path takes a file, as Ruby's Dir.glob reads the path:
 * "*" is any run of characters but "/".
 */
const globTakes: (glob: string, filePath: string) => boolean = (
  glob: string,
  filePath: string,
): boolean => {
  if (UNREAD_PATTERN_SIGNS.test(glob.replace(/\//g, ""))) {
    throw new Error(`A path this test does not read: ${glob}`);
  }

  return new RegExp(
    `^${glob.split("*").map(escapeRegExp).join("[^/]*")}$`,
  ).test(filePath);
};

const RUBY_STRFTIME_EXAMPLE: string = "2026-11-15T10:17:12.834701377Z";

const configOf: (runsIn: FluentdRunsIn) => FluentdSection = (
  runsIn: FluentdRunsIn,
): FluentdSection => {
  return parseFluentd(getFluentdConfig(SELF_HOSTED, runsIn));
};

const tailOf: (config: FluentdSection) => FluentdSection = (
  config: FluentdSection,
): FluentdSection => {
  const tails: Array<FluentdSection> = sectionsNamed(config, "source").filter(
    (section: FluentdSection): boolean => {
      return section.parameters["@type"] === "tail";
    },
  );

  expect(tails.length).toBe(1);

  return tails[0]!;
};

// The top-level <filter> sections, in the order Fluentd runs them.
const filtersOf: (config: FluentdSection) => Array<FluentdSection> = (
  config: FluentdSection,
): Array<FluentdSection> => {
  return sectionsNamed(config, "filter");
};

// The one parser filter, which reads a JSON line's fields out of "message".
const jsonParserOf: (config: FluentdSection) => FluentdSection = (
  config: FluentdSection,
): FluentdSection => {
  const parsers: Array<FluentdSection> = filtersOf(config).filter(
    (section: FluentdSection): boolean => {
      return section.parameters["@type"] === "parser";
    },
  );

  expect(parsers.length).toBe(1);
  expect(parserOf(parsers[0]!)).toBe("json");

  return parsers[0]!;
};

// The json parser's own time_key when <parse> sets none (parser_json.rb).
const JSON_PARSER_DEFAULT_TIME_KEY: string = "time";

/*
 * What Fluentd's json parser does with a JSON line's fields, as Fluentd
 * 1.20.1 does it (Parser#parse_time): the field its time_key names, when
 * the line has it, is read as the event's time - taken out of the record
 * unless keep_time_key is true - and a value that is no text and no
 * number raises TimeParseError ("value must be a string or a number"),
 * which the parser filter, with emit_invalid_record_to_error false, turns
 * into a dropped line, with no warning. reserve_data does not keep it: that
 * is for a line that is no JSON at all. time_type float, the json parser's,
 * and mixed read text and numbers alike.
 */
const jsonParserOutcome: (
  parse: FluentdSection,
  line: JSONObject,
) => { dropped: boolean; record: JSONObject | null } = (
  parse: FluentdSection,
  line: JSONObject,
): { dropped: boolean; record: JSONObject | null } => {
  const timeKey: string =
    parse.parameters["time_key"] ?? JSON_PARSER_DEFAULT_TIME_KEY;
  const record: JSONObject = { ...line };

  if (!Object.prototype.hasOwnProperty.call(record, timeKey)) {
    return { dropped: false, record };
  }

  const value: unknown = record[timeKey];

  if (parse.parameters["keep_time_key"] !== "true") {
    delete record[timeKey];
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return { dropped: true, record: null };
  }

  return { dropped: false, record };
};

// The values a JSON line's time field may hold that Fluentd cannot read as a time.
const NOT_TEXT_OR_NUMBER: Array<[string, unknown]> = [
  ["null", null],
  ["true", true],
  ["false", false],
  ["a list", [1, 2]],
  ["an empty list", []],
  ["an object", { s: 1 }],
  ["an empty object", {}],
];

// And values it reads, as text or a number, whatever they mean.
const TEXT_OR_NUMBER: Array<[string, unknown]> = [
  ["an ISO time", "2026-11-14T08:00:00.123Z"],
  ["epoch seconds", 1763107202],
  ["pino's milliseconds", 1763107204123],
  ["a word", "soon"],
  ["empty text", ""],
];

describe("Fluentd reads every file in /var/log, the ones only root may read too (issue #8005)", () => {
  const compose: string = getFluentdDockerCompose();

  /*
   * The image runs as its user fluent (uid 999), who could not read a file
   * that only root may: Fluentd logged "/var/log/secure.log unreadable. It
   * is excluded and would be examined next time." and sent none of it. The
   * image's entrypoint does not drop root (it ends in exec "$@").
   */
  test("the Compose file runs Fluentd as root", () => {
    expect(composeServiceSetting(compose, "user")).toBe("root");
    // Not a group: no group reads a file of root's alone (mode 0600, as Red Hat keeps its logs).
    expect(compose).not.toContain("group_add");
  });

  test("root keeps its place in the volume, which the image made its user's", () => {
    const tail: FluentdSection = tailOf(configOf(FluentdRunsIn.DockerCompose));
    const holders: Array<ComposeMount> = composeMounts(compose).filter(
      (mount: ComposeMount): boolean => {
        return isUnder(tail.parameters["pos_file"]!, mount.target);
      },
    );

    // Root writes any folder; only a read-only mount stops it.
    expect(holders).toEqual([
      {
        source: "fluentd-state",
        target: IMAGE_USER_FOLDER,
        readOnly: false,
      },
    ]);
  });

  test("the host's logs stay read-only to it", () => {
    expect(
      composeMounts(compose).filter((mount: ComposeMount): boolean => {
        return mount.source === "/var/log";
      }),
    ).toEqual([{ source: "/var/log", target: "/var/log", readOnly: true }]);
  });

  test("on the host, the package's user reads the adm group's logs, and stays its own user", () => {
    const commands: Array<string> = getFluentdHostCommands()
      .split("\n")
      .filter((line: string): boolean => {
        return !line.startsWith("#");
      });

    expect(commands).toContain("sudo usermod -aG adm _fluentd");
    // A group a user joins counts from the service's next start.
    expect(commands.indexOf("sudo usermod -aG adm _fluentd")).toBeLessThan(
      commands.indexOf("sudo systemctl restart fluentd"),
    );
    // The service listens on 24224 of every address: it is not made root.
    expect(getFluentdHostCommands()).not.toMatch(/User=root|sudo fluentd/);
  });
});

describe("a batch OneUptime turns away for a while is sent again (issue #8006)", () => {
  /*
   * Fluentd's HTTP output sends again only what retryable_response_codes
   * lists, 503 alone when it is not set (and Fluentd warns that this goes
   * in v2). It drops a batch on any other answer: the 502 of a restarting
   * App lost the run's whole batch ("got unrecoverable error ... 502").
   */
  test.each(RUNS_IN)(
    "%s: 429, 502, 503 and 504 are sent again",
    (runsIn: FluentdRunsIn) => {
      const output: FluentdSection = httpOutput(
        getFluentdConfig(SELF_HOSTED, runsIn),
      );
      const codes: Array<string> = fluentdArray(
        output.parameters["retryable_response_codes"]!,
      );

      expect(codes).toEqual(["429", "502", "503", "504"]);
      expect(FLUENTD_RETRYABLE_RESPONSE_CODES).toEqual([429, 502, 503, 504]);
    },
  );

  test("not an answer that sending again cannot change", () => {
    const codes: Array<string> = fluentdArray(
      httpOutput(getFluentdConfig(CLOUD, FluentdRunsIn.DockerCompose))
        .parameters["retryable_response_codes"]!,
    );

    /*
     * A wrong key (401), no payment method (402), a disabled or Browser key
     * (422) and a batch over the limit (413) answer the same every time;
     * a 500 a payload causes, too. Fluentd holds back every later batch
     * while it tries one again, for up to retry_timeout.
     */
    for (const code of [
      "400",
      "401",
      "402",
      "403",
      "404",
      "413",
      "422",
      "500",
    ]) {
      expect({ code, retried: codes.includes(code) }).toEqual({
        code,
        retried: false,
      });
    }
  });

  test("OneUptime answers 429 to a key over its rate", () => {
    const middleware: string = readFromHere(
      "../../../Common/Server/Middleware/TelemetryIngest.ts",
    );

    expect(middleware).toContain("new TooManyRequestsException(");
    expect(
      readFromHere("../../../Common/Types/Exception/ExceptionCode.ts"),
    ).toMatch(/TooManyRequestsException = 429/);
  });

  test.each(RUNS_IN)(
    "%s: it tries again about every 30 seconds at most, for 72 hours",
    (runsIn: FluentdRunsIn) => {
      const buffer: FluentdSection = sectionsNamed(
        httpOutput(getFluentdConfig(SELF_HOSTED, runsIn)),
        "buffer",
      )[0]!;

      /*
       * Fluentd's backoff doubles from 1 second without a bound: in the run,
       * nine 503s in a row were tried again 1, 2, 4, 7 and 17 seconds apart,
       * then about every 30 (with retry_max_interval), where without it the
       * seventh try waits 64 seconds, the ninth 256, and an hour's outage
       * leaves the next try up to an hour away.
       */
      expect(fluentdSeconds(buffer.parameters["retry_max_interval"]!)).toBe(30);
      expect(fluentdSeconds(buffer.parameters["retry_timeout"]!)).toBe(
        72 * 3600,
      );
      // Exponential backoff, Fluentd's own, and a batch is dropped after 72 hours, not held for ever.
      expect(buffer.parameters["retry_type"]).toBeUndefined();
      expect(buffer.parameters["retry_forever"]).toBeUndefined();
      expect(buffer.parameters["retry_max_times"]).toBeUndefined();
    },
  );
});

describe("on the host, Fluentd keeps its place in a folder of its own (issue #8007)", () => {
  /*
   * fluent-package (5.0.9, Fluentd 1.16.11, on Debian 12) runs its service
   * as _fluentd, who owns /etc/fluent, /var/lib/fluent and /var/log/fluent;
   * its own fluentd.conf keeps its buffers in /var/log/fluent, and its log
   * is /var/log/fluent/fluentd.log. With the Compose file's
   * /fluentd/log/fluentd.pos, Fluentd run as _fluentd failed in a loop:
   * Errno::EACCES, "Permission denied @ dir_s_mkdir - /fluentd".
   */
  const PACKAGE_FOLDER: string = "/var/log/fluent";
  const PACKAGE_LOG: string = "/var/log/fluent/fluentd.log";
  const tail: FluentdSection = tailOf(configOf(FluentdRunsIn.Host));
  const posFile: string = tail.parameters["pos_file"]!;

  test("the host's file keeps its place outside /fluentd, in the package's folder", () => {
    expect(isUnder(posFile, "/fluentd")).toBe(false);
    expect(path.posix.dirname(posFile)).toBe(PACKAGE_FOLDER);
  });

  test.each(RUNS_IN)(
    "%s: the tail does not read its own place, nor Fluentd's own log",
    (runsIn: FluentdRunsIn) => {
      const runTail: FluentdSection = tailOf(configOf(runsIn));

      for (const file of [runTail.parameters["pos_file"]!, PACKAGE_LOG]) {
        expect({
          file,
          read: globTakes(runTail.parameters["path"]!, file),
        }).toEqual({
          file,
          read: false,
        });
      }

      expect(globTakes(runTail.parameters["path"]!, "/var/log/auth.log")).toBe(
        true,
      );
    },
  );

  test("the run step puts the file where the package's service reads it, and restarts the service", () => {
    const commands: Array<string> = getFluentdHostCommands()
      .split("\n")
      .filter((line: string): boolean => {
        return !line.startsWith("#");
      });

    expect(commands[0]).toBe("sudo cp fluentd.conf /etc/fluent/fluentd.conf");
    expect(commands[commands.length - 1]).toBe(
      "sudo systemctl restart fluentd",
    );
    // Not Fluentd run by hand as the person, who cannot write the package's folder.
    expect(getFluentdHostCommands()).not.toContain("fluentd -c");
  });

  test("Docker Compose keeps its place where it did", () => {
    expect(
      tailOf(configOf(FluentdRunsIn.DockerCompose)).parameters["pos_file"],
    ).toBe("/fluentd/log/fluentd.pos");
  });
});

describe("a log keeps its own time (issue #8010)", () => {
  /*
   * Fluentd's json parser took a JSON line's "time" out of the record, as
   * the event's time, and the HTTP output sends records without their
   * event's time: OneUptime stored every Fluentd log at the time it
   * arrived. The ingest now reads a record's time (FluentRecordTime).
   */
  test.each(RUNS_IN)(
    "%s: a JSON line keeps its time fields as written, and its event the time the tail read it",
    (runsIn: FluentdRunsIn) => {
      const parser: FluentdSection = jsonParserOf(configOf(runsIn));
      const parse: FluentdSection = sectionsNamed(parser, "parse")[0]!;
      const line: JSONObject = {
        time: "2026-11-14T08:00:00.123Z",
        timestamp: 1763107202123,
        "@timestamp": "2026-11-14T08:00:00+01:00",
        ts: 1763107205.5,
        level: "error",
        message: "payment failed",
      };

      // Every time field the ingest reads goes on as the line wrote it.
      expect(jsonParserOutcome(parse, line)).toEqual({
        dropped: false,
        record: line,
      });
      /*
       * The event keeps the time the tail read the line: Fluentd read a
       * JSON line's time as seconds (the json parser's time_type float),
       * so "2026-11-14T08:00:00Z" was the 2026th second of 1970.
       */
      expect(parser.parameters["reserve_time"]).toBe("true");
    },
  );

  test.each(RUNS_IN)(
    "%s: every event's time goes in its record, after the line is read",
    (runsIn: FluentdRunsIn) => {
      const config: FluentdSection = configOf(runsIn);
      const filters: Array<FluentdSection> = filtersOf(config);
      const stampers: Array<FluentdSection> = filters.filter(
        (section: FluentdSection): boolean => {
          return section.parameters["@type"] === "record_transformer";
        },
      );

      expect(stampers.length).toBe(1);

      const stamper: FluentdSection = stampers[0]!;

      // Every event: the tail's lines and whatever the forward port takes (docker.<id>).
      for (const tag of ["app.logs", "docker.3f2a", "web"]) {
        expect(patternTakes(stamper.argument, tag)).toBe(true);
      }

      // Filters run in the order they are written: the parser's time is set first.
      expect(filters.indexOf(stamper)).toBeGreaterThan(
        filters.findIndex((section: FluentdSection): boolean => {
          return section.parameters["@type"] === "parser";
        }),
      );
      // Before the output, at the top, which Fluentd's own logs (the @FLUENT_LOG label) never pass.
      expect(
        config.sections.findIndex((section: FluentdSection): boolean => {
          return section === stamper;
        }),
      ).toBeLessThan(
        config.sections.findIndex((section: FluentdSection): boolean => {
          return section.name === "match";
        }),
      );

      const record: FluentdSection = sectionsNamed(stamper, "record")[0]!;

      expect(Object.keys(record.parameters)).toEqual([FLUENTD_EVENT_TIME_KEY]);
      // Ruby, to the nanosecond and in UTC: ${time} without it is to the second, in the host's zone.
      expect(stamper.parameters["enable_ruby"]).toBe("true");
      expect(record.parameters[FLUENTD_EVENT_TIME_KEY]).toBe(
        '${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}',
      );
    },
  );

  test("the HTTP output has no <inject> section, which it does not use", () => {
    // Fluentd: "section <inject> is not used in <match **> of http plugin".
    for (const runsIn of RUNS_IN) {
      expect(
        sectionsNamed(httpOutput(getFluentdConfig(CLOUD, runsIn)), "inject"),
      ).toEqual([]);
    }
  });

  test("the ingest reads the time the file writes, last, after a record's own, to the nanosecond", () => {
    expect(FLUENTD_EVENT_TIME_KEY).toBe(FLUENTD_EVENT_TIME_FIELD);
    expect(
      FLUENT_RECORD_TIME_FIELDS[FLUENT_RECORD_TIME_FIELDS.length - 1],
    ).toBe(FLUENTD_EVENT_TIME_KEY);

    // What Ruby's strftime wrote for the format above, in the run.
    const arrivedAt: Date = new Date("2026-11-15T10:17:18.703Z");

    expect(
      FluentRecordTimeUtil.read(
        { message: "plain", [FLUENTD_EVENT_TIME_KEY]: RUBY_STRFTIME_EXAMPLE },
        arrivedAt,
      ),
    ).toEqual({
      timeUnixNano: "1794737832834701377",
      timeDate: new Date("2026-11-15T10:17:12.834Z"),
      field: FLUENTD_EVENT_TIME_KEY,
    });
    expect(
      FluentRecordTimeUtil.read(
        {
          time: "2026-11-14T08:00:00.123Z",
          [FLUENTD_EVENT_TIME_KEY]: RUBY_STRFTIME_EXAMPLE,
        },
        arrivedAt,
      ).field,
    ).toBe("time");
  });
});

/*
 * The three follow-ups of #8249, each checked here the way Fluentd and
 * Compose read the files, and again in a run of the files as handed out
 * (fluent/fluentd 1.20.1 in Docker Compose, and fluent-package 5.0.9 with
 * Fluentd 1.16.11 on Debian 12, against a stub of /fluentd/logs; the pull
 * request that closes them has it).
 */

/*
 * What the stub of /fluentd/logs got from the guide's Compose files, in
 * the run, for the lines the old parser dropped and their neighbours.
 */
const RUN_BATCH: Array<JSONObject> = [
  {
    time: null,
    message: "b1 null time",
    fluentd_time: "2026-11-15T17:39:28.041016696Z",
  },
  {
    time: true,
    message: "b1 true time",
    fluentd_time: "2026-11-15T17:39:28.041037898Z",
  },
  {
    time: [1, 2],
    message: "b1 list time",
    fluentd_time: "2026-11-15T17:39:28.041039701Z",
  },
  {
    time: { s: 1 },
    message: "b1 object time",
    fluentd_time: "2026-11-15T17:39:28.041041193Z",
  },
  { message: "b1 no time", fluentd_time: "2026-11-15T17:39:28.041042766Z" },
  {
    time: "2026-11-14T08:00:00.123Z",
    level: "error",
    message: "b1 iso time",
    fluentd_time: "2026-11-15T17:39:28.041043907Z",
  },
];

describe("a JSON line is never dropped for its time (issue #8241)", () => {
  /*
   * In the run of the files as #8249 left them, {"time":null,...},
   * {"time":true,...}, {"time":[1,2],...} and {"time":{"s":1},...} never
   * reached the stub, and Fluentd logged nothing: the json parser read
   * "time" as the event's time and the parser filter dropped the line.
   * With the files below, all of them arrived.
   */
  const OLD_PARSE: FluentdSection = parseFluentd(
    "<parse>\n  @type json\n  keep_time_key true\n</parse>",
  ).sections[0]!;

  test("the model of the json parser drops what Fluentd dropped with the old settings, and reads the rest", () => {
    for (const [what, value] of NOT_TEXT_OR_NUMBER) {
      expect({
        what,
        outcome: jsonParserOutcome(OLD_PARSE, { time: value, message: "x" }),
      }).toEqual({ what, outcome: { dropped: true, record: null } });
    }

    for (const [what, value] of TEXT_OR_NUMBER) {
      expect({
        what,
        outcome: jsonParserOutcome(OLD_PARSE, { time: value, message: "x" }),
      }).toEqual({
        what,
        outcome: { dropped: false, record: { time: value, message: "x" } },
      });
    }

    // Without keep_time_key, as Fluentd's own default, "time" left the record.
    expect(
      jsonParserOutcome(
        parseFluentd("<parse>\n  @type json\n</parse>").sections[0]!,
        {
          time: "2026-11-14T08:00:00Z",
          message: "x",
        },
      ),
    ).toEqual({ dropped: false, record: { message: "x" } });
  });

  test.each(RUNS_IN)(
    "%s: no line is dropped or changed for what a time field the ingest reads holds",
    (runsIn: FluentdRunsIn) => {
      const parse: FluentdSection = sectionsNamed(
        jsonParserOf(configOf(runsIn)),
        "parse",
      )[0]!;
      const loggersFields: Array<string> = FLUENT_RECORD_TIME_FIELDS.filter(
        (field: string): boolean => {
          return field !== FLUENTD_EVENT_TIME_KEY;
        },
      );

      expect(loggersFields).toEqual(["time", "timestamp", "@timestamp", "ts"]);

      for (const field of loggersFields) {
        for (const [what, value] of [
          ...NOT_TEXT_OR_NUMBER,
          ...TEXT_OR_NUMBER,
        ]) {
          const line: JSONObject = {
            [field]: value as JSONObject,
            message: "x",
          };

          expect({
            field,
            what,
            outcome: jsonParserOutcome(parse, line),
          }).toEqual({
            field,
            what,
            outcome: { dropped: false, record: line },
          });
        }
      }
    },
  );

  test.each(RUNS_IN)(
    "%s: the one field the parser reads a time from is the one the next filter writes over",
    (runsIn: FluentdRunsIn) => {
      const config: FluentdSection = configOf(runsIn);
      const parser: FluentdSection = jsonParserOf(config);
      const parse: FluentdSection = sectionsNamed(parser, "parse")[0]!;
      const stamper: FluentdSection = filtersOf(config).find(
        (section: FluentdSection): boolean => {
          return section.parameters["@type"] === "record_transformer";
        },
      )!;

      expect(parse.parameters["time_key"]).toBe(FLUENTD_EVENT_TIME_KEY);
      expect(
        Object.keys(sectionsNamed(stamper, "record")[0]!.parameters),
      ).toEqual([parse.parameters["time_key"]]);
      // After the parser, and on every line the parser reads.
      expect(filtersOf(config).indexOf(stamper)).toBeGreaterThan(
        filtersOf(config).indexOf(parser),
      );
      expect(
        patternTakes(stamper.argument, tailOf(config).parameters["tag"]!),
      ).toBe(true);
      /*
       * A line's own fluentd_time is written over whatever the parser does
       * with it, so keep_time_key would change nothing; "time" is no
       * longer the time key, and stays in the record without it.
       */
      expect(parse.parameters["keep_time_key"]).toBeUndefined();
      // Text or a number in a line's own fluentd_time is read, and the line goes on.
      expect(
        jsonParserOutcome(parse, {
          message: "x",
          [FLUENTD_EVENT_TIME_KEY]: "2020-01-01T00:00:00Z",
        }),
      ).toEqual({ dropped: false, record: { message: "x" } });
    },
  );

  test("the ingest stores such a line at the time Fluentd read it, and keeps its time as an attribute", () => {
    const arrivedAt: Date = new Date("2026-11-15T17:39:33.100Z");

    expect(
      RUN_BATCH.map((record: JSONObject): [unknown, string | null, string] => {
        const read: FluentRecordTime = FluentRecordTimeUtil.read(
          record,
          arrivedAt,
        );

        return [record["message"], read.field, read.timeUnixNano];
      }),
    ).toEqual([
      ["b1 null time", FLUENTD_EVENT_TIME_KEY, "1794764368041016696"],
      ["b1 true time", FLUENTD_EVENT_TIME_KEY, "1794764368041037898"],
      ["b1 list time", FLUENTD_EVENT_TIME_KEY, "1794764368041039701"],
      ["b1 object time", FLUENTD_EVENT_TIME_KEY, "1794764368041041193"],
      ["b1 no time", FLUENTD_EVENT_TIME_KEY, "1794764368041042766"],
      ["b1 iso time", "time", "1794643200123000000"],
    ]);

    // Without the guide's fluentd_time, at the time OneUptime takes it in.
    for (const record of RUN_BATCH.slice(0, 4)) {
      const own: JSONObject = { ...record };

      delete own[FLUENTD_EVENT_TIME_KEY];

      expect(FluentRecordTimeUtil.read(own, arrivedAt)).toEqual({
        timeUnixNano: `${arrivedAt.getTime()}000000`,
        timeDate: arrivedAt,
        field: null,
      });
    }
  });
});

// A list setting of the fluentd service, as `    ports:` and its `      - ...` lines write it.
const composeServiceList: (compose: string, name: string) => Array<string> = (
  compose: string,
  name: string,
): Array<string> => {
  const lines: Array<string> = compose.split("\n");
  const start: number = lines.indexOf(`    ${name}:`);

  if (start < 0) {
    return [];
  }

  const values: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("      #")) {
      continue;
    }

    const item: RegExpMatchArray | null = line.match(/^ {6}- (.+)$/);

    if (!item) {
      break;
    }

    values.push(item[1]!.replace(/^"(.*)"$/, "$1"));
  }

  return values;
};

describe("the batches still to send outlive Fluentd (issue #8242)", () => {
  /*
   * The buffer was in memory. In the run, a batch the stub answered 503
   * for was lost when the container was made again: its five lines never
   * arrived, and the tail had moved past them. With the file buffer, the
   * chunk stayed in the volume, the new container sent it again, and when
   * the stub answered 200 Fluentd logged "retry succeeded" for the same
   * chunk. On the host, the same when the service was stopped and started.
   */
  test.each(RUNS_IN)(
    "%s: the output keeps its batches in a file buffer, in Fluentd's state folder",
    (runsIn: FluentdRunsIn) => {
      const output: FluentdSection = httpOutput(
        getFluentdConfig(SELF_HOSTED, runsIn),
      );
      const bufferPath: string = bufferOf(output).parameters["path"]!;

      expect(bufferType(output)).toBe("file");
      expect(bufferPath).toBe(FLUENTD_BUFFER_PATHS[runsIn]);
      expect(isUnder(bufferPath, FLUENTD_STATE_FOLDERS[runsIn])).toBe(true);
      // Beside the tail's place, which outlives Fluentd for the same reason.
      expect(
        isUnder(
          tailOf(configOf(runsIn)).parameters["pos_file"]!,
          FLUENTD_STATE_FOLDERS[runsIn],
        ),
      ).toBe(true);
      // Its own folder: Fluentd refuses two buffers on one path.
      expect(path.posix.basename(bufferPath)).toBe("oneuptime");
    },
  );

  test("in Docker Compose, the buffer is in the state volume, under no read-only mount", () => {
    const compose: string = getFluentdDockerCompose();
    const holders: Array<ComposeMount> = composeMounts(compose).filter(
      (mount: ComposeMount): boolean => {
        return isUnder(
          FLUENTD_BUFFER_PATHS[FluentdRunsIn.DockerCompose],
          mount.target,
        );
      },
    );

    expect(holders).toEqual([
      {
        source: "fluentd-state",
        target: FLUENTD_STATE_FOLDERS[FluentdRunsIn.DockerCompose],
        readOnly: false,
      },
    ]);
    // A named volume, which a container made again finds as it was left.
    expect(compose).toMatch(/^volumes:\n {2}fluentd-state:$/m);
  });

  test("on the host, the buffer is in the package's folder, which its user owns, beside the package's own", () => {
    const bufferPath: string = FLUENTD_BUFFER_PATHS[FluentdRunsIn.Host];

    // fluent-package's _fluentd owns /var/log/fluent; its own file buffers to /var/log/fluent/buffer/td.
    expect(isUnder(bufferPath, "/var/log/fluent")).toBe(true);
    expect(isUnder(bufferPath, "/fluentd")).toBe(false);
    expect(bufferPath).not.toBe("/var/log/fluent/buffer/td");
    expect(path.posix.dirname(bufferPath)).toBe("/var/log/fluent/buffer");
  });

  test.each(RUNS_IN)(
    "%s: the tail reads none of the buffer's files",
    (runsIn: FluentdRunsIn) => {
      const glob: string = tailOf(configOf(runsIn)).parameters["path"]!;
      const bufferPath: string = FLUENTD_BUFFER_PATHS[runsIn];

      // The names Fluentd gave the chunk and its meta file in the run: staged (b) and queued (q).
      for (const file of [
        "buffer.b6605425b03973fb1f2abdf218e4d140e.log",
        "buffer.b6605425b03973fb1f2abdf218e4d140e.log.meta",
        "buffer.q6605425b03973fb1f2abdf218e4d140e.log",
        "buffer.q6605425b03973fb1f2abdf218e4d140e.log.meta",
      ]) {
        expect({
          file,
          read: globTakes(glob, `${bufferPath}/${file}`),
        }).toEqual({ file, read: false });
      }
    },
  );

  test.each(RUNS_IN)(
    "%s: it keeps at most 512 MB, what the memory buffer held, and a chunk is still one request",
    (runsIn: FluentdRunsIn) => {
      const output: FluentdSection = httpOutput(
        getFluentdConfig(SELF_HOSTED, runsIn),
      );
      const totalBytes: number = bufferLimitBytes(output, "total_limit_size");
      const limit: number = ingressBodyLimitBytes(
        readFromHere("../../../Nginx/default.conf.template"),
        readFromHere("../../../Nginx/nginx.conf"),
        FLUENTD_LOGS_PATH,
      );

      expect(FLUENTD_BUFFER_TOTAL_LIMIT).toBe("512m");
      // Set in the file: the file buffer's own limit is not the memory buffer's.
      expect(bufferOf(output).parameters["total_limit_size"]).toBe(
        FLUENTD_BUFFER_TOTAL_LIMIT,
      );
      expect(bufferType(output)).toBe("file");
      expect(totalBytes).toBe(512 * MB);
      // A file buffer's own limit is 64 GB, more than a small host's disk.
      expect(totalBytes).toBe(FLUENTD_BUFFER_DEFAULTS["memory"]!.totalBytes);
      expect(totalBytes).toBeLessThan(
        FLUENTD_BUFFER_DEFAULTS["file"]!.totalBytes,
      );
      // A file buffer's own chunk is 256 MB: the file sets 900k, as for memory.
      expect(chunkLimitBytes(output)).toBe(900 * 1024);
      expect(chunkLimitBytes(output) + 1).toBeLessThanOrEqual(limit);
      expect(chunkLimitBytes(output)).toBeLessThan(totalBytes);
      /*
       * Full, it takes no more: in the run, with the buffer full, Fluentd
       * logged "buffer space has too many data", the tail kept its place,
       * and every line arrived once when the stub answered 200 again.
       */
      expect(bufferOf(output).parameters["overflow_action"]).toBeUndefined();
    },
  );
});

describe("the forward port takes events from this host alone (issue #8243)", () => {
  const compose: string = getFluentdDockerCompose();

  // Where Docker's fluentd log driver sends when fluentd-address is not set.
  const DOCKER_LOG_DRIVER_DEFAULT_ADDRESS: string = "localhost:24224";

  const forwardOf: (config: FluentdSection) => FluentdSection = (
    config: FluentdSection,
  ): FluentdSection => {
    const forwards: Array<FluentdSection> = sectionsNamed(
      config,
      "source",
    ).filter((section: FluentdSection): boolean => {
      return section.parameters["@type"] === "forward";
    });

    expect(forwards.length).toBe(1);

    return forwards[0]!;
  };

  test.each(RUNS_IN)(
    "%s: the forward input listens on the port Docker's log driver sends to",
    (runsIn: FluentdRunsIn) => {
      const forward: FluentdSection = forwardOf(configOf(runsIn));

      expect(forward.parameters["port"]).toBe(String(FLUENTD_FORWARD_PORT));
      expect(forward.parameters["bind"]).toBe(FLUENTD_FORWARD_BINDS[runsIn]);
      expect(DOCKER_LOG_DRIVER_DEFAULT_ADDRESS).toBe(
        `localhost:${FLUENTD_FORWARD_PORT}`,
      );
    },
  );

  test("on the host, Fluentd listens on the loopback address alone", () => {
    expect(forwardOf(configOf(FluentdRunsIn.Host)).parameters["bind"]).toBe(
      "127.0.0.1",
    );
  });

  test("in Docker Compose, the port is published on the host's loopback alone, to the forward input", () => {
    const ports: Array<string> = composeServiceList(compose, "ports");

    expect(ports).toEqual([FLUENTD_FORWARD_PUBLISHED]);
    expect(FLUENTD_FORWARD_PUBLISHED).toBe("127.0.0.1:24224:24224");

    for (const port of ports) {
      // host address : host port : container port; with no address, Docker publishes on every one.
      const [hostAddress, hostPort, containerPort] = port.split(":");

      expect({ port, hostAddress }).toEqual({ port, hostAddress: "127.0.0.1" });
      expect(hostPort).toBe(String(FLUENTD_FORWARD_PORT));
      expect(containerPort).toBe(String(FLUENTD_FORWARD_PORT));
    }

    // A published port reaches the container on its own address, not its loopback.
    expect(
      forwardOf(configOf(FluentdRunsIn.DockerCompose)).parameters["bind"],
    ).toBe("0.0.0.0");
    // Nor does the container share the host's network, where 0.0.0.0 is every address the host has.
    expect(compose).not.toMatch(/network_mode|^\s+expose:/m);
  });

  test("in Docker Compose, root keeps none of its powers but reading and writing any file", () => {
    /*
     * In the run: the container's effective capabilities were 0x2
     * (DAC_OVERRIDE alone), and it read a root:root 0600 file and a
     * 104:adm 0640 one, and wrote the volume. With no capability at all,
     * Fluentd logged "/var/log/syslog.log unreadable. It is excluded".
     */
    expect(composeServiceList(compose, "cap_drop")).toEqual(["ALL"]);
    expect(composeServiceList(compose, "cap_add")).toEqual(
      FLUENTD_COMPOSE_CAPABILITIES,
    );
    expect(FLUENTD_COMPOSE_CAPABILITIES).toEqual(["DAC_OVERRIDE"]);
    expect(compose).not.toMatch(/privileged|security_opt/);
    expect(composeServiceSetting(compose, "user")).toBe("root");
  });

  test.each([SELF_HOSTED, CLOUD])(
    "the file says where the server's own docs say how to take events from other hosts ($host)",
    (endpoint: CompatibleIngestEndpoint) => {
      for (const runsIn of RUNS_IN) {
        expect(getFluentdConfig(endpoint, runsIn)).toContain(
          `\n  # ${endpoint.protocol}://${endpoint.host}${FLUENTD_OTHER_HOSTS_DOCS_PATH}\n  bind `,
        );
      }

      // And the Compose file points at fluentd.conf, which says it.
      expect(compose).toContain(
        "# This host alone may send: fluentd.conf says how to take events from other hosts",
      );
    },
  );

  test("the docs section the file links to is on the English Fluentd page", () => {
    const [pagePath, anchor] = FLUENTD_OTHER_HOSTS_DOCS_PATH.split("#") as [
      string,
      string,
    ];

    expect(pagePath).toBe("/docs/telemetry/fluentd");

    const page: string = readFromHere(
      `../../FeatureSet/Docs/Content/en${pagePath.replace(/^\/docs/, "")}.md`,
    );
    const slugs: Array<string> = Array.from(
      page.matchAll(/^#{2,3} (.+)$/gm),
    ).map((match: RegExpMatchArray): string => {
      return slugifyMarkdownHeading(match[1]!);
    });

    expect(slugs).toContain(anchor);
  });
});

/*
 * A forward input other hosts can reach - listening on an address that is
 * not a loopback one, or published on one by Compose - must ask each
 * sender for a shared key, over TLS.
 */
const LOOPBACK: RegExp = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;

const forwardSafetyProblems: (
  forward: FluentdSection,
  publishedOn: Array<string> | null,
) => Array<string> = (
  forward: FluentdSection,
  publishedOn: Array<string> | null,
): Array<string> => {
  const bind: string = forward.parameters["bind"] ?? "0.0.0.0";
  const reachable: boolean =
    publishedOn === null
      ? !LOOPBACK.test(bind)
      : publishedOn.some((address: string): boolean => {
          return !LOOPBACK.test(address);
        });

  if (!reachable) {
    return [];
  }

  const problems: Array<string> = [];
  const security: FluentdSection | undefined = sectionsNamed(
    forward,
    "security",
  )[0];
  const transport: FluentdSection | undefined = sectionsNamed(
    forward,
    "transport",
  ).find((section: FluentdSection): boolean => {
    return section.argument === "tls";
  });

  if (
    !security?.parameters["shared_key"] ||
    !security.parameters["self_hostname"]
  ) {
    problems.push("no shared key");
  }

  if (
    !transport?.parameters["cert_path"] ||
    !transport.parameters["private_key_path"]
  ) {
    problems.push("no TLS");
  }

  return problems;
};

describe("a forward input other hosts can reach asks for a shared key and TLS", () => {
  const forwardIn: (config: string) => FluentdSection = (
    config: string,
  ): FluentdSection => {
    return sectionsNamed(parseFluentd(config), "source").find(
      (section: FluentdSection): boolean => {
        return section.parameters["@type"] === "forward";
      },
    )!;
  };

  test("the rule finds the files as they were: every address, no key, no TLS", () => {
    const old: FluentdSection = forwardIn(
      "<source>\n  @type forward\n  port 24224\n  bind 0.0.0.0\n</source>",
    );

    expect(forwardSafetyProblems(old, null)).toEqual([
      "no shared key",
      "no TLS",
    ]);
    // Inside a container on 0.0.0.0, and Compose publishing "24224:24224" on every address.
    expect(forwardSafetyProblems(old, ["0.0.0.0"])).toEqual([
      "no shared key",
      "no TLS",
    ]);
    // No bind is every address, Fluentd's own default.
    expect(
      forwardSafetyProblems(
        forwardIn("<source>\n  @type forward\n</source>"),
        null,
      ),
    ).toEqual(["no shared key", "no TLS"]);
  });

  test.each(RUNS_IN)("%s: the guide's file", (runsIn: FluentdRunsIn) => {
    const published: Array<string> | null =
      runsIn === FluentdRunsIn.DockerCompose
        ? composeServiceList(getFluentdDockerCompose(), "ports").map(
            (port: string): string => {
              return port.split(":")[0]!;
            },
          )
        : null;

    expect(
      forwardSafetyProblems(
        forwardIn(getFluentdConfig(CLOUD, runsIn)),
        published,
      ),
    ).toEqual([]);
  });

  test("the docs page's files: the complete example on this host alone, and the one for other hosts with a key and TLS", () => {
    const page: string = readFromHere(
      "../../FeatureSet/Docs/Content/en/telemetry/fluentd.md",
    );
    const blocks: Array<string> = Array.from(
      page.matchAll(/^```text title="fluentd\.conf[^"]*"\n([\s\S]*?)\n```$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    const forwards: Array<FluentdSection> = blocks
      .filter((block: string): boolean => {
        return (
          /@type forward\n\s+port/.test(block) && block.includes("<source>")
        );
      })
      .map(forwardIn);

    expect(
      forwards.map((forward: FluentdSection): [string, Array<string>] => {
        return [
          forward.parameters["bind"]!,
          forwardSafetyProblems(forward, null),
        ];
      }),
    ).toEqual([
      ["127.0.0.1", []],
      ["0.0.0.0", []],
    ]);
  });
});

describe("the Fluentd docs page's files agree with the guide's", () => {
  const docsConfigs: Array<string> = Array.from(
    readFromHere(
      "../../FeatureSet/Docs/Content/en/telemetry/fluentd.md",
    ).matchAll(/^```text title="fluentd\.conf"\n([\s\S]*?)\n```$/gm),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
  const guideText: string = getFluentdConfig(
    CLOUD,
    FluentdRunsIn.DockerCompose,
  );
  const guideOutput: FluentdSection = httpOutput(guideText);
  const guideStamper: FluentdSection = sectionsNamed(
    parseFluentd(guideText),
    "filter",
  ).find((section: FluentdSection): boolean => {
    return section.parameters["@type"] === "record_transformer";
  })!;

  test("the page has its two files", () => {
    expect(docsConfigs.length).toBe(2);
  });

  test.each([0, 1])(
    "file %i keeps Fluentd's own logs out, and posts chunks of the guide's size",
    (index: number) => {
      const docsConfig: string = docsConfigs[index]!;
      const docsOutput: FluentdSection = httpOutput(docsConfig);

      expect(ownLogOutputs(docsConfig)).toEqual(
        FLUENTD_OWN_LOG_TAGS.map((): string => {
          return "null";
        }),
      );
      expect(docsOutput.parameters["json_array"]).toBe("true");
      expect(chunkLimitBytes(docsOutput)).toBe(chunkLimitBytes(guideOutput));
    },
  );

  test.each([0, 1])(
    "file %i sends a batch again on the guide's answers, and as often and as long (issue #8006)",
    (index: number) => {
      const docsOutput: FluentdSection = httpOutput(docsConfigs[index]!);
      const docsBuffer: FluentdSection = sectionsNamed(
        docsOutput,
        "buffer",
      )[0]!;
      const guideBuffer: FluentdSection = sectionsNamed(
        guideOutput,
        "buffer",
      )[0]!;

      expect(
        fluentdArray(docsOutput.parameters["retryable_response_codes"]!),
      ).toEqual(FLUENTD_RETRYABLE_RESPONSE_CODES.map(String));

      for (const setting of ["retry_max_interval", "retry_timeout"]) {
        expect({ setting, value: docsBuffer.parameters[setting] }).toEqual({
          setting,
          value: guideBuffer.parameters[setting],
        });
      }
    },
  );

  test.each([0, 1])(
    "file %i writes the time Fluentd gave each event into its record, as the guide's does (issue #8010)",
    (index: number) => {
      const docsConfig: FluentdSection = parseFluentd(docsConfigs[index]!);
      const stampers: Array<FluentdSection> = sectionsNamed(
        docsConfig,
        "filter",
      ).filter((section: FluentdSection): boolean => {
        return section.parameters["@type"] === "record_transformer";
      });

      expect(stampers).toEqual([guideStamper]);
      expect(docsConfig.sections.indexOf(stampers[0]!)).toBeLessThan(
        docsConfig.sections.findIndex((section: FluentdSection): boolean => {
          return section.name === "match";
        }),
      );
    },
  );

  test.each([0, 1])(
    "file %i keeps its batches on disk, in fluent-package's folder, as much as the guide's host file (issue #8242)",
    (index: number) => {
      const docsOutput: FluentdSection = httpOutput(docsConfigs[index]!);
      const hostOutput: FluentdSection = httpOutput(
        getFluentdConfig(CLOUD, FluentdRunsIn.Host),
      );

      // The page's Fluentd is the package's: its file is /etc/fluent/fluentd.conf.
      expect(bufferType(docsOutput)).toBe("file");
      expect(bufferOf(docsOutput).parameters["path"]).toBe(
        FLUENTD_BUFFER_PATHS[FluentdRunsIn.Host],
      );
      expect(bufferLimitBytes(docsOutput, "total_limit_size")).toBe(
        bufferLimitBytes(hostOutput, "total_limit_size"),
      );
    },
  );

  test("the complete example's forward input listens on this host alone, as the guide's host file does (issue #8243)", () => {
    const forward: FluentdSection = sectionsNamed(
      parseFluentd(docsConfigs[1]!),
      "source",
    ).find((section: FluentdSection): boolean => {
      return section.parameters["@type"] === "forward";
    })!;

    expect(forward.parameters["bind"]).toBe(
      FLUENTD_FORWARD_BINDS[FluentdRunsIn.Host],
    );
    expect(forward.parameters["port"]).toBe(String(FLUENTD_FORWARD_PORT));
  });

  describe("the files that take records from other hosts (issue #8243)", () => {
    const page: string = readFromHere(
      "../../FeatureSet/Docs/Content/en/telemetry/fluentd.md",
    );
    const titledText: (title: string) => string = (title: string): string => {
      const blocks: Array<string> = Array.from(
        page.matchAll(
          new RegExp(
            `^\`\`\`text title="${escapeRegExp(title)}"\\n([\\s\\S]*?)\\n\`\`\`$`,
            "gm",
          ),
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(blocks.length).toBe(1);

      return blocks[0]!;
    };
    const titled: (title: string) => FluentdSection = (
      title: string,
    ): FluentdSection => {
      return parseFluentd(titledText(title));
    };
    const receiver: FluentdSection = sectionsNamed(
      titled("fluentd.conf on this host"),
      "source",
    )[0]!;
    const sender: FluentdSection = sectionsNamed(
      titled("fluentd.conf on each sender"),
      "match",
    )[0]!;
    const receiverSecurity: FluentdSection = sectionsNamed(
      receiver,
      "security",
    )[0]!;
    const senderSecurity: FluentdSection = sectionsNamed(
      sender,
      "security",
    )[0]!;

    test("this host listens on every address, on the guide's port, for a shared key over TLS", () => {
      expect(receiver.parameters).toEqual({
        "@type": "forward",
        port: String(FLUENTD_FORWARD_PORT),
        bind: "0.0.0.0",
      });
      expect(
        sectionsNamed(receiver, "transport").map(
          (section: FluentdSection): string => {
            return section.argument;
          },
        ),
      ).toEqual(["tls"]);
      expect(Object.keys(receiverSecurity.parameters).sort()).toEqual([
        "self_hostname",
        "shared_key",
      ]);
      // A sender with no key is not let in as an anonymous one (Fluentd's own default).
      expect(
        receiverSecurity.parameters["allow_anonymous_source"],
      ).toBeUndefined();
      expect(receiverSecurity.parameters["user_auth"]).toBeUndefined();
    });

    test("each sender sends to it over TLS, with the same key, to the name its certificate is for", () => {
      expect(sender.parameters["@type"]).toBe("forward");
      expect(sender.parameters["transport"]).toBe("tls");
      expect(senderSecurity.parameters["shared_key"]).toBe(
        receiverSecurity.parameters["shared_key"],
      );
      expect(receiverSecurity.parameters["shared_key"]).toBe("YOUR_SHARED_KEY");
      // Each side names itself: the same name on both would not tell them apart in Fluentd's log.
      expect(senderSecurity.parameters["self_hostname"]).not.toBe(
        receiverSecurity.parameters["self_hostname"],
      );

      const server: FluentdSection = sectionsNamed(sender, "server")[0]!;

      expect(server.parameters).toEqual({
        host: receiverSecurity.parameters["self_hostname"],
        port: String(FLUENTD_FORWARD_PORT),
      });
      // The hostname is checked against the certificate (tls_verify_hostname, true by default).
      expect(sender.parameters["tls_verify_hostname"]).toBeUndefined();
      expect(sender.parameters["tls_insecure_mode"]).toBeUndefined();
    });

    test("a sender keeps its own logs to itself, as this host does", () => {
      // Without the label, its <match **> sent Fluentd's own logs on, and Fluentd warned it is deprecated.
      expect(ownLogOutputs(titledText("fluentd.conf on each sender"))).toEqual(
        FLUENTD_OWN_LOG_TAGS.map((): string => {
          return "null";
        }),
      );
    });

    test("a sender keeps its batches on disk too, on a path of its own", () => {
      const senderBuffer: FluentdSection = bufferOf(sender);

      expect(bufferType(sender)).toBe("file");
      expect(senderBuffer.parameters["path"]).not.toBe(
        FLUENTD_BUFFER_PATHS[FluentdRunsIn.Host],
      );
      expect(isUnder(senderBuffer.parameters["path"]!, "/var/log/fluent")).toBe(
        true,
      );
    });
  });
});

describe("the paths are the ones a server serves", () => {
  const read: (relativePath: string) => string = readFromHere;

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
