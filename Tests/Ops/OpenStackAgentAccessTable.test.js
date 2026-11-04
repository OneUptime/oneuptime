"use strict";

/**
 * What the OpenStack agent's docs say each level of access gets, against what real
 * clouds answered. access-matrix.sh records every read and write of each credential in
 * packages/Common/Tests/Fixtures/OpenStack/<release>/access/, and
 * openstack-e2e/access-table.py writes the tables from those recordings. So a table on
 * a page that differs from what the script prints fails here, and the words around the
 * tables are held to the same recordings.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const E2E_DIR = path.join(__dirname, "openstack-e2e");
const SCRIPT = path.join(E2E_DIR, "access-table.py");
const FIXTURES = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Tests",
  "Fixtures",
  "OpenStack",
);
const DOCS = path.join(REPO_ROOT, "packages", "App", "FeatureSet", "Docs");

const README = path.join(AGENT_DIR, "README.md");
const DOCS_PAGE = path.join(DOCS, "Content", "en", "telemetry", "openstack.md");
const GUIDE = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "OpenStack",
  "Utils",
  "DocumentationMarkdown.ts",
);

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-access-table-"));
  scratchDirs.push(dir);
  return dir;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function runScript(...args) {
  return spawnSync("python3", ["-I", "-B", SCRIPT, ...args], {
    encoding: "utf8",
  });
}

function generated(...args) {
  const run = runScript(...args);
  expect({ status: run.status, stderr: run.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  return run.stdout.replace(/\n$/, "");
}

// The table on a page: from its header line to the first line that is not a row.
function tableOn(text, header) {
  const at = text.indexOf(header);
  if (at < 0) {
    return `no table with the header "${header}"`;
  }
  const rows = [];
  for (const line of text.slice(at).split("\n")) {
    if (!line.startsWith("|")) {
      break;
    }
    // The in-app guide holds its table in a template string.
    rows.push(line.replace(/`;$/, ""));
  }
  return rows.join("\n");
}

const AGAIN =
  "(a different table means a recording changed, or a page was edited by hand: run python3 Tests/Ops/openstack-e2e/access-table.py and paste what it prints)";

describe("the tables on the pages", () => {
  const reads = generated();
  const series = generated("--series");

  test("are what the script makes of five real clouds", () => {
    expect(reads.split("\n").length).toBeGreaterThan(25);
    expect(
      fs
        .readdirSync(FIXTURES)
        .filter((name) => {
          return fs.existsSync(path.join(FIXTURES, name, "access"));
        })
        .sort(),
    ).toEqual([
      "epoxy-ovn",
      "flamingo-ovn",
      "gazpacho-ovn",
      "gazpacho-ovs",
      "hibiscus-ovn",
    ]);
    // Where they disagree the cell would say so, and today they agree.
    expect(reads).not.toContain(" on ");
  });

  test.each([
    ["the docs page", DOCS_PAGE],
    ["the README", README],
    ["the in-app guide", GUIDE],
  ])(`%s holds the table of reads ${AGAIN}`, (_name, file) => {
    expect(tableOn(read(file), reads.split("\n")[0])).toBe(reads);
  });

  test.each([
    ["the docs page", DOCS_PAGE],
    ["the README", README],
  ])(`%s holds the table of what the exporter got ${AGAIN}`, (_name, file) => {
    expect(tableOn(read(file), series.split("\n")[0])).toBe(series);
  });

  test("every word a cell can hold is explained under the table, on each page", () => {
    const cells = new Set(
      reads
        .split("\n")
        .slice(2)
        .flatMap((row) => {
          return row.slice(2, -2).split(" | ").slice(1);
        }),
    );
    expect([...cells].sort()).toEqual([
      "409, expected",
      "all",
      "none recorded",
      "nothing",
      "own project only",
      "refused",
      "what anyone sees",
    ]);
    for (const file of [DOCS_PAGE, README, GUIDE]) {
      for (const cell of cells) {
        expect({ file, cell, explained: true }).toEqual({
          file,
          cell,
          explained: read(file).includes(`- **${cell}**: `),
        });
      }
    }
  });
});

/* ---------------------------------------- the script, on recordings made here */

// What one read answered: a number is a 200 with that many rows, a string a refusal.
function result(answer) {
  return typeof answer === "number"
    ? { status: 200, count: answer, seesAll: true }
    : { status: Number(answer), count: null, seesAll: false, reason: "no" };
}

function results(answers) {
  return Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => {
      return [name, result(answer)];
    }),
  );
}

