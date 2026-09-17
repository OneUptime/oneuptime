import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/*
 * Regression tests for "the quick start does not work on a fresh clone".
 *
 * `.gitignore` carries a repo-wide `**\/Dockerfile` rule. That rule is correct
 * for service images: `configure.sh` renders every `Dockerfile.tpl` through
 * gomplate at install time, so the rendered `Dockerfile` really is build
 * output and really should not be committed.
 *
 * It is wrong for `Examples/`, where the Dockerfiles are hand-written source.
 * `Examples/snmp-simulator/Dockerfile` was swallowed by it: `docker compose up
 * --build` -- the command that example's README tells you to run -- worked only
 * on machines that happened to still have the file lying around untracked from
 * whoever wrote it. On a fresh clone, or in a git worktree, the file is simply
 * absent and the build dies with "failed to read dockerfile".
 *
 * The class of bug is what these tests pin down, not just the one instance:
 * a compose file that builds an image nobody can build, because the Dockerfile
 * it names is neither committed nor generated from something that is.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Where hand-written (as opposed to gomplate-rendered) Dockerfiles live.
const EXAMPLES_DIR: string = "Examples";

const SNMP_SIMULATOR_DIR: string = path.join(EXAMPLES_DIR, "snmp-simulator");
const SNMP_SIMULATOR_DOCKERFILE: string = path.join(
  SNMP_SIMULATOR_DIR,
  "Dockerfile",
);

/*
 * Run a git command against the checkout under test. A failure here is a real
 * test failure and not something to swallow: the whole point of this file is to
 * assert on what git tracks and ignores, so a suite that cannot ask git has
 * nothing left to check and must not pass quietly.
 */
const git: (args: Array<string>) => string = (args: Array<string>): string => {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    throw new Error(
      `Could not run \`git ${args.join(" ")}\` in ${REPO_ROOT}. These are ` +
        `repository-hygiene tests; they need a real git checkout to run ` +
        `against. Underlying error: ${String(err)}`,
    );
  }
};

// Every path git tracks, as repo-relative POSIX paths.
const trackedFiles: Set<string> = new Set(
  git(["ls-files"])
    .split("\n")
    .filter((line: string): boolean => {
      return line.length > 0;
    }),
);

const isTracked: (relativePath: string) => boolean = (
  relativePath: string,
): boolean => {
  return trackedFiles.has(relativePath.split(path.sep).join("/"));
};

/*
 * `git check-ignore` exits 0 when a path is ignored and 1 when it is not --
 * including when it is not ignored because a later negation rescued it, which
 * is exactly the case we care about. Any other exit status is a genuine
 * failure and is re-thrown by `git()` above.
 */
const isIgnored: (relativePath: string) => boolean = (
  relativePath: string,
): boolean => {
  const posixPath: string = relativePath.split(path.sep).join("/");

  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", posixPath], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return true;
  } catch (err: unknown) {
    const status: unknown = (err as { status?: unknown }).status;
    if (status === 1) {
      return false;
    }
    throw new Error(
      `\`git check-ignore\` failed unexpectedly for ${posixPath} ` +
        `(exit ${String(status)}).`,
    );
  }
};

const readRepoFile: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

interface ImageBuild {
  // The compose file that asks for this build, repo-relative.
  composeFile: string;
  service: string;
  // The Dockerfile the build resolves to, repo-relative.
  dockerfile: string;
}

const SERVICES_KEY: RegExp = /^services:\s*$/;
const TOP_LEVEL_KEY: RegExp = /^\S/;
const SERVICE_NAME: RegExp = /^ {2}([A-Za-z0-9._-]+):\s*$/;
const BUILD_SHORT_FORM: RegExp = /^ {4}build:[ \t]+(\S+)\s*$/;
const BUILD_BLOCK_FORM: RegExp = /^ {4}build:\s*$/;
const BUILD_BLOCK_ENTRY: RegExp = /^ {6}([A-Za-z0-9_-]+):[ \t]+(\S+)\s*$/;
const BUILD_BLOCK_END: RegExp = /^ {0,5}\S/;

