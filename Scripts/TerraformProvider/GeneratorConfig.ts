import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export default class GeneratorConfig {

    /**
     * Generates a generator config for the Terraform provider and writes it to a file.
     * @param data - The data required to generate the config.
     * @param data.openApiSpecInJsonFilePath - The OpenAPI specification in JSON format.
     * @param data.outputPath - The path where the output file will be written.
     * @param data.outputFileName - The name of the output file.
     * @param data.providerName - The name of the Terraform provider.
     *
     * This implementation generates a minimal valid generator config for the OpenAPI provider spec generator.
     * You can extend this to add resources, data_sources, and schema options as needed.
     */

    public static generateGeneratorConfigAndWriteToFile(data: {
        openApiSpecInJsonFilePath: string,
        outputPath: string,
        outputFileName: string,
        providerName: string,
    }): void {
        // Read the OpenAPI spec JSON file
        const openApiSpec = JSON.parse(fs.readFileSync(data.openApiSpecInJsonFilePath, 'utf-8'));
        const config: any = {
            provider: {
                name: data.providerName
            },
            resources: {},
            data_sources: {}
        };

        // Parse OpenAPI paths to generate resources and data sources
        if (openApiSpec.paths) {
            for (const [pathKey, pathObj] of Object.entries(openApiSpec.paths)) {
                for (const [method, opRaw] of Object.entries(pathObj as any)) {
                    const op = opRaw as any;
                    if (!op || typeof op !== 'object' || typeof op.operationId !== 'string') continue;
                    // Heuristic: POST/PUT = resource, GET = data source
                    if (method.toLowerCase() === 'post' || method.toLowerCase() === 'put') {
                        // Use operationId or path as resource name
                        const resourceName = (op.operationId.replace(/^(create|put|add)/i, '').toLowerCase() || pathKey.replace(/[\/{\}]/g, '').replace(/\//g, '_')).replace(/^_+|_+$/g, '');
                        if (!config.resources[resourceName]) config.resources[resourceName] = {};
                        config.resources[resourceName][method.toLowerCase()] = { path: pathKey, method: method.toUpperCase() };
                    } else if (method.toLowerCase() === 'get') {
                        const dsName = (op.operationId.replace(/^get/i, '').toLowerCase() || pathKey.replace(/[\/{\}]/g, '').replace(/\//g, '_')).replace(/^_+|_+$/g, '');
                        if (!config.data_sources[dsName]) config.data_sources[dsName] = {};
                        config.data_sources[dsName]['read'] = { path: pathKey, method: 'GET' };
                    } else if (method.toLowerCase() === 'delete') {
                        // Attach delete to resource if exists
                        for (const resName in config.resources) {
                            if (pathKey.includes(resName)) {
                                config.resources[resName]['delete'] = { path: pathKey, method: 'DELETE' };
                            }
                        }
                    }
                }
            }
        }

        // Remove empty objects
        if (Object.keys(config.resources).length === 0) delete config.resources;
        if (Object.keys(config.data_sources).length === 0) delete config.data_sources;

        // Convert the config object to YAML
        const yamlStr = yaml.dump(config, { noRefs: true, lineWidth: 120 });

        // Ensure output directory exists
        if (!fs.existsSync(data.outputPath)) {
            fs.mkdirSync(data.outputPath, { recursive: true });
        }

        // Write the YAML string to the output file
        const outputFile = path.join(data.outputPath, data.outputFileName);
        fs.writeFileSync(outputFile, yamlStr, 'utf-8');
    }
}




