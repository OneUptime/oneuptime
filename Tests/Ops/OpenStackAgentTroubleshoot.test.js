"use strict";

/**
 * agents/OpenStackAgent/troubleshoot.sh, run for real with the real curl against
 * a local server that answers as a cloud's Keystone and services, an exporter and
 * OneUptime do. `docker` is a stub that runs the curl it is asked to run, so what
 * reaches the server went through every quote, pipe and stdin the script uses.
 *
 * No real OpenStack answers here: the shapes the server gives are the APIs' as
 * Tests/Ops/openstack-e2e records them, and what it says of each kind of credential
 * is what #5721 says they do. `access-matrix.sh` runs the same reads on real policies.
 *
 * The check it exists for: OpenStack has no global read-only role, and a 200 is no
 * proof. Neutron and Cinder answer a plain reader with a 200 and only its own
 * project, so a list where every row has one project id is "may be own project
 * only", shared networks and public images do not count as seeing another project,
 * and each gap says which pages and alerts go without it and what to do.
 *
 * AgentTroubleshootTokenCheck.test.js runs the ingestion-key matrix over this script.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const SCRIPT = path.join(AGENT_DIR, "troubleshoot.sh");
const MATRIX = path.join(__dirname, "openstack-e2e", "access-matrix.py");
const ACCESS_RULES = path.join(
  AGENT_DIR,
  "access",
  "application-credential-access-rules.json",
);

const CURL_IMAGE = "fake/curl";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const TOKEN = "gAAAAB-issued-token-never-to-be-logged";
const APP_ID = "4c2f7bd8a1e94f6b8d3c0e5a7f1b2c3d";
const APP_SECRET = `s3cr$t'x"y\\ #: {z}`;
const OWN_PROJECT = "own-project";
const OTHER_PROJECT = "other-project";

// A run makes some fifty requests, each its own processes: minutes on a busy machine.
jest.setTimeout(900000);

const REAL_CURL = spawnSync("sh", ["-c", "command -v curl"], {
  encoding: "utf8",
}).stdout.trim();

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-doctor-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/* -------------------------------------------------- the reads, from each side */

// access-matrix.py's READS: service type, what it reads, path, the list's key.
function matrixReads() {
  const source = fs.readFileSync(MATRIX, "utf8");
  const block = source.slice(
    source.indexOf("READS = ["),
    source.indexOf("# Writes a monitoring credential"),
  );
  return Array.from(
    block.matchAll(/^\s+\("([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)", /gm),
  ).map(([, service, label, readPath, key]) => {
    return { service, label, readPath, key };
  });
}

// The doctor's table of the same reads, every column.
function doctorHoldings() {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf("<<'HOLDINGS'\n") + "<<'HOLDINGS'\n".length;
  const table = source.slice(start, source.indexOf("\nHOLDINGS\n", start));
  return table.split("\n").map((line) => {
    const [service, label, readPath, key, version] = line.split("|");
    return { service, label, readPath, key, version };
  });
}

function doctorReads() {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const start = source.indexOf("<<'READS'\n") + "<<'READS'\n".length;
  const table = source.slice(start, source.indexOf("\nREADS\n", start));
  return table.split("\n").map((line) => {
    const [service, label, readPath, key, attr, version, cost, fix] =
      line.split("|");
    return { service, label, readPath, key, attr, version, cost, fix };
  });
}

/*
 * What a row of a list looks like, by the attribute naming its project, as each
 * API answers it. The rest have no per-project rows.
 */
const ROW_OF = {
  "compute:servers, all projects": (project) => {
    return { id: `server-${project}`, tenant_id: project };
  },
  "network:networks": (project, shared = false) => {
    return {
      project_id: project,
      shared,
      "router:external": shared,
    };
  },
  "network:subnets": (project) => {
    return { project_id: project };
  },
  "network:routers": (project) => {
    return { project_id: project };
  },
  "network:floating IPs": (project) => {
    return { project_id: project };
  },
  "network:IP availabilities": (project) => {
    return { project_id: project, network_id: `net-${project}` };
  },
  "network:security groups": (project) => {
    return { project_id: project, shared: false };
  },
  "network:ports": (project) => {
    return { project_id: project };
  },
  "block-storage:volumes, all projects": (project) => {
    return { id: `volume-${project}`, "os-vol-tenant-attr:tenant_id": project };
  },
  "block-storage:snapshots, all projects": (project) => {
    return {
      id: `snapshot-${project}`,
      "os-extended-snapshot-attributes:project_id": project,
    };
  },
  "block-storage:backups, all projects": (project) => {
    return {
      id: `backup-${project}`,
      "os-backup-project-attr:project_id": project,
    };
  },
  "image:images": (project, visibility = "private") => {
    return { id: `image-${project}`, owner: project, visibility };
  },
  "load-balancer:load balancers": (project) => {
    return { id: `lb-${project}`, project_id: project };
  },
};

function rowsIn(read, projects) {
  const row = ROW_OF[`${read.service}:${read.label}`];
  return projects.map((project) => {
    return row ? row(project) : { id: `${read.key}-${project}` };
  });
}

const INFRA_READS = [
  "compute:services",
  "compute:hypervisors",
  "compute:aggregates",
  "compute:availability zones, detail",
  "placement:resource providers",
  "network:agents",
  "network:IP availabilities",
  "block-storage:services",
  "block-storage:pools",
  "identity:projects",
  "identity:domains",
  "identity:services",
  "identity:endpoints",
];

// An admin: every project's rows.
function fullView(read) {
  return { rows: rowsIn(read, [OWN_PROJECT, OTHER_PROJECT]) };
}

/*
 * A plain reader, as #5721 has it: 403 for what defaults to admin and for Nova's
 * all_tenants, and a 200 with its own project from Neutron, Cinder and the rest,
 * plus what is anyone's to see: a shared network and its subnet, a public image.
 */
function projectView(read) {
  const name = `${read.service}:${read.label}`;
  if (INFRA_READS.includes(name)) {
    return { status: 403 };
  }
  switch (name) {
    case "compute:servers, all projects":
    case "compute:usage per project":
    case "network:quotas":
    case "load-balancer:amphorae":
      return { status: 403 };
    case "network:networks":
      return {
        rows: [ROW_OF[name](OWN_PROJECT), ROW_OF[name](OTHER_PROJECT, true)],
      };
    case "network:subnets":
      return { rows: rowsIn(read, [OWN_PROJECT, OTHER_PROJECT]) };
    case "image:images":
      return {
        rows: [
          ROW_OF[name](OWN_PROJECT),
          ROW_OF[name](OTHER_PROJECT, "public"),
        ],
      };
    default:
      return { rows: rowsIn(read, [OWN_PROJECT, OWN_PROJECT]) };
  }
}

// The monitoring role with the policy overrides: infrastructure, and its own project.
function infrastructureOnly(read) {
  const name = `${read.service}:${read.label}`;
  if (INFRA_READS.includes(name)) {
    return fullView(read);
  }
  return projectView(read);
}

const SERVICE_PATH = {
  compute: "compute/v2.1",
  placement: "placement",
  network: "network",
  "block-storage": "volume/v3",
  image: "image",
  "load-balancer": "load-balancer",
  baremetal: "baremetal",
};

/*
 * The cloud. Keystone is at /identity and refuses any credential but the one it is
 * given; each service is at /<region>/<service>, answers with the scenario, and
 * refuses a request without the token. OneUptime is at /oneuptime, and the exporter
 * at /probe. Every request is kept.
 */
function startCloud({
  scenario = fullView,
  regions = ["RegionOne"],
  services = Object.keys(SERVICE_PATH),
  credential = { application_credential: { id: APP_ID, secret: APP_SECRET } },
  tokenExtra = {},
  roles = ["admin"],
  loginStatus = 201,
  serviceStatus = {},
  catalogNames = {},
  holds = [],
  holdsRefused = [],
  probe = (url) => {
    return regions.includes(url.searchParams.get("cloud"))
      ? "# HELP openstack_identity_up up\nopenstack_identity_up 1\nopenstack_identity_regions 2\n"
      : "";
  },
} = {}) {
  const requests = [];
  const logins = [];
  const reads = matrixReads();

  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const url = new URL(request.url, "http://cloud");
      const send = (status, payload, headers = {}) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          ...headers,
        });
        response.end(
          typeof payload === "string" ? payload : JSON.stringify(payload),
        );
      };
      requests.push({
        method: request.method,
        path: url.pathname,
        query: url.searchParams,
        token: request.headers["x-auth-token"],
        version:
          request.headers["openstack-api-version"] ||
          request.headers["x-openstack-ironic-api-version"],
      });

      if (url.pathname === "/probe") {
        return send(200, probe(url), { "Content-Type": "text/plain" });
      }
      if (url.pathname === "/oneuptime/otlp/v1/validate") {
        return request.headers["x-oneuptime-token"] === KEY
          ? send(200, { valid: true, keyType: "Server" })
          : send(401, { valid: false });
      }
      if (url.pathname === "/identity/v3/auth/tokens") {
        const identity = JSON.parse(body).auth.identity;
        logins.push(identity);
        const accepted = Object.entries(credential).every(([kind, value]) => {
          return JSON.stringify(identity[kind]) === JSON.stringify(value);
        });
        if (!accepted || loginStatus === 401) {
          return send(401, { error: { code: 401, title: "Unauthorized" } });
        }
        if (loginStatus !== 201) {
          return send(loginStatus, { error: { code: loginStatus } });
        }
        const base = `http://${request.headers.host}`;
        return send(
          201,
          {
            token: {
              project: { id: OWN_PROJECT, name: "monitoring" },
              roles: roles.map((name) => {
                return { name };
              }),
              ...tokenExtra,
              catalog: [
                {
                  type: "identity",
                  name: "keystone",
                  endpoints: regions.map((region) => {
                    return {
                      region_id: region,
                      region,
                      interface: "public",
                      url: `${base}/identity`,
                    };
                  }),
                },
                ...services.map((type) => {
                  return {
                    type: catalogNames[type] || type,
                    name: type,
                    endpoints: regions.flatMap((region) => {
                      return ["public", "internal"].map((face) => {
                        return {
                          region_id: region,
                          region,
                          interface: face,
                          url: `${base}/${region.replace(/ /g, "_")}/${SERVICE_PATH[type]}${face === "internal" ? "-internal" : ""}`,
                        };
                      });
                    }),
                  };
                }),
              ],
            },
          },
          { "X-Subject-Token": TOKEN },
        );
      }
      if (request.headers["x-auth-token"] !== TOKEN) {
        // A service's root answers anyone, as the version document does.
        const isRoot = Object.values(SERVICE_PATH).some((service) => {
          return url.pathname.endsWith(`/${service}`);
        });
        if (isRoot) {
          const type = Object.keys(SERVICE_PATH).find((service) => {
            return url.pathname.endsWith(`/${SERVICE_PATH[service]}`);
          });
          return send(serviceStatus[type] || 200, { versions: [] });
        }
        return send(401, { error: { code: 401 } });
      }
      // What the credential's own project holds, asked one row at a time.
      const held = url.pathname.endsWith("/compute/v2.1/servers")
        ? ["servers", "instances"]
        : url.pathname.endsWith("/volume/v3/volumes")
          ? ["volumes", "volumes"]
          : url.searchParams.has("project_id")
            ? [
                ["networks", "networks"],
                ["routers", "routers"],
                ["floatingips", "floating IPs"],
              ].find(([key]) => {
                return url.pathname.endsWith(`/v2.0/${key}`);
              })
            : null;
      if (held && holdsRefused.includes(held[1])) {
        return send(403, { error: { code: 403 } });
      }
      if (held) {
        return send(200, {
          [held[0]]: holds.includes(held[1]) ? [{ id: "held" }] : [],
        });
      }
      const read = reads.find((candidate) => {
        const within =
          candidate.service === "identity"
            ? "identity"
            : SERVICE_PATH[candidate.service];
        return url.pathname.endsWith(
          `/${within}${candidate.readPath.split("?")[0]}`,
        );
      });
      if (!read) {
        return send(404, { error: { code: 404 } });
      }
      const answer = scenario(read);
      if (answer.status && answer.status !== 200) {
        return send(answer.status, { error: { code: answer.status } });
      }
      return send(200, { [read.key]: answer.rows || [] });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        host: `127.0.0.1:${server.address().port}`,
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        logins,
        close: () => {
          return new Promise((done) => {
            server.close(done);
          });
        },
      });
    });
  });
}

