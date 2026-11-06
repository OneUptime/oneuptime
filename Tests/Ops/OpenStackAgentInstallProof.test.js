"use strict";

/**
 * Tests/Ops/openstack-e2e/agent-install.sh installs the OpenStack agent the way its docs say,
 * on a DevStack, and is only as good as what it stands on. A DevStack takes half an hour to
 * deploy, so what can be proven without one is proven here:
 *
 *  - the docs page still holds the commands it runs, and they are what a person is told to run;
 *  - the stand-in OneUptime answers as the real one does, and reads an OTLP request right, because
 *    a check that reads the wrong thing passes for the wrong reason;
 *  - every phase is wired into the workflow.
 */

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const RIG = path.join(__dirname, "openstack-e2e");
const DOCS_PAGE = path.join(
  ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "telemetry",
  "openstack.md",
);
const CATALOG = path.join(
  ROOT,
  "packages",
  "Common",
  "Types",
  "InstallScripts",
  "InstallScripts.ts",
);
const WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "test.openstack-e2e.yaml",
);
const { loadInstallScriptsCatalog } = require("./Utils/InstallScriptsCatalog");

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-install-proof-"));
  scratchDirs.push(dir);
  return dir;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function lift() {
  const out = scratch();
  childProcess.execFileSync("python3", [
    "-I",
    path.join(RIG, "agent-install-docs.py"),
    DOCS_PAGE,
    out,
    "http://stand-in:4318",
    CATALOG,
  ]);
  return (name) => {
    return read(path.join(out, name));
  };
}

