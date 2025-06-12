import { generateOpenAPISpec } from '../OpenAPI/GenerateSpec';
import GeneratorConfig from './GeneratorConfig';
import path from 'path';

async function main() {
  // 1. Generate OpenAPI spec
  const openApiSpecPath = path.resolve(__dirname, '../../openapi.json');
  await generateOpenAPISpec(openApiSpecPath);

  // 2. Generate Terraform provider generator config
  GeneratorConfig.generateGeneratorConfigAndWriteToFile({
    openApiSpecInJsonFilePath: openApiSpecPath,
    outputPath: path.resolve(__dirname, '../../Terraform'),
    outputFileName: 'terraform-provider-generator-config.yaml',
    providerName: 'oneuptime', // Change as needed
  });

  console.log('OpenAPI spec and Terraform provider generator config generated successfully.');

  
}

main().catch((err) => {
  console.error('Error generating provider:', err);
  process.exit(1);
});