/*
 * `docker` answers the runtime checks from files a test can write, records every
 * call, and runs the curl it is asked to run, with the bundled exporter's address
 * turned into the server's. $STUB_DIR/curl-fails holds "<text in the arguments>
 * <curl exit>" to make a curl fail without an answer. `curl`, for the install
 * without Docker, does the same.
 */
const CURL_WRAPPER = `args=()
for arg in "$@"; do
  arg="\${arg//openstack-exporter:9180/$FAKE_EXPORTER}"
  arg="\${arg//exporter.example.com:9180/$FAKE_EXPORTER}"
  arg="\${arg//127.0.0.1:9180/$FAKE_EXPORTER}"
  args+=("$arg")
done
if [ -f "$STUB_DIR/curl-fails" ]; then
  read -r pattern code < "$STUB_DIR/curl-fails"
  case "$*" in
    *"$pattern"*)
      cat > /dev/null
      echo "curl: ($code) simulated failure"
      printf '\\nOUSTATUS:000\\n'
      exit "$code"
      ;;
  esac
fi
case "$*" in
  *127.0.0.1:8888/metrics*|*127.0.0.1:8891/metrics*)
    printf 'otelcol_receiver_accepted_metric_points 10\\notelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\n'
    exit 0
    ;;
esac
exec "$REAL_CURL" "\${args[@]}"
`;

function installStubs(bin) {
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
case "$1" in
  info|compose) exit 0 ;;
  logs) cat "$STUB_DIR/collector.log" 2>/dev/null; exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
      *Config.User*) cat "$STUB_DIR/exporter.user" 2>/dev/null ;;
      *restarting*) printf 'running restarting=false restarts=0\\n' ;;
      *State.Status*)
        if [ -f "$STUB_DIR/exporter.state" ]; then cat "$STUB_DIR/exporter.state"; else printf 'running\\n'; fi
        ;;
    esac
    exit 0 ;;
  run)
    shift
    while [ $# -gt 0 ] && [ "$1" != "${CURL_IMAGE}" ]; do shift; done
    shift
    ${CURL_WRAPPER}
    ;;
esac
exit 0
`,
  );
}

function installNativeStubs(bin) {
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/docker.log"\nexit 1\n`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/curl.log"\n${CURL_WRAPPER}`,
  );
  writeExecutable(
    path.join(bin, "systemctl"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/systemctl.log"
case "$1" in
  is-active)
    if [ -f "$STUB_DIR/$2.inactive" ]; then echo failed; exit 3; fi
    echo active
    ;;
esac
`,
  );
  writeExecutable(
    path.join(bin, "journalctl"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/journalctl.log"\ncat "$STUB_DIR/collector.log" 2>/dev/null\n`,
  );
}

