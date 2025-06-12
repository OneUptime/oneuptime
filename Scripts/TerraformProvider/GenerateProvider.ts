import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import Logger from "Common/Server/Utils/Logger";
import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";

interface GeneratorConfig {
  version: string;
  generator: string;
  output_dir: string;
  package_name: string;
  provider_name: string;
}

interface ResourceConfig {
  name: string;
  description?: string;
  schema?: Record<string, any>;
  operations: {
    read?: string | undefined;
    create?: string | undefined;
    update?: string | undefined;
    delete?: string | undefined;
    list?: string | undefined;
  };
}

interface DataSourceConfig {
  name: string;
  description?: string;
  schema?: Record<string, any>;
  operations: {
    read: string;
  };
}

async function generateTerraformProvider(): Promise<void> {
  await generateOpenAPISpec();

  const openApiSpecPath: string = "./openapi.json";
  const outputDir: string = "./Terraform";
  const configPath = path.join(outputDir, "generator-config.yaml");

  try {
    // Check if OpenAPI spec exists
    if (!fs.existsSync(openApiSpecPath)) {
      throw new Error(
        "OpenAPI specification file not found. Please run 'npm run generate-openapi-spec' first.",
      );
    }

    Logger.info("🔍 Found OpenAPI specification");

    // Read OpenAPI spec to get version info
    const specContent: string = fs.readFileSync(openApiSpecPath, "utf8");
    const spec: any = JSON.parse(specContent);
    const apiVersion: string = spec.info?.version || "1.0.0";
    const apiTitle: string = spec.info?.title || "OneUptime API";

    Logger.info(`📋 API Title: ${apiTitle}`);
    Logger.info(`🏷️ API Version: ${apiVersion}`);

    // Clean up existing output directory
    if (fs.existsSync(outputDir)) {
      Logger.info("🧹 Cleaning up existing provider directory");
      fs.rmSync(outputDir, { recursive: true, force: true });
    }

    // Create generator configuration
    const generatorConfig: GeneratorConfig = {
      version: "1.0",
      generator: "terraform-provider",
      output_dir: outputDir,
      package_name: "github.com/oneuptime/terraform",
      provider_name: "oneuptime",
    };

    // Extract resources and data sources from OpenAPI spec
    const { resources, dataSources } = extractResourcesAndDataSources(spec);
    Logger.info(`Found ${resources.length} resources and ${dataSources.length} data sources`);

    // Create generator configuration with resources and datasources
    const generatorConfigYaml: string = generateProviderConfigYAML(generatorConfig, apiVersion, resources, dataSources);

    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(configPath, generatorConfigYaml, "utf8");
    Logger.info("⚙️ Generator configuration created with resources and datasources");

    // Install terraform-plugin-codegen-openapi if not present
    Logger.info("📦 Installing terraform-plugin-codegen-openapi...");
    const goPath: string = execSync("go env GOPATH", {
      encoding: "utf8",
    }).trim();
    const tfplugigenPath: string = path.join(
      goPath,
      "bin",
      "tfplugingen-openapi",
    );

    try {
      if (!fs.existsSync(tfplugigenPath)) {
        throw new Error("tfplugigen-openapi not found");
      }
      Logger.info("✅ terraform-plugin-codegen-openapi already installed");
    } catch {
      Logger.info("📥 Installing terraform-plugin-codegen-openapi...");
      execSync(
        "go install github.com/hashicorp/terraform-plugin-codegen-openapi/cmd/tfplugingen-openapi@latest",
        {
          stdio: "inherit",
        },
      );
    }

    // Generate Terraform provider
    Logger.info("🏗️ Generating Terraform provider...");
    const generateCommand: string = `"${tfplugigenPath}" generate --config ${configPath} --output ${outputDir} ${openApiSpecPath}`;

    try {
      execSync(generateCommand, { stdio: "inherit" });
      Logger.info("✅ Terraform provider generated successfully");
    } catch {
      Logger.error("❌ Provider generation failed with tfplugingen-openapi");
      Logger.info(
        "🔄 Trying alternative approach with direct Go generation...",
      );

      // Fallback: Create a basic provider structure manually
      await createBasicProviderStructure(outputDir, generatorConfig, spec, resources, dataSources);
    }

    // Validate generation
    await validateProviderGeneration(outputDir);

    // Create go.mod if it doesn't exist
    await ensureGoModule(outputDir, generatorConfig);

    // Create provider documentation
    await createProviderDocumentation(outputDir, spec, resources, dataSources);

    // Clean up temporary config
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    Logger.info("🎉 Terraform provider generation completed!");
    Logger.info(`📁 Provider location: ${outputDir}`);
  } catch (error: any) {
    Logger.error("❌ Error generating Terraform provider:");
    Logger.error(error.message || error);
    process.exit(1);
  }
}

