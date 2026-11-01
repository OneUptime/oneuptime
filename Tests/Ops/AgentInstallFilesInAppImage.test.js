"use strict";

/**
 * The App image carries every file it serves at /install/<agent>.
 *
 * packages/App/FeatureSet/Install serves the agents' install scripts, and
 * the files they download, from /usr/src/<folder> in the image: each
 * entry's sourceDirectory of packages/Common/Types/InstallScripts, which the
 * App's Dockerfile copies from the repository. A folder the Dockerfile
 * forgets, or a file .dockerignore keeps out of the build context (all of
 * HelmChart/ is, but for the Kubernetes agent's diagnostic script), would be
 * a 500 on every install, so this holds the Dockerfile, .dockerignore and
 * the development compose file to the list, and builds the copies for real
 * with BuildKit where Docker is available (CI's Ops job has it).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const {
  ancestry,
  instructions,
  parseStages,
  render,
} = require("./Utils/DockerfileTemplate");
const {
  REPO_ROOT,
  loadInstallScriptsCatalog,
} = require("./Utils/InstallScriptsCatalog");

const { INSTALL_SCRIPTS } = loadInstallScriptsCatalog();

const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "packages", "App", "Dockerfile.tpl"),
  "utf8",
);
const STAGES = parseStages(render(TEMPLATE, "production"));
const BUILD_STAGE = STAGES.find((stage) => {
  return stage.name === "community-build";
});

// Where the App reads them (packages/App/FeatureSet/Install/Config.ts).
const IMAGE_ROOT = "/usr/src";

const COPY = /^COPY\s+((?:--\S+\s+)*)(\S+)\s+(\S+)$/;

// The COPY instructions of the build stage that take something from agents/ or HelmChart/.
function agentCopies() {
  return instructions(BUILD_STAGE.body)
    .map((line) => {
      const match = COPY.exec(line);
      return match
        ? { line, flags: match[1].trim(), source: match[2], target: match[3] }
        : null;
    })
    .filter((copy) => {
      return copy && /^\.\/(?:agents|HelmChart)\//.test(copy.source);
    });
}

// Whether the Dockerfile copies a repository path to the same path under /usr/src.
function copiedToImage(relativePath) {
  return agentCopies().some((copy) => {
    const source = copy.source.replace(/^\.\//, "");

    return (
      (relativePath === source || relativePath.startsWith(`${source}/`)) &&
      copy.target === `${IMAGE_ROOT}/${source}`
    );
  });
}

describe("the App's Dockerfile", () => {
  test("the build stage both editions are made from exists", () => {
    expect(BUILD_STAGE).toBeDefined();

    for (const target of ["community", "enterprise"]) {
      expect(
        ancestry(STAGES, target).map((stage) => {
          return stage.name;
        }),
      ).toContain("community-build");
    }
  });

  test.each(
    INSTALL_SCRIPTS.flatMap((entry) => {
      return entry.files.map((file) => {
        return [`${entry.sourceDirectory}/${file}`];
      });
    }),
  )("copies %s to the same path under /usr/src", (relativePath) => {
    expect(copiedToImage(relativePath)).toBe(true);
  });

  test("copies them owned by root: the node user the App runs as can read them, never change them", () => {
    const copies = agentCopies();

    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect({ line: copy.line, flags: copy.flags }).toEqual({
        line: copy.line,
        flags: "",
      });
    }
  });

  test("copies each served folder, and no agent's folder it does not serve", () => {
    const served = INSTALL_SCRIPTS.map((entry) => {
      return entry.sourceDirectory;
    });

    for (const copy of agentCopies()) {
      const source = copy.source.replace(/^\.\//, "");
      const ofAnEntry = served.some((folder) => {
        return source === folder || source.startsWith(`${folder}/`);
      });

      expect({ source, ofAnEntry }).toEqual({ source, ofAnEntry: true });
    }
  });

  test("the App reads them where the Dockerfile puts them", () => {
    const config = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages",
        "App",
        "FeatureSet",
        "Install",
        "Config.ts",
      ),
      "utf8",
    );

    expect(config).toContain(
      `export const InstallFilesRoot: string = "${IMAGE_ROOT}";`,
    );
  });
});

describe(".dockerignore", () => {
  const ignore = fs
    .readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => {
      return line.trim();
    });

  test("keeps HelmChart/ out of the context, but for the Kubernetes agent's diagnostic script", () => {
    const helmChart = ignore.indexOf("HelmChart");
    const exception = ignore.indexOf(
      "!HelmChart/Public/kubernetes-agent/troubleshoot.sh",
    );

    expect(helmChart).toBeGreaterThan(-1);
    // An exception only counts after the pattern it excepts from.
    expect(exception).toBeGreaterThan(helmChart);
  });

  test("leaves agents/ in the context", () => {
    for (const line of ignore) {
      expect(line === "agents" || line.startsWith("agents/")).toBe(false);
    }
  });
});

describe("the development compose file", () => {
  const compose = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, "Scripts", "Dev", "docker-compose.dev.yml"),
      "utf8",
    ),
  );
  const volumes = compose.services.app.volumes;

  test("mounts the agents' folders where the image has them, read-only", () => {
    expect(volumes).toContain("./agents:/usr/src/agents:ro");
    expect(volumes).toContain(
      "./HelmChart/Public/kubernetes-agent/troubleshoot.sh:/usr/src/HelmChart/Public/kubernetes-agent/troubleshoot.sh:ro",
    );
  });

  test("so every served file is there in development too", () => {
    for (const entry of INSTALL_SCRIPTS) {
      const mounted = volumes.some((volume) => {
        const [source, target] = volume.split(":");
        const folder = source.replace(/^\.\//, "");

        return (
          (entry.sourceDirectory === folder ||
            entry.sourceDirectory.startsWith(`${folder}/`) ||
            folder.startsWith(`${entry.sourceDirectory}/`)) &&
          target === `${IMAGE_ROOT}/${folder}`
        );
      });

      expect({ entry: entry.name, mounted }).toEqual({
        entry: entry.name,
        mounted: true,
      });
    }
  });
});

/*
 * The copies built for real: the Dockerfile's own COPY lines on an empty
 * image, with the repository as the context and its .dockerignore, as the
 * release builds the App. BuildKit sends only what they copy.
 */