function clouds({
  regions = ["RegionOne"],
  auth,
  authUrl,
  authType = "v3applicationcredential",
  extra = "",
}) {
  const lines = ["clouds:"];
  for (const region of regions) {
    lines.push(`  ${JSON.stringify(region)}:`);
    lines.push(`    region_name: ${JSON.stringify(region)}`);
    lines.push("    identity_api_version: 3");
    if (extra) {
      lines.push(extra);
    }
    lines.push(`    auth_type: ${authType}`);
    lines.push("    auth:");
    lines.push(`      auth_url: ${JSON.stringify(authUrl)}`);
    for (const [name, value] of Object.entries(auth)) {
      lines.push(`      ${name}: ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const APP_CREDENTIAL = {
  application_credential_id: APP_ID,
  application_credential_secret: APP_SECRET,
};

// The doctor, on an install laid out as install.sh lays it out.
async function runDoctor(cloud, options = {}) {
  const {
    regions = ["RegionOne"],
    auth = APP_CREDENTIAL,
    authType,
    extraClouds = "",
    writeClouds = true,
    env = {},
    args = [],
    native = false,
    files = {},
    cloudsMode = 0o600,
    viaStdin = false,
  } = options;
  const dir = scratch();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  if (native) {
    installNativeStubs(bin);
  } else {
    installStubs(bin);
  }
  // As install.sh leaves it: the exporter runs as the user who owns clouds.yaml.
  const stubFiles = {
    "exporter.user": `${process.getuid()}:${process.getgid()}\n`,
    ...files,
  };
  for (const [name, text] of Object.entries(stubFiles)) {
    fs.writeFileSync(path.join(dir, name), text);
  }

  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  for (const file of ["docker-compose.yml", "otel-collector-config.yaml"]) {
    fs.copyFileSync(path.join(AGENT_DIR, file), path.join(installDir, file));
  }
  if (native) {
    writeExecutable(
      path.join(installDir, "otelcol-contrib"),
      "#!/bin/sh\nexit 0\n",
    );
  }
  const settings = {
    ONEUPTIME_URL: `${cloud.url}/oneuptime`,
    ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
    OPENSTACK_CLOUD_NAME: "prod",
    OPENSTACK_EXPORTER_CLOUDS: `[${regions.join(",")}]`,
    OPENSTACK_EXPORTER_ADDRESS: native
      ? "127.0.0.1:9180"
      : "openstack-exporter:9180",
    ...env,
  };
  const envText = `${Object.entries(settings)
    .map(([name, value]) => {
      return `${name}=${value}`;
    })
    .join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "container.env"), envText);
  fs.writeFileSync(
    path.join(installDir, ".env"),
    native
      ? `${Object.entries(settings)
          .map(([name, value]) => {
            return `${name}="${value.replace(/[\\"]/g, "\\$&")}"`;
          })
          .join("\n")}\n`
      : envText,
  );
  if (options.caFile) {
    fs.writeFileSync(
      path.join(installDir, "ca.pem"),
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );
  }
  if (writeClouds) {
    const file = path.join(installDir, "clouds.yaml");
    fs.writeFileSync(
      file,
      clouds({
        regions,
        auth,
        authType,
        authUrl: options.authUrl || `${cloud.url}/identity/v3`,
        extra: extraClouds,
      }),
    );
    fs.chmodSync(file, cloudsMode);
  }

  const scriptArgs = [
    "-d",
    installDir,
    "--no-color",
    "--curl-image",
    CURL_IMAGE,
    ...args,
  ];
  const result = await new Promise((resolve) => {
    const child = spawn(
      "bash",
      viaStdin ? ["-s", "--", ...scriptArgs] : [SCRIPT, ...scriptArgs],
      {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          REAL_CURL,
          FAKE_EXPORTER: options.exporterHost || cloud.host,
        },
        stdio: [viaStdin ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, output });
    });
    if (viaStdin) {
      child.stdin.end(fs.readFileSync(SCRIPT));
    }
  });

  return {
    ...result,
    installDir,
    docker: readIfExists(path.join(dir, "docker.log")),
    curlLog: readIfExists(path.join(dir, "curl.log")),
    systemctl: readIfExists(path.join(dir, "systemctl.log")),
    journalctl: readIfExists(path.join(dir, "journalctl.log")),
  };
}

// The lines of one section, whichever number it has.
function sectionOf(output, title) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => {
    return line.endsWith(`${title} ──`);
  });
  if (start < 0) {
    throw new Error(`no section "${title}" in:\n${output}`);
  }
  const end = lines.findIndex((line, index) => {
    return index > start && /^── .* ──$/.test(line);
  });
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

// Each call `docker` was given, one a line: curl's -w holds a line break of its own.
function dockerCalls(run) {
  return run.docker.replace(/ -w \nOUSTATUS:/g, " -w OUSTATUS:").split("\n");
}

function accessLines(run) {
  return sectionOf(run.output, "What this credential can read");
}

function lineAbout(lines, read) {
  const found = lines.find((line) => {
    return line.includes(`${read} — `);
  });
  if (!found) {
    throw new Error(`no line about "${read}" in:\n${lines.join("\n")}`);
  }
  return found.trim();
}

/* ------------------------------------------------ the list of reads */

describe("the reads it makes", () => {
  const table = doctorReads();
  const matrix = matrixReads();

  test("are exactly access-matrix.py's, in its order", () => {
    expect(matrix.length).toBeGreaterThan(25);
    expect(
      table.map((read) => {
        return [
          read.service,
          read.label,
          read.readPath.split("?")[0],
          read.key,
        ];
      }),
    ).toEqual(
      matrix.map((read) => {
        return [
          read.service,
          read.label,
          read.readPath.split("?")[0],
          read.key,
        ];
      }),
    );
  });

  test("use the API versions it uses", () => {
    const source = fs.readFileSync(MATRIX, "utf8");
    const version = (service) => {
      return {
        compute: source.match(/COMPUTE_VERSION = \{"([^"]+)": "([^"]+)"\}/),
        "block-storage": source.match(
          /VOLUME_VERSION = \{"([^"]+)": "([^"]+)"\}/,
        ),
        placement: source.match(/PLACEMENT_VERSION = \{"([^"]+)": "([^"]+)"\}/),
      }[service];
    };
    for (const read of table) {
      const wanted = version(read.service);
      if (wanted) {
        expect({ read: read.label, version: read.version }).toEqual({
          read: read.label,
          version: `${wanted[1]}: ${wanted[2]}`,
        });
      }
    }
  });

  test("are all ones the application credential's access rules allow", () => {
    const rules = JSON.parse(fs.readFileSync(ACCESS_RULES, "utf8"));
    const VERSION_IN_THE_RULES = {
      compute: "/v2.1",
      "block-storage": "/v3",
    };
    const allows = (service, wanted) => {
      return rules.some((rule) => {
        if (rule.service !== service || rule.method !== "GET") {
          return false;
        }
        const pattern = rule.path
          .replace(/\*\*/g, "\u0000")
          .replace(/\*/g, "[^/]+")
          .replace(/\u0000/g, ".+");
        return new RegExp(`^${pattern}$`).test(wanted);
      });
    };
    for (const read of [...table, ...doctorHoldings()]) {
      const wanted = `${VERSION_IN_THE_RULES[read.service] || ""}${read.readPath.split("?")[0]}`;
      // A current catalog calls Cinder block-storage, an older one volumev3.
      const names =
        read.service === "block-storage"
          ? ["block-storage", "volumev3"]
          : [read.service];
      for (const service of names) {
        expect({ read: read.label, service, wanted, allowed: true }).toEqual({
          read: read.label,
          service,
          wanted,
          allowed: allows(service, wanted),
        });
      }
    }
  });

  test("each say what goes without them and what to do", () => {
    for (const read of table) {
      expect(read.cost.length).toBeGreaterThan(5);
      expect(read.fix).toMatch(/^(policy:|code:|text:|any$)/);
    }
  });

  test("each policy line to add is in the file the agent ships for that service, as it stands", () => {
    const lines = table.filter((read) => {
      return read.fix.startsWith("policy:");
    });
    expect(lines.length).toBeGreaterThan(10);
    for (const read of lines) {
      const rest = read.fix.slice("policy:".length);
      const service = rest.slice(0, rest.indexOf(":"));
      const line = rest.slice(rest.indexOf(":") + 1);
      const file = fs.readFileSync(
        path.join(AGENT_DIR, "access", "policy", `${service}.yaml`),
        "utf8",
      );
      expect({ read: read.label, inFile: true }).toEqual({
        read: read.label,
        inFile: file.split("\n").includes(line),
      });
    }
  });

  test("Neutron's and Cinder's per-project lists say no policy line opens them", () => {
    for (const read of table) {
      if (
        read.attr !== "-" &&
        ["network", "block-storage"].includes(read.service)
      ) {
        if (read.label !== "IP availabilities") {
          expect({ read: read.label, fix: read.fix }).toEqual({
            read: read.label,
            fix: read.service === "network" ? "code:Neutron" : "code:Cinder",
          });
        }
      }
    }
  });

  test("the attribute naming a row's project is what the fake cloud's rows carry, row for row", () => {
    for (const read of table) {
      if (read.attr !== "-" && read.attr !== "*") {
        const row = rowsIn(read, ["p"])[0];
        expect({ read: read.label, has: true }).toEqual({
          read: read.label,
          has: Object.keys(row).includes(read.attr),
        });
      }
    }
  });
});

/* --------------------------------------------------------- the three levels */

describe("a full-view credential", () => {
  let cloud;
  let run;

  beforeAll(async () => {
    cloud = await startCloud({
      tokenExtra: {
        application_credential: {
          id: APP_ID,
          name: "oneuptime-agent",
          restricted: true,
          access_rules: [
            { service: "compute", method: "GET", path: "/v2.1/servers" },
          ],
        },
      },
    });
    run = await runDoctor(cloud);
  });

  afterAll(async () => {
    await cloud.close();
  });

  test("reads everything, and passes", () => {
    const lines = accessLines(run);
    for (const read of matrixReads()) {
      expect(lineAbout(lines, `${read.service}: ${read.label}`)).toMatch(
        /^✔ .* — reads everything/,
      );
    }
    expect(run.output).toContain(
      `Reads everything: ${matrixReads().length}. May be own project only: 0. Refused: 0. Not deployed: 0. Could not ask: 0.`,
    );
    expect(run.output).toContain(
      "✔ That adds up to Full view: hypervisors, services and capacity, and every project's instances, volumes and networks.",
    );
    expect(run.status).toBe(0);
    expect(run.output).toContain(
      "The agent looks healthy and OneUptime accepts the token.",
    );
    expect(run.output).not.toContain("Section 5 says");
  });

  test("names it: an application credential limited by access rules", () => {
    expect(run.output).toContain(
      "✔ An application credential limited by access rules.",
    );
    expect(run.output).toContain(`Roles on project ${OWN_PROJECT}: admin`);
  });

  test("logs in with the credential as typed, on stdin, and asks with the token on stdin", () => {
    expect(cloud.logins).toEqual([
      {
        methods: ["application_credential"],
        application_credential: { id: APP_ID, secret: APP_SECRET },
      },
    ]);
    const asked = cloud.requests.filter((request) => {
      return request.path.includes("/os-hypervisors/detail");
    });
    expect(asked).toHaveLength(1);
    expect(asked[0].token).toBe(TOKEN);
    expect(asked[0].version).toBe("compute 2.90");

    for (const secret of [APP_ID, APP_SECRET, TOKEN, KEY]) {
      expect(run.docker).not.toContain(secret);
      expect(run.output).not.toContain(secret);
    }
  });

  test("Docker reads this script's stdin only where something is piped to curl", () => {
    const runs = dockerCalls(run).filter((line) => {
      return line.startsWith("run ");
    });
    expect(runs.length).toBeGreaterThan(30);
    for (const line of runs) {
      expect({ line, piped: line.includes(" -i ") }).toEqual({
        line,
        piped: line.includes("@-"),
      });
    }
  });

  test("runs its probes on the exporter's network, the path the exporter uses", () => {
    const login = dockerCalls(run).find((line) => {
      return line.includes("/auth/tokens");
    });
    expect(login).toContain("--network container:oneuptime-openstack-exporter");
    const validate = dockerCalls(run).find((line) => {
      return line.includes("/otlp/v1/validate");
    });
    expect(validate).toContain("--network container:oneuptime-openstack-agent");
    const scrape = dockerCalls(run).find((line) => {
      return line.includes("/probe?");
    });
    expect(scrape).toContain("--network container:oneuptime-openstack-agent");
  });

  test("asks gently: a small page of everything that pages, and never every port", () => {
    const asked = (ending) => {
      const found = cloud.requests.filter((request) => {
        return (
          request.path.endsWith(ending) && !request.query.has("project_id")
        );
      });
      expect({ ending, times: found.length }).toEqual({ ending, times: 1 });
      return found[0].query;
    };

    const ports = asked("/v2.0/ports");
    expect(ports.get("limit")).toBe("100");
    expect(ports.getAll("fields")).toEqual(["project_id"]);
    for (const ending of [
      "/servers/detail",
      "/volumes/detail",
      "/snapshots/detail",
      "/backups/detail",
    ]) {
      const query = asked(ending);
      expect(query.get("all_tenants")).toBe("1");
      expect(query.get("limit")).toBe("100");
    }
    for (const ending of [
      "/v2.0/networks",
      "/v2.0/subnets",
      "/v2.0/routers",
      "/v2.0/floatingips",
      "/v2/images",
      "/os-hypervisors/detail",
      "/flavors/detail",
    ]) {
      expect({ ending, limit: asked(ending).get("limit") }).toEqual({
        ending,
        limit: "100",
      });
    }
    // Usage since today, where the matrix on a throwaway cloud asks since 2000.
    const usage = asked("/os-simple-tenant-usage");
    expect(usage.get("start")).toBe(
      `${new Date().toISOString().slice(0, 10)}T00:00:00`,
    );
    expect(usage.get("limit")).toBe("10");
  });

  test("checks each service in the catalog at its public endpoint, without the token", () => {
    const lines = sectionOf(run.output, "Every service in the catalog");
    for (const service of Object.keys(SERVICE_PATH)) {
      expect(
        lines.some((line) => {
          return (
            line.includes(`✔ ${service}: answers at `) &&
            line.includes(`/RegionOne/${SERVICE_PATH[service]} (HTTP 200)`)
          );
        }),
      ).toBe(true);
    }
    expect(run.output).not.toContain("-internal");
    const roots = cloud.requests.filter((request) => {
      return request.path === "/RegionOne/compute/v2.1";
    });
    expect(roots).toHaveLength(1);
    expect(roots[0].token).toBe(undefined);
  });

  test("scrapes the exporter as the collector does, once per region, the lightest service", () => {
    const probes = cloud.requests.filter((request) => {
      return request.path === "/probe";
    });
    expect(probes).toHaveLength(1);
    expect(probes[0].query.get("cloud")).toBe("RegionOne");
    expect(probes[0].query.get("include_services")).toBe("identity");
    expect(run.output).toContain(
      "✔ Region RegionOne: the exporter reads Keystone (2 openstack_* series, openstack_identity_up 1).",
    );
  });

  test("checks clouds.yaml is its owner's alone", () => {
    expect(run.output).toContain(
      "✔ clouds.yaml is readable by its owner alone",
    );
  });
});

describe("a plain reader, and the trap", () => {
  let cloud;
  let run;

  beforeAll(async () => {
    cloud = await startCloud({
      scenario: projectView,
      roles: ["reader", "member"],
      services: ["compute", "placement", "network", "block-storage", "image"],
    });
    run = await runDoctor(cloud);
  });

  afterAll(async () => {
    await cloud.close();
  });

  test.each([
    ["network: routers", "every row is in one project"],
    ["network: floating IPs", "every row is in one project"],
    ["network: security groups", "every row is in one project"],
    ["network: ports", "every row is in one project"],
    ["block-storage: volumes, all projects", "every row is in one project"],
    ["block-storage: snapshots, all projects", "every row is in one project"],
    ["block-storage: backups, all projects", "every row is in one project"],
  ])("%s answers 200, and that is no proof", (read, reason) => {
    expect(lineAbout(accessLines(run), read)).toBe(
      `▲ ${read} — may be own project only (${reason})`,
    );
  });

  test("a shared network is anyone's to see, so it does not count as another project", () => {
    expect(lineAbout(accessLines(run), "network: networks")).toBe(
      "▲ network: networks — may be own project only (every row is in one project)",
    );
  });

  test("nor does a subnet of one, though nothing on the subnet says so", () => {
    expect(lineAbout(accessLines(run), "network: subnets")).toBe(
      "▲ network: subnets — may be own project only (as for the networks: a subnet of a shared network is anyone's to see)",
    );
  });

  test("nor a public image", () => {
    expect(lineAbout(accessLines(run), "image: images")).toBe(
      "▲ image: images — may be own project only (every row is in one project)",
    );
  });

  test.each([
    ["compute: hypervisors"],
    ["compute: services"],
    ["compute: servers, all projects"],
    ["placement: resource providers"],
    ["network: agents"],
    ["network: IP availabilities"],
    ["block-storage: services"],
    ["block-storage: pools"],
    ["identity: projects"],
  ])("%s is refused", (read) => {
    expect(lineAbout(accessLines(run), read)).toBe(
      `▲ ${read} — refused (HTTP 403)`,
    );
  });

  test.each([
    ["load-balancer: load balancers"],
    ["load-balancer: amphorae"],
    ["baremetal: nodes"],
  ])("%s is not deployed", (read) => {
    expect(lineAbout(accessLines(run), read)).toBe(
      `• ${read} — not deployed (not in this region's catalog)`,
    );
  });

  test("what any credential may read reads everything", () => {
    for (const read of [
      "compute: flavors",
      "identity: regions",
      "block-storage: volume types",
    ]) {
      expect(lineAbout(accessLines(run), read)).toBe(
        `✔ ${read} — reads everything`,
      );
    }
  });

  test("a refused read says which pages and alerts go without it, and the exact line to add", () => {
    const lines = accessLines(run);
    const at = lines.findIndex((line) => {
      return line.includes("compute: hypervisors — refused");
    });
    expect(
      lines.slice(at + 1, at + 4).map((line) => {
        return line.trim();
      }),
    ).toEqual([
      "Goes without it: the Hypervisors page, capacity, and the alerts on hypervisors.",
      'To read it: use a full-view credential (README.md, "Level 1: Full view"), or give this account the oneuptime_monitoring role and add this line, on every controller, to the file named by [oslo_policy] policy_file in nova.conf, which is /etc/nova/policy.yaml unless your deployment says otherwise:',
      '"os_compute_api:os-hypervisors:list-detail": "rule:context_is_admin or role:oneuptime_monitoring"',
    ]);
  });

  test("Nova refusing all projects' servers costs every instance, this project's too, and only the probe has them", () => {
    const lines = accessLines(run);
    const at = lines.findIndex((line) => {
      return line.includes("compute: servers, all projects — refused");
    });
    expect(lines[at + 1].trim()).toBe(
      "Goes without it: every instance, this credential's own project's too: the exporter asks Nova for all projects' servers, and when Nova refuses, that read fails whole. The Instances page, instance counts per hypervisor and project, and the alerts on instances go with it. Only a OneUptime probe, collecting without this agent, lists one project's instances.",
    );
  });

  test("a list only its own service can open says no policy line does", () => {
    const lines = accessLines(run);
    const at = lines.findIndex((line) => {
      return line.includes("block-storage: volumes, all projects — may be");
    });
    expect(
      lines.slice(at + 1, at + 3).map((line) => {
        return line.trim();
      }),
    ).toEqual([
      "Goes without it: volumes in other projects on the Volumes page, and the alerts on them.",
      'Cinder scopes this list to the credential\'s own project in its code, so no policy line opens it. To read every project: use a full-view credential (README.md, "Level 1: Full view"), or give this account a role on each project you want seen.',
    ]);
  });

  test("adds up to Project view, which is a choice and not a failure", () => {
    expect(run.output).toContain(
      "• That adds up to Project view: this credential's own project, and no infrastructure. Through the agent that means no instances either: the exporter asks Nova for all projects' servers, Nova refuses, and that read fails whole. Only a OneUptime probe, collecting without this agent, lists one project's instances.",
    );
    expect(run.output).toContain(
      "That is fine if it is the level of access you chose.",
    );
    expect(run.status).toBe(0);
    expect(run.output).toContain(
      "If a page is empty or an alert stays quiet, Section 5 says what this credential cannot read.",
    );
    expect(run.output).not.toContain("ROOT CAUSE");
  });
});