/*
 * Pull the build directives out of a compose file.
 *
 * Deliberately a small line scanner rather than a YAML parse: Common's jest
 * config maps the `yaml` module to a stub, so a real parser is not available
 * inside this suite. The compose files in this repo are plain two-space YAML
 * with no anchors or flow mappings on the build stanzas, which is all this
 * needs to handle -- and `parsesTheComposeFilesItClaimsTo` below fails loudly
 * if that ever stops being true, so the scanner cannot silently go blind.
 */
const parseImageBuilds: (composeFile: string) => Array<ImageBuild> = (
  composeFile: string,
): Array<ImageBuild> => {
  const builds: Array<ImageBuild> = [];
  const composeDir: string = path.dirname(composeFile);
  const lines: Array<string> = readRepoFile(composeFile).split("\n");

  let inServices: boolean = false;
  let service: string | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (SERVICES_KEY.test(line)) {
      inServices = true;
      continue;
    }

    if (!inServices) {
      continue;
    }

    // A new top-level key ends the services block.
    if (TOP_LEVEL_KEY.test(line)) {
      inServices = false;
      service = null;
      continue;
    }

    const serviceMatch: RegExpMatchArray | null = line.match(SERVICE_NAME);
    if (serviceMatch) {
      service = serviceMatch[1] as string;
      continue;
    }

    if (service === null) {
      continue;
    }

    /*
     * Short form -- `build: <context>`. The Dockerfile is `Dockerfile` inside
     * the context directory.
     */
    const shortMatch: RegExpMatchArray | null = line.match(BUILD_SHORT_FORM);
    if (shortMatch) {
      const context: string = shortMatch[1] as string;
      builds.push({
        composeFile: composeFile,
        service: service,
        dockerfile: path.normalize(
          path.join(composeDir, context, "Dockerfile"),
        ),
      });
      continue;
    }

    if (!BUILD_BLOCK_FORM.test(line)) {
      continue;
    }

    /*
     * Long form. `dockerfile:` is resolved relative to `context:`, per compose,
     * and both default the way compose defaults them.
     */
    let context: string = ".";
    let dockerfile: string = "Dockerfile";

    for (let inner: number = index + 1; inner < lines.length; inner++) {
      const innerLine: string = lines[inner] as string;

      if (innerLine.trim() === "") {
        continue;
      }

      if (BUILD_BLOCK_END.test(innerLine)) {
        break;
      }

      const entry: RegExpMatchArray | null = innerLine.match(BUILD_BLOCK_ENTRY);
      if (!entry) {
        continue;
      }

      if (entry[1] === "context") {
        context = entry[2] as string;
      }

      if (entry[1] === "dockerfile") {
        dockerfile = entry[2] as string;
      }
    }

    builds.push({
      composeFile: composeFile,
      service: service,
      dockerfile: path.normalize(path.join(composeDir, context, dockerfile)),
    });
  }

  return builds;
};

const COMPOSE_FILE_NAME: RegExp = /^docker-compose[A-Za-z0-9._-]*\.ya?ml$/;

// Every tracked compose file in the repo.
const composeFiles: Array<string> = Array.from(trackedFiles)
  .filter((file: string): boolean => {
    return (
      COMPOSE_FILE_NAME.test(path.basename(file)) &&
      !file.startsWith("node_modules/")
    );
  })
  .sort();

const imageBuilds: Array<ImageBuild> = composeFiles.flatMap(
  (composeFile: string): Array<ImageBuild> => {
    return parseImageBuilds(composeFile);
  },
);

/*
 * A Dockerfile is reachable on a fresh clone if it is committed, or if
 * `configure.sh` renders it from a committed `Dockerfile.tpl` before anything
 * builds it. Anything else exists only on the machine that authored it.
 */
const templateFor: (dockerfile: string) => string = (
  dockerfile: string,
): string => {
  return `${dockerfile}.tpl`;
};