function hasBuildx() {
  const probe = spawnSync("docker", ["buildx", "version"], {
    encoding: "utf8",
  });
  const daemon = spawnSync(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      encoding: "utf8",
    },
  );

  return probe.status === 0 && daemon.status === 0;
}

const describeWithDocker = hasBuildx() ? describe : describe.skip;

describeWithDocker("the copies, built with BuildKit", () => {
  let output = "";
  let work = "";
  let build = null;

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "app-image-agents-"));
    output = path.join(work, "image");

    const dockerfile = path.join(work, "Dockerfile");
    fs.writeFileSync(
      dockerfile,
      [
        "FROM scratch",
        ...agentCopies().map((copy) => {
          return copy.line;
        }),
        "",
      ].join("\n"),
    );

    build = spawnSync(
      "docker",
      [
        "buildx",
        "build",
        "--no-cache",
        "--file",
        dockerfile,
        "--output",
        `type=local,dest=${output}`,
        REPO_ROOT,
      ],
      { encoding: "utf8", timeout: 300000 },
    );
  }, 320000);

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  test("builds", () => {
    expect({
      status: build.status,
      stderr: build.status === 0 ? "" : build.stderr,
    }).toEqual({
      status: 0,
      stderr: "",
    });
  });

  test.each(
    INSTALL_SCRIPTS.flatMap((entry) => {
      return entry.files.map((file) => {
        return [`${entry.sourceDirectory}/${file}`];
      });
    }),
  )("the image holds %s, as the repository has it", (relativePath) => {
    const inImage = path.join(output, IMAGE_ROOT, relativePath);

    expect(fs.existsSync(inImage)).toBe(true);
    expect(
      fs
        .readFileSync(inImage)
        .equals(fs.readFileSync(path.join(REPO_ROOT, relativePath))),
    ).toBe(true);
  });

  test("nothing else of HelmChart/ comes along", () => {
    const helmChart = path.join(output, IMAGE_ROOT, "HelmChart");
    const files = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          files.push(path.relative(helmChart, full).split(path.sep).join("/"));
        }
      }
    };

    walk(helmChart);
    expect(files).toEqual(["Public/kubernetes-agent/troubleshoot.sh"]);
  });
});
