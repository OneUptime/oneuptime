"use strict";

/**
 * The App image serves the docs and the Home image serves the blog, and both
 * draw diagrams with the mermaid Common/Server/Utils/VendorAssets.ts serves
 * from Common/build/mermaid-browser. That directory is not in git: it is a
 * build of mermaid's ES module source, with the packages npm installed, that
 * Common/Scripts/build-mermaid-browser.js writes. So both images have to run
 * the script - after Common's npm ci, which installs esbuild, mermaid and
 * katex, and after Common's sources are copied in - in a stage every target
 * they ship builds on, in production and in development. If they did not,
 * every diagram would quietly be a 404.
 */

const fs = require("fs");
const path = require("path");

const {
  render,
  parseStages,
  ancestry,
  instructions,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BUILD_SCRIPT = "packages/Common/Scripts/build-mermaid-browser.js";
const BUILD = "RUN node /usr/src/Common/Scripts/build-mermaid-browser.js";
const COPY_COMMON = "COPY ./packages/Common /usr/src/Common";
const COMMON_WORKDIR = "WORKDIR /usr/src/Common";

const IMAGES = ["packages/App/Dockerfile.tpl", "packages/Home/Dockerfile.tpl"];
const ENVIRONMENTS = ["production", "development"];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function stagesOf(template, environment) {
  return parseStages(
    render(read(template), environment, {
      fileExists: (relativePath) => {
        return fs.existsSync(path.join(REPO_ROOT, relativePath));
      },
    }),
  ).map((stage) => {
    return { ...stage, instructions: instructions(stage.body) };
  });
}

/*
 * What a build of the template ships, each as the instructions it runs from
 * its first stage to its last: the App's two edition targets, or the last
 * stage.
 */
function shippedInstructionLists(stages) {
  const targets = stages.filter((stage) => {
    return stage.name === "community" || stage.name === "enterprise";
  });
  const finals = targets.length > 0 ? targets : [stages[stages.length - 1]];

  return finals.map((stage) => {
    const chain = stage.name ? ancestry(stages, stage.name) : [stage];

    return {
      target: stage.name || "(last stage)",
      lines: chain
        .slice()
        .reverse()
        .flatMap((link) => {
          return link.instructions;
        }),
    };
  });
}

describe("images that draw diagrams build mermaid from its source", () => {
  test("the script the images run is in the repository", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, BUILD_SCRIPT))).toBe(true);
  });

  for (const image of IMAGES) {
    for (const environment of ENVIRONMENTS) {
      describe(`${image} (${environment})`, () => {
        const shipped = shippedInstructionLists(stagesOf(image, environment));

        test("ships at least one target to check", () => {
          expect(shipped.length).toBeGreaterThan(0);
        });

        for (const { target, lines } of shipped) {
          test(`${target} runs the build once, after Common is installed and copied in`, () => {
            const builds = lines.filter((line) => {
              return line === BUILD;
            });

            expect(builds).toHaveLength(1);

            const buildAt = lines.indexOf(BUILD);
            const copyAt = lines.indexOf(COPY_COMMON);
            const workdirAt = lines.indexOf(COMMON_WORKDIR);
            const installAt = lines.findIndex((line, index) => {
              return index > workdirAt && /\bnpm ci\b/.test(line);
            });

            expect(workdirAt).toBeGreaterThanOrEqual(0);
            expect(installAt).toBeGreaterThan(workdirAt);
            expect(copyAt).toBeGreaterThan(installAt);
            expect(buildAt).toBeGreaterThan(copyAt);
          });
        }
      });
    }
  }

  test("VendorAssets serves the directory the script writes by default", () => {
    const vendorAssets = read("packages/Common/Server/Utils/VendorAssets.ts");
    const mermaid = read("packages/Common/UI/esbuild-mermaid.js");

    expect(vendorAssets).toMatch(
      /MermaidBuildPath: string = path\.resolve\(\s*__dirname,\s*"\.\.",\s*"\.\.",\s*"build",\s*"mermaid-browser",?\s*\)/,
    );
    expect(mermaid).toMatch(
      /MERMAID_BROWSER_BUILD_DIRECTORY = path\.join\(\s*COMMON_ROOT,\s*"build",\s*"mermaid-browser",?\s*\)/,
    );
  });
});
