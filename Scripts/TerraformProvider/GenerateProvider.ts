import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import path from "path";
import fs from "fs";
import Logger from "Common/Server/Utils/Logger";
import { TerraformProviderGenerator } from "./Core/TerraformProviderGenerator";
import { OpenAPIParser } from "./Core/OpenAPIParser";
import { GoModuleGenerator } from "./Core/GoModuleGenerator";
import { ResourceGenerator } from "./Core/ResourceGenerator";
import { DataSourceGenerator } from "./Core/DataSourceGenerator";
import { ProviderGenerator } from "./Core/ProviderGenerator";
import { DocumentationGenerator } from "./Core/DocumentationGenerator";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync: (
  command: string,
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/*
 * Extract the most useful diagnostic text from a failed `exec` call. Compiler
 * and `go mod` errors land on stderr/stdout, not in the bare Error message, so
 * surface those so a failure is actually debuggable from the logs.
 */
function formatCommandError(error: unknown): string {
  const execError: { stdout?: string; stderr?: string; message?: string } =
    error as { stdout?: string; stderr?: string; message?: string };
  return (
    execError.stderr?.trim() ||
    execError.stdout?.trim() ||
    execError.message ||
    "Unknown error"
  );
}

async function main(): Promise<void> {
  Logger.info("🚀 Starting Terraform Provider Generation Process...");

  // Define paths
  const terraformDir: string = path.resolve(__dirname, "../../Terraform");
  const openApiSpecPath: string = path.resolve(terraformDir, "openapi.json");
  const providerDir: string = path.resolve(
    terraformDir,
    "terraform-provider-oneuptime",
  );

  try {
    // Step 1: Clean up existing Terraform directory
    if (fs.existsSync(terraformDir)) {
      Logger.info("🗑️ Removing existing Terraform directory...");
      fs.rmSync(terraformDir, { recursive: true, force: true });
    }

    // Step 2: Generate OpenAPI spec
    Logger.info("📄 Step 1: Generating OpenAPI specification...");
    await generateOpenAPISpec(openApiSpecPath);

    // Step 3: Parse OpenAPI spec
    Logger.info("🔍 Step 2: Parsing OpenAPI specification...");
    const parser: OpenAPIParser = new OpenAPIParser();
    const apiSpec: any = await parser.parseOpenAPISpec(openApiSpecPath);

    // Step 4: Initialize Terraform provider generator
    Logger.info("⚙️ Step 3: Initializing Terraform provider generator...");
    const generator: TerraformProviderGenerator =
      new TerraformProviderGenerator({
        outputDir: providerDir,
        providerName: "oneuptime",
        providerVersion: "1.0.0",
        goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
      });

    // Step 5: Generate Go module files
    Logger.info("📦 Step 4: Generating Go module files...");
    const goModuleGen: GoModuleGenerator = new GoModuleGenerator(
      generator.config,
    );
    await goModuleGen.generateModule();

    // Step 6: Generate provider main file
    Logger.info("🏗️ Step 5: Generating provider main file...");
    const providerGen: ProviderGenerator = new ProviderGenerator(
      generator.config,
      apiSpec,
    );
    await providerGen.generateProvider();

    // Step 7: Generate resources
    Logger.info("📋 Step 6: Generating Terraform resources...");
    const resourceGen: ResourceGenerator = new ResourceGenerator(
      generator.config,
      apiSpec,
    );
    await resourceGen.generateResources();

    // Step 8: Generate data sources
    Logger.info("🔍 Step 7: Generating Terraform data sources...");
    const dataSourceGen: DataSourceGenerator = new DataSourceGenerator(
      generator.config,
      apiSpec,
    );
    await dataSourceGen.generateDataSources();

    // Step 9: Generate documentation
    Logger.info("📚 Step 8: Generating documentation...");
    const docGen: DocumentationGenerator = new DocumentationGenerator(
      generator.config,
      apiSpec,
    );
    await docGen.generateDocumentation();

    // Step 10: Write VERSION file to ensure git always detects changes
    Logger.info("📝 Step 9: Writing VERSION file...");
    const rootVersionPath: string = path.resolve(__dirname, "../../VERSION");
    const providerVersionPath: string = path.resolve(providerDir, "VERSION");
    const versionContent: string = fs
      .readFileSync(rootVersionPath, "utf-8")
      .trim();
    const versionFileContent: string = `${versionContent}
# This file is auto-generated from the root VERSION file.
# It ensures the Terraform provider is regenerated for each OneUptime release.
# Generated at: ${new Date().toISOString()}
`;
    fs.writeFileSync(providerVersionPath, versionFileContent);
    Logger.info(`✅ VERSION file written: ${versionContent}`);

    // Step 11: Generate build scripts
    Logger.info("🔨 Step 10: Generating build and installation scripts...");
    await generator.generateBuildScripts();

    // Step 12: Run go mod tidy
    Logger.info("📦 Step 11: Running go mod tidy...");

    try {
      await execAsync("go mod tidy", { cwd: providerDir });
      Logger.info("✅ go mod tidy completed successfully");
    } catch (error) {
      /*
       * Fail hard. A failed `go mod tidy` means go.mod/go.sum are inconsistent,
       * which yields a provider that won't build. Stopping here keeps a broken
       * module from being pushed/tagged/released by publish-terraform-provider.sh.
       */
      throw new Error(`go mod tidy failed:\n${formatCommandError(error)}`);
    }

    /*
     * Step 13: Compile-check the generated provider for the current platform.
     * Multi-platform cross-compilation is handled by `goreleaser release` in
     * publish-terraform-provider.sh, which runs with --clean and rebuilds dist/
     * from scratch. Doing a 23-target cross-compile here too doubled the work
     * and OOM-killed CI runners.
     */
    Logger.info(
      "🔨 Step 12: Verifying provider compiles (current platform)...",
    );
    try {
      await execAsync("go build -o terraform-provider-oneuptime", {
        cwd: providerDir,
      });
      Logger.info("✅ Provider compiled successfully");
    } catch (error) {
      /*
       * Fail hard. A non-compiling provider MUST stop the pipeline here, before
       * publish-terraform-provider.sh pushes/tags/releases the broken code.
       * Otherwise the failure resurfaces much later (and confusingly) as a
       * GoReleaser cross-compile failure rather than a generation bug.
       */
      throw new Error(
        `Generated provider failed to compile (go build):\n${formatCommandError(error)}`,
      );
    }

    Logger.info("✅ Terraform provider generation completed successfully!");
    Logger.info(`📁 Provider generated at: ${providerDir}`);
    Logger.info("🎯 Next steps:");
    Logger.info("   1. cd Terraform/terraform-provider-oneuptime");
    Logger.info("   2. Run tests with: go test ./...");
    Logger.info("   3. Install locally with: ./install.sh");
  } catch (error) {
    Logger.error(
      `❌ Error during Terraform provider generation: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    throw new Error(
      `Failed to generate Terraform provider: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

main().catch((err: Error) => {
  Logger.error(`💥 Unexpected error: ${err.message}`);
  process.exit(1);
});
