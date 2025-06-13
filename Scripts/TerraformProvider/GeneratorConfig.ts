import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

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
    openApiSpecInJsonFilePath: string;
    outputPath: string;
    outputFileName: string;
    providerName: string;
  }): void {
    // Read the OpenAPI spec JSON file
    const openApiSpec: any = JSON.parse(
      fs.readFileSync(data.openApiSpecInJsonFilePath, "utf-8"),
    );
    const config: any = {
      provider: {
        name: data.providerName,
      },
      resources: {},
      data_sources: {},
    };

    // Parse OpenAPI paths to generate resources and data sources
    if (openApiSpec.paths) {
      for (const [pathKey, pathObj] of Object.entries(openApiSpec.paths)) {
        for (const [method, opRaw] of Object.entries(pathObj as any)) {
          const op: any = opRaw as any;
          if (
            !op ||
            typeof op !== "object" ||
            typeof op.operationId !== "string"
          ) {
            continue;
          }

          const operationId: string = op.operationId.toLowerCase();
          const isReadOperation: boolean =
            operationId.startsWith("get") ||
            operationId.startsWith("list") ||
            operationId.startsWith("count") ||
            operationId.includes("read") ||
            operationId.includes("fetch");
          const isCreateOperation: boolean =
            operationId.startsWith("create") ||
            operationId.startsWith("add") ||
            method.toLowerCase() === "post";
          const isUpdateOperation: boolean =
            operationId.startsWith("update") ||
            operationId.startsWith("put") ||
            method.toLowerCase() === "put";
          const isDeleteOperation: boolean =
            operationId.startsWith("delete") || operationId.includes("remove");

          if (isReadOperation) {
            // Generate data source for read operations
            const dsName: string =
              this.extractResourceNameFromPath(pathKey).toLowerCase();
            if (dsName) {
              if (!config.data_sources[dsName]) {
                config.data_sources[dsName] = {};
              }
              config.data_sources[dsName]["read"] = {
                path: pathKey,
                method: method.toUpperCase(),
              };
            }

            // Also add as resource read operation
            const resourceName: string =
              this.extractResourceNameFromPath(pathKey).toLowerCase();
            if (resourceName) {
              if (!config.resources[resourceName]) {
                config.resources[resourceName] = {};
              }
              config.resources[resourceName]["read"] = {
                path: pathKey,
                method: method.toUpperCase(),
              };
            }
          } else if (isCreateOperation) {
            // Generate resource for create operations
            const resourceName: string =
              this.extractResourceNameFromPath(pathKey).toLowerCase();
            if (resourceName) {
              if (!config.resources[resourceName]) {
                config.resources[resourceName] = {};
              }
              config.resources[resourceName]["create"] = {
                path: pathKey,
                method: method.toUpperCase(),
              };
            }
          } else if (isUpdateOperation) {
            // Generate resource for update operations
            const resourceName: string =
              this.extractResourceNameFromPath(pathKey).toLowerCase();
            if (resourceName) {
              if (!config.resources[resourceName]) {
                config.resources[resourceName] = {};
              }
              config.resources[resourceName]["update"] = {
                path: pathKey,
                method: method.toUpperCase(),
              };
            }
          } else if (isDeleteOperation) {
            // Handle delete operations
            const resourceName: string =
              this.extractResourceNameFromPath(pathKey).toLowerCase();
            if (resourceName) {
              if (!config.resources[resourceName]) {
                config.resources[resourceName] = {};
              }
              config.resources[resourceName]["delete"] = {
                path: pathKey,
                method: method.toUpperCase(),
              };
            }
          }
        }
      }
    }

    // Ensure every resource has both 'create' and 'read' operations
    // Remove resources that don't have the required operations
    const resourcesToRemove: string[] = [];

    for (const [resourceName, resourceConfig] of Object.entries(
      config.resources,
    )) {
      const resource: any = resourceConfig as any;

      // If resource doesn't have 'create', try to use 'post' operation
      if (!resource.create && resource.post) {
        resource.create = resource.post;
        delete resource.post;
      }

      // If resource doesn't have 'read', try to find it in data sources
      if (!resource.read) {
        const matchingDataSource: any = config.data_sources[resourceName];
        if (matchingDataSource && matchingDataSource.read) {
          resource.read = matchingDataSource.read;
        }
      }

      // If resource still doesn't have both 'create' and 'read', remove it
      if (!resource.create || !resource.read) {
        // eslint-disable-next-line no-console
        console.log(
          `Removing resource '${resourceName}' - missing required operations (create: ${Boolean(resource.create)}, read: ${Boolean(resource.read)})`,
        );
        resourcesToRemove.push(resourceName);
      }
    }

    // Remove invalid resources
    for (const resourceName of resourcesToRemove) {
      delete config.resources[resourceName];
    }

    // Remove empty objects
    if (Object.keys(config.resources).length === 0) {
      delete config.resources;
    }
    if (Object.keys(config.data_sources).length === 0) {
      delete config.data_sources;
    }

    // Convert the config object to YAML
    const yamlStr: string = yaml.dump(config, { noRefs: true, lineWidth: 120 });

    // Ensure output directory exists
    if (!fs.existsSync(data.outputPath)) {
      fs.mkdirSync(data.outputPath, { recursive: true });
    }

    // Write the YAML string to the output file
    const outputFile: string = path.join(data.outputPath, data.outputFileName);
    fs.writeFileSync(outputFile, yamlStr, "utf-8");
  }

  /**
   * Extract resource name from API path.
   * Converts paths like "/alert-custom-field" to "alertcustomfield"
   * and "/alert-custom-field/{id}" to "alertcustomfield"
   */
  private static extractResourceNameFromPath(path: string): string {
    // Remove leading slash and anything after the first parameter
    const pathParts: string[] = path.replace(/^\//, "").split("/");
    let resourcePath: string = pathParts[0] || "";

    // Handle paths that end with specific patterns like /count, /get-list, etc.
    if (resourcePath.includes("-count") || resourcePath.includes("-get-list")) {
      resourcePath = resourcePath.replace(/-count$|-get-list$/, "");
    }

    // Convert kebab-case to snake_case and remove special characters
    const resourceName: string = resourcePath
      .replace(/-/g, "") // Remove hyphens
      .replace(/[^a-zA-Z0-9]/g, "") // Remove any other special characters
      .toLowerCase();

    return resourceName;
  }
}
