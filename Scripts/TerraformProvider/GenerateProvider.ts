import { generateOpenAPISpec } from '../OpenAPI/GenerateSpec';
import GeneratorConfig from './GeneratorConfig';
import path from 'path';
import { ToolInstaller } from './InstallTools';
import { execSync } from 'child_process';

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

  // 4. Genertae Terraform provider code
  // tfplugingen-openapi generate \
  // --config <path/to/generator_config.yml> \
  // --output <output/for/provider_code_spec.json> \
  // <path/to/openapi_spec.json>

  // Get the Go path and construct the full path to the tfplugingen-openapi binary
  const goPath = execSync('go env GOPATH', { encoding: 'utf8' }).trim();
  const tfplugigenBinaryPath = path.join(goPath, 'bin', 'tfplugingen-openapi');

  const generatorConfigPath = path.resolve(__dirname, '../../Terraform/terraform-provider-generator-config.yaml');
  const outputPath = path.resolve(__dirname, '../../Terraform/terraform-provider-code');
  const openApiSpecPathForCodegen = path.resolve(__dirname, '../../Terraform/openapi.json');
  const command = `"${tfplugigenBinaryPath}" generate --config "${generatorConfigPath}" --output "${outputPath}" "${openApiSpecPathForCodegen}"`;

  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error('Error executing Terraform provider code generation command:', error);
    throw new Error(`Failed to generate Terraform provider code: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log('Terraform provider code generated successfully at:', outputPath);
}

main().catch((err) => {
  console.error('Error generating provider:', err);
  process.exit(1);
});
