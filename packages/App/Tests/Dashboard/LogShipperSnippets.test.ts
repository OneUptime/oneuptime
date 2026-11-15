import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { CompatibleIngestEndpoint } from "../../FeatureSet/Dashboard/src/Components/Telemetry/CompatibleIngestGuide";
import {
  FLUENTD_EVENT_TIME_KEY,
  FLUENTD_LOGS_PATH,
  FLUENTD_POSITION_FILES,
  FLUENTD_RETRYABLE_RESPONSE_CODES,
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
    keep_time_key true
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
    @type memory
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

  test("on the host, the same file but for where the tail keeps its place", () => {
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
        "  pos_file /var/log/fluent/fluentd.pos",
        "  pos_file /fluentd/log/fluentd.pos",
      ],
    ]);
    expect(FLUENTD_POSITION_FILES).toEqual({
      [FluentdRunsIn.Host]: "/var/log/fluent/fluentd.pos",
      [FluentdRunsIn.DockerCompose]: "/fluentd/log/fluentd.pos",
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
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
      - /var/log:/var/log:ro
      - fluentd-positions:/fluentd/log
    ports:
      - "24224:24224"

volumes:
  fluentd-positions:`);
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

// Fluentd's own chunk size when <buffer> sets none (Buffer::DEFAULT_CHUNK_LIMIT_SIZE).
const FLUENTD_DEFAULT_CHUNK_BYTES: number = 8 * 1024 * 1024;

// A buffer chunk's most bytes: chunk_limit_size, as Fluentd reads a size.
const chunkLimitBytes: (output: FluentdSection) => number = (
  output: FluentdSection,
): number => {
  const size: string | undefined = sectionsNamed(output, "buffer")[0]
    ?.parameters["chunk_limit_size"];

  if (size === undefined) {
    return FLUENTD_DEFAULT_CHUNK_BYTES;
  }

  const match: RegExpMatchArray | null = size.match(/^(\d+)([kmgt]?)$/i);

  if (!match) {
    throw new Error(`A size this test does not read: ${size}`);
  }

  const power: number = ["", "k", "m", "g", "t"].indexOf(
    match[2]!.toLowerCase(),
  );

  return parseInt(match[1]!, 10) * Math.pow(1024, power);
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
        source: "fluentd-positions",
        target: IMAGE_USER_FOLDER,
        readOnly: false,
      },
    ]);
    // A named volume, which a new one starts as a copy of the image's folder, owner and all.
    expect(compose).toMatch(/^volumes:\n {2}fluentd-positions:$/m);
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
        source: "fluentd-positions",
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
    "%s: a JSON line keeps its time field, and its event the time the tail read it",
    (runsIn: FluentdRunsIn) => {
      const config: FluentdSection = configOf(runsIn);
      const parser: FluentdSection = filtersOf(config).find(
        (section: FluentdSection): boolean => {
          return section.parameters["@type"] === "parser";
        },
      )!;
      const parse: FluentdSection = sectionsNamed(parser, "parse")[0]!;

      expect(parse.parameters["keep_time_key"]).toBe("true");
      /*
       * Fluentd reads a JSON line's time as seconds (the json parser's
       * time_type float): "2026-11-14T08:00:00Z" was the 2026th second of
       * 1970. reserve_time keeps the time the tail read the line instead.
       */
      expect(parser.parameters["reserve_time"]).toBe("true");
      // The time key is the one the ingest reads first.
      expect(parse.parameters["time_key"] ?? "time").toBe(
        FLUENT_RECORD_TIME_FIELDS[0],
      );
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
