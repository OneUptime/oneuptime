/*
 * Generates the OneUptime Crossplane provider, Crossplane/provider-oneuptime,
 * from the Terraform provider `npm run generate-terraform-provider` writes:
 * Crossplane's Upjet makes a namespaced managed resource of each of its
 * resources, which the provider reconciles by running the Terraform provider
 * in process. See README.md.
 */
import path from "path";
import fs from "fs";
import Logger from "Common/Server/Utils/Logger";
import { CrossplaneProviderGenerator } from "./Core/CrossplaneProviderGenerator";

async function main(): Promise<void> {
  const repoRoot: string = path.resolve(__dirname, "..", "..");
  const generator: CrossplaneProviderGenerator =
    new CrossplaneProviderGenerator({
      outputDir: path.join(repoRoot, "Crossplane", "provider-oneuptime"),
      terraformProviderDir: path.join(
        repoRoot,
        "Terraform",
        "terraform-provider-oneuptime",
      ),
      openApiSpecPath: path.join(repoRoot, "Terraform", "openapi.json"),
      version: fs.readFileSync(path.join(repoRoot, "VERSION"), "utf-8").trim(),
    });

  Logger.info("🚀 Generating the Crossplane provider...");
  generator.checkTerraformProvider();

  Logger.info("📄 Writing the sources...");
  await generator.writeSources();

  await generator.runGoSteps((message: string): void => {
    Logger.info(`🔨 ${message}`);
  });

  Logger.info(
    `✅ Crossplane provider generated at ${generator.options.outputDir}`,
  );
}

main().catch((err: Error) => {
  Logger.error(`💥 ${err.message}`);
  process.exit(1);
});