/*
 * A read as each matrix recorded it. `rules` is level 1 beside its admin. `overrides`
 * and `defaults` are [admin, plain reader, the role on an empty project, the role on a
 * real project], with and without the policy overrides.
 */
function recording({
  service = "compute",
  label,
  rules = [5, 5],
  overrides,
  defaults,
}) {
  const four = ([admin, reader, role, onAProject]) => {
    return results({
      admin,
      reader,
      "monitoring-role": role,
      "role-on-a-project": onAProject,
    });
  };
  return {
    rules: {
      service,
      read: label,
      results: results({
        admin: rules[0],
        "monitoring-admin-get": rules[1],
      }),
    },
    overrides: { service, read: label, results: four(overrides) },
    defaults: { service, read: label, results: four(defaults) },
  };
}

function writeRecordings(dir, release, reads, exporter) {
  const access = path.join(dir, release, "access");
  fs.mkdirSync(path.join(access, "exporter"), { recursive: true });
  const files = {
    "matrix-access-rules.json": "rules",
    "matrix.json": "overrides",
    "matrix-default-policy.json": "defaults",
  };
  for (const [file, kind] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(access, file),
      JSON.stringify({
        reads: reads.map((one) => {
          return one[kind];
        }),
        writes: [],
        credentials: [],
      }),
    );
  }
  for (const [level, text] of Object.entries(exporter || {})) {
    fs.writeFileSync(path.join(access, "exporter", `${level}.txt`), text);
  }
}

// [level 1, level 2, level 3] for each read, from a table the script printed.
function cellsIn(table) {
  return Object.fromEntries(
    table
      .split("\n")
      .slice(2)
      .map((row) => {
        const [name, ...levels] = row.slice(2, -2).split(" | ");
        return [name, levels];
      }),
  );
}