const isAvailableOnAFreshClone: (dockerfile: string) => boolean = (
  dockerfile: string,
): boolean => {
  return isTracked(dockerfile) || isTracked(templateFor(dockerfile));
};

describe("Every Dockerfile a compose file builds survives a fresh clone", () => {
  test("parses the compose files it claims to", () => {
    /*
     * Guards the scanner above. If it ever stops recognising the compose
     * syntax in this repo it would find nothing, and `test.each` over an empty
     * list is silently green -- the suite would keep passing while checking
     * nothing at all.
     */
    expect(composeFiles).toContain("docker-compose.dev.yml");
    expect(composeFiles).toContain(
      path
        .join(SNMP_SIMULATOR_DIR, "docker-compose.yml")
        .split(path.sep)
        .join("/"),
    );
    expect(imageBuilds.length).toBeGreaterThanOrEqual(8);
  });

  test.each(
    imageBuilds.map((build: ImageBuild): [string, string, string] => {
      return [build.composeFile, build.service, build.dockerfile];
    }),
  )(
    "%s builds %s from a Dockerfile that is in the repo (%s)",
    (_composeFile: string, _service: string, dockerfile: string) => {
      /*
       * Asserted as an object so a failure names the offending Dockerfile and
       * says which of the two ways of being reachable it missed, rather than
       * just reporting `false`.
       */
      expect({
        dockerfile: dockerfile,
        committed: isTracked(dockerfile),
        renderedFromCommittedTemplate: isTracked(templateFor(dockerfile)),
        availableOnAFreshClone: isAvailableOnAFreshClone(dockerfile),
      }).toMatchObject({
        dockerfile: dockerfile,
        availableOnAFreshClone: true,
      });
    },
  );

  test("the snmp-simulator quick start builds all three of its containers", () => {
    const builds: Array<ImageBuild> = imageBuilds.filter(
      (build: ImageBuild): boolean => {
        return build.composeFile.startsWith(`${EXAMPLES_DIR}/snmp-simulator/`);
      },
    );

    expect(
      builds.map((build: ImageBuild): string => {
        return build.service;
      }),
    ).toEqual(["switch-a", "switch-b", "router-v3"]);

    // The two snmpsim switches share the hand-written Dockerfile.
    expect(
      builds
        .filter((build: ImageBuild): boolean => {
          return build.service !== "router-v3";
        })
        .map((build: ImageBuild): string => {
          return build.dockerfile;
        }),
    ).toEqual([SNMP_SIMULATOR_DOCKERFILE, SNMP_SIMULATOR_DOCKERFILE]);

    // The v3 router uses the separate net-snmp one.
    expect(
      builds.find((build: ImageBuild): boolean => {
        return build.service === "router-v3";
      })?.dockerfile,
    ).toBe(path.join(SNMP_SIMULATOR_DIR, "Dockerfile.snmpd"));
  });

  test("the file that started this is committed, not just present locally", () => {
    /*
     * `fs.existsSync` would have passed on the machine this bug was written on.
     * Tracking is the thing that was broken, so tracking is the thing asserted.
     */
    expect(isTracked(SNMP_SIMULATOR_DOCKERFILE)).toBe(true);
  });
});

