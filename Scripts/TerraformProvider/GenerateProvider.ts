import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import { ToolInstaller } from "./InstallTools";
import FrameworkGenerator from "./FrameworkGenerator";
import SpecificationConverter from "./SpecificationConverter";
import path from "path";

async function main() {
  console.log("🚀 Starting Terraform Provider Generation Process...");

  try {
    // 1. Generate OpenAPI spec
    console.log("\n📄 Step 1: Generating OpenAPI specification...");
    const openApiSpecPath = path.resolve(
      __dirname,
      "../../Terraform/openapi.json",
    );
    await generateOpenAPISpec(openApiSpecPath);

    // 2. Convert OpenAPI spec to Provider Code Specification
    console.log("\n🔄 Step 2: Converting to Provider Code Specification...");
    const providerSpecPath = path.resolve(
      __dirname,
      "../../Terraform/provider-code-spec.json",
    );
    SpecificationConverter.convertOpenAPIToProviderSpec({
      openApiSpecPath: openApiSpecPath,
      outputPath: providerSpecPath,
      providerName: "oneuptime",
    });

    // 3. Install Framework Generator tool
    console.log(
      "\n🔧 Step 3: Installing Terraform Plugin Framework Generator...",
    );
    const frameworkInstallResult =
      await ToolInstaller.installTerraformPluginFrameworkGenerator();
    if (!frameworkInstallResult.success) {
      throw new Error(
        `Failed to install framework generator: ${frameworkInstallResult.message}`,
      );
    }
    console.log(`✅ ${frameworkInstallResult.message}`);

    // 4. Generate Terraform Provider Framework code
    console.log(
      "\n🏗️  Step 4: Generating Terraform Provider Framework code...",
    );
    const frameworkOutputPath = path.resolve(
      __dirname,
      "../../Terraform/terraform-provider-framework",
    );

    FrameworkGenerator.generateAll({
      specificationPath: providerSpecPath,
      outputPath: frameworkOutputPath,
      packageName: "oneuptime", // Optional: specify a package name
    });

    console.log("\n🎉 Provider generation completed successfully!");
    console.log("\n📋 Generated Files:");
    console.log(`   📄 OpenAPI Spec: ${openApiSpecPath}`);
    console.log(`   📄 Provider Code Spec: ${providerSpecPath}`);
    console.log(`   📁 Framework Provider Code: ${frameworkOutputPath}`);

    console.log("\n📖 Next Steps:");
    console.log("   1. Review the generated Provider Code Specification");
    console.log(
      "   2. Customize the specification as needed for your use case",
    );
    console.log(
      "   3. Use the Framework Generator to regenerate code after modifications",
    );
    console.log(
      "   4. Implement the actual provider logic in the generated Go files",
    );

    FrameworkGenerator.printUsageInfo();
  } catch (error) {
    console.error("\n❌ Error during provider generation:", error);
    console.error("\n🔍 Troubleshooting Tips:");
    console.error("   - Ensure Go is installed and properly configured");
    console.error("   - Check that GOPATH is set correctly");
    console.error("   - Verify internet connectivity for downloading tools");
    console.error(
      "   - Make sure you have write permissions in the output directories",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("💥 Unexpected error:", err);
  process.exit(1);
});
