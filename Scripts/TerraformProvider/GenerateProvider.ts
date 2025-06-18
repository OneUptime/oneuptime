import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import { ToolInstaller } from "./InstallTools";
import FrameworkGenerator from "./FrameworkGenerator";
import SpecificationConverter from "./SpecificationConverter";
import path from "path";

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("🚀 Starting Terraform Provider Generation Process...");

  try {
    // 1. Generate OpenAPI spec
    // eslint-disable-next-line no-console
    console.log("\n📄 Step 1: Generating OpenAPI specification...");
    const openApiSpecPath: string = path.resolve(
      __dirname,
      "../../Terraform/openapi.json",
    );
    
    await generateOpenAPISpec(openApiSpecPath);

    // 2. Convert OpenAPI spec to Provider Code Specification
    // eslint-disable-next-line no-console
    console.log("\n🔄 Step 2: Converting to Provider Code Specification...");
    const providerSpecPath: string = path.resolve(
      __dirname,
      "../../Terraform/provider-code-spec.json",
    );
    SpecificationConverter.convertOpenAPIToProviderSpec({
      openApiSpecPath: openApiSpecPath,
      outputPath: providerSpecPath,
      providerName: "oneuptime",
    });

    // 3. Install Framework Generator tool
    // eslint-disable-next-line no-console
    console.log(
      "\n🔧 Step 3: Installing Terraform Plugin Framework Generator...",
    );
    const frameworkInstallResult: any =
      await ToolInstaller.installTerraformPluginFrameworkGenerator();
    if (!frameworkInstallResult.success) {
      throw new Error(
        `Failed to install framework generator: ${frameworkInstallResult.message}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`✅ ${frameworkInstallResult.message}`);

    // 4. Generate Terraform Provider Framework code
    // eslint-disable-next-line no-console
    console.log(
      "\n🏗️  Step 4: Generating Terraform Provider Framework code...",
    );
    const frameworkOutputPath: string = path.resolve(
      __dirname,
      "../../Terraform/terraform-provider-framework",
    );

    FrameworkGenerator.generateAll({
      specificationPath: providerSpecPath,
      outputPath: frameworkOutputPath,
      packageName: "oneuptime", // Use oneuptime package for generated files
    });

    // scaffolding the framework output directory
    FrameworkGenerator.scaffold({
      type: "provider",
      name: "oneuptime",
      outputDir: frameworkOutputPath,
      packageName: "oneuptime",
      force: true, // Force overwrite existing files
    })

    // 5. Setup Go module and build configuration
    // eslint-disable-next-line no-console
    console.log("\n🔧 Step 5: Setting up Go module and building provider...");

    // eslint-disable-next-line no-console
    console.log("\n🎉 Provider generation and build completed successfully!");
    // eslint-disable-next-line no-console
    console.log("\n📋 Generated Files:");
    // eslint-disable-next-line no-console
    console.log(`   📄 OpenAPI Spec: ${openApiSpecPath}`);
    // eslint-disable-next-line no-console
    console.log(`   📄 Provider Code Spec: ${providerSpecPath}`);
    // eslint-disable-next-line no-console
    console.log(`   📁 Framework Provider Code: ${frameworkOutputPath}`);
    // eslint-disable-next-line no-console
    console.log(`   🔧 Go Module & Build Files: ${frameworkOutputPath}`);
    // eslint-disable-next-line no-console
    console.log(`   🏗️  Multi-platform Builds: ${frameworkOutputPath}/builds`);

    // eslint-disable-next-line no-console
    console.log("\n📖 Next Steps:");
    // eslint-disable-next-line no-console
    console.log("   1. Review the generated Provider Code Specification");
    // eslint-disable-next-line no-console
    console.log(
      "   2. Customize the specification as needed for your use case",
    );
    // eslint-disable-next-line no-console
    console.log(
      "   3. Use the Framework Generator to regenerate code after modifications",
    );
    // eslint-disable-next-line no-console
    console.log(
      "   4. Implement the actual provider logic in the generated Go files",
    );
    // eslint-disable-next-line no-console
    console.log(
      "   5. Run tests and publish using the Scripts/TerraformProvider/publish-terraform-provider.sh script",
    );

    FrameworkGenerator.printUsageInfo();
  } catch (error) {
    const err: Error = error as Error;
    // eslint-disable-next-line no-console
    console.error("\n❌ Error during provider generation:", err);
    // eslint-disable-next-line no-console
    console.error("\n🔍 Troubleshooting Tips:");
    // eslint-disable-next-line no-console
    console.error("   - Ensure Go is installed and properly configured");
    // eslint-disable-next-line no-console
    console.error("   - Check that GOPATH is set correctly");
    // eslint-disable-next-line no-console
    console.error("   - Verify internet connectivity for downloading tools");
    // eslint-disable-next-line no-console
    console.error(
      "   - Make sure you have write permissions in the output directories",
    );
    process.exit(1);
  }
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error("💥 Unexpected error:", err);
  process.exit(1);
});