describe("the commands it lifts out of the docs page", () => {
  const lifted = lift();

  test("are the ones a person is told to run, on the OneUptime they name", () => {
    expect(lifted("install-docker.sh")).toBe(
      "curl -fsSL http://stand-in:4318/install/openstack-agent -o install.sh\nbash install.sh\n",
    );
    expect(lifted("install-without-docker.sh")).toBe(
      "curl -fsSL http://stand-in:4318/install/openstack-agent -o install.sh\nsudo bash install.sh --without-docker\n",
    );
    expect(lifted("upgrade.sh")).toBe(
      "curl -fsSL http://stand-in:4318/install/openstack-agent -o install.sh\nbash install.sh\n",
    );
    expect(lifted("systemd-unit.sh")).toContain(
      "sudo systemctl enable --now oneuptime-openstack-agent",
    );
    expect(lifted("troubleshoot.sh")).toContain("sudo bash troubleshoot.sh");
    expect(lifted("uninstall-docker.sh")).toContain("docker compose down");
    expect(lifted("uninstall-systemd-unit.sh")).toContain(
      "sudo rm -f /etc/systemd/system/oneuptime-openstack-agent.service",
    );
    expect(lifted("uninstall-without-docker.sh")).toContain(
      "sudo userdel oneuptime-openstack",
    );
  });

  test("name no address but the OneUptime they were given", () => {
    for (const name of [
      "install-docker.sh",
      "install-without-docker.sh",
      "upgrade.sh",
      "systemd-unit.sh",
      "troubleshoot.sh",
    ]) {
      expect(lifted(name)).not.toContain("oneuptime.com");
    }
  });

  test("check the agent from the folder Compose needs to be in, and return", () => {
    // Asked from anywhere else, `docker compose ps` says no configuration file was found.
    expect(lifted("check-running.sh").split("\n")[0]).toMatch(
      /^cd \/opt\/oneuptime-openstack-agent\b/,
    );
    // -f would never end, for a reader or for the rig.
    expect(lifted("check-running.sh")).not.toContain("logs -f");
  });

  test("a page that loses a block stops the rig, and says which", () => {
    const out = scratch();
    const page = path.join(out, "page.md");
    fs.writeFileSync(
      page,
      read(DOCS_PAGE).replace(
        "curl -fsSL https://oneuptime.com/install/openstack-agent/troubleshoot.sh -o troubleshoot.sh",
        "",
      ).replace("sudo bash troubleshoot.sh", "").replace(/```bash\n\s*#[^\n]*\n```/, ""),
    );
    const result = childProcess.spawnSync(
      "python3",
      [
        "-I",
        path.join(RIG, "agent-install-docs.py"),
        page,
        out,
        "http://stand-in:4318",
        CATALOG,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("the diagnostic script");
  });

  test("the files it serves are the ones the real OneUptime lists, and it finds them all", () => {
    const entry = loadInstallScriptsCatalog().INSTALL_SCRIPTS.find(
      (candidate) => {
        return candidate.name === "openstack-agent";
      },
    );
    expect(lifted("served-files.txt").trim().split("\n").sort()).toEqual(
      [...entry.files].sort(),
    );
  });
});

/*
 * An OTLP request, written field by field as the collector's protobuf encoder writes it. Only what
 * is read is here. Wire types: 0 a varint, 1 eight bytes, 2 a length and that many bytes.
 */
function varint(value) {
  const bytes = [];
  let left = value;
  while (left > 127) {
    bytes.push((left & 127) | 128);
    left = Math.floor(left / 128);
  }
  bytes.push(left);
  return Buffer.from(bytes);
}

function lengthDelimited(field, buffer) {
  return Buffer.concat([
    varint((field << 3) | 2),
    varint(buffer.length),
    buffer,
  ]);
}

function string(field, text) {
  return lengthDelimited(field, Buffer.from(text, "utf8"));
}

function attribute(field, key, value) {
  return lengthDelimited(
    field,
    Buffer.concat([string(1, key), lengthDelimited(2, string(1, value))]),
  );
}

function point(value, region) {
  const double = Buffer.alloc(8);
  double.writeDoubleLE(value);
  return lengthDelimited(
    1,
    Buffer.concat([
      region === null
        ? Buffer.alloc(0)
        : attribute(7, "openstack.region.name", region),
      varint((4 << 3) | 1),
      double,
    ]),
  );
}

function metric(name, points, kind = 5) {
  return lengthDelimited(
    2,
    Buffer.concat([
      string(1, name),
      lengthDelimited(kind, Buffer.concat(points)),
    ]),
  );
}

function request(attributes, metrics) {
  return lengthDelimited(
    1,
    Buffer.concat([
      lengthDelimited(
        1,
        Buffer.concat(
          Object.entries(attributes).map(([key, value]) => {
            return attribute(1, key, value);
          }),
        ),
      ),
      lengthDelimited(2, Buffer.concat(metrics)),
    ]),
  );
}

describe("the stand-in OneUptime", () => {
  const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
  let process_;
  let port;
  let folder;
  let served;

  function ask(method, url, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request(
        {
          host: "127.0.0.1",
          port,
          path: url,
          method,
          // As the collector sends one: its body is in memory, so it says how long.
          headers: body
            ? { ...headers, "Content-Length": body.length }
            : headers,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode,
              contentType: response.headers["content-type"],
              text: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      outgoing.on("error", reject);
      if (body) {
        outgoing.write(body);
      }
      outgoing.end();
    });
  }

  function post(body, key = KEY) {
    return ask("POST", "/otlp/v1/metrics", {
      body: zlib.gzipSync(body),
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "application/x-protobuf",
        "x-oneuptime-token": key,
      },
    });
  }

  function check(...question) {
    const result = childProcess.spawnSync(
      "python3",
      [
        "-I",
        path.join(RIG, "agent-install-check.py"),
        path.join(folder, "requests.jsonl"),
        "0",
        ...question,
      ],
      { encoding: "utf8" },
    );
    return { status: result.status, output: result.stdout.trim() };
  }

  beforeAll(async () => {
    folder = scratch();
    served = scratch();
    fs.mkdirSync(path.join(served, "systemd"));
    fs.writeFileSync(path.join(served, "install.sh"), "#!/bin/bash\n");
    fs.writeFileSync(path.join(served, "systemd", "unit.service"), "[Unit]\n");
    fs.writeFileSync(path.join(served, "not-listed.txt"), "secret\n");
    const listed = path.join(folder, "listed.txt");
    fs.writeFileSync(listed, "install.sh\nsystemd/unit.service\ngone.txt\n");
    // A port of its own: nothing else in this test listens, so a free one is simply asked for.
    const probe = http.createServer();
    await new Promise((resolve) => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    port = probe.address().port;
    await new Promise((resolve) => {
      probe.close(resolve);
    });
    process_ = childProcess.spawn(
      "python3",
      [
        "-I",
        path.join(RIG, "agent-install-oneuptime.py"),
        String(port),
        folder,
        served,
        listed,
      ],
      {
        stdio: "ignore",
        env: { ...process.env, ONEUPTIME_STAND_IN_KEY: KEY },
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await ask("GET", "/otlp/v1/validate");
        return;
      } catch {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
    }
    throw new Error("the stand-in never answered");
  });

  afterAll(() => {
    if (process_) {
      process_.kill();
    }
  });

  test("serves the script at the agent's own address, as plain text", async () => {
    const answer = await ask("GET", "/install/openstack-agent");
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("text/plain; charset=utf-8");
    expect(answer.text).toBe("#!/bin/bash\n");
  });

  test("serves a listed file in a folder", async () => {
    const answer = await ask(
      "GET",
      "/install/openstack-agent/systemd/unit.service",
    );
    expect(answer.status).toBe(200);
    expect(answer.text).toBe("[Unit]\n");
  });

  test("a file the real one does not list is a 404, as it would be there", async () => {
    const answer = await ask("GET", "/install/openstack-agent/not-listed.txt");
    expect(answer.status).toBe(404);
    expect(answer.text).not.toContain("secret");
  });

  test("a path out of the folder is no file of the agent's", async () => {
    const answer = await ask(
      "GET",
      "/install/openstack-agent/../../../../etc/passwd",
    );
    expect(answer.status).toBe(404);
  });

  test("a listed file it cannot read is a 500, which stops an install, and not a 404, which sends it to GitHub", async () => {
    const answer = await ask("GET", "/install/openstack-agent/gone.txt");
    expect(answer.status).toBe(500);
  });

  test("anything else is the 404 an older OneUptime answers", async () => {
    expect((await ask("GET", "/somewhere")).status).toBe(404);
  });

  test("says whether a key is good, for troubleshoot.sh", async () => {
    const good = await ask("GET", "/otlp/v1/validate", {
      headers: { "x-oneuptime-token": KEY },
    });
    expect(good.status).toBe(200);
    expect(JSON.parse(good.text)).toMatchObject({
      valid: true,
      keyType: "Server",
    });
    const bad = await ask("GET", "/otlp/v1/validate", {
      headers: { "x-oneuptime-token": "not-it" },
    });
    expect(bad.status).toBe(401);
    expect(JSON.parse(bad.text).valid).toBe(false);
    const none = await ask("GET", "/otlp/v1/validate");
    expect(none.status).toBe(401);
    expect(JSON.parse(none.text).tokenProvided).toBe(false);
  });

  describe("what arrives", () => {
    beforeAll(async () => {
      const good = {
        "openstack.cloud.name": "Lab Cloud #1 $west",
        "oneuptime.agent.version": "0.161.1",
      };
      await post(
        request(good, [
          metric("openstack_nova_up", [point(1, "RegionOne"), point(0, "RegionOne")]),
          metric("openstack_cinder_up", [point(1, "RegionOne")], 7),
          // Nobody's region: the collector's own series, which the rig does not hold to one.
          metric("up", [point(1, null)]),
        ]),
      );
    });

    test("a metric's series are found by their name, in a gauge and in a sum", () => {
      expect(check("reports", "openstack_nova_").status).toBe(0);
      expect(check("reports", "openstack_cinder_").status).toBe(0);
      expect(check("reports", "openstack_glance_").status).toBe(1);
    });

    test("a metric's last value is read off the protobuf", () => {
      expect(check("last", "openstack_nova_up")).toEqual({
        status: 0,
        output: "0.0",
      });
      expect(check("last", "openstack_glance_up").status).toBe(1);
    });

    test("a batch with the right identity passes", () => {
      expect(
        check("identity", "Lab Cloud #1 $west", "0.161.1", "RegionOne").status,
      ).toBe(0);
    });

    test("the wrong cloud, version or region is named", () => {
      expect(check("identity", "Lab Cloud", "0.161.1", "RegionOne").output).toContain(
        "openstack.cloud.name is",
      );
      expect(
        check("identity", "Lab Cloud #1 $west", "0.160.0", "RegionOne").output,
      ).toContain("oneuptime.agent.version is");
      expect(
        check("identity", "Lab Cloud #1 $west", "0.161.1", "RegionTwo").output,
      ).toContain("says regions");
    });

    test("nothing has been refused yet", () => {
      expect(check("refused").status).toBe(1);
    });

    test("what is kept is the body itself, unzipped, to put through the real ingest", () => {
      const lines = read(path.join(folder, "requests.jsonl"))
        .trim()
        .split("\n")
        .map((line) => {
          return JSON.parse(line);
        });
      const first = lines.find((line) => {
        return line.body;
      });
      expect(first.encoding).toBe("gzip");
      const body = fs.readFileSync(path.join(folder, "bodies", first.body));
      expect(body.includes(Buffer.from("openstack_nova_up"))).toBe(true);
    });

    test("no key is ever written down", () => {
      expect(read(path.join(folder, "requests.jsonl"))).not.toContain(KEY);
    });

    test("a batch with service.name would be caught, and a bad key refused", async () => {
      const answer = await post(
        request({ "service.name": "phantom" }, [
          metric("openstack_nova_up", [point(1, "RegionOne")]),
        ]),
        "not-the-key",
      );
      expect(answer.status).toBe(401);
      expect(check("refused").status).toBe(0);
      await post(
        request(
          {
            "openstack.cloud.name": "Lab Cloud #1 $west",
            "oneuptime.agent.version": "0.161.1",
            "service.name": "phantom",
          },
          [metric("openstack_nova_up", [point(1, "RegionOne")])],
        ),
      );
      expect(
        check("identity", "Lab Cloud #1 $west", "0.161.1", "RegionOne").output,
      ).toContain("it carries service.name");
    });

    test("says how much arrived, service by service", () => {
      const { output } = check("summary");
      expect(output).toContain("compute:");
      expect(output).toContain("volume:");
    });
  });
});

describe("the workflow", () => {
  const workflow = yaml.load(read(WORKFLOW));
  const job = workflow.jobs["agent-install"];

  test("runs it on its own, on one DevStack, by a word on the command line", () => {
    const on = workflow.on || workflow[true];
    expect(on.workflow_dispatch.inputs.agent_install_only.type).toBe("boolean");
    expect(job.if).toContain("inputs.agent_install_only");
    expect(job.strategy).toBeUndefined();
    expect(workflow.jobs.record.if).toContain("!inputs.agent_install_only");
    expect(workflow.jobs["record-control-plane"].if).toContain(
      "!inputs.agent_install_only",
    );
  });

  test("a run that only installs the agent does not cancel a full one", () => {
    expect(workflow.concurrency.group).toContain("github.run_id");
  });

  test("keeps what it did even when it fails, under a name of its own", () => {
    const upload = job.steps.find((step) => {
      return step.name === "Upload what it did";
    });
    expect(upload.if).toBe("always()");
    // openstack-recording-* is what import-recording.py takes for a cloud's recording.
    expect(upload.with.name).toBe("openstack-agent-install");
  });

  test("builds the estate first, so a cloud with something in it is what reports", () => {
    const names = job.steps.map((step) => {
      return step.run || "";
    });
    const estate = names.findIndex((run) => {
      return run.includes("estate.sh");
    });
    const install = names.findIndex((run) => {
      return run.includes("agent-install.sh");
    });
    expect(estate).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(estate);
  });

  test("gives it longer than the sum of what it waits for", () => {
    expect(job["timeout-minutes"]).toBeGreaterThanOrEqual(150);
  });
});

describe("the rig", () => {
  const script = read(path.join(RIG, "agent-install.sh"));

  test("parses", () => {
    childProcess.execFileSync("bash", ["-n", path.join(RIG, "agent-install.sh")]);
  });

  test("names every phase it says it runs, and a function for each", () => {
    const phases = script.match(/^PHASES="\$\{AGENT_INSTALL_PHASES:-(.*)\}"$/m)[1];
    for (const phase of phases.split(" ")) {
      const name = phase.replace(/-/g, "_");
      expect(script).toContain(`phase_${name}() {`);
      expect(script).toContain(`wants ${phase} && phase_${name}`);
    }
  });

  test("never turns a command's echo on, which would print every secret", () => {
    expect(script).not.toMatch(/^\s*set -[a-z]*x/m);
  });

  test("names a secret it looks for only by what it is, in what it keeps as in what it prints", () => {
    // says and never_says print what they look for, and the job's log and results.txt are kept.
    for (const secret of [
      "INGESTION_KEY",
      "BAD_INGESTION_KEY",
      "APP_SECRET",
      "ACCOUNT_PASSWORD",
      "HOSTILE_SECRET",
    ]) {
      expect(script).not.toMatch(
        new RegExp(`(never_)?says "[^"]*"[^\\n]*"\\$${secret}"`),
      );
    }
    expect(script).toContain("holds_no_secret() {");
  });

  test("the stand-in's own command line holds no key, because the rig looks at every one", () => {
    expect(script).toMatch(
      /ONEUPTIME_STAND_IN_KEY="\$INGESTION_KEY" python3 -I "\$HERE\/agent-install-oneuptime\.py"/,
    );
  });

  test("exercises the uid the exporter's image really runs as", () => {
    expect(script).toContain(
      'check_equal "the exporter\'s process runs as 65532, on this machine\'s own process table"',
    );
    // start-agent.sh's chmod a+r is why nothing else in the rig does.
    expect(script).not.toContain("chmod a+r");
  });

  test("keeps no container's environment, which holds the ingestion key", () => {
    expect(script).not.toMatch(/docker inspect "\$name" >/);
  });
});