describe("the monitoring role with the policy overrides", () => {
  let cloud;
  let run;

  beforeAll(async () => {
    cloud = await startCloud({
      scenario: infrastructureOnly,
      roles: ["reader", "oneuptime_monitoring"],
      services: ["compute", "placement", "network", "block-storage", "image"],
    });
    run = await runDoctor(cloud);
  });

  afterAll(async () => {
    await cloud.close();
  });

  test("reads the infrastructure, and adds up to Infrastructure only", () => {
    const lines = accessLines(run);
    for (const read of [
      "compute: hypervisors",
      "network: agents",
      "block-storage: pools",
      "placement: resource providers",
    ]) {
      expect(lineAbout(lines, read)).toBe(`✔ ${read} — reads everything`);
    }
    expect(lineAbout(lines, "network: routers")).toBe(
      "▲ network: routers — may be own project only (every row is in one project)",
    );
    expect(run.output).toContain(
      "• That adds up to Infrastructure only: control-plane health and capacity, with instances, volumes and routers only where this account has a role.",
    );
    expect(run.status).toBe(0);
  });
});

/* ------------------------------------------------------- what a 200 can prove */

describe("what a 200 proves", () => {
  const ROUTERS = "network: routers";

  async function routersAre(rows, options = {}) {
    const cloud = await startCloud({
      scenario: (read) => {
        return read.label === "routers" ? { rows } : fullView(read);
      },
      roles: options.roles || ["reader"],
    });
    const run = await runDoctor(cloud);
    await cloud.close();
    return lineAbout(accessLines(run), ROUTERS);
  }

  test("rows from two projects: everything", async () => {
    expect(
      await routersAre([
        { project_id: OWN_PROJECT },
        { project_id: OTHER_PROJECT },
      ]),
    ).toBe(`✔ ${ROUTERS} — reads everything (2 projects in 2 rows)`);
  });

  test("every row in one project, the credential's own: may be own project only, whatever its role", async () => {
    expect(
      await routersAre(
        [{ project_id: OWN_PROJECT }, { project_id: OWN_PROJECT }],
        { roles: ["admin"] },
      ),
    ).toBe(
      `▲ ${ROUTERS} — may be own project only (every row is in one project)`,
    );
  });

  test("every row in one project that is not the credential's: it sees past its own", async () => {
    expect(
      await routersAre([
        { project_id: OTHER_PROJECT },
        { project_id: OTHER_PROJECT },
      ]),
    ).toBe(
      `✔ ${ROUTERS} — reads everything (every row is in one project, and not this credential's)`,
    );
  });

  test("an empty list proves nothing", async () => {
    expect(await routersAre([])).toBe(
      `▲ ${ROUTERS} — may be own project only (a 200 with nothing here to tell by)`,
    );
  });

  test("an empty list for an admin is most likely just empty", async () => {
    expect(await routersAre([], { roles: ["admin"] })).toBe(
      `✔ ${ROUTERS} — reads everything (nothing here to tell by, and the credential has the admin role)`,
    );
  });

  test("a project attribute the policy hides proves nothing either", async () => {
    expect(await routersAre([{ id: "r1" }, { id: "r2" }])).toBe(
      `▲ ${ROUTERS} — may be own project only (a 200 with nothing here to tell by)`,
    );
  });

  test("bare metal nodes carry no project unless one owns them, so any row proves it", async () => {
    const cloud = await startCloud({
      scenario: (read) => {
        return read.label === "nodes"
          ? { rows: [{ uuid: "n1", owner: null }] }
          : fullView(read);
      },
      roles: ["reader"],
    });
    const run = await runDoctor(cloud);
    await cloud.close();
    expect(lineAbout(accessLines(run), "baremetal: nodes")).toBe(
      "✔ baremetal: nodes — reads everything",
    );
  });
});

