"use strict";

/**
 * HelmChart/AirGap/install.sh, the script every OneUptime serves at
 * /install/air-gapped: it carries a release into a network with no route to
 * the internet.
 *
 *   save   on a connected machine: every image the release's chart runs, and
 *          the signed chart, into one folder with SHA256SUMS;
 *   push   inside the gap: checks those checksums, then loads every image
 *          into the reader's registry under the same name and tag, and
 *          prints the values that point the chart at it.
 *
 * The docs (installation/air-gapped) and oneuptime.com/enterprise/air-gapped
 * tell people to run it, so these run it end to end, with stand-ins for
 * helm, crane, skopeo and docker on PATH that log what they were asked and
 * write what the real ones would. Nothing here reaches a registry. The
 * names it pushes are the names global.imageRegistry builds (the chart's
 * global-image-registry_test.yaml), so a mirror this script fills is one the
 * chart reads.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "HelmChart", "AirGap", "install.sh");

// What the stand-in `helm template` renders: every form the chart writes an image in.
const RENDERED = [
  "---",
  "# Source: oneuptime/templates/app.yaml",
  "        - image: docker.io/oneuptime/app:TAG",
  "---",
  "# Source: oneuptime/templates/postgresql-statefulset.yaml",
  '        image: "postgres:15"',
  "---",
  "# Source: oneuptime/templates/valkey-statefulset.yaml",
  "        image: 'valkey/valkey:9.1-alpine'",
  "---",
  "# Source: oneuptime/templates/probe.yaml",
  "        - image: docker.io/oneuptime/probe:TAG",
  "---",
  "# Source: oneuptime/templates/worker.yaml",
  "        - image: docker.io/oneuptime/app:TAG",
  "---",
  "# Source: oneuptime/templates/postgresql-cnpg-cluster.yaml",
  '  imageName: "ghcr.io/cloudnative-pg/postgresql:17"',
].join("\n");

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-gap-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

/*
 * A folder with stand-ins for the tools asked for, each appending one line
 * per call to calls.log: its name and its arguments.
 */
function setUp(tools) {
  const dir = scratch();
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "calls.log");
  fs.mkdirSync(bin);
  fs.writeFileSync(log, "");

  const record = `printf '%s' "$(basename "$0")" >> "${log}"; for arg in "$@"; do printf ' %s' "$arg" >> "${log}"; done; printf '\\n' >> "${log}"`;

  writeExecutable(
    path.join(bin, "helm"),
    `${record}
case "$1" in
  pull)
    destination=""; version=""; prov=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --destination) destination="$2"; shift 2 ;;
        --version) version="$2"; shift 2 ;;
        --prov) prov=1; shift ;;
        *) shift ;;
      esac
    done
    printf 'chart' > "$destination/oneuptime-$version.tgz"
    if [ -n "$prov" ]; then printf 'signature' > "$destination/oneuptime-$version.tgz.prov"; fi
    ;;
  template)
    tag=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --set) case "$2" in image.tag=*) tag="\${2#image.tag=}" ;; esac; shift 2 ;;
        *) shift ;;
      esac
    done
    cat <<'RENDER' | sed "s/TAG/$tag/g"
${RENDERED}
RENDER
    ;;
esac`,
  );

  if (tools.includes("crane")) {
    writeExecutable(
      path.join(bin, "crane"),
      `${record}
if [ "$1" = "pull" ]; then for last; do :; done; printf 'image %s' "$4" > "$last"; fi`,
    );
  }

  if (tools.includes("skopeo")) {
    writeExecutable(
      path.join(bin, "skopeo"),
      `${record}
for last; do :; done
case "$last" in
  docker-archive:*) file="\${last#docker-archive:}"; printf 'image' > "\${file%%:*}" ;;
esac`,
    );
  }

  if (tools.includes("docker")) {
    writeExecutable(
      path.join(bin, "docker"),
      `${record}
if [ "$1" = "save" ]; then printf 'image %s' "$4" > "$3"; fi`,
    );
  }

  return { dir, log };
}