describe("what the script makes of a recording", () => {
  function tableOf(reads, release = "epoxy-ovn") {
    const dir = scratch();
    writeRecordings(dir, release, reads);
    return cellsIn(generated(dir));
  }

  test("the same rows an admin saw, where a reader is refused, is all", () => {
    expect(
      tableOf([
        recording({
          label: "hypervisors",
          overrides: [5, "403", 5, 5],
          defaults: [5, "403", "403", "403"],
        }),
      ]),
    ).toEqual({ "Nova: hypervisors": ["all", "all", "refused"] });
  });

  test("fewer rows than an admin saw is own project only", () => {
    expect(
      tableOf([
        recording({
          service: "network",
          label: "routers",
          overrides: [5, 2, 0, 2],
          defaults: [5, 2, 0, 2],
        }),
      ]),
    ).toEqual({
      "Neutron: routers": ["all", "own project only", "own project only"],
    });
  });

  test("every row an admin saw is still own project only, when another project sees fewer", () => {
    expect(
      tableOf([
        recording({
          service: "block-storage",
          label: "volumes",
          overrides: [3, 3, 0, 3],
          defaults: [3, 3, 0, 3],
        }),
      ])["Cinder: volumes"],
    ).toEqual(["all", "own project only", "own project only"]);
  });

  test("what every credential sees with default policy is what anyone sees", () => {
    expect(
      tableOf([
        recording({
          service: "image",
          label: "images",
          overrides: [1, 1, 1, 1],
          defaults: [1, 1, 1, 1],
        }),
      ])["Glance: images"],
    ).toEqual(["all", "what anyone sees", "what anyone sees"]);
  });

  test("a 200 with no rows on either project, where an admin saw some, is nothing", () => {
    expect(
      tableOf([
        recording({
          service: "network",
          label: "agents",
          overrides: [4, 0, 4, 4],
          defaults: [4, 0, 0, 0],
        }),
      ])["Neutron: agents"],
    ).toEqual(["all", "all", "nothing"]);
  });

  test("no rows anywhere tells nothing, unless a policy override opened what a reader is refused", () => {
    const table = tableOf([
      recording({
        service: "block-storage",
        label: "backups",
        rules: [0, 0],
        overrides: [0, 0, 0, 0],
        defaults: [0, 0, 0, 0],
      }),
      recording({
        label: "aggregates",
        rules: [0, 0],
        overrides: [0, "403", 0, 0],
        defaults: [0, "403", "403", "403"],
      }),
    ]);
    expect(table["Cinder: backups"]).toEqual([
      "all",
      "none recorded",
      "none recorded",
    ]);
    expect(table["Nova: aggregates"]).toEqual(["all", "all", "refused"]);
  });

  test("a 409 is said to be one, and a 401 is a refusal", () => {
    const table = tableOf([
      recording({
        service: "network",
        label: "security groups",
        rules: [6, "401"],
        overrides: [6, 2, "409", 2],
        defaults: [6, 2, "409", 2],
      }),
    ]);
    expect(table["Neutron: security groups"]).toEqual([
      "refused",
      "409, expected",
      "own project only",
    ]);
  });

  test("a service that was failing stops it: a table must not call that a level of access", () => {
    const dir = scratch();
    writeRecordings(dir, "epoxy-ovn", [
      recording({
        label: "services",
        overrides: [4, "403", "503", 4],
        defaults: [4, "403", "403", "403"],
      }),
    ]);
    const run = runScript(dir);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("HTTP 503 in a recording: record it again.");
  });

  test("where releases disagree the cell says which said what, naming a release once", () => {
    const dir = scratch();
    const answers = (level2) => {
      return [
        recording({
          label: "hypervisors",
          overrides: [5, "403", level2, 5],
          defaults: [5, "403", "403", "403"],
        }),
      ];
    };
    writeRecordings(dir, "epoxy-ovn", answers(5));
    writeRecordings(dir, "gazpacho-ovn", answers(5));
    writeRecordings(dir, "gazpacho-ovs", answers(5));
    writeRecordings(dir, "hibiscus-ovn", answers("403"));
    expect(cellsIn(generated(dir))["Nova: hypervisors"]).toEqual([
      "all",
      "all on Epoxy, Gazpacho; refused on Hibiscus",
      "refused",
    ]);
  });

  test("releases that recorded different reads stop it, and so does no recording at all", () => {
    const dir = scratch();
    const one = (label) => {
      return recording({
        label,
        overrides: [5, "403", 5, 5],
        defaults: [5, "403", "403", "403"],
      });
    };
    writeRecordings(dir, "epoxy-ovn", [one("services")]);
    writeRecordings(dir, "hibiscus-ovn", [one("hypervisors")]);
    const run = runScript(dir);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("hibiscus-ovn recorded other reads");

    const empty = runScript(scratch());
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("No recordings in ");
  });

  test("the exporter's series are a number, or a range where clouds differ", () => {
    const dir = scratch();
    const exporter = (network) => {
      return Object.fromEntries(
        ["admin", "monitoring-admin-get", "monitoring-role", "reader"].map(
          (level) => {
            return [
              level,
              `identity 200 4 series\nnetwork 200 ${network} series\n`,
            ];
          },
        ),
      );
    };
    writeRecordings(dir, "epoxy-ovn", [], exporter(36));
    writeRecordings(dir, "hibiscus-ovn", [], exporter(40));
    expect(generated("--series", dir)).toBe(
      [
        "| Exporter service | Admin | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |",
        "| --- | --- | --- | --- | --- |",
        "| identity | 4 | 4 | 4 | 4 |",
        "| network | 36 to 40 | 36 to 40 | 36 to 40 | 36 to 40 |",
      ].join("\n"),
    );
  });
});

/* ------------------------------------- what the words beside the tables rest on */

const RELEASES = fs
  .readdirSync(FIXTURES)
  .filter((name) => {
    return fs.existsSync(path.join(FIXTURES, name, "access"));
  })
  .sort();

function matrix(release, name) {
  return JSON.parse(
    read(path.join(FIXTURES, release, "access", `${name}.json`)),
  );
}

function writeOf(release, name, service, write) {
  return matrix(release, name).writes.find((row) => {
    return row.service === service && row.write === write;
  }).results;
}

function readOf(release, name, service, label) {
  return matrix(release, name).reads.find((row) => {
    return row.service === service && row.read === label;
  }).results;
}