/* ----------------------------------------------------- what else can come back */

describe("the other answers", () => {
  test("404: the API is not deployed. 503: that says nothing about the credential, and the service is named", async () => {
    const cloud = await startCloud({
      serviceStatus: { "load-balancer": 503 },
      scenario: (read) => {
        if (read.label === "IP availabilities") {
          return { status: 404 };
        }
        if (read.label === "load balancers") {
          return { status: 503 };
        }
        return fullView(read);
      },
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    const lines = accessLines(run);
    expect(lineAbout(lines, "network: IP availabilities")).toBe(
      "• network: IP availabilities — not deployed (HTTP 404: this cloud has no such API)",
    );
    expect(lineAbout(lines, "load-balancer: load balancers")).toBe(
      "▲ load-balancer: load balancers — could not ask (HTTP 503). That says nothing about the credential: section 4 looks at the service.",
    );
    expect(run.output).toContain("Could not ask: 1.");
    expect(
      sectionOf(run.output, "Every service in the catalog").some((line) => {
        return line.includes(
          `▲ load-balancer: failing at ${cloud.url}/RegionOne/load-balancer (HTTP 503).`,
        );
      }),
    ).toBe(true);
    expect(run.output).toContain(
      "so its series go missing (the others keep reporting).",
    );
  });

  test("a 401 on a credential with access rules points at the rules and service_type", async () => {
    const cloud = await startCloud({
      tokenExtra: {
        application_credential: {
          id: APP_ID,
          restricted: true,
          access_rules: [{ path: "/v2.1/servers" }],
        },
      },
      scenario: (read) => {
        return read.label === "hypervisors" ? { status: 401 } : fullView(read);
      },
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(lineAbout(accessLines(run), "compute: hypervisors")).toBe(
      "▲ compute: hypervisors — refused (HTTP 401)",
    );
    expect(run.output).toContain(
      "With access rules, a 401 means they do not list this path, or this service's keystonemiddleware has no service_type set",
    );
    expect(run.output).toContain(
      "or it sits behind a path prefix, which the shipped rules do not fit: access-rules-for-cloud.py fits them to this cloud",
    );
  });

  test("an older catalog calls Cinder volumev3, and it is read just the same", async () => {
    const cloud = await startCloud({
      catalogNames: { "block-storage": "volumev3" },
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    const lines = accessLines(run);
    expect(lineAbout(lines, "block-storage: pools")).toBe(
      "✔ block-storage: pools — reads everything",
    );
    expect(lineAbout(lines, "block-storage: volumes, all projects")).toBe(
      "✔ block-storage: volumes, all projects — reads everything (2 projects in 2 rows)",
    );
    expect(
      cloud.requests.filter((request) => {
        return (
          request.path === "/RegionOne/volume/v3/scheduler-stats/get_pools"
        );
      }),
    ).toHaveLength(1);
  });

  test("a plain admin application credential is labelled as one, and an unrestricted one is called out", async () => {
    const cloud = await startCloud({
      tokenExtra: {
        application_credential: { id: APP_ID, restricted: false },
      },
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(run.output).toContain(
      '▲ A plain admin application credential: it has no access rules, so it can write. Add them where you can (README.md, "Level 1: Full view").',
    );
    expect(run.output).toContain(
      "▲ This application credential was created --unrestricted: it can make more credentials. Replace it with one that is not.",
    );
  });

  test("a username and password work, as typed, and the doctor says an application credential is better", async () => {
    const password = `pa$$w'ord"\\ #1`;
    const cloud = await startCloud({
      credential: {
        password: {
          user: {
            name: "monitor",
            domain: { name: "Default" },
            password,
          },
        },
      },
    });
    const run = await runDoctor(cloud, {
      authType: "v3password",
      auth: {
        username: "monitor",
        password,
        project_name: "monitoring",
        user_domain_name: "Default",
        project_domain_name: "Default",
      },
    });
    await cloud.close();

    expect(run.output).toContain(
      "✔ DNS and TLS are fine, and Keystone accepted the credential (HTTP 201).",
    );
    expect(run.output).toContain(
      '▲ This is a username and password. It can do whatever its account can, and an application credential is better (README.md, "Access").',
    );
    expect(run.docker).not.toContain(password);
  });
});

/* ------------------------------------------------------- Keystone and its road */

describe("Keystone, DNS and TLS", () => {
  test("a refused credential is the root cause, and nothing is asked with it", async () => {
    const cloud = await startCloud({ loginStatus: 401 });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(run.output).toContain(
      "✗ Keystone REFUSED this credential (HTTP 401).",
    );
    expect(run.output).toContain(
      "ROOT CAUSE: the credential in clouds.yaml gets no token from Keystone.",
    );
    expect(run.output).toContain(
      "Skipped: it takes a login to Keystone to ask.",
    );
    expect(run.status).toBe(1);
    expect(
      cloud.requests.filter((request) => {
        return request.path.includes("/os-hypervisors");
      }),
    ).toEqual([]);
  });

  test.each([
    [6, "DNS: this path cannot resolve the host"],
    [7, "the connection was refused, or there is no route"],
    [28, "nothing answered in time"],
    [60, "TLS: the certificate is not trusted on this path"],
  ])("curl exit %i says what it means", async (code, why) => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      files: { "curl-fails": `/auth/tokens ${code}\n` },
    });
    await cloud.close();

    expect(run.output).toContain(
      `✗ No answer from Keystone at ${cloud.url}/identity/v3: ${why}.`,
    );
    expect(run.status).toBe(1);
    if (code === 60) {
      expect(run.output).toContain(
        "For a cloud with its own CA: OPENSTACK_CA_FILE=/path/to/ca.pem bash install.sh",
      );
    }
  });

  test("an answer that is no token says so", async () => {
    const cloud = await startCloud({ loginStatus: 300 });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(run.output).toContain(
      `✗ Keystone answered HTTP 300 at ${cloud.url}/identity/v3/auth/tokens, not a token.`,
    );
  });

  test("the private CA is mounted for curl and used, the way the exporter uses it", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      extraClouds: '    cacert: "/etc/openstack/ca.pem"',
      caFile: true,
      args: ["--skip-access"],
    });
    await cloud.close();

    const login = dockerCalls(run).find((line) => {
      return line.includes("/auth/tokens");
    });
    expect(login).toContain(
      `-v ${path.join(run.installDir, "ca.pem")}:/tmp/oneuptime-ca.pem:ro`,
    );
    expect(login).toContain("--cacert /tmp/oneuptime-ca.pem");
    expect(run.output).not.toContain("it is not where this script looks");
  });

  test("a CA clouds.yaml names and this script cannot find is said, rather than guessed at", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      extraClouds: '    cacert: "/etc/openstack/ca.pem"',
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "▲ clouds.yaml names a CA (/etc/openstack/ca.pem), and it is not where this script looks",
    );
  });

  test("verify: false is called out", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      extraClouds: "    verify: false",
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "▲ clouds.yaml has verify: false, so nothing checks Keystone's certificate",
    );
    expect(
      dockerCalls(run).find((line) => {
        return line.includes("/auth/tokens");
      }),
    ).toContain(" -k ");
  });

  test("a region the catalog does not list is named, with the ones it does", async () => {
    const cloud = await startCloud({ regions: ["RegionOne"] });
    const run = await runDoctor(cloud, {
      regions: ["RegionOne", "regionone"],
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "✗ Region regionone: the service catalog lists no public endpoint there.",
    );
    expect(run.output).toContain(
      'Region "regionone" is not in this cloud\'s catalog (it lists: RegionOne).',
    );
  });
});

