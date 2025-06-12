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
                    
                    const operationId = op.operationId.toLowerCase();
                    const isReadOperation = operationId.startsWith('get') || operationId.startsWith('list') || operationId.startsWith('count') || operationId.includes('read') || operationId.includes('fetch');
                    const isWriteOperation = operationId.startsWith('create') || operationId.startsWith('add') || operationId.startsWith('update') || operationId.startsWith('put') || operationId.includes('save');
                    const isDeleteOperation = operationId.startsWith('delete') || operationId.includes('remove');

                    if (isReadOperation) {
                        // Generate data source for read operations
                        const dsName = operationId.replace(/^(get|list|count|read|fetch)/i, '').toLowerCase() || pathKey.replace(/[\/{\}]/g, '').replace(/\//g, '_');
                        const cleanDsName = dsName.replace(/^_+|_+$/g, '');
                        if (cleanDsName) {
                            if (!config.data_sources[cleanDsName]) config.data_sources[cleanDsName] = {};
                            config.data_sources[cleanDsName]['read'] = { path: pathKey, method: method.toUpperCase() };
                        }
                    } else if (isWriteOperation || (!isReadOperation && !isDeleteOperation)) {
                        // Generate resource for write operations (create, update) or other operations
                        const resourceName = operationId.replace(/^(create|put|add|update)/i, '').toLowerCase() || pathKey.replace(/[\/{\}]/g, '').replace(/\//g, '_');
                        const cleanResourceName = resourceName.replace(/^_+|_+$/g, '');
                        if (cleanResourceName) {
                            if (!config.resources[cleanResourceName]) config.resources[cleanResourceName] = {};
                            const operationType = isWriteOperation && operationId.includes('update') ? 'put' : method.toLowerCase();
                            config.resources[cleanResourceName][operationType] = { path: pathKey, method: method.toUpperCase() };
                        }
                    } else if (isDeleteOperation) {
                        // Handle delete operations - try to attach to existing resources or create new ones
                        const resourceName = operationId.replace(/^(delete|remove)/i, '').toLowerCase() || pathKey.replace(/[\/{\}]/g, '').replace(/\//g, '_');
                        const cleanResourceName = resourceName.replace(/^_+|_+$/g, '');
                        if (cleanResourceName) {
                            if (!config.resources[cleanResourceName]) config.resources[cleanResourceName] = {};
                            config.resources[cleanResourceName]['delete'] = { path: pathKey, method: method.toUpperCase() };
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