describe("The .gitignore Dockerfile rules stay pointed at the right files", () => {
  test("hand-written example Dockerfiles are not ignored", () => {
    const exampleDockerfiles: Array<string> = Array.from(trackedFiles).filter(
      (file: string): boolean => {
        return (
          file.startsWith(`${EXAMPLES_DIR}/`) &&
          path.basename(file) === "Dockerfile"
        );
      },
    );

    // At minimum the two that exist today; both must be committed and visible.
    expect(exampleDockerfiles).toEqual(
      expect.arrayContaining([
        SNMP_SIMULATOR_DOCKERFILE.split(path.sep).join("/"),
        `${EXAMPLES_DIR}/otel-dotnet/Dockerfile`,
      ]),
    );

    for (const dockerfile of exampleDockerfiles) {
      expect({
        dockerfile: dockerfile,
        ignored: isIgnored(dockerfile),
      }).toEqual({
        dockerfile: dockerfile,
        ignored: false,
      });
    }
  });

  test("rendered service Dockerfiles are still ignored", () => {
    /*
     * The negation that rescues `Examples/` must not have widened into the
     * service images. Those are gomplate output; committing one would ship a
     * stale render with whatever values the author's config.env happened to
     * hold.
     */
    const renderedDockerfiles: Array<string> = Array.from(trackedFiles)
      .filter((file: string): boolean => {
        return path.basename(file) === "Dockerfile.tpl";
      })
      .map((template: string): string => {
        return template.replace(/\.tpl$/, "");
      });

    expect(renderedDockerfiles.length).toBeGreaterThanOrEqual(10);
    expect(renderedDockerfiles).toContain("App/Dockerfile");
    expect(renderedDockerfiles).toContain("Probe/Dockerfile");

    for (const dockerfile of renderedDockerfiles) {
      expect({
        dockerfile: dockerfile,
        ignored: isIgnored(dockerfile),
      }).toEqual({
        dockerfile: dockerfile,
        ignored: true,
      });

      // And of course none of them should have been committed.
      expect(isTracked(dockerfile)).toBe(false);
    }
  });

  test("nothing under Examples/ is generated from a template", () => {
    /*
     * `!Examples/**\/Dockerfile` is a blanket negation, which is safe only
     * while everything under `Examples/` is hand-written. The moment somebody
     * adds an `Examples/**\/Dockerfile.tpl`, its render would start being
     * tracked and the negation needs narrowing to the specific examples that
     * are really source.
     */
    const templatesUnderExamples: Array<string> = Array.from(
      trackedFiles,
    ).filter((file: string): boolean => {
      return (
        file.startsWith(`${EXAMPLES_DIR}/`) &&
        path.basename(file) === "Dockerfile.tpl"
      );
    });

    expect(templatesUnderExamples).toEqual([]);
  });

  test("configure.sh is what renders the ignored Dockerfiles", () => {
    /*
     * Ties the reasoning above to the code that makes it true. If the render
     * step moves or stops running over every template, the "ignored because
     * generated" justification stops holding and this file's premise is stale.
     */
    const configureScript: string = readRepoFile("configure.sh");

    expect(configureScript).toContain('-name "Dockerfile.tpl"');
    expect(configureScript).toContain("gomplate");
    expect(configureScript).toContain('"${dockerfile_template%.tpl}"');
  });
});