describe("what the credential's own project holds", () => {
  test("nothing, in a project of its own, is said", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(accessLines(run)).toContain(
      "  ✔ This credential's project holds no instances, volumes, networks, routers or floating IPs in region RegionOne.",
    );
    expect(run.output).not.toContain("holds things");
  });

  test("things are warned about, because on many clouds any role on a project can write there, and each is named", async () => {
    const cloud = await startCloud({
      holds: ["instances", "volumes", "floating IPs"],
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(accessLines(run)).toContain(
      "  ▲ This credential's project holds things in region RegionOne: instances, volumes, floating IPs.",
    );
    expect(run.output).toContain(
      "Where Cinder has enforce_new_defaults off, which is Cinder's own default, any role on a project can create that project's volumes, reader and oneuptime_monitoring included, so this credential may be able to write there.",
    );
    expect(run.output).toContain(
      'give the agent a project of its own that holds nothing and has zero quota (README.md, "Level 2: Infrastructure only").',
    );
    expect(run.output).toContain(
      "This credential's project holds things (instances, volumes, floating IPs in region RegionOne)",
    );
    // A warning, not a failure: a project view has this on purpose.
    expect(run.status).toBe(0);
  });

  test("it asks for one row of each, of that project, with the token", async () => {
    const cloud = await startCloud({ holds: ["routers"] });
    await runDoctor(cloud);
    await cloud.close();

    const asked = cloud.requests.filter((request) => {
      return request.query.get("limit") === "1";
    });
    expect(
      asked.map((request) => {
        return request.path.split("/").slice(2).join("/");
      }),
    ).toEqual([
      "compute/v2.1/servers",
      "volume/v3/volumes",
      "network/v2.0/networks",
      "network/v2.0/routers",
      "network/v2.0/floatingips",
    ]);
    for (const request of asked) {
      expect(request.token).toBe(TOKEN);
      if (request.path.includes("/network/")) {
        expect(request.query.get("project_id")).toBe(OWN_PROJECT);
      }
    }
  });

  test("a read it could not make is not taken for an empty project", async () => {
    const cloud = await startCloud({ holdsRefused: ["instances", "routers"] });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(accessLines(run)).toContain(
      "  • This credential's project holds nothing this script could ask about in region RegionOne, but it could not ask about: instances, routers.",
    );
    expect(run.output).not.toContain("holds no instances");
  });

  test("something held is still warned about when another read could not be made", async () => {
    const cloud = await startCloud({
      holds: ["volumes"],
      holdsRefused: ["instances"],
    });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(accessLines(run)).toContain(
      "  ▲ This credential's project holds things in region RegionOne: volumes.",
    );
  });

  test("a project it cannot ask about is said to be unknown, not empty", async () => {
    const cloud = await startCloud({ services: ["placement"] });
    const run = await runDoctor(cloud);
    await cloud.close();

    expect(accessLines(run)).toContain(
      "  • Could not tell what this credential's project holds in region RegionOne.",
    );
  });
});

describe("several regions", () => {
  let cloud;
  let run;

  beforeAll(async () => {
    cloud = await startCloud({ regions: ["RegionOne", "Region Two"] });
    run = await runDoctor(cloud, { regions: ["RegionOne", "Region Two"] });
  });

  afterAll(async () => {
    await cloud.close();
  });

  test("scrapes each, by the name of its clouds.yaml entry", () => {
    expect(
      cloud.requests
        .filter((request) => {
          return request.path === "/probe";
        })
        .map((request) => {
          return request.query.get("cloud");
        }),
    ).toEqual(["RegionOne", "Region Two"]);
  });

  test("reads each region's own endpoints, and Keystone once", () => {
    const paths = cloud.requests.map((request) => {
      return request.path;
    });
    expect(paths).toContain("/RegionOne/compute/v2.1/os-hypervisors/detail");
    expect(paths).toContain("/Region_Two/compute/v2.1/os-hypervisors/detail");
    expect(
      paths.filter((one) => {
        return one === "/identity/v3/projects";
      }),
    ).toHaveLength(1);
    expect(cloud.logins).toHaveLength(1);
  });

  test("says which region each line is about", () => {
    const lines = accessLines(run);
    expect(lines).toContain("  • Region RegionOne");
    expect(lines).toContain("  • Region Region Two");
  });
});

/* ------------------------------------------------------------- the exporter */

describe("the exporter", () => {
  test("openstack_identity_up 0 says it logs in and reads nothing", async () => {
    const cloud = await startCloud({
      probe: () => {
        return "openstack_identity_up 0\n";
      },
    });
    const run = await runDoctor(cloud, { args: ["--skip-access"] });
    await cloud.close();

    expect(run.output).toContain(
      "▲ Region RegionOne: the exporter answers, but openstack_identity_up is 0: it could not read Keystone's lists.",
    );
  });

  test("no series at all points at the entry named for the region", async () => {
    const cloud = await startCloud({
      probe: () => {
        return "";
      },
    });
    const run = await runDoctor(cloud, { args: ["--skip-access"] });
    await cloud.close();

    expect(run.output).toContain(
      "✗ Region RegionOne: the exporter answered with no openstack_identity_up series.",
    );
    expect(run.output).toContain(
      'The exporter has no clouds.yaml entry named "RegionOne", or cannot log in with it.',
    );
    expect(run.output).toContain(
      "ROOT CAUSE: the collector has no OpenStack metrics to ship (exporter scrape failing).",
    );
    expect(run.status).toBe(1);
  });

  test("an exporter that cannot be reached says so", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      files: { "curl-fails": `/probe? 7\n` },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "✗ Region RegionOne: cannot reach the exporter at openstack-exporter:9180 from the agent's network.",
    );
  });

  test("the bundled exporter down, or never started, is a failure with what to do", async () => {
    const cloud = await startCloud();
    const exited = await runDoctor(cloud, {
      files: { "exporter.state": "exited\n" },
      args: ["--skip-access"],
    });
    const never = await runDoctor(cloud, {
      files: { "exporter.state": "" },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(exited.output).toContain(
      "✗ Bundled exporter 'oneuptime-openstack-exporter' is NOT running (state: exited)",
    );
    expect(never.output).toContain(
      "✗ Bundled exporter 'oneuptime-openstack-exporter' does not exist.",
    );
    expect(never.output).toContain("Set COMPOSE_PROFILES=openstack-exporter");
  });

  test("the image's own user is assumed when the container says none, and it must own the file", async () => {
    if (process.getuid() === 65532 || process.getuid() === 0) {
      return;
    }
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      files: { "exporter.user": "" },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toMatch(
      /✗ The exporter runs as uid 65532, and clouds\.yaml belongs to uid \d+/,
    );
  });

  test("a clouds.yaml the exporter's user does not own locks it out, and that is the failure", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      files: { "exporter.user": "4242:4242\n" },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toMatch(
      /✗ The exporter runs as uid 4242, and clouds\.yaml belongs to uid \d+, so the exporter cannot read it\./,
    );
    expect(run.output).toContain("sudo chown 4242 ");
    expect(run.status).toBe(1);
  });

  test("with the exporter running as the file's owner, nothing is said", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, { args: ["--skip-access"] });
    await cloud.close();

    expect(run.output).not.toContain("so the exporter cannot read it");
  });

  test("a clouds.yaml others can read is called out", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      cloudsMode: 0o644,
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toMatch(
      /▲ clouds\.yaml holds the credential, and its mode is -rw-r--r--.*: others can read it\./,
    );
    expect(run.output).toContain("chmod 600 ");
  });

  test("no clouds.yaml says run the installer", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, { writeClouds: false });
    await cloud.close();

    expect(run.output).toContain(
      "clouds.yaml does not exist, so the exporter has no credential.",
    );
    expect(run.output).toContain(
      "Run install.sh again: with no clouds.yaml it asks for the credential and writes one.",
    );
  });

  test("your own exporter: no clouds.yaml wanted, its address scraped, and the credential checks left to it", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      writeClouds: false,
      env: { OPENSTACK_EXPORTER_ADDRESS: "exporter.example.com:9180" },
      files: { "exporter.state": "" },
    });
    await cloud.close();

    expect(run.output).toContain(
      "• No bundled exporter: the agent reads your own at exporter.example.com:9180 (OPENSTACK_EXPORTER_ADDRESS), and its clouds.yaml holds the credential.",
    );
    expect(run.output).toContain(
      "✔ Region RegionOne: the exporter reads Keystone",
    );
    expect(run.output).toContain(
      "• Skipped: your own exporter holds the credential, on its own machine.",
    );
    expect(run.status).toBe(0);
    expect(cloud.logins).toEqual([]);
  });

  test("your own exporter at localhost is the agent's container, and the doctor says so", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      writeClouds: false,
      env: { OPENSTACK_EXPORTER_ADDRESS: "localhost:9180" },
      files: { "exporter.state": "" },
    });
    await cloud.close();

    expect(run.output).toContain(
      "✗ OPENSTACK_EXPORTER_ADDRESS is 'localhost:9180' — inside the agent container that is the agent itself, not this machine.",
    );
  });

  test("a list without its square brackets is the error that stops the collector", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      env: { OPENSTACK_EXPORTER_CLOUDS: "RegionOne,RegionTwo" },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "✗ OPENSTACK_EXPORTER_CLOUDS is 'RegionOne,RegionTwo' — not a list in square brackets, so the collector refuses to start.",
    );
  });
});

