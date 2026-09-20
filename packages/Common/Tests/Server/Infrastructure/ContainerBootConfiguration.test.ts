import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Regression tests for container boot time.
 *
 * Every production image already runs `npm run compile` (tsc) at BUILD time, so
 * the codebase is fully type-checked before the image is published. The runtime
 * entrypoint then boots through `node --require ts-node/register Index.ts`,
 * which throws that away and re-runs the entire type-check inside every
 * container, on every start, before the HTTP listener binds.
 *
 * That is minutes of boot per pod. It is the amplifier behind the rolling-update
 * capacity hole: a tier cannot be replaced faster than its pods can start, and
 * recovery from a node failure or OOM kill is just as slow.
 *
 * TS_NODE_TRANSPILE_ONLY=1 strips the types without re-checking them. The dev
 * loop already does exactly this via nodemon; only production did not.
 *
 * The end state is what KubernetesCostAgent and KubernetesLogTailer already do:
 * `CMD ["node", "build/dist/Index.js"]`, with no ts-node in the image at all.
 * These tests encode the rule that gets us there safely: if you boot through
 * ts-node, you must not re-type-check at boot.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");

/*
 * Service directories sit one level below the repository root, below
 * packages/, or below agents/. Every discovery pass below scans all three.
 */
const SERVICE_PARENT_DIRECTORIES: Array<string> = [".", "packages", "agents"];

// Repo-relative paths of every candidate service directory.
const listServiceDirectories: () => Array<string> = (): Array<string> => {
  const directories: Array<string> = [];

  for (const parent of SERVICE_PARENT_DIRECTORIES) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, parent), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name === "node_modules") {
        continue;
      }

      directories.push(path.join(parent, entry.name));
    }
  }

  return directories;
};

interface ServiceImage {
  service: string;
  /*
   * The part of the Dockerfile that produces the production image. Templated
   * Dockerfiles carry a `{{ if eq .Env.ENVIRONMENT "development" }}` branch that
   * we must not confuse with the production one.
   */
  productionStanza: string;
  /*
   * The whole Dockerfile as it renders for production: everything before the
   * development branch plus the production stanza. Stages defined before the
   * branch (a shared `base`) belong to the production build too.
   */
  productionDockerfile: string;
  // The `start` script the production CMD ultimately runs, if it runs one.
  startScript: string | null;
}

// One `FROM` stage of a Dockerfile.
interface DockerfileStage {
  // The `AS <name>`, lower-cased, or null for an unnamed stage.
  name: string | null;
  // What it is built FROM: an image or an earlier stage's name (lower-cased).
  from: string;
  // The instructions after the FROM line, up to the next FROM.
  body: string;
}

// CMD forms that hand control to `npm start`.
const CMD_NPM_START_EXEC_FORM: RegExp = /CMD\s*\[\s*"npm"\s*,\s*"start"\s*\]/;
const CMD_NPM_START_SHELL_FORM: RegExp = /CMD\s+npm\s+start/;
const CMD_INVOKES_TS_NODE: RegExp = /CMD.*ts-node\/register/;
const TRANSPILE_ONLY_ENV: RegExp = /ENV\s+TS_NODE_TRANSPILE_ONLY=1/;
const CMD_PRECOMPILED_ENTRYPOINT: RegExp =
  /CMD\s*\[\s*"node"\s*,\s*"build\/dist\/Index\.js"\s*\]/;
const TS_NODE_ANYWHERE: RegExp = /ts-node\/register/;
/*
 * The actual build step, anchored to a RUN instruction. A plain substring
 * search would also match a comment that merely mentions `npm run compile`.
 */
const RUN_COMPILE_INSTRUCTION: RegExp = /^\s*RUN\s+npm\s+run\s+compile\s*$/m;
// Captures the body of a tsconfig `"include": [ ... ]` array.
const INCLUDE_ARRAY_BLOCK: RegExp = /"include"\s*:\s*\[([^\]]*)\]/;
const QUOTED_STRING: RegExp = /"[^"]*"/g;

// Where the development branch of a Dockerfile.tpl starts.
const DEVELOPMENT_BRANCH_START: string =
  '{{ if eq .Env.ENVIRONMENT "development" }}';
// A FROM line: `FROM <image or stage> [AS <name>]`, case-insensitive like Docker.
const FROM_INSTRUCTION: RegExp =
  /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