function extractResourcesAndDataSources(spec: any): { resources: ResourceConfig[], dataSources: DataSourceConfig[] } {
  Logger.info("🔍 Extracting resources and data sources from OpenAPI spec");
  const resources: ResourceConfig[] = [];
  const dataSources: DataSourceConfig[] = [];

  // Process each path and method in the OpenAPI spec
  for (const [path, pathItem] of Object.entries<any>(spec.paths || {})) {
    // Skip if it's not an object
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    // First, identify potential resources and data sources
    let resourceName = generateResourceName(path);
    
    // Handle GET paths as data sources
    if (pathItem.get) {
      const operation = pathItem.get;
      const isList = path.endsWith('s') && !path.includes('{'); // Simple heuristic to detect list endpoints
      
      // For list endpoints, we create a data source
      if (isList) {
        const dataSourceName = `${resourceName}_list`;
        const description = operation.summary || operation.description || `List ${resourceName}`;
        
        dataSources.push({
          name: dataSourceName,
          description,
          schema: extractSchema(operation.responses?.['200']?.content?.['application/json']?.schema),
          operations: {
            read: path
          }
        });
      } 
      // For get by ID endpoints, we create a data source
      else if (path.includes('{')) {
        const dataSourceName = resourceName;
        const description = operation.summary || operation.description || `Get ${resourceName}`;
        
        dataSources.push({
          name: dataSourceName,
          description,
          schema: extractSchema(operation.responses?.['200']?.content?.['application/json']?.schema),
          operations: {
            read: path
          }
        });
      }
    }
    
    // If we have a combination of POST/PUT/PATCH/DELETE, it's likely a resource
    const hasCreate = !!pathItem.post;
    const hasUpdate = !!pathItem.put || !!pathItem.patch;
    const hasDelete = !!pathItem.delete;
    
    if (hasCreate || hasUpdate || hasDelete) {
      let requestSchema = null;
      
      // Use request schema from POST for create
      if (hasCreate) {
        requestSchema = extractSchema(pathItem.post?.requestBody?.content?.['application/json']?.schema);
      } 
      // Fallback to PUT or PATCH for update
      else if (hasUpdate) {
        requestSchema = extractSchema(
          pathItem.put?.requestBody?.content?.['application/json']?.schema ||
          pathItem.patch?.requestBody?.content?.['application/json']?.schema
        );
      }
      
      let responseSchema = null;
      
      // Get response schema from POST, PUT, PATCH, or GET
      const getOperation = pathItem.get;
      const postOperation = pathItem.post;
      const putOperation = pathItem.put;
      const patchOperation = pathItem.patch;
      
      if (postOperation) {
        responseSchema = extractSchema(postOperation.responses?.['200']?.content?.['application/json']?.schema) ||
                        extractSchema(postOperation.responses?.['201']?.content?.['application/json']?.schema);
      } else if (putOperation) {
        responseSchema = extractSchema(putOperation.responses?.['200']?.content?.['application/json']?.schema);
      } else if (patchOperation) {
        responseSchema = extractSchema(patchOperation.responses?.['200']?.content?.['application/json']?.schema);
      } else if (getOperation) {
        responseSchema = extractSchema(getOperation.responses?.['200']?.content?.['application/json']?.schema);
      }
      
      // Combine request and response schemas to create the full resource schema
      const combinedSchema = { ...requestSchema, ...responseSchema };
      
      // Only add as resource if we have meaningful operations
      if (Object.keys(combinedSchema).length > 0) {
        const description = (pathItem.post?.summary || pathItem.put?.summary || pathItem.patch?.summary || 
                            pathItem.delete?.summary || `Manage ${resourceName}`);
        
        resources.push({
          name: resourceName,
          description,
          schema: combinedSchema,
          operations: {
            create: hasCreate ? path : undefined,
            read: getOperation ? path : undefined,
            update: hasUpdate ? path : undefined,
            delete: hasDelete ? path : undefined,
            list: undefined
          }
        });
      }
    }
  }

  return { resources, dataSources };
}

