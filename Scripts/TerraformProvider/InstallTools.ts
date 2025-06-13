import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface InstallResult {
  success: boolean;
  message: string;
  version?: string;
}

class ToolInstaller {
  private static readonly OPENAPI_TOOL_NAME = "tfplugingen-openapi";
  private static readonly OPENAPI_TOOL_PACKAGE =
    "github.com/hashicorp/terraform-plugin-codegen-openapi/cmd/tfplugingen-openapi@latest";

  private static readonly FRAMEWORK_TOOL_NAME = "tfplugingen-framework";
  private static readonly FRAMEWORK_TOOL_PACKAGE =
    "github.com/hashicorp/terraform-plugin-codegen-framework/cmd/tfplugingen-framework@latest";

  public static async installTerraformPluginCodegenOpenAPI(): Promise<InstallResult> {
    try {
      // eslint-disable-next-line no-console
      console.log("🔧 Installing Terraform Plugin Codegen OpenAPI...");

      // Check if Go is installed
      if (!this.isGoInstalled()) {
        return {
          success: false,
          message: "Go is not installed. Please install Go first.",
        };
      }

      // Install the tool
      // eslint-disable-next-line no-console
      console.log(`📦 Running: go install ${this.OPENAPI_TOOL_PACKAGE}`);
      execSync(`go install ${this.OPENAPI_TOOL_PACKAGE}`, {
        stdio: "inherit",
        timeout: 300000, // 5 minutes timeout
      });

      // Verify installation
      const version: string | null = this.getToolVersion(
        this.OPENAPI_TOOL_NAME,
      );
      if (version) {
        // eslint-disable-next-line no-console
        console.log("✅ Installation successful!");
        return {
          success: true,
          message: `Successfully installed ${this.OPENAPI_TOOL_NAME}`,
          version: version,
        };
      }
      return {
        success: false,
        message: `Installation completed but ${this.OPENAPI_TOOL_NAME} is not available in PATH`,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Installation failed:", error);
      return {
        success: false,
        message: `Installation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  public static async installTerraformPluginFrameworkGenerator(): Promise<InstallResult> {
    try {
      // eslint-disable-next-line no-console
      console.log("🔧 Installing Terraform Plugin Framework Generator...");

      // Check if Go is installed
      if (!this.isGoInstalled()) {
        return {
          success: false,
          message: "Go is not installed. Please install Go first.",
        };
      }

      // Install the tool
      // eslint-disable-next-line no-console
      console.log(`📦 Running: go install ${this.FRAMEWORK_TOOL_PACKAGE}`);
      execSync(`go install ${this.FRAMEWORK_TOOL_PACKAGE}`, {
        stdio: "inherit",
        timeout: 300000, // 5 minutes timeout
      });

      // Verify installation
      const version: string | null = this.getToolVersion(
        this.FRAMEWORK_TOOL_NAME,
      );
      if (version) {
        // eslint-disable-next-line no-console
        console.log("✅ Framework Generator installation successful!");
        return {
          success: true,
          message: `Successfully installed ${this.FRAMEWORK_TOOL_NAME}`,
          version: version,
        };
      }
      return {
        success: false,
        message: `Installation completed but ${this.FRAMEWORK_TOOL_NAME} is not available in PATH`,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Framework Generator installation failed:", error);
      return {
        success: false,
        message: `Installation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private static isGoInstalled(): boolean {
    try {
      execSync("go version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  private static getToolVersion(toolName: string): string | null {
    try {
      execSync(`${toolName} --help`, {
        encoding: "utf8",
        stdio: "pipe",
      });
      // The tool might not have a --version flag, so we check if it's available
      return "latest";
    } catch {
      try {
        // Try to find the binary in GOPATH/bin or GOBIN
        const goPath: string = this.getGoPath();
        const binaryPath: string = path.join(goPath, "bin", toolName);
        if (fs.existsSync(binaryPath)) {
          return "latest";
        }
      } catch {
        // Ignore error
      }
      return null;
    }
  }

  private static getGoPath(): string {
    try {
      const goPath: string = execSync("go env GOPATH", {
        encoding: "utf8",
      }).trim();
      return goPath;
    } catch {
      // Default GOPATH
      const homeDir: string =
        process.env["HOME"] || process.env["USERPROFILE"] || "";
      return path.join(homeDir, "go");
    }
  }

  public static printInstallationInfo(): void {
    // eslint-disable-next-line no-console
    console.log("📋 Installation Information:");
    // eslint-disable-next-line no-console
    console.log(`   OpenAPI Tool: ${this.OPENAPI_TOOL_NAME}`);
    // eslint-disable-next-line no-console
    console.log(`   OpenAPI Package: ${this.OPENAPI_TOOL_PACKAGE}`);
    // eslint-disable-next-line no-console
    console.log(`   Framework Tool: ${this.FRAMEWORK_TOOL_NAME}`);
    // eslint-disable-next-line no-console
    console.log(`   Framework Package: ${this.FRAMEWORK_TOOL_PACKAGE}`);
    // eslint-disable-next-line no-console
    console.log("   Prerequisites: Go must be installed");
    // eslint-disable-next-line no-console
    console.log(
      "   Usage: Use different methods to install the specific tool needed",
    );
    // eslint-disable-next-line no-console
    console.log("");
  }
}

// Main execution
async function main(): Promise<void> {
  try {
    ToolInstaller.printInstallationInfo();

    const result: InstallResult =
      await ToolInstaller.installTerraformPluginCodegenOpenAPI();

    if (result.success) {
      // eslint-disable-next-line no-console
      console.log(`🎉 ${result.message}`);
      if (result.version) {
        // eslint-disable-next-line no-console
        console.log(`📌 Version: ${result.version}`);
      }

      // Print usage instructions
      // eslint-disable-next-line no-console
      console.log("");
      // eslint-disable-next-line no-console
      console.log("📖 Usage Instructions:");
      // eslint-disable-next-line no-console
      console.log(
        "   The tfplugingen-openapi tool is now available in your PATH",
      );
      // eslint-disable-next-line no-console
      console.log(
        "   You can use it to generate Terraform provider code from OpenAPI specs",
      );
      // eslint-disable-next-line no-console
      console.log("   Example: tfplugingen-openapi generate --help");
    } else {
      // eslint-disable-next-line no-console
      console.error(`💥 ${result.message}`);
      process.exit(1);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("🚨 Unexpected error:", error);
    process.exit(1);
  }
}

// Export for potential reuse
export { ToolInstaller, InstallResult };

// Run if this file is executed directly
if (require.main === module) {
  main();
}