/* ------------------------------------------------------------------- the rest */

describe("the rest of the chain", () => {
  test("--skip-access asks nothing of the services, and --help prints the usage", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, { args: ["--skip-access"] });
    await cloud.close();

    expect(run.output).toContain("• Skipped (--skip-access).");
    expect(
      cloud.requests.filter((request) => {
        return request.token;
      }),
    ).toEqual([]);

    const help = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain(
      "./troubleshoot.sh [-d INSTALL_DIR] [--skip-egress] [--skip-access] [--curl-image IMG] [--no-color]",
    );
    expect(help.stdout).toContain("Nothing secret goes on a command line");
  });

  test("run as `curl ... | bash`, Docker leaves the script on stdin alone, and it runs to the end", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, { viaStdin: true });
    await cloud.close();

    expect(run.output).toContain("That adds up to Full view");
    expect(run.output).toContain("The agent looks healthy");
    expect(run.status).toBe(0);
  });

  test("names the cloud it reports as, and a config that has lost the stamp", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      env: { OPENSTACK_CLOUD_NAME: "prod-east" },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain(
      "Reporting as cloud name: 'prod-east'  (this is the openstack.cloud.name OneUptime keys on)",
    );
    expect(run.output).toContain(
      "✔ Collector config stamps the openstack.cloud.name resource attribute.",
    );
  });

  test("shows the collector's error lines", async () => {
    const cloud = await startCloud();
    const run = await runDoctor(cloud, {
      files: {
        "collector.log":
          "info started\nerror Exporting failed. HTTP Status Code 401\n",
      },
      args: ["--skip-access"],
    });
    await cloud.close();

    expect(run.output).toContain("Exporting failed. HTTP Status Code 401");
    expect(run.output).not.toContain("info started");
  });
});