function run(env, args) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: env.dir,
    encoding: "utf8",
    env: {
      // Only the stand-ins and the system's own tools: never a real crane or docker.
      PATH: `${path.join(env.dir, "bin")}:/usr/bin:/bin`,
      HOME: env.dir,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: fs
      .readFileSync(env.log, "utf8")
      .split("\n")
      .filter((line) => {
        return line !== "";
      }),
  };
}

function callsOf(result, tool) {
  return result.calls.filter((line) => {
    return line.split(" ")[0] === tool;
  });
}

describe("images", () => {
  test("lists every image the release's chart renders, once each, quotes and all", () => {
    const env = setUp([]);
    const result = run(env, ["images", "--version", "14.0.102"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "docker.io/oneuptime/app:14.0.102",
      "docker.io/oneuptime/probe:14.0.102",
      "ghcr.io/cloudnative-pg/postgresql:17",
      "postgres:15",
      "valkey/valkey:9.1-alpine",
    ]);
  });

  test("downloads the release's chart, with its signature, from the Helm repository", () => {
    const env = setUp([]);
    const result = run(env, ["images", "--version", "14.0.102"]);

    expect(callsOf(result, "helm")[0]).toBe(
      "helm pull oneuptime --repo https://helm-chart.oneuptime.com --version 14.0.102 --destination " +
        callsOf(result, "helm")[0].split("--destination ")[1].split(" ")[0] +
        " --prov",
    );
  });

  test("renders the release's tag, the edition and the reader's values", () => {
    const env = setUp([]);
    const values = path.join(env.dir, "values.yaml");
    fs.writeFileSync(values, "pgbouncer:\n  enabled: true\n");

    const result = run(env, [
      "images",
      "--version",
      "14.0.102",
      "--edition",
      "enterprise",
      "--values",
      values,
    ]);
    const template = callsOf(result, "helm").find((line) => {
      return line.startsWith("helm template ");
    });

    expect(result.status).toBe(0);
    expect(template).toContain("--set image.tag=14.0.102");
    expect(template).toContain("--set image.type=enterprise-edition");
    expect(template).toContain(`--values ${values}`);
  });

  test("needs a release: a moving tag is no air-gapped install", () => {
    const env = setUp([]);
    const result = run(env, ["images"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("images needs --version");
    expect(result.calls).toEqual([]);
  });

  test("refuses what is not a release, before anything runs", () => {
    const env = setUp([]);
    const result = run(env, ["images", "--version", "14.0.102;rm -rf /"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not a release");
    expect(result.calls).toEqual([]);
  });
});

describe("save", () => {
  test("writes every image, the chart and its signature, and a checksum for each file", () => {
    const env = setUp(["crane"]);
    const result = run(env, ["save", "--version", "14.0.102"]);
    const bundle = path.join(env.dir, "oneuptime-air-gap-14.0.102");

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(path.join(bundle, "images.txt"), "utf8").trim().split("\n"),
    ).toEqual([
      "images/docker.io_oneuptime_app_14.0.102.tar docker.io/oneuptime/app:14.0.102",
      "images/docker.io_oneuptime_probe_14.0.102.tar docker.io/oneuptime/probe:14.0.102",
      "images/ghcr.io_cloudnative-pg_postgresql_17.tar ghcr.io/cloudnative-pg/postgresql:17",
      "images/postgres_15.tar postgres:15",
      "images/valkey_valkey_9.1-alpine.tar valkey/valkey:9.1-alpine",
    ]);
    for (const file of fs.readdirSync(path.join(bundle, "images"))) {
      expect(fs.statSync(path.join(bundle, "images", file)).size).toBeGreaterThan(0);
    }
    expect(fs.existsSync(path.join(bundle, "chart", "oneuptime-14.0.102.tgz"))).toBe(true);
    expect(fs.existsSync(path.join(bundle, "chart", "oneuptime-14.0.102.tgz.prov"))).toBe(true);
    expect(fs.readFileSync(path.join(bundle, "bundle.env"), "utf8")).toBe(
      "VERSION=14.0.102\nEDITION=community\nPLATFORM=linux/amd64\nCHART=chart/oneuptime-14.0.102.tgz\n",
    );

    const sums = fs
      .readFileSync(path.join(bundle, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        return line.split(/\s+/).pop();
      });
    expect(sums).toEqual(
      expect.arrayContaining([
        "bundle.env",
        "images.txt",
        "chart/oneuptime-14.0.102.tgz",
        "chart/oneuptime-14.0.102.tgz.prov",
        "images/postgres_15.tar",
      ]),
    );
    // Five images, the chart and its signature, images.txt and bundle.env.
    expect(sums).toHaveLength(9);
    expect(sums).not.toContain("SHA256SUMS");
  });

  test("pulls each image for the platform asked for (crane)", () => {
    const env = setUp(["crane"]);
    const result = run(env, ["save", "--version", "14.0.102", "--platform", "linux/arm64"]);

    expect(result.status).toBe(0);
    expect(callsOf(result, "crane")).toContain(
      "crane pull --platform linux/arm64 postgres:15 oneuptime-air-gap-14.0.102/images/postgres_15.tar",
    );
    expect(callsOf(result, "crane")).toHaveLength(5);
  });

  test("pulls and saves each image with docker, for the platform asked for", () => {
    const env = setUp(["docker"]);
    const result = run(env, ["save", "--version", "14.0.102", "--output", "bundle"]);

    expect(result.status).toBe(0);
    expect(callsOf(result, "docker")).toEqual(
      expect.arrayContaining([
        "docker pull --platform linux/amd64 postgres:15",
        "docker save --output bundle/images/postgres_15.tar postgres:15",
      ]),
    );
  });

  test("copies each image with skopeo, naming the OS, the architecture and a variant", () => {
    const env = setUp(["skopeo"]);
    const result = run(env, ["save", "--version", "14.0.102", "--platform", "linux/arm/v7"]);

    expect(result.status).toBe(0);
    expect(callsOf(result, "skopeo")).toContain(
      "skopeo copy --override-os linux --override-arch arm --override-variant v7 docker://postgres:15 docker-archive:oneuptime-air-gap-14.0.102/images/postgres_15.tar:postgres:15",
    );
  });

  test("uses crane before skopeo before docker, and says which", () => {
    const env = setUp(["crane", "skopeo", "docker"]);
    const result = run(env, ["save", "--version", "14.0.102"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Copying images with crane.");
    expect(callsOf(result, "skopeo")).toEqual([]);
    expect(callsOf(result, "docker")).toEqual([]);
  });

  test("stops before writing anything when no tool can copy images", () => {
    const env = setUp([]);
    const result = run(env, ["save", "--version", "14.0.102"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("found none of crane, skopeo or docker");
    expect(fs.existsSync(path.join(env.dir, "oneuptime-air-gap-14.0.102"))).toBe(false);
  });

  test("never writes over a bundle that is already there", () => {
    const env = setUp(["crane"]);
    fs.mkdirSync(path.join(env.dir, "bundle"));
    fs.writeFileSync(path.join(env.dir, "bundle", "keep.txt"), "keep");

    const result = run(env, ["save", "--version", "14.0.102", "--output", "bundle"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists and is not empty");
    expect(callsOf(result, "crane")).toEqual([]);
  });
});

describe("push", () => {
  function saved(tools) {
    const env = setUp(tools);
    const save = run(env, ["save", "--version", "14.0.102", "--output", "bundle"]);
    expect(save.status).toBe(0);
    fs.writeFileSync(env.log, "");
    return env;
  }

  test("pushes every image under the reader's registry, by the name global.imageRegistry reads", () => {
    const env = saved(["crane"]);
    const result = run(env, [
      "push",
      "--bundle",
      "bundle",
      "--registry",
      "registry.example.com/",
    ]);

    expect(result.status).toBe(0);
    expect(callsOf(result, "crane")).toEqual([
      "crane push bundle/images/docker.io_oneuptime_app_14.0.102.tar registry.example.com/oneuptime/app:14.0.102",
      "crane push bundle/images/docker.io_oneuptime_probe_14.0.102.tar registry.example.com/oneuptime/probe:14.0.102",
      "crane push bundle/images/ghcr.io_cloudnative-pg_postgresql_17.tar registry.example.com/cloudnative-pg/postgresql:17",
      "crane push bundle/images/postgres_15.tar registry.example.com/postgres:15",
      "crane push bundle/images/valkey_valkey_9.1-alpine.tar registry.example.com/valkey/valkey:9.1-alpine",
    ]);
  });

  test("prints the values that point the chart at the registry, and the images those values do not move", () => {
    const env = saved(["crane"]);
    const result = run(env, ["push", "--bundle", "bundle", "--registry", "registry.example.com"]);

    expect(result.stdout).toBe(
      'global:\n  imageRegistry: registry.example.com\nimage:\n  tag: "14.0.102"\n',
    );
    const moved = result.stderr.split("name a registry of their own")[1];
    expect(moved).toBeDefined();
    expect(moved).toContain("registry.example.com/cloudnative-pg/postgresql:17");
    // Docker Hub's images are what global.imageRegistry moves: none is listed.
    expect(moved).not.toContain("registry.example.com/postgres:15");
    expect(moved).not.toContain("registry.example.com/oneuptime/app:14.0.102");
  });

  test("names the Enterprise Edition in the values for an enterprise bundle", () => {
    const env = setUp(["crane"]);
    expect(
      run(env, ["save", "--version", "14.0.102", "--edition", "enterprise", "--output", "bundle"]).status,
    ).toBe(0);

    const result = run(env, ["push", "--bundle", "bundle", "--registry", "registry.example.com"]);

    expect(result.stdout).toContain("  type: enterprise-edition\n");
  });

  test("loads, tags and pushes each image with docker", () => {
    const env = saved(["docker"]);
    const result = run(env, ["push", "--bundle", "bundle", "--registry", "registry.example.com"]);

    expect(result.status).toBe(0);
    expect(callsOf(result, "docker")).toEqual(
      expect.arrayContaining([
        "docker load --input bundle/images/postgres_15.tar",
        "docker tag postgres:15 registry.example.com/postgres:15",
        "docker push registry.example.com/postgres:15",
      ]),
    );
  });

  test("lets crane and skopeo reach a registry they do not trust only when asked", () => {
    const crane = saved(["crane"]);
    expect(
      callsOf(run(crane, ["push", "--bundle", "bundle", "--registry", "registry.example.com", "--insecure"]), "crane")[0],
    ).toMatch(/^crane push --insecure /);

    const skopeo = saved(["skopeo"]);
    const pushed = callsOf(
      run(skopeo, ["push", "--bundle", "bundle", "--registry", "registry.example.com", "--insecure"]),
      "skopeo",
    );
    expect(pushed[0]).toMatch(/^skopeo copy --dest-tls-verify=false docker-archive:bundle\/images\//);
  });

  test("pushes nothing when a file no longer matches its checksum", () => {
    const env = saved(["crane"]);
    fs.appendFileSync(path.join(env.dir, "bundle", "images", "postgres_15.tar"), "changed");

    const result = run(env, ["push", "--bundle", "bundle", "--registry", "registry.example.com"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match SHA256SUMS");
    expect(callsOf(result, "crane")).toEqual([]);
  });

  test("refuses a folder save did not write", () => {
    const env = setUp(["crane"]);
    fs.mkdirSync(path.join(env.dir, "bundle"));

    const result = run(env, ["push", "--bundle", "bundle", "--registry", "registry.example.com"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not a folder save wrote");
  });

  test("needs the registry to push to", () => {
    const env = saved(["crane"]);
    const result = run(env, ["push", "--bundle", "bundle"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("push needs --registry");
  });
});