const USER_NODE_INSTRUCTION: RegExp = /^\s*USER\s+node\s*$/m;
// Any COPY/ADD whose source is the ee/ directory (./ee, ee, ./ee/...).
const COPIES_ENTERPRISE_DIRECTORY: RegExp =
  /^\s*(?:COPY|ADD)\s+(?:--\S+\s+)*(?:\.\/)?ee(?:\/\S*)?\s/im;
const SETS_ONEUPTIME_EDITION: RegExp = /^\s*ENV\s+ONEUPTIME_EDITION[=\s]/m;
const SETS_ENTERPRISE_EDITION_MARKER: RegExp =
  /^\s*ENV\s+ONEUPTIME_EDITION=enterprise\s*$/m;

// The final stages the edition split builds (packages/App/Dockerfile.tpl).
const EDITION_STAGE_NAMES: Array<string> = ["community", "enterprise"];

// Splits a Dockerfile into its FROM stages, in order.
const splitStages: (dockerfile: string) => Array<DockerfileStage> = (
  dockerfile: string,
): Array<DockerfileStage> => {
  const stages: Array<DockerfileStage> = [];
  let current: DockerfileStage | null = null;

  for (const line of dockerfile.split("\n")) {
    const from: RegExpMatchArray | null = line.match(FROM_INSTRUCTION);

    if (from) {
      current = {
        from: (from[1] ?? "").toLowerCase(),
        name: from[2] ? from[2].toLowerCase() : null,
        body: "",
      };
      stages.push(current);
      continue;
    }

    if (current) {
      current.body += `${line}\n`;
    }
  }

  return stages;
};

// The stage and every stage it is built FROM, nearest first.
const stageAncestry: (
  stages: Array<DockerfileStage>,
  name: string,
) => Array<DockerfileStage> = (
  stages: Array<DockerfileStage>,
  name: string,
): Array<DockerfileStage> => {
  const chain: Array<DockerfileStage> = [];
  let next: string | null = name;

  while (next !== null) {
    const wanted: string = next;
    const stage: DockerfileStage | undefined = stages.find(
      (candidate: DockerfileStage) => {
        return candidate.name === wanted;
      },
    );

    if (!stage || chain.includes(stage)) {
      break;
    }

    chain.push(stage);
    next = stage.from;
  }

  return chain;
};

const listServiceImages: () => Array<ServiceImage> =
  (): Array<ServiceImage> => {
    const images: Array<ServiceImage> = [];

    for (const directory of listServiceDirectories()) {
      const dockerfilePath: string = path.join(
        REPO_ROOT,
        directory,
        "Dockerfile.tpl",
      );
      if (!fs.existsSync(dockerfilePath)) {
        continue;
      }

      const dockerfile: string = fs.readFileSync(dockerfilePath, "utf8");

      /*
       * Everything after the last `{{ else }}` is the production branch. Files
       * with no dev/prod split are production in their entirety.
       */
      const elseIndex: number = dockerfile.lastIndexOf("{{ else }}");
      const productionStanza: string =
        elseIndex === -1 ? dockerfile : dockerfile.slice(elseIndex);
      const developmentIndex: number = dockerfile.indexOf(
        DEVELOPMENT_BRANCH_START,
      );
      const productionDockerfile: string =
        elseIndex === -1 || developmentIndex === -1
          ? dockerfile
          : dockerfile.slice(0, developmentIndex) + productionStanza;

      let startScript: string | null = null;
      const packageJsonPath: string = path.join(
        REPO_ROOT,
        directory,
        "package.json",
      );
      if (fs.existsSync(packageJsonPath)) {
        const parsed: { scripts?: Record<string, string> } = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8"),
        ) as { scripts?: Record<string, string> };
        startScript = parsed.scripts?.["start"] ?? null;
      }

      images.push({
        service: path.basename(directory),
        productionStanza,
        productionDockerfile,
        startScript,
      });
    }

    return images;
  };

// Does this image's production entrypoint go through ts-node?
const bootsThroughTsNode: (image: ServiceImage) => boolean = (
  image: ServiceImage,
): boolean => {
  const runsNpmStart: boolean =
    CMD_NPM_START_EXEC_FORM.test(image.productionStanza) ||
    CMD_NPM_START_SHELL_FORM.test(image.productionStanza);

  if (
    runsNpmStart &&
    image.startScript !== null &&
    image.startScript.includes("ts-node/register")
  ) {
    return true;
  }

  // Some images invoke ts-node straight from CMD or via a wrapper script.
  return CMD_INVOKES_TS_NODE.test(image.productionStanza);
};