/* ------------------------------------------------------------ without Docker */

describe("an install without Docker", () => {
  let cloud;
  let run;

  beforeAll(async () => {
    cloud = await startCloud({ scenario: infrastructureOnly });
    run = await runDoctor(cloud, {
      native: true,
      env: { OPENSTACK_CLOUD_NAME: `cost$$ly "east"` },
      files: { "collector.log": "error Exporting failed\n" },
    });
  });

  afterAll(async () => {
    await cloud.close();
  });

  test("never calls docker, and runs the probes on this machine", () => {
    expect(run.docker).toBe("");
    expect(run.output).toContain(
      "holds the agent without Docker (systemd services)",
    );
    expect(run.output).toContain(
      "✔ Service 'oneuptime-openstack-agent' is active",
    );
    expect(run.output).toContain(
      "✔ Service 'oneuptime-openstack-exporter' is active",
    );
    expect(run.curlLog).toContain("/auth/tokens");
  });

  test("runs the whole access check, with nothing secret on curl's command line", () => {
    expect(lineAbout(accessLines(run), "network: routers")).toBe(
      "▲ network: routers — may be own project only (every row is in one project)",
    );
    expect(lineAbout(accessLines(run), "compute: hypervisors")).toBe(
      "✔ compute: hypervisors — reads everything",
    );
    expect(cloud.logins).toHaveLength(1);
    for (const secret of [APP_ID, APP_SECRET, TOKEN, KEY]) {
      expect(run.curlLog).not.toContain(secret);
    }
  });

  test("reads .env by systemd's rules, where a $ is literal", () => {
    expect(run.output).toContain(`Reporting as cloud name: 'cost$$ly "east"'`);
  });

  test("checks the ingestion key, the collector's own metrics on 8891 and its log in the journal", () => {
    expect(run.output).toContain(
      "✔ Reached OneUptime and the ingestion token is VALID (/otlp/v1/validate → 200).",
    );
    expect(run.curlLog).toContain("http://127.0.0.1:8891/metrics");
    expect(run.output).toContain("accepted=10  sent=10  send_failed=0");
    expect(run.journalctl).toContain("-u oneuptime-openstack-agent");
    expect(run.output).toContain("error Exporting failed");
    expect(run.status).toBe(0);
  });

  test("a service that is down is the root cause", async () => {
    const stopped = await startCloud();
    const down = await runDoctor(stopped, {
      native: true,
      files: { "oneuptime-openstack-agent.inactive": "" },
      args: ["--skip-access"],
    });
    await stopped.close();

    expect(down.output).toContain(
      "✗ Service 'oneuptime-openstack-agent' is NOT active: failed",
    );
    expect(down.output).toContain("ROOT CAUSE: the agent isn't running.");
    expect(down.output).toContain(
      "journalctl -u oneuptime-openstack-agent -n 100 --no-pager",
    );
    expect(down.status).toBe(1);
  });
});

/* ------------------------------------------------------------ the helpers */

describe("the script's helpers", () => {
  const doctor = fs.readFileSync(SCRIPT, "utf8");
  const installer = fs.readFileSync(path.join(AGENT_DIR, "install.sh"), "utf8");

  function shellFunction(script, name) {
    const start = script.indexOf(`\n${name}() {\n`);
    expect(start).toBeGreaterThan(-1);
    const end = script.indexOf("\n}\n", start);
    return script.slice(start + 1, end + 2);
  }

  // The same function at another indent: the scripts differ in that alone.
  function unindented(text) {
    return text
      .split("\n")
      .map((line) => {
        return line.trimStart();
      })
      .join("\n");
  }

  test("reads a quoted .env the way install.sh writes it, with the VMware doctor's helper", () => {
    const vmware = fs.readFileSync(
      path.join(REPO_ROOT, "agents/VMwareAgent/troubleshoot.sh"),
      "utf8",
    );
    expect(shellFunction(doctor, "dotenv_get")).toBe(
      shellFunction(vmware, "dotenv_get"),
    );
    expect(doctor).toContain('v=$(dotenv_get "$1" "$ENV_FILE")');
  });

  test.each([["json_string"], ["clouds_yaml_get"], ["systemd_env_get"]])(
    "%s is the installer's",
    (name) => {
      expect(unindented(shellFunction(doctor, name))).toBe(
        unindented(shellFunction(installer, name)),
      );
    },
  );

  test("logs in with the same request the installer does", () => {
    const shape = (text) => {
      return Array.from(text.matchAll(/printf '(\{"auth".*?)'/g)).map(
        (match) => {
          return match[1];
        },
      );
    };
    expect(shape(shellFunction(doctor, "keystone_auth_body"))).toEqual(
      shape(shellFunction(installer, "keystone_auth_body")),
    );
    expect(shape(shellFunction(doctor, "keystone_auth_body"))).toHaveLength(2);
  });

  test("hands the credential only to a curl image pinned by digest, the Database agent's doctor's", () => {
    const pinOf = (text) => {
      return text.match(/^CURL_IMAGE="([^"]+)"$/m)[1];
    };
    expect(pinOf(doctor)).toMatch(
      /^curlimages\/curl:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
    );
    expect(pinOf(doctor)).toBe(
      pinOf(
        fs.readFileSync(
          path.join(REPO_ROOT, "agents/DatabaseAgent/troubleshoot.sh"),
          "utf8",
        ),
      ),
    );
  });

  test("passes bash -n", () => {
    const result = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