function generateResourceName(path: string): string {
  // Strip the version prefix and leading/trailing slashes
  let cleanPath = path.replace(/^\/api\/v\d+\//, '').replace(/^\/|\/$/g, '');
  
  // Replace path parameters with underscores
  cleanPath = cleanPath.replace(/\/{([^}]+)}/g, '_by_$1');
  
  // Replace slashes with underscores
  cleanPath = cleanPath.replace(/\//g, '_');
  
  // Remove any plural forms to get singular resource name
  if (cleanPath.endsWith('s') && !cleanPath.endsWith('ss')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  
  // Special handling for nested resources
  if (cleanPath.includes('_')) {
    const parts = cleanPath.split('_');
    // If we have a nested resource or sub-resource
    if (parts.length > 2) {
      // Try to identify the main resource
      return parts.join('_');
    }
  }
  
  return cleanPath;
}

function extractSchema(schema: any): Record<string, any> {
  if (!schema) {
    return {};
  }
  
  // Handle references
  if (schema.$ref) {
    // Extract just the type name from the reference
    const refName = schema.$ref.split('/').pop();
    return { type: 'object', ref_name: refName };
  }
  
  // Handle arrays
  if (schema.type === 'array' && schema.items) {
    return {
      type: mapOpenAPITypeToTerraform('array'),
      items: extractSchema(schema.items)
    };
  }
  
  // Handle objects
  if (schema.type === 'object' || schema.properties) {
    const properties: Record<string, any> = {};
    
    for (const [propName, propSchema] of Object.entries<any>(schema.properties || {})) {
      properties[propName] = extractSchema(propSchema);
    }
    
    return {
      type: mapOpenAPITypeToTerraform('object'),
      properties
    };
  }
  
  // Handle primitive types
  if (schema.type) {
    return { 
      type: mapOpenAPITypeToTerraform(schema.type),
      description: schema.description || '',
      required: schema.required || false,
      computed: schema.readOnly || false
    };
  }
  
  return {};
}

function generateProviderConfigYAML(
  config: GeneratorConfig, 
  apiVersion: string, 
  resources: ResourceConfig[],
  dataSources: DataSourceConfig[]
): string {
  const yaml = [
    `version: "${config.version}"`,
    `generator: "${config.generator}"`,
    `output_dir: "${config.output_dir}"`,
    `package_name: "${config.package_name}"`,
    `provider_name: "${config.provider_name}"`,
    '',
    'provider:',
    `  name: "oneuptime"`,
    `  version: "${apiVersion}"`,
    '',
    'settings:',
    '  go_package_name: "oneuptime"',
    '  generate_docs: true',
    '  generate_examples: true',
    '  schema_generation: true',
    ''
  ];
  
  // Add resources
  if (resources.length > 0) {
    yaml.push('resources:');
    for (const resource of resources) {
      yaml.push(`  - name: "${resource.name}"`);
      
      if (resource.description) {
        yaml.push(`    description: "${resource.description}"`);
      }
      
      // Add operations
      yaml.push('    operations:');
      if (resource.operations.create) {
        yaml.push(`      create: "${resource.operations.create}"`);
      }
      if (resource.operations.read) {
        yaml.push(`      read: "${resource.operations.read}"`);
      }
      if (resource.operations.update) {
        yaml.push(`      update: "${resource.operations.update}"`);
      }
      if (resource.operations.delete) {
        yaml.push(`      delete: "${resource.operations.delete}"`);
      }
      if (resource.operations.list) {
        yaml.push(`      list: "${resource.operations.list}"`);
      }
      
      // Add schema if available
      if (resource.schema && Object.keys(resource.schema).length > 0) {
        yaml.push('    schema:');
        yaml.push('      attributes:');
        
        for (const [attrName, attrSchema] of Object.entries<any>(resource.schema)) {
          if (!attrName.startsWith('_') && attrName !== 'id') { // Skip internal properties
            yaml.push(`        ${attrName}:`);
            
            if (attrSchema.type) {
              yaml.push(`          type: "${attrSchema.type}"`);
            }
            
            if (attrSchema.description) {
              yaml.push(`          description: "${attrSchema.description}"`);
            }
            
            if (attrSchema.computed) {
              yaml.push(`          computed: true`);
            }
            
            if (attrSchema.required) {
              yaml.push(`          required: true`);
            }
          }
        }
      }
    }
    yaml.push('');
  }
  
  // Add data sources
  if (dataSources.length > 0) {
    yaml.push('datasources:');
    for (const dataSource of dataSources) {
      yaml.push(`  - name: "${dataSource.name}"`);
      
      if (dataSource.description) {
        yaml.push(`    description: "${dataSource.description}"`);
      }
      
      // Add operations
      yaml.push('    operations:');
      yaml.push(`      read: "${dataSource.operations.read}"`);
      
      // Add schema if available
      if (dataSource.schema && Object.keys(dataSource.schema).length > 0) {
        yaml.push('    schema:');
        yaml.push('      attributes:');
        
        for (const [attrName, attrSchema] of Object.entries<any>(dataSource.schema)) {
          if (!attrName.startsWith('_') && attrName !== 'id') { // Skip internal properties
            yaml.push(`        ${attrName}:`);
            
            if (attrSchema.type) {
              yaml.push(`          type: "${attrSchema.type}"`);
            }
            
            if (attrSchema.description) {
              yaml.push(`          description: "${attrSchema.description}"`);
            }
            
            yaml.push(`          computed: true`);
          }
        }
      }
    }
  }
  
  return yaml.join('\n');
}

async function createBasicProviderStructure(
  outputDir: string,
  config: GeneratorConfig,
  spec: any,
  resources: ResourceConfig[],
  dataSources: DataSourceConfig[]
): Promise<void> {
  Logger.info("🔨 Creating basic provider structure...");

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Extract API info from spec
  const apiVersion: string = spec?.info?.version || "dev";

  // Create main.go using config information
  const mainGoContent: string = `package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"${config.package_name}/internal/provider"
)

var (
	version string = "${apiVersion}"
)

func main() {
	var debug bool

	flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers like delve")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "registry.terraform.io/${config.provider_name}/${config.provider_name}",
		Debug:   debug,
	}

	err := providerserver.Serve(context.Background(), provider.New(version), opts)

	if err != nil {
		log.Fatal(err.Error())
	}
}
`;

  fs.writeFileSync(path.join(outputDir, "main.go"), mainGoContent);

  // Create internal/provider directory
  const providerDir: string = path.join(outputDir, "internal", "provider");
  fs.mkdirSync(providerDir, { recursive: true });

  // Create provider.go using config and spec information
  const providerName: string = config.provider_name;
  const providerDisplayName: string = (
    spec?.info?.title || "OneUptime"
  ).replace(/[^a-zA-Z0-9]/g, ""); // Remove spaces and special chars for Go struct names
  const providerGoContent: string = `package provider

import (
	"context"
	"net/http"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ provider.Provider = &${providerDisplayName}Provider{}

type ${providerDisplayName}Provider struct {
	version string
}

type ${providerDisplayName}ProviderModel struct {
	ApiKey  types.String \`tfsdk:"api_key"\`
	BaseUrl types.String \`tfsdk:"base_url"\`
}

func (p *${providerDisplayName}Provider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "${providerName}"
	resp.Version = p.version
}

func (p *${providerDisplayName}Provider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"api_key": schema.StringAttribute{
				MarkdownDescription: "${providerDisplayName} API Key",
				Optional:            true,
				Sensitive:           true,
			},
			"base_url": schema.StringAttribute{
				MarkdownDescription: "${providerDisplayName} API Base URL",
				Optional:            true,
			},
		},
	}
}

func (p *${providerDisplayName}Provider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var data ${providerDisplayName}ProviderModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Configuration values are now available.
	if data.ApiKey.IsUnknown() {
		resp.Diagnostics.AddAttributeError(
			path.Root("api_key"),
			"Unknown ${providerDisplayName} API Key",
			"The provider cannot create the ${providerDisplayName} API client as there is an unknown configuration value for the ${providerDisplayName} API key. "+
				"Either target apply the source of the value first, set the value statically in the configuration, or use the ${providerName.toUpperCase()}_API_KEY environment variable.",
		)
	}

	if resp.Diagnostics.HasError() {
		return
	}

	// Default values to environment variables, but override
	// with Terraform configuration value if set.

	apiKey := os.Getenv("${providerName.toUpperCase()}_API_KEY")
	baseUrl := "${spec?.servers?.[0]?.url || "https://oneuptime.com/api"}"

	if !data.ApiKey.IsNull() {
		apiKey = data.ApiKey.ValueString()
	}

	if !data.BaseUrl.IsNull() {
		baseUrl = data.BaseUrl.ValueString()
	}

	// If any of the expected configurations are missing, return
	// errors with provider-specific guidance.

	if apiKey == "" {
		resp.Diagnostics.AddAttributeError(
			path.Root("api_key"),
			"Missing ${providerDisplayName} API Key",
			"The provider requires a ${providerDisplayName} API key. Set the api_key attribute in the provider configuration or use the ${providerName.toUpperCase()}_API_KEY environment variable.",
		)
	}

	if resp.Diagnostics.HasError() {
		return
	}

	// Create a new ${providerDisplayName} client using the configuration values
	client := &http.Client{}
	
	// Example client configuration would go here
	_ = client
	_ = apiKey
	_ = baseUrl

	// Make the ${providerDisplayName} client available during DataSource and Resource
	// type Configure methods.
	resp.DataSourceData = client
	resp.ResourceData = client
}

func (p *${providerDisplayName}Provider) Resources(ctx context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		// Generated resources
		${resources.map(r => `// ${r.name}`).join('\n\t\t')}
		// Add your resources here
	}
}

func (p *${providerDisplayName}Provider) DataSources(ctx context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		// Generated data sources
		${dataSources.map(d => `// ${d.name}`).join('\n\t\t')}
		// Add your data sources here
	}
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &${providerDisplayName}Provider{
			version: version,
		}
	}
}
`;

  fs.writeFileSync(path.join(providerDir, "provider.go"), providerGoContent);

  Logger.info("✅ Basic provider structure created");
}

async function validateProviderGeneration(outputDir: string): Promise<void> {
  Logger.info("🔍 Validating provider generation...");

  if (!fs.existsSync(outputDir)) {
    throw new Error("Provider output directory was not created");
  }

  // Check for Go files
  const goFiles: string[] = [];
  const findGoFiles: (dir: string) => void = (dir: string): void => {
    const items: string[] = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath: string = path.join(dir, item);
      const stat: fs.Stats = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        findGoFiles(fullPath);
      } else if (item.endsWith(".go")) {
        goFiles.push(fullPath);
      }
    }
  };

  findGoFiles(outputDir);

  if (goFiles.length === 0) {
    throw new Error("No Go files were generated");
  }

  Logger.info(`✅ Found ${goFiles.length} Go files`);
  Logger.info("✅ Provider validation passed");
}

async function ensureGoModule(
  outputDir: string,
  config: GeneratorConfig,
): Promise<void> {
  const goModPath: string = path.join(outputDir, "go.mod");

  if (!fs.existsSync(goModPath)) {
    Logger.info("📦 Creating go.mod file...");

    const goModContent: string = `module ${config.package_name}

