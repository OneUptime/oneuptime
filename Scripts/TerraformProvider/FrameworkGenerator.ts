import { execSync } from "child_process";
import path from "path";
import * as fs from "fs";

interface FrameworkGeneratorOptions {
  specificationPath: string;
  outputPath: string;
  packageName?: string;
}

interface FrameworkScaffoldOptions {
  type: "data-source" | "provider" | "resource";
  name: string;
  outputDir: string;
  packageName?: string;
  force?: boolean;
}

export default class FrameworkGenerator {
  private static readonly TOOL_NAME = "tfplugingen-framework";

  /**
   * Generate Terraform Provider Framework code from a Provider Code Specification
   */
  public static generateAll(options: FrameworkGeneratorOptions): void {
    this.generate("all", options);
  }

  /**
   * Generate only data source code
   */
  public static generateDataSources(options: FrameworkGeneratorOptions): void {
    this.generate("data-sources", options);
  }

  /**
   * Generate only resource code
   */
  public static generateResources(options: FrameworkGeneratorOptions): void {
    this.generate("resources", options);
  }

  /**
   * Generate only provider code
   */
  public static generateProvider(options: FrameworkGeneratorOptions): void {
    this.generate("provider", options);
  }

  /**
   * Scaffold starter code for a data source, provider, or resource
   */
  public static scaffold(options: FrameworkScaffoldOptions): void {
    const binaryPath: string = this.getTerraformFrameworkGeneratorPath();

    let command: string = `"${binaryPath}" scaffold ${options.type} --name "${options.name}" --output-dir "${options.outputDir}"`;

    if (options.packageName) {
      command += ` --package "${options.packageName}"`;
    }

    if (options.force) {
      command += " --force";
    }

    try {
      // eslint-disable-next-line no-console
      console.log(`🏗️  Scaffolding ${options.type}: ${options.name}`);
      // eslint-disable-next-line no-console
      console.log(`📁 Output directory: ${options.outputDir}`);
      // eslint-disable-next-line no-console
      console.log(`🔧 Running command: ${command}`);

      execSync(command, { stdio: "inherit" });
      // eslint-disable-next-line no-console
      console.log(
        `✅ Successfully scaffolded ${options.type}: ${options.name}`,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`❌ Error scaffolding ${options.type}:`, error);
      throw new Error(
        `Failed to scaffold ${options.type}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private static generate(
    subcommand: "all" | "data-sources" | "resources" | "provider",
    options: FrameworkGeneratorOptions,
  ): void {
    const binaryPath: string = this.getTerraformFrameworkGeneratorPath();

    let command: string = `"${binaryPath}" generate ${subcommand} --input "${options.specificationPath}" --output "${options.outputPath}"`;

    if (options.packageName) {
      command += ` --package "${options.packageName}"`;
    }

    try {
      // eslint-disable-next-line no-console
      console.log(`🔄 Generating ${subcommand} from specification...`);
      // eslint-disable-next-line no-console
      console.log(`📄 Input specification: ${options.specificationPath}`);
      // eslint-disable-next-line no-console
      console.log(`📁 Output directory: ${options.outputPath}`);
      // eslint-disable-next-line no-console
      console.log(`🔧 Running command: ${command}`);

      // Ensure output directory exists
      if (!fs.existsSync(options.outputPath)) {
        fs.mkdirSync(options.outputPath, { recursive: true });
      }

      execSync(command, { stdio: "inherit" });
      // eslint-disable-next-line no-console
      console.log(
        `✅ Successfully generated ${subcommand} at: ${options.outputPath}`,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`❌ Error generating ${subcommand}:`, error);
      throw new Error(
        `Failed to generate ${subcommand}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private static getTerraformFrameworkGeneratorPath(): string {
    // Get the Go path and construct the full path to the tfplugingen-framework binary
    const goPath: string = execSync("go env GOPATH", { encoding: "utf8" }).trim();
    return path.join(goPath, "bin", this.TOOL_NAME);
  }

  /**
   * Check if the framework generator tool is installed
   */
  public static isInstalled(): boolean {
    try {
      const binaryPath: string = this.getTerraformFrameworkGeneratorPath();
      return fs.existsSync(binaryPath);
    } catch {
      return false;
    }
  }

  /**
   * Print usage information for the framework generator
   */
  public static printUsageInfo(): void {
    // eslint-disable-next-line no-console
    console.log("📖 Terraform Plugin Framework Generator Usage:");
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log("🔄 Generate Commands:");
    // eslint-disable-next-line no-console
    console.log(
      "   generateAll()        - Generate all provider code (data sources, resources, and provider)",
    );
    // eslint-disable-next-line no-console
    console.log("   generateDataSources()- Generate only data source code");
    // eslint-disable-next-line no-console
    console.log("   generateResources()  - Generate only resource code");
    // eslint-disable-next-line no-console
    console.log("   generateProvider()   - Generate only provider code");
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log("🏗️  Scaffold Commands:");
    // eslint-disable-next-line no-console
    console.log(
      "   scaffold()           - Create starter code for data source, provider, or resource",
    );
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log("📋 Requirements:");
    // eslint-disable-next-line no-console
    console.log("   - Provider Code Specification file (JSON format)");
    // eslint-disable-next-line no-console
    console.log("   - tfplugingen-framework tool installed");
    // eslint-disable-next-line no-console
    console.log("   - Go installed and properly configured");
    // eslint-disable-next-line no-console
    console.log("");
  }
}
