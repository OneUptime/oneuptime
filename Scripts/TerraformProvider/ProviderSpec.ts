import { execSync } from "child_process";
import path from "path";

export default class ProviderSpec {
  public static generateTerraformProviderCode(options: {
    generatorConfigPath: string;
    openApiSpecPath: string;
    outputPath: string;
  }): void {
    // Get the Go path and construct the full path to the tfplugingen-openapi binary
    const goPath: string = execSync("go env GOPATH", { encoding: "utf8" }).trim();
    const tfplugigenBinaryPath: string = path.join(
      goPath,
      "bin",
      "tfplugingen-openapi",
    );

    const command: string = `"${tfplugigenBinaryPath}" generate --config "${options.generatorConfigPath}" --output "${options.outputPath}" "${options.openApiSpecPath}"`;

    try {
      execSync(command, { stdio: "inherit" });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "Error executing Terraform provider code generation command:",
        error,
      );
      throw new Error(
        `Failed to generate Terraform provider code: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      "Terraform provider code generated successfully at:",
      options.outputPath,
    );
  }
}