go 1.21

require (
	github.com/hashicorp/terraform-plugin-framework v1.4.2
	github.com/hashicorp/terraform-plugin-testing v1.5.1
)
`;

    fs.writeFileSync(goModPath, goModContent);
    Logger.info("✅ go.mod file created");
  }
}

async function createProviderDocumentation(
  outputDir: string,
  spec: any,
  resources: ResourceConfig[],
  dataSources: DataSourceConfig[],
): Promise<void> {
  const readmePath: string = path.join(outputDir, "README.md");
  const apiVersion: string = spec.info?.version || "1.0.0";
  const apiTitle: string = spec.info?.title || "OneUptime API";
  const pathCount: number = Object.keys(spec.paths || {}).length;

  const readmeContent: string = `# Terraform Provider for OneUptime

This Terraform provider was auto-generated from the OneUptime OpenAPI specification.

## Overview

This provider allows you to manage OneUptime resources using Terraform. It includes:
- ${dataSources.length} data sources for reading OneUptime resources
- ${resources.length} resources for creating, updating, and deleting OneUptime resources

**Generated from:**
- **API:** ${apiTitle}
- **Version:** ${apiVersion}
- **API Paths:** ${pathCount}
- **Generated on:** ${new Date().toISOString()}

## Available Resources

${resources.map(resource => `- \`oneuptime_${resource.name}\`: ${resource.description || `Manage ${resource.name}`}`).join('\n')}

