"use strict";

/**
 * Data Security's names-and-addresses model reaches every image that scans,
 * from one pinned place, and nothing else.
 *
 * The App's workers and the probes run the model inside the scanner
 * (packages/Common/Server/Utils/DataSecurity/Model). Its weights are never in
 * git: NameAddressModel.json pins the revision they come from and each file's
 * URL, size and SHA-256, and
 *
 *  - the App's and the probe's release Dockerfiles fetch exactly those files
 *    with Scripts/Docker/FetchDataSecurityModel.js, which checks each against
 *    its SHA-256, into the directory the scanner reads, before Common's
 *    sources are copied (so a change to them does not fetch it again);
 *  - Iron Bank, whose pipeline builds offline, gets the same files as
 *    resources of the App's and the probe's hardening_manifest.yaml, with the
 *    same URLs and checksums, copied to the same place; their shipped stages
 *    leave the release's copy out, so no layer carries the model twice;
 *  - the App's pruned build walks the model's worker thread, which alone
 *    requires onnxruntime-web, so the prune keeps it.
 *
 * Moving the model to another revision is one change to NameAddressModel.json
 * and the two Iron Bank manifests; this fails until all three agree.
 */

const path = require("path");
const yaml = require("js-yaml");

const { render, parseStages, instructions } = require("./Utils/DockerfileTemplate");
const { read, all, commands, copies, readProject } = require("./Utils/IronBank");

const MANIFEST_PATH =
  "packages/Common/Server/Utils/DataSecurity/Model/NameAddressModel.json";
const model = JSON.parse(read(MANIFEST_PATH));
const FETCH_RUN = `RUN node /tmp/FetchDataSecurityModel.js --manifest /tmp/NameAddressModel.json --runtime /usr/src/Common/node_modules/onnxruntime-web && rm /tmp/FetchDataSecurityModel.js /tmp/NameAddressModel.json`;
const FETCH_COPIES = [
  `COPY ./${MANIFEST_PATH} /tmp/NameAddressModel.json`,
  "COPY ./Scripts/Docker/FetchDataSecurityModel.js /tmp/FetchDataSecurityModel.js",
];

function resourceName(file) {
  return `data-security-${file.name}`;
}

describe("NameAddressModel.json", () => {
  test("pins one revision of an Apache-2.0 model, every file by an https URL of that revision, its size and its SHA-256", () => {
    expect(model.licence).toBe("Apache-2.0");
    expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(model.directory).toBe("/usr/src/DataSecurityModel");
    expect(
      model.files.map((file) => {
        return file.name;
      }),
    ).toEqual(["model_quantized.onnx", "vocab.txt", "config.json", "README.md"]);

    for (const file of model.files) {
      expect(file.url).toBe(
        `https://huggingface.co/${model.name}/resolve/${model.revision}/${
          file.name === "model_quantized.onnx" ? "onnx/" : ""
        }${file.name}`,
      );
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(file.bytes) && file.bytes > 0).toBe(true);
    }
  });

  test("the scanner reads the model from the directory the images put it in", () => {
    const files = read(
      "packages/Common/Server/Utils/DataSecurity/Model/NameAddressModelFiles.ts",
    );

    expect(files).toContain("NAME_ADDRESS_MODEL.directory");
    expect(files).toContain('MODEL_FILE_NAME: string = "model_quantized.onnx"');
    expect(files).toContain('VOCABULARY_FILE_NAME: string = "vocab.txt"');
  });
});