const SERVICE_IMAGES: Array<ServiceImage> = listServiceImages();

// The nginx image boots run.sh, which calls `npm start` internally.
const NGINX_WRAPPER_SERVICES: Array<string> = ["Nginx"];

const bootsThroughTsNodeIncludingWrappers: (image: ServiceImage) => boolean = (
  image: ServiceImage,
): boolean => {
  if (NGINX_WRAPPER_SERVICES.includes(image.service)) {
    return (
      image.startScript !== null &&
      image.startScript.includes("ts-node/register")
    );
  }
  return bootsThroughTsNode(image);
};

describe("Container boot configuration", () => {
  test("the repository actually has service images to check", () => {
    /*
     * Guards against the discovery above silently matching nothing, which would
     * make every test below vacuously pass.
     */
    expect(SERVICE_IMAGES.length).toBeGreaterThan(5);
  });

  describe("images that boot through ts-node must not re-type-check at boot", () => {
    const tsNodeImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      bootsThroughTsNodeIncludingWrappers,
    );

    test("at least one such image exists", () => {
      expect(tsNodeImages.length).toBeGreaterThan(0);
    });

    test.each(
      tsNodeImages.map((i: ServiceImage) => {
        return i.service;
      }),
    )(
      "%s sets TS_NODE_TRANSPILE_ONLY=1 in its production image",
      (service: string) => {
        const image: ServiceImage | undefined = SERVICE_IMAGES.find(
          (i: ServiceImage) => {
            return i.service === service;
          },
        );

        expect(image).toBeDefined();
        expect(image?.productionStanza).toMatch(TRANSPILE_ONLY_ENV);
      },
    );
  });

  describe("no image disables the boot check without a build-time check", () => {
    /*
     * The two halves must stay together. Disabling the boot-time type-check on a
     * service whose image never runs `npm run compile` would leave its types
     * verified NOWHERE -- not at build, not at boot, not in CI.
     */
    test("every ts-node image type-checks at build time", () => {
      const gaps: Array<string> = SERVICE_IMAGES.filter(
        (image: ServiceImage) => {
          return (
            bootsThroughTsNodeIncludingWrappers(image) &&
            !RUN_COMPILE_INSTRUCTION.test(image.productionStanza)
          );
        },
      ).map((image: ServiceImage) => {
        return image.service;
      });

      expect(gaps).toEqual([]);
    });
  });

  describe("images that run precompiled JavaScript need no such flag", () => {
    /*
     * KubernetesCostAgent and KubernetesLogTailer boot `build/dist/Index.js`
     * directly. They are the model the ts-node services should eventually
     * follow, and they must not regress back to ts-node without the flag.
     */
    const precompiledImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      (image: ServiceImage) => {
        return CMD_PRECOMPILED_ENTRYPOINT.test(image.productionStanza);
      },
    );

    test("the precompiled pattern is still in use somewhere", () => {
      expect(precompiledImages.length).toBeGreaterThan(0);
    });

    test.each(
      precompiledImages.map((i: ServiceImage) => {
        return i.service;
      }),
    )("%s does not boot through ts-node", (service: string) => {
      const image: ServiceImage | undefined = SERVICE_IMAGES.find(
        (i: ServiceImage) => {
          return i.service === service;
        },
      );

      expect(image).toBeDefined();
      expect(image?.productionStanza).not.toMatch(TS_NODE_ANYWHERE);
    });
  });

  describe("build-time type checking is still in place", () => {
    /*
     * transpile-only is only safe because tsc already ran at build time. If a
     * service ever drops `npm run compile`, disabling the boot check would mean
     * its types are never verified at all.
     */
    const tsNodeImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      (image: ServiceImage) => {
        return (
          bootsThroughTsNodeIncludingWrappers(image) &&
          TRANSPILE_ONLY_ENV.test(image.productionStanza)
        );
      },
    );

    test.each(
      tsNodeImages.map((i: ServiceImage) => {
        return i.service;
      }),
    )("%s still runs `npm run compile` at build time", (service: string) => {
      const image: ServiceImage | undefined = SERVICE_IMAGES.find(
        (i: ServiceImage) => {
          return i.service === service;
        },
      );

      expect(image).toBeDefined();
      expect(image?.productionStanza).toMatch(RUN_COMPILE_INSTRUCTION);
    });
  });

  describe("the dev loop keeps its existing transpile-only behaviour", () => {
    const nodemonServices: Array<string> = [
      "App",
      "Home",
      "Probe",
      "Runner",
      "TestServer",
    ];

    test.each(nodemonServices)(
      "%s nodemon config still uses transpile-only",
      (service: string) => {
        const nodemonPath: string = path.join(
          REPO_ROOT,
          "packages",
          service,
          "nodemon.json",
        );

        expect(fs.existsSync(nodemonPath)).toBe(true);
        expect(fs.readFileSync(nodemonPath, "utf8")).toContain(
          "TS_NODE_TRANSPILE_ONLY",
        );
      },
    );
  });

  describe("build-time type checking actually has inputs to check", () => {
    /*
     * A tsconfig `include` entry beginning with "/" is an ABSOLUTE glob rooted
     * at the filesystem, not at the tsconfig's directory. AIAgent, Probe and
     * Runner all shipped `["/**\/*.ts"]`, which meant `npm run compile`
     * matched whatever .ts files happened to lie within tsc's glob reach of `/`
     * -- nothing at all on a developer machine (tsc exits 2 with TS18003), and
     * an arbitrary set inside the container, where /usr/src/app sits shallow
     * enough to match.
     *
     * That made the build-time type-check environment-dependent and, on the
     * services above, effectively absent -- while the CI compile jobs stayed
     * green. Since TS_NODE_TRANSPILE_ONLY hands ALL type verification to that
     * build step, a broken `include` silently means no type checking anywhere.
     */
    const tsConfigPaths: Array<string> = listServiceDirectories()
      .map((directory: string) => {
        return path.join(directory, "tsconfig.json");
      })
      .filter((candidate: string) => {
        return fs.existsSync(path.join(REPO_ROOT, candidate));
      });

    test("there are tsconfigs to check", () => {
      expect(tsConfigPaths.length).toBeGreaterThan(0);
    });

    test.each(tsConfigPaths)(
      "%s has no absolute include glob",
      (tsConfigPath: string) => {
        /*
         * These tsconfigs are JSONC (comments and trailing commas), so they are
         * not valid JSON. Extract the include array textually instead of
         * hand-rolling a JSONC parser.
         */
        const raw: string = fs.readFileSync(
          path.join(REPO_ROOT, tsConfigPath),
          "utf8",
        );
        const includeBlock: RegExpMatchArray | null =
          raw.match(INCLUDE_ARRAY_BLOCK);

        if (includeBlock === null) {
          // No `include` at all: tsc defaults to the tsconfig's own directory.
          return;
        }

        const patterns: Array<string> = (
          includeBlock[1]?.match(QUOTED_STRING) ?? []
        ).map((quoted: string) => {
          return quoted.slice(1, -1);
        });

        expect(patterns.length).toBeGreaterThan(0);

        for (const pattern of patterns) {
          expect({
            tsConfigPath,
            pattern,
            absolute: pattern.startsWith("/"),
          }).toEqual({ tsConfigPath, pattern, absolute: false });
        }
      },
    );
  });

  describe("images built as Community and Enterprise targets", () => {
    /*
     * The App builds both editions from one Dockerfile: `--target community`
     * and `--target enterprise` (packages/App/Dockerfile.tpl). Docker does
     * inherit USER, ENV and CMD from a parent stage, but that is exactly why
     * the whole-stanza checks above cannot see a final stage that lost one of
     * them: they match the instruction anywhere in the production branch. Each
     * final stage is an image of its own, so each states its own boot
     * configuration, and nothing the Community image is built from may copy
     * ee/ in.
     */
    const stagesOf: (service: string) => Array<DockerfileStage> = (
      service: string,
    ): Array<DockerfileStage> => {
      const image: ServiceImage | undefined = SERVICE_IMAGES.find(
        (candidate: ServiceImage) => {
          return candidate.service === service;
        },
      );

      return image ? splitStages(image.productionDockerfile) : [];
    };

    const stageNamed: (
      service: string,
      name: string,
    ) => DockerfileStage | undefined = (
      service: string,
      name: string,
    ): DockerfileStage | undefined => {
      return stagesOf(service).find((stage: DockerfileStage) => {
        return stage.name === name;
      });
    };

    const editionServices: Array<string> = SERVICE_IMAGES.filter(
      (image: ServiceImage) => {
        return splitStages(image.productionDockerfile).some(
          (stage: DockerfileStage) => {
            return (
              stage.name !== null && EDITION_STAGE_NAMES.includes(stage.name)
            );
          },
        );
      },
    ).map((image: ServiceImage) => {
      return image.service;
    });

    const finalStages: Array<[string, string]> = editionServices.flatMap(
      (service: string) => {
        return EDITION_STAGE_NAMES.map((name: string): [string, string] => {
          return [service, name];
        });
      },
    );

    test("the App is built this way, with exactly one stage per edition", () => {
      expect(editionServices).toContain("App");

      for (const name of EDITION_STAGE_NAMES) {
        expect(
          stagesOf("App").filter((stage: DockerfileStage) => {
            return stage.name === name;
          }),
        ).toHaveLength(1);
      }
    });

    test.each(editionServices)(
      "%s: the community stage is last, so a build without --target is the Community Edition",
      (service: string) => {
        const stages: Array<DockerfileStage> = stagesOf(service);

        expect(stages[stages.length - 1]?.name).toBe("community");
      },
    );

    test.each(finalStages)(
      "%s: the %s stage runs as the node user",
      (service: string, name: string) => {
        expect(stageNamed(service, name)?.body).toMatch(USER_NODE_INSTRUCTION);
      },
    );

    test.each(finalStages)(
      "%s: the %s stage sets TS_NODE_TRANSPILE_ONLY=1",
      (service: string, name: string) => {
        expect(stageNamed(service, name)?.body).toMatch(TRANSPILE_ONLY_ENV);
      },
    );

    test.each(finalStages)(
      "%s: the %s stage boots with CMD npm start",
      (service: string, name: string) => {
        const body: string = stageNamed(service, name)?.body ?? "";

        expect(
          CMD_NPM_START_EXEC_FORM.test(body) ||
            CMD_NPM_START_SHELL_FORM.test(body),
        ).toBe(true);
      },
    );

    test.each(finalStages)(
      "%s: the %s stage is type-checked at build time (npm run compile in its ancestry)",
      (service: string, name: string) => {
        const ancestry: Array<DockerfileStage> = stageAncestry(
          stagesOf(service),
          name,
        );

        expect(
          ancestry.some((stage: DockerfileStage) => {
            return RUN_COMPILE_INSTRUCTION.test(stage.body);
          }),
        ).toBe(true);
      },
    );

    test.each(editionServices)(
      "%s: nothing the community stage is built from copies ee/",
      (service: string) => {
        const ancestry: Array<DockerfileStage> = stageAncestry(
          stagesOf(service),
          "community",
        );

        expect(ancestry.length).toBeGreaterThan(1);
        expect(
          ancestry
            .filter((stage: DockerfileStage) => {
              return COPIES_ENTERPRISE_DIRECTORY.test(stage.body);
            })
            .map((stage: DockerfileStage) => {
              return stage.name;
            }),
        ).toEqual([]);
      },
    );

    test.each(editionServices)(
      "%s: the enterprise stage's ancestry does copy ee/ (so the check above can fail)",
      (service: string) => {
        expect(
          stageAncestry(stagesOf(service), "enterprise").some(
            (stage: DockerfileStage) => {
              return COPIES_ENTERPRISE_DIRECTORY.test(stage.body);
            },
          ),
        ).toBe(true);
      },
    );

    test.each(editionServices)(
      "%s: the enterprise image is the community build plus ee/ (they share its layers)",
      (service: string) => {
        const communityParent: string | undefined = stageNamed(
          service,
          "community",
        )?.from;
        const enterpriseAncestry: Array<string | null> = stageAncestry(
          stagesOf(service),
          "enterprise",
        ).map((stage: DockerfileStage) => {
          return stage.name;
        });

        expect(communityParent).toBeDefined();
        expect(enterpriseAncestry).toContain(communityParent);
      },
    );

    test.each(editionServices)(
      "%s: only the enterprise stage sets ONEUPTIME_EDITION, to enterprise",
      (service: string) => {
        expect(stageNamed(service, "enterprise")?.body).toMatch(
          SETS_ENTERPRISE_EDITION_MARKER,
        );
        expect(
          stageAncestry(stagesOf(service), "community").some(
            (stage: DockerfileStage) => {
              return SETS_ONEUPTIME_EDITION.test(stage.body);
            },
          ),
        ).toBe(false);
      },
    );
  });
});