## Available Data Sources

${dataSources.map(dataSource => `- \`oneuptime_${dataSource.name}\`: ${dataSource.description || `Access ${dataSource.name}`}`).join('\n')}

## Installation

\`\`\`hcl
terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
      version = "~> 1.0"
    }
  }
}

provider "oneuptime" {
  api_key = var.oneuptime_api_key
  base_url = "https://oneuptime.com/api" # Optional, defaults to this value
}
\`\`\`

## Authentication

The provider requires an API key for authentication. You can provide this in several ways:

1. **Provider configuration:**
   \`\`\`hcl
   provider "oneuptime" {
     api_key = "your-api-key-here"
   }
   \`\`\`

2. **Environment variable:**
   \`\`\`bash
   export ONEUPTIME_API_KEY="your-api-key-here"
   \`\`\`

3. **Terraform variables:**
   \`\`\`hcl
   variable "oneuptime_api_key" {
     description = "OneUptime API Key"
     type        = string
     sensitive   = true
   }
   
   provider "oneuptime" {
     api_key = var.oneuptime_api_key
   }
   \`\`\`

## Usage Examples

\`\`\`hcl
${resources.length > 0 ? `# Example resource
resource "oneuptime_${resources[0]?.name || 'resource'}" "example" {
  # Required attributes would go here
  name = "Example ${resources[0]?.name || 'Resource'}"
  # Additional configuration...
}` : '# No resources available'}

${dataSources.length > 0 ? `# Example data source
data "oneuptime_${dataSources[0]?.name || 'data_source'}" "example" {
  # Required attributes would go here
  id = "your-id"
}` : '# No data sources available'}

${resources.length > 0 && dataSources.length > 0 ? `# Example using data source with resource
resource "oneuptime_${resources[0]?.name || 'resource'}" "another_example" {
  # Reference a data source
  related_id = data.oneuptime_${dataSources[0]?.name || 'data_source'}.example.id
  # Additional configuration...
}` : ''}
\`\`\`

## Development

This provider was generated using HashiCorp's terraform-plugin-codegen-openapi tool.

### Building the Provider

\`\`\`bash
go mod download
go build -v ./...
\`\`\`

### Testing the Provider

\`\`\`bash
go test -v ./...
\`\`\`

### Installing the Provider Locally

\`\`\`bash
go build -o Terraform
mkdir -p ~/.terraform.d/plugins/local/oneuptime/oneuptime/1.0.0/darwin_amd64/
cp Terraform ~/.terraform.d/plugins/local/oneuptime/oneuptime/1.0.0/darwin_amd64/
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes
5. Submit a pull request

## License

This provider is licensed under the same license as the OneUptime project.
`;

  fs.writeFileSync(readmePath, readmeContent);
  Logger.info("✅ Provider documentation created");
}

function mapOpenAPITypeToTerraform(openAPIType: string): string {
  switch (openAPIType) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    case 'array':
      return 'list';
    case 'object':
      return 'map';
    default:
      return 'string'; // Default to string for unknown types
  }
}

// Execute the main function
generateTerraformProvider().catch((error: Error) => {
  Logger.error("❌ Failed to generate Terraform provider:");
  Logger.error(error.message || error);
  process.exit(1);
});