describe("The snmpsim image serves what its compose file and README promise", () => {
  const dockerfile: string = readRepoFile(SNMP_SIMULATOR_DOCKERFILE);
  const compose: string = readRepoFile(
    path.join(SNMP_SIMULATOR_DIR, "docker-compose.yml"),
  );
  const readme: string = readRepoFile(
    path.join(SNMP_SIMULATOR_DIR, "README.md"),
  );

  test("installs the SNMP agent it runs", () => {
    // The responder binary in CMD comes from this package.
    expect(dockerfile).toContain("snmpsim-lextudio");
  });

  test("installs the net-snmp tools the README tells you to use", () => {
    /*
     * The README's sanity check runs `snmpwalk` inside this image, and its trap
     * instructions run `snmptrap` inside it via `docker compose exec`. Both
     * come from net-snmp-tools; drop the package and the documented commands
     * fail with "executable file not found".
     */
    expect(dockerfile).toContain("net-snmp-tools");
    expect(readme).toContain("snmpwalk -v2c -c public 172.30.99.11");
    expect(readme).toContain("docker compose exec switch-a snmptrap");
  });

  test("creates the unprivileged user that CMD drops to", () => {
    const processUser: RegExpMatchArray | null = dockerfile.match(
      /--process-user=(\S+?)"/,
    );
    const processGroup: RegExpMatchArray | null = dockerfile.match(
      /--process-group=(\S+?)"/,
    );

    expect(processUser?.[1]).toBe("snmpsim");
    expect(processGroup?.[1]).toBe("snmpsim");

    /*
     * snmpsim refuses to start when the user it is told to drop to does not
     * exist, so the `adduser` and the CMD flags have to agree.
     */
    expect(dockerfile).toContain("adduser -D snmpsim");
  });

  test("serves the data directory the compose file mounts", () => {
    const dataDir: RegExpMatchArray | null =
      dockerfile.match(/--data-dir=(\S+?)"/);

    expect(dataDir?.[1]).toBe("/data");

    // Both switches mount their recordings read-only onto exactly that path.
    expect(compose).toContain("./data/switch-a:/data:ro");
    expect(compose).toContain("./data/switch-b:/data:ro");
  });

  test("listens on the SNMP port the probe polls", () => {
    expect(dockerfile).toContain("--agent-udpv4-endpoint=0.0.0.0:161");
    expect(dockerfile).toContain("EXPOSE 161/udp");

    /*
     * No ports are published: the README explains the probe runs with
     * network_mode: host and reaches the bridge IPs directly. If that ever
     * changes, the port mapping and the README paragraph have to change
     * together.
     */
    expect(compose).not.toContain("ports:");
    expect(readme).toContain("network_mode: host");
  });

  test("writes its cache somewhere writable for a read-only data mount", () => {
    /*
     * `/data` is mounted `:ro`. snmpsim indexes each recording on first use, so
     * the cache has to live off the mount or the container dies at boot.
     */
    expect(dockerfile).toContain("--cache-dir=/tmp/snmpsim-cache");
  });

  test("pins a base image rather than floating on latest", () => {
    const from: RegExpMatchArray | null = dockerfile.match(/^FROM\s+(\S+)/m);

    expect(from?.[1]).toBe("python:3.11-alpine");
  });
});

describe("The snmp-simulator quick start has every file it reads", () => {
  const compose: string = readRepoFile(
    path.join(SNMP_SIMULATOR_DIR, "docker-compose.yml"),
  );

  test("the README's quick start points at this directory's compose file", () => {
    const readme: string = readRepoFile(
      path.join(SNMP_SIMULATOR_DIR, "README.md"),
    );

    expect(readme).toContain("cd Examples/snmp-simulator");
    expect(readme).toContain("docker compose up -d --build");
    expect(isTracked(path.join(SNMP_SIMULATOR_DIR, "docker-compose.yml"))).toBe(
      true,
    );
  });

  test.each([
    "data/switch-a/public.snmprec",
    "data/switch-b/public.snmprec",
    "snmpd.conf",
    "Dockerfile",
    "Dockerfile.snmpd",
    "docker-compose.yml",
    "README.md",
  ])("%s is committed", (relativePath: string) => {
    expect(isTracked(path.join(SNMP_SIMULATOR_DIR, relativePath))).toBe(true);
  });

  test("Dockerfile.snmpd copies a config that is committed next to it", () => {
    const snmpdDockerfile: string = readRepoFile(
      path.join(SNMP_SIMULATOR_DIR, "Dockerfile.snmpd"),
    );

    expect(snmpdDockerfile).toContain("COPY snmpd.conf");
    expect(isTracked(path.join(SNMP_SIMULATOR_DIR, "snmpd.conf"))).toBe(true);
  });

  test("every recording the compose file mounts exists", () => {
    const mounts: Array<string> = Array.from(
      compose.matchAll(/- \.\/(data\/[A-Za-z0-9._-]+):\/data:ro/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(mounts.length).toBeGreaterThan(0);

    for (const mount of mounts) {
      const dataDir: string = path.join(REPO_ROOT, SNMP_SIMULATOR_DIR, mount);

      expect(fs.existsSync(dataDir)).toBe(true);

      /*
       * snmpsim picks the recording by community string, so the file name is
       * load-bearing: the compose file and README both use `public`.
       */
      expect(fs.readdirSync(dataDir)).toContain("public.snmprec");
    }
  });
});
