import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { goEnvironment } from "../../TerraformProvider/Core/GoCommand";
import { OpenAPIParser } from "../../TerraformProvider/Core/OpenAPIParser";
import { TerraformResource } from "../../TerraformProvider/Core/Types";
import {
  collectReferences,
  ReferenceMap,
  renderReferencesGo,
  TERRAFORM_PREFIX,
} from "./References";
import { MODULE_PATH, renderGoMod } from "./GoModule";

const execAsync: (
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/*
 * The provider's hand-written Go - the provider command, its configuration,
 * the ProviderConfig types, the clients, the tests - and its package
 * metadata, copied into the provider as they are, by their paths in here.
 */
export const STATIC_FILES_DIR: string = path.join(
  __dirname,
  "..",
  "StaticFiles",
);

export interface CrossplaneProviderOptions {
  // Where the provider is written: Crossplane/provider-oneuptime.
  outputDir: string;
  // The Terraform provider it runs: Terraform/terraform-provider-oneuptime.
  terraformProviderDir: string;
  // The spec the Terraform provider was generated from: its relations.
  openApiSpecPath: string;
  // The OneUptime release: 14.0.105.
  version: string;
}

export interface GoStep {
  title: string;
  command: string;
  // Relative to the provider; the provider itself when not given.
  cwd?: string;
}

/*
 * What turns the copied sources into the provider, in order. The code
 * generators are built first (go.mod pins them as tools), and their folder
 * is on the PATH of every step: Upjet runs goimports by name.
 */
export function goSteps(options: CrossplaneProviderOptions): Array<GoStep> {
  const terraformDocs: string = path.join(
    path.relative(options.outputDir, options.terraformProviderDir),
    "docs",
    "resources",
  );
  const header: string = "../hack/boilerplate.go.txt";
  return [
    /*
     * -e: the packages generation writes (apis, internal/controller) are
     * not there yet, and the main command imports them.
     */
    { title: "Resolving the Go modules", command: "go mod tidy -e" },
    { title: "Building the code generators", command: "go build -o bin/ tool" },
    {
      title: "Reading the Terraform provider's schema",
      command: "go run ./cmd/schema config/schema.json",
    },
    {
      title: "Reading the Terraform provider's docs",
      command: `bin/scraper -n ${TERRAFORM_PREFIX}/${TERRAFORM_PREFIX} -r ${terraformDocs} -o config/provider-metadata.yaml`,
    },
    {
      title: "Generating the managed resources",
      command: "go run ./cmd/generator .",
    },
    {
      title: "Generating deep copies and CRDs",
      cwd: "apis",
      command: `../bin/controller-gen object:headerFile=${header} paths=./... crd:allowDangerousTypes=true,crdVersions=v1 output:artifacts:config=../package/crds`,
    },
    {
      title: "Generating method sets",
      cwd: "apis",
      command: `../bin/angryjet generate-methodsets --header-file=${header} ./...`,
    },
    { title: "Formatting", command: "gofmt -w config" },
    { title: "Tidying the Go modules", command: "go mod tidy" },
    {
      title: "Building the provider",
      command: `go build -ldflags "-X ${MODULE_PATH}/internal/version.Version=v${options.version}" -o bin/provider ./cmd/provider`,
    },
  ];
}

/*
 * The environment every Go step runs in: the code generators' folder first
 * on PATH, no C library, and Go's memory limit
 * (TerraformProvider/Core/GoCommand.ts). Reading the schema, generating the
 * resources and building the provider all link the Terraform provider's
 * internal/provider, which this provider runs in process, and without the
 * limit compiling it took the compiler alone to ~15 GB of a 16 GB CI runner.
 */
export function goStepsEnvironment(
  options: CrossplaneProviderOptions,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...goEnvironment(environment),
    PATH: [path.join(options.outputDir, "bin"), environment["PATH"]]
      .filter(Boolean)
      .join(path.delimiter),
    // A provider runs on any Linux: no C library.
    CGO_ENABLED: "0",
  };
}

// Every file under a folder, by its path relative to the folder.
export function listFiles(dir: string, prefix: string = ""): Array<string> {
  const files: Array<string> = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), {
    withFileTypes: true,
  })) {
    const relative: string = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(dir, relative));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

function formatCommandError(error: unknown): string {
  const execError: { stdout?: string; stderr?: string; message?: string } =
    error as { stdout?: string; stderr?: string; message?: string };
  return (
    [execError.stderr?.trim(), execError.stdout?.trim()]
      .filter(Boolean)
      .join("\n") ||
    execError.message ||
    "Unknown error"
  );
}

export class CrossplaneProviderGenerator {
  public readonly options: CrossplaneProviderOptions;

  public constructor(options: CrossplaneProviderOptions) {
    this.options = options;
  }

  /*
   * The Terraform provider, and the spec it came from, must be generated
   * first: this provider runs that one.
   */
  public checkTerraformProvider(): void {
    const missing: Array<string> = [
      path.join(this.options.terraformProviderDir, "go.mod"),
      path.join(this.options.terraformProviderDir, "xpprovider"),
      path.join(this.options.terraformProviderDir, "docs", "resources"),
      this.options.openApiSpecPath,
    ].filter((file: string): boolean => {
      return !fs.existsSync(file);
    });
    if (missing.length > 0) {
      throw new Error(
        `The Terraform provider is not generated (missing ${missing.join(", ")}). Run \`npm run generate-terraform-provider\` first.`,
      );
    }
  }

  public async getReferences(): Promise<ReferenceMap> {
    const parser: OpenAPIParser = new OpenAPIParser();
    await parser.parseOpenAPISpec(this.options.openApiSpecPath);
    const resources: Array<TerraformResource> = parser.getResources();
    if (resources.length === 0) {
      throw new Error(
        `The spec at ${this.options.openApiSpecPath} has no resources.`,
      );
    }
    return collectReferences(resources);
  }

  /*
   * Writes everything generation starts from: the static files, go.mod and
   * the references. What was there before is removed first, so a file
   * dropped from StaticFiles is gone from the provider too.
   */
  public async writeSources(): Promise<void> {
    const { outputDir } = this.options;
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    for (const file of listFiles(STATIC_FILES_DIR)) {
      const target: string = path.join(outputDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(STATIC_FILES_DIR, file), target);
    }

    fs.writeFileSync(
      path.join(outputDir, "go.mod"),
      renderGoMod({
        terraformProviderPath: path.relative(
          outputDir,
          this.options.terraformProviderDir,
        ),
      }),
    );

    fs.writeFileSync(
      path.join(outputDir, "config", "zz_references.go"),
      renderReferencesGo(await this.getReferences()),
    );

    fs.writeFileSync(
      path.join(outputDir, "VERSION"),
      `${this.options.version}\n# Written from the root VERSION file.\n`,
    );
  }

  public async runGoSteps(log: (message: string) => void): Promise<void> {
    const env: NodeJS.ProcessEnv = goStepsEnvironment(
      this.options,
      process.env,
    );
    for (const step of goSteps(this.options)) {
      log(`${step.title}: ${step.command}`);
      try {
        await execAsync(step.command, {
          cwd: path.join(this.options.outputDir, step.cwd || ""),
          env,
          maxBuffer: 256 * 1024 * 1024,
        });
      } catch (error) {
        throw new Error(`${step.title} failed:\n${formatCommandError(error)}`);
      }
    }
  }
}
