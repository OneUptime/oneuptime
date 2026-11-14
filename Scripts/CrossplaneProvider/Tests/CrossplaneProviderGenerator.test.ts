import fs from "fs";
import os from "os";
import path from "path";
import { GO_MEMORY_LIMIT } from "../../TerraformProvider/Core/GoCommand";
import { buildFixtureSpec } from "../../TerraformProvider/Tests/Fixtures";
import {
  CrossplaneProviderGenerator,
  CrossplaneProviderOptions,
  GoStep,
  goSteps,
  goStepsEnvironment,
  listFiles,
  STATIC_FILES_DIR,
} from "../Core/CrossplaneProviderGenerator";

let root: string;
let options: CrossplaneProviderOptions;

// A repository laid out as the real one is: Terraform/ beside Crossplane/.
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xpgen-"));
  const terraformProviderDir: string = path.join(
    root,
    "Terraform",
    "terraform-provider-oneuptime",
  );
  fs.mkdirSync(path.join(terraformProviderDir, "xpprovider"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(terraformProviderDir, "docs", "resources"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(terraformProviderDir, "go.mod"), "module x\n");
  const openApiSpecPath: string = path.join(root, "Terraform", "openapi.json");
  fs.writeFileSync(openApiSpecPath, JSON.stringify(buildFixtureSpec()));
  options = {
    outputDir: path.join(root, "Crossplane", "provider-oneuptime"),
    terraformProviderDir,
    openApiSpecPath,
    version: "14.0.105",
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("before generating", () => {
  test("a Terraform provider that is there passes", () => {
    expect(() => {
      new CrossplaneProviderGenerator(options).checkTerraformProvider();
    }).not.toThrow();
  });

  test("a Terraform provider that is not says how to make it", () => {
    fs.rmSync(path.join(options.terraformProviderDir, "xpprovider"), {
      recursive: true,
    });
    expect(() => {
      new CrossplaneProviderGenerator(options).checkTerraformProvider();
    }).toThrow(/xpprovider.*npm run generate-terraform-provider/);
  });

  test("so does a missing spec", () => {
    fs.rmSync(options.openApiSpecPath);
    expect(() => {
      new CrossplaneProviderGenerator(options).checkTerraformProvider();
    }).toThrow(/openapi\.json/);
  });
});

describe("the sources", () => {
  test("every static file is copied, at its path", async () => {
    await new CrossplaneProviderGenerator(options).writeSources();

    const written: Array<string> = listFiles(options.outputDir);
    const statics: Array<string> = listFiles(STATIC_FILES_DIR);
    expect(statics.length).toBeGreaterThan(20);
    expect(written).toEqual(expect.arrayContaining(statics));
    for (const file of statics) {
      expect(fs.readFileSync(path.join(options.outputDir, file))).toEqual(
        fs.readFileSync(path.join(STATIC_FILES_DIR, file)),
      );
    }
  });

  test("go.mod replaces the Terraform provider with the one beside it", async () => {
    await new CrossplaneProviderGenerator(options).writeSources();

    expect(
      fs.readFileSync(path.join(options.outputDir, "go.mod"), "utf-8"),
    ).toContain(
      "replace github.com/oneuptime/terraform-provider-oneuptime => ../../Terraform/terraform-provider-oneuptime\n",
    );
  });

  test("the references come from the spec", async () => {
    await new CrossplaneProviderGenerator(options).writeSources();

    expect(
      fs.readFileSync(
        path.join(options.outputDir, "config", "zz_references.go"),
        "utf-8",
      ),
    ).toContain('"current_monitor_status_id": "oneuptime_monitor_status",');
  });

  test("VERSION is the release's", async () => {
    await new CrossplaneProviderGenerator(options).writeSources();

    expect(
      fs.readFileSync(path.join(options.outputDir, "VERSION"), "utf-8"),
    ).toMatch(/^14\.0\.105\n/);
  });

  test("what an earlier generation left is gone", async () => {
    const stale: string = path.join(
      options.outputDir,
      "internal",
      "controller",
      "crossplane",
      "gone",
      "zz_controller.go",
    );
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, "package gone\n");

    await new CrossplaneProviderGenerator(options).writeSources();

    expect(fs.existsSync(stale)).toBe(false);
  });
});

describe("the Go steps", () => {
  const titles: (steps: Array<GoStep>) => Array<string> = (
    steps: Array<GoStep>,
  ): Array<string> => {
    return steps.map((step: GoStep): string => {
      return step.command.split(" ")[0] === "go"
        ? step.command.split(" ").slice(0, 3).join(" ")
        : step.command.split(" ")[0]!;
    });
  };

  test("run in the order each needs the one before", () => {
    const order: Array<string> = titles(goSteps(options));
    const at: (prefix: string) => number = (prefix: string): number => {
      const index: number = order.findIndex((command: string): boolean => {
        return command.startsWith(prefix);
      });
      expect({ prefix, index }).toEqual({
        prefix,
        index: expect.any(Number),
      });
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };

    expect(at("go mod tidy")).toBeLessThan(at("go build -o"));
    expect(at("go build -o")).toBeLessThan(at("go run ./cmd/schema"));
    expect(at("go run ./cmd/schema")).toBeLessThan(at("bin/scraper"));
    expect(at("bin/scraper")).toBeLessThan(at("go run ./cmd/generator"));
    expect(at("go run ./cmd/generator")).toBeLessThan(
      at("../bin/controller-gen"),
    );
    expect(at("../bin/controller-gen")).toBeLessThan(at("../bin/angryjet"));
    expect(order[order.length - 1]).toBe("go build -ldflags");
  });

  test("tidy tolerates the packages generation has not written yet, and only then", () => {
    const steps: Array<GoStep> = goSteps(options);
    expect(steps[0]!.command).toBe("go mod tidy -e");
    expect(
      steps.filter((step: GoStep): boolean => {
        return step.command === "go mod tidy";
      }),
    ).toHaveLength(1);
  });

  test("the scraper reads the Terraform provider's resource docs", () => {
    const scraper: GoStep = goSteps(options).find((step: GoStep) => {
      return step.command.startsWith("bin/scraper");
    })!;
    expect(scraper.command).toContain(
      "-r ../../Terraform/terraform-provider-oneuptime/docs/resources",
    );
    expect(scraper.command).toContain("-o config/provider-metadata.yaml");
  });

  test("the CRDs land in the package", () => {
    const controllerGen: GoStep = goSteps(options).find((step: GoStep) => {
      return step.command.includes("controller-gen");
    })!;
    expect(controllerGen.cwd).toBe("apis");
    expect(controllerGen.command).toContain(
      "output:artifacts:config=../package/crds",
    );
  });

  /*
   * Three of them link the Terraform provider's internal/provider, whose
   * compile took the compiler to ~15 GB of a 16 GB CI runner without Go's
   * memory limit (#7559).
   */
  test("run with the code generators first on PATH, no C library and Go's memory limit", () => {
    expect(
      goStepsEnvironment(options, { PATH: "/usr/bin", HOME: "/home/runner" }),
    ).toEqual({
      PATH: [path.join(options.outputDir, "bin"), "/usr/bin"].join(
        path.delimiter,
      ),
      HOME: "/home/runner",
      CGO_ENABLED: "0",
      GOMEMLIMIT: GO_MEMORY_LIMIT,
    });
  });

  test("a caller's own memory limit wins", () => {
    expect(
      goStepsEnvironment(options, { PATH: "/usr/bin", GOMEMLIMIT: "off" })[
        "GOMEMLIMIT"
      ],
    ).toBe("off");
  });

  test("the provider is built with its version", () => {
    const build: GoStep = goSteps(options)[goSteps(options).length - 1]!;
    expect(build.command).toContain(
      "-X github.com/oneuptime/crossplane-provider-oneuptime/internal/version.Version=v14.0.105",
    );
    expect(build.command).toContain("./cmd/provider");
  });
});