describe.each([
  ["App", "packages/App/Dockerfile.tpl", "base"],
  ["Probe", "packages/Probe/Dockerfile.tpl", null],
])("the %s release image", (name, template, stageName) => {
  for (const environment of ["production", "development"]) {
    test(`fetches the model with the script, checked against the manifest, before Common's sources (${environment})`, () => {
      const stages = parseStages(
        render(read(template), environment, {
          fileExists: () => {
            return false;
          },
        }),
      );
      const stage = stageName
        ? stages.find((candidate) => {
            return candidate.name === stageName;
          })
        : stages[0];
      const lines = instructions(stage.body);
      const fetchIndex = lines.indexOf(FETCH_RUN);
      const npmIndex = lines.findIndex((line) => {
        return /^RUN .*npm ci/.test(line);
      });
      const sourcesIndex = lines.findIndex((line) => {
        return /^COPY (--exclude=Tests )?\.\/packages\/Common \/usr\/src\/Common$/.test(
          line,
        );
      });

      expect(fetchIndex).toBeGreaterThan(-1);
      expect(lines.slice(fetchIndex - 2, fetchIndex)).toEqual(FETCH_COPIES);
      // The runtime is installed before it is slimmed, the sources after.
      expect(npmIndex).toBeGreaterThan(-1);
      expect(npmIndex).toBeLessThan(fetchIndex);
      expect(sourcesIndex).toBeGreaterThan(fetchIndex);
    });
  }
});

test("the App's pruned builds walk the model's worker thread, so onnxruntime-web stays", () => {
  const stages = parseStages(render(read("packages/App/Dockerfile.tpl"), "production"));

  for (const stageName of ["community-pruned", "enterprise-pruned"]) {
    const stage = stages.find((candidate) => {
      return candidate.name === stageName;
    });
    const prune = instructions(stage.body).find((line) => {
      return line.startsWith("RUN node /tmp/PruneUnreachablePackages.js");
    });

    expect(prune).toContain(
      "--entry /usr/src/Common/Server/Utils/DataSecurity/Model/NameAddressModelWorker.cjs",
    );
    expect(prune).toContain(
      "--entry-loader /usr/src/Common/Server/Utils/DataSecurity/Model/NameAddressModelThread.ts",
    );
  }

  // The worker requires the runtime by its name, which the walk follows.
  expect(
    read("packages/Common/Server/Utils/DataSecurity/Model/NameAddressModelWorker.cjs"),
  ).toContain('require("onnxruntime-web")');
});

test("the build context lets the fetch script in", () => {
  expect(read(".dockerignore").split("\n")).toContain(
    "!Scripts/Docker/FetchDataSecurityModel.js",
  );
});

describe.each(["App", "Probe"])("IronBank/%s", (name) => {
  const project = readProject(name);
  const manifest = yaml.load(read(`IronBank/${name}/hardening_manifest.yaml`));
  const modelResources = (manifest.resources || []).filter((resource) => {
    return String(resource.filename || "").startsWith("data-security-");
  });

  test("lists every file of the model as a resource, with the URL and SHA-256 the release's build checks", () => {
    expect(modelResources).toEqual(
      model.files.map((file) => {
        return {
          url: file.url,
          filename: resourceName(file),
          validation: { type: "sha256", value: file.sha256 },
        };
      }),
    );
  });

  test("copies each to where the scanner reads it, and leaves the release's copy out", () => {
    const fromContext = copies(project.finalInstructions).filter((copy) => {
      return copy.from === null && copy.sources[0].startsWith("data-security-");
    });

    expect(fromContext).toEqual(
      model.files.map((file) => {
        return {
          from: null,
          sources: [resourceName(file)],
          destination: path.posix.join(model.directory, file.name),
        };
      }),
    );

    const shipped = project.stages.find((stage) => {
      return stage.name === "shipped";
    });

    expect(commands(instructions(shipped.body))).toContain(
      `rm -rf /usr/src/Common/Tests /usr/src/app/Tests ${model.directory}`,
    );
  });

  test("fetches nothing itself: the files come from the manifest", () => {
    expect(
      commands(project.finalInstructions).filter((command) => {
        return /huggingface|FetchDataSecurityModel/.test(command);
      }),
    ).toEqual([]);
    expect(all(project.finalInstructions, "ADD")).toEqual([]);
  });
});
