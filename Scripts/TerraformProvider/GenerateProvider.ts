import { generateOpenAPISpec } from '../OpenAPI/GenerateSpec';
import GeneratorConfig from './GeneratorConfig';
import path from 'path';
import { ToolInstaller } from './InstallTools';
import ProviderSpec from './ProviderSpec';

async function main() {
  // 1. Generate OpenAPI spec
  const openApiSpecPath = path.resolve(__dirname, '../../Terraform/openapi.json');
  await generateOpenAPISpec(openApiSpecPath);

  // 2. Generate Terraform provider generator config
  GeneratorConfig.generateGeneratorConfigAndWriteToFile({
    openApiSpecInJsonFilePath: openApiSpecPath,
    outputPath: path.resolve(__dirname, '../../Terraform'),
    outputFileName: 'terraform-provider-generator-config.yaml',
    providerName: 'oneuptime', // Change as needed
  });

  // 3. Install CLI tools. 
  await ToolInstaller.installTerraformPluginCodegenOpenAPI(); 

  // 4. Generate Terraform provider code
  ProviderSpec.generateTerraformProviderCode({
    generatorConfigPath: path.resolve(__dirname, '../../Terraform/terraform-provider-generator-config.yaml'),
    openApiSpecPath: path.resolve(__dirname, '../../Terraform/openapi.json'),
    outputPath: path.resolve(__dirname, '../../Terraform/terraform-provider-code'),
  });
}

main().catch((err) => {
  console.error('Error generating provider:', err);
  process.exit(1);
});