describe("what the recordings show, as the pages say it", () => {
  test.each(RELEASES)(
    "%s: level 1 read everything with a 200, and every write answered 401",
    (release) => {
      const recorded = matrix(release, "matrix-access-rules");
      expect(recorded.reads.length).toBeGreaterThan(25);
      for (const row of recorded.reads) {
        expect({
          read: row.read,
          status: row.results["monitoring-admin-get"].status,
        }).toEqual({ read: row.read, status: 200 });
      }
      expect(recorded.writes.length).toBeGreaterThan(5);
      for (const row of recorded.writes) {
        expect({
          write: row.write,
          status: row.results["monitoring-admin-get"].status,
        }).toEqual({ write: row.write, status: 401 });
      }
    },
  );

  test.each(RELEASES)(
    "%s: level 2 wrote nothing: every write answered 403, or 409 and 413 from quota",
    (release) => {
      for (const row of matrix(release, "matrix").writes) {
        const { status, wrote } = row.results["monitoring-role"];
        expect({ write: row.write, wrote, refused: true }).toEqual({
          write: row.write,
          wrote: false,
          refused: [403, 409, 413].includes(status),
        });
      }
    },
  );

  test("a plain reader and the role on a real project created a volume, everywhere but Hibiscus", () => {
    const created = {};
    for (const release of RELEASES) {
      const results = writeOf(
        release,
        "matrix",
        "block-storage",
        "create a volume",
      );
      created[release] = [
        results.reader.status,
        results["role-on-a-project"].status,
      ];
    }
    expect(created).toEqual({
      "epoxy-ovn": [202, 202],
      "flamingo-ovn": [202, 202],
      "gazpacho-ovn": [202, 202],
      "gazpacho-ovs": [202, 202],
      "hibiscus-ovn": [403, 403],
    });
  });

  test.each(RELEASES)(
    "%s: Cinder's services and pools refuse the role, whatever policy says",
    (release) => {
      for (const label of ["services", "pools"]) {
        expect(
          readOf(release, "matrix", "block-storage", label)["monitoring-role"]
            .status,
        ).toBe(403);
      }
    },
  );

  test.each(RELEASES)(
    "%s: Neutron answers an empty project's list of security groups with 409",
    (release) => {
      const answer = readOf(release, "matrix", "network", "security groups")[
        "monitoring-role"
      ];
      expect(answer.status).toBe(409);
      expect(answer.reason).toContain("Quota exceeded");
    },
  );

  test.each(RELEASES)(
    "%s: Neutron's quotas are an admin's alone at every level but level 1",
    (release) => {
      expect(
        readOf(release, "matrix-access-rules", "network", "quotas")[
          "monitoring-admin-get"
        ].status,
      ).toBe(200);
      expect(
        readOf(release, "matrix", "network", "quotas")["monitoring-role"]
          .status,
      ).toBe(403);
      expect(
        readOf(release, "matrix-default-policy", "network", "quotas").reader
          .status,
      ).toBe(403);
    },
  );

  test("the pages say so of Neutron's quotas", () => {
    for (const file of [README, DOCS_PAGE]) {
      expect(read(file)).toContain(
        "Neutron's list of quotas is an admin's alone at every level but level 1, so `openstack_neutron_quota_*` needs that level.",
      );
    }
    expect(read(GUIDE)).toContain(
      "Neutron's quotas answer only **Full view**.",
    );
  });

  test("the reads those clouds do not run are the ones the pages say they do not", () => {
    const source = read(path.join(E2E_DIR, "access-matrix.py"));
    const block = source.slice(
      source.indexOf("READS = ["),
      source.indexOf("# Writes a monitoring credential"),
    );
    const asked = Array.from(block.matchAll(/^\s+\("([^"]+)", "([^"]+)", /gm));
    const recorded = matrix(RELEASES[0], "matrix").reads.map((row) => {
      return `${row.service}: ${row.read}`;
    });
    expect(
      asked
        .map(([, service, label]) => {
          return `${service}: ${label}`;
        })
        .filter((name) => {
          return !recorded.includes(name);
        }),
    ).toEqual([
      "load-balancer: load balancers",
      "load-balancer: amphorae",
      "baremetal: nodes",
    ]);
    for (const file of [README, DOCS_PAGE]) {
      expect(read(file)).toContain(
        "Octavia and Ironic are not here because those clouds do not run them.",
      );
    }
  });

  test("the service types the pages name are the ones the rig set, and the rules carry Cinder's under both names", () => {
    const rig = read(path.join(E2E_DIR, "access-matrix.sh"));
    expect(
      Array.from(rig.matchAll(/^set_service_type \S+ (\S+)$/gm)).map(
        (match) => {
          return match[1];
        },
      ),
    ).toEqual(["compute", "network", "block-storage", "image", "placement"]);

    const rules = JSON.parse(
      read(
        path.join(
          AGENT_DIR,
          "access",
          "application-credential-access-rules.json",
        ),
      ),
    );
    const paths = (service) => {
      return rules
        .filter((rule) => {
          return rule.service === service;
        })
        .map((rule) => {
          return rule.path;
        });
    };
    expect(paths("block-storage").length).toBeGreaterThan(0);
    expect(paths("volumev3")).toEqual(paths("block-storage"));
    expect(paths("identity")).not.toContain("/v3/users");
    expect(paths("identity")).not.toContain("/v3/groups");
  });
});

/* ------------------------------------------------------------- nothing for Cinder */

describe("there is no policy file for Cinder", () => {
  test("in the folder, or in what OneUptime serves", () => {
    expect(
      fs.readdirSync(path.join(AGENT_DIR, "access", "policy")).sort(),
    ).toEqual(["keystone.yaml", "neutron.yaml", "nova.yaml", "placement.yaml"]);
    expect(
      read(
        path.join(
          REPO_ROOT,
          "packages",
          "Common",
          "Types",
          "InstallScripts",
          "InstallScripts.ts",
        ),
      ),
    ).not.toContain("cinder.yaml");
  });

  test.each([
    ["the docs page", DOCS_PAGE],
    ["the README", README],
    ["the in-app guide", GUIDE],
    ["the doctor", path.join(AGENT_DIR, "troubleshoot.sh")],
    ["install.sh", path.join(AGENT_DIR, "install.sh")],
  ])("%s does not name one", (_name, file) => {
    expect(read(file)).not.toContain("cinder.yaml");
    expect(read(file)).not.toContain("volume_extension:services:index");
    expect(read(file)).not.toContain("scheduler_stats:get_pools");
  });
});

/* ------------------------------------------------------- what every page must say */

// The in-app guide as its reader sees it, with the names it fills in.
function asRead(file) {
  return read(file)
    .replace(/\\`/g, "`")
    .replace(/\$\{OPENSTACK_MONITORING_PROJECT\}/g, "oneuptime-monitoring")
    .replace(/\$\{OPENSTACK_MONITORING_ROLE\}/g, "oneuptime_monitoring")
    .replace(
      /\$\{OPENSTACK_ACCESS_RULES_FITTER\}/g,
      "access-rules-for-cloud.py",
    );
}

describe.each([
  ["the docs page", DOCS_PAGE],
  ["the README", README],
  ["the in-app guide", GUIDE],
])("%s", (_name, file) => {
  const text = asRead(file);

  test("makes level 2's project with the rig's own commands, holding nothing, with zero quota", () => {
    const quotas = read(path.join(E2E_DIR, "access-matrix.sh"))
      .split("\n")
      .filter((line) => {
        return line.startsWith("openstack quota set ");
      });
    expect(quotas).toHaveLength(3);
    for (const line of quotas) {
      expect(text).toContain(
        line.replace(/ ou-monitoring$/, " oneuptime-monitoring"),
      );
    }
    for (const role of ["oneuptime_monitoring", "reader"]) {
      expect(text).toContain(
        `openstack role add --project oneuptime-monitoring --user oneuptime-monitoring ${role}`,
      );
    }
    expect(text).toContain(
      "every write answered `403`, or `409` and `413` from quota",
    );
  });

  test("says Cinder's defaults let a role on a real project write", () => {
    expect(text).toContain(
      "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off.",
    );
    expect(text).toContain("which is Cinder's own default");
    expect(text).toContain("On Epoxy, Flamingo and Gazpacho it did");
    expect(text).toContain(
      "because DevStack only turns `enforce_new_defaults` on there",
    );
  });

  test("says to empty a policy file, never to delete it, and what to do if it is gone", () => {
    expect(text).toContain("empty the file (`{}`) and never delete it");
    expect(text).toContain("the whole cloud answers `503`");
    expect(text).toContain("If it has already happened, restart the service.");
  });

  test("names the file a service reads as that service's own setting", () => {
    expect(text).toContain("[oslo_policy] policy_file");
  });

  test("fits the access rules to the cloud, and names each service type", () => {
    expect(text).toMatch(
      /openstack catalog list -f json \| python3 access-rules-for-cloud\.py/,
    );
    expect(text).not.toContain(
      '--access-rules "$(cat application-credential-access-rules.json)"',
    );
    expect(text).toContain("Keystone needs nothing");
    expect(text).toContain("`volumev3`, for a Cinder configured that way");
  });

  test("says level 1 leaves out Keystone's users and groups, on purpose", () => {
    expect(text).toContain("Keystone's users and groups, on purpose");
  });

  test("says level 3 shows no instances through the agent, and what does", () => {
    expect(text).toMatch(
      /[Tt]he exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole/,
    );
    expect(text).toContain(
      "Only a OneUptime probe, collecting without this agent, can list one project's instances.",
    );
  });

  test("says Neutron's 409 on an empty project is harmless", () => {
    expect(text).toContain("`409 Quota exceeded`");
    expect(text).toContain("That is harmless");
  });

  test("no longer says what the recordings disproved", () => {
    // Level 2 sees every project's servers.
    expect(text).not.toMatch(/[Ii]nstances, volumes and routers appear only/);
    expect(text).not.toContain("Nova's developers");
    // Named only to say why it is not used.
    expect(text).not.toContain("exporter's slow metrics");
    expect(text).not.toContain("--disable-slow-metrics` is on");
  });
});

/* ------------------------------------------------------------------ the docs page */

describe("the docs page", () => {
  const page = read(DOCS_PAGE);
  const lines = page.split("\n");

  test("is in the nav, under its title, as every page must be", () => {
    expect(lines[0]).toBe("# OpenStack Agent");
    expect(read(path.join(DOCS, "Utils", "Nav.ts"))).toMatch(
      /title: "OpenStack Agent",\s+url: "\/docs\/telemetry\/openstack",/,
    );
  });

  test("tells a self-hosted reader, once, on the line AgentInstallDocsServed reads", () => {
    const notes = lines.filter((line) => {
      return (
        line.startsWith("Every OneUptime serves ") &&
        line.includes("self-hosted OneUptime") &&
        line.includes("`https://oneuptime.com`") &&
        line.includes("so you can read it before you run it")
      );
    });
    expect(notes).toHaveLength(1);
  });

  test("every download fails on an error answer, and every file it names is served", () => {
    const catalog = read(
      path.join(
        REPO_ROOT,
        "packages",
        "Common",
        "Types",
        "InstallScripts",
        "InstallScripts.ts",
      ),
    );
    const downloads = lines.filter((line) => {
      return (
        line.includes("https://oneuptime.com/install/openstack-agent") &&
        line.includes("curl ")
      );
    });
    expect(downloads.length).toBeGreaterThan(5);
    for (const line of downloads) {
      expect({ line, flags: line.match(/curl -(\S*)/)[1] }).toEqual({
        line,
        flags: expect.stringContaining("f"),
      });
      const file = line.match(/\/install\/openstack-agent\/([A-Za-z0-9._/-]+)/);
      if (file) {
        expect({ file: file[1], served: true }).toEqual({
          file: file[1],
          served:
            catalog.includes(`"${file[1]}"`) || file[1] === "troubleshoot.sh",
        });
        expect(fs.existsSync(path.join(AGENT_DIR, file[1]))).toBe(true);
      }
    }
  });

  test("says the same as the README of what the agent turns off", () => {
    const readme = read(README);
    const compose = read(path.join(AGENT_DIR, "docker-compose.yml"));
    const flags = Array.from(compose.matchAll(/- (--disable-metric=\S+)/g)).map(
      (match) => {
        return match[1];
      },
    );
    expect(flags.length).toBeGreaterThan(5);
    for (const flag of flags) {
      for (const text of [page, readme]) {
        expect({
          flag,
          named: flag.startsWith("--disable-metric=neutron-port")
            ? text.includes("the four `--disable-metric=neutron-port*` lines")
            : text.includes(`\`${flag}\``),
        }).toEqual({ flag, named: true });
      }
    }
    for (const issue of [540, 660, 244]) {
      expect(page).toContain(
        `https://github.com/openstack-exporter/openstack-exporter/issues/${issue}`,
      );
    }
  });

  test("says the interval each job has, and each timeout, as the collector's config does", () => {
    const { scrape_configs: jobs } = yaml.load(
      read(path.join(AGENT_DIR, "otel-collector-config.yaml")),
    ).receivers.prometheus.config;
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      const minutes = Number.parseInt(job.scrape_interval, 10) / 60;
      const timeout = Number.parseInt(job.scrape_timeout, 10);
      expect(page).toContain(
        `| \`${job.job_name}\` | ${minutes} minutes | ${timeout} s |`,
      );
    }
  });

  test("names the alert templates that need level 1, as the monitor's page calls them", () => {
    const monitor = read(
      path.join(DOCS, "Content", "en", "monitor", "openstack-monitor.md"),
    );
    for (const template of [
      "Block Storage Service Down",
      "Storage Pool Warning",
      "Storage Pool Critical",
      "Compute Service Down",
      "Network Agent Down",
    ]) {
      expect(page).toContain(`**${template}**`);
      expect(monitor).toContain(`| ${template} |`);
    }
  });
});
