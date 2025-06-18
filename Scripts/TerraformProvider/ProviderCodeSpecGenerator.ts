import { execSync } from "child_process";
import path from "path";

export default class ProviderCodeSpecGenerator {
  private static readonly TOOL_NAME = "tfplugingen-openapi";

  public static generateProviderCodeSpec(data: {
    openApiFilePath: string;
    outputPath: string;
    generatorConfigFilePath: string;
  }): void {
    const { openApiFilePath, outputPath, generatorConfigFilePath } = data;

    const binaryPath: string = this.getTerraformProviderCodeSpecGeneratorPath();

    const command: string = `"${binaryPath}" generate --output "${outputPath}" --config "${generatorConfigFilePath}" ${openApiFilePath}`;

    try {
      // eslint-disable-next-line no-console
      console.log(`Executing command: ${command}`);
      execSync(command, { stdio: "inherit" });
      // eslint-disable-next-line no-console
      console.log("Provider code specification generated successfully!");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error generating provider code specification:", error);
    }
  }

  private static getTerraformProviderCodeSpecGeneratorPath(): string {
    // Get the Go path and construct the full path to the tfplugingen-framework binary
    const goPath: string = execSync("go env GOPATH", {
      encoding: "utf8",
    }).trim();
    return path.join(goPath, "bin", this.TOOL_NAME);
  }
}
