import * as fs from 'fs';

interface OpenAPISpec {
    openapi: string;
    info: {
        title: string;
        version: string;
        description?: string;
    };
    paths: Record<string, any>;
    components?: {
        schemas?: Record<string, any>;
    };
}

interface ProviderCodeSpecification {
    version: string;
    provider: {
        name: string;
        schema?: {
            attributes?: any[];
            blocks?: any[];
        };
    };
    resources?: Array<{
        name: string;
        schema: {
            attributes?: any[];
            blocks?: any[];
        };
    }>;
    datasources?: Array<{
        name: string;
        schema: {
            attributes?: any[];
            blocks?: any[];
        };
    }>;
}

export default class SpecificationConverter {
    /**
     * Convert OpenAPI specification to Provider Code Specification
     */
    public static convertOpenAPIToProviderSpec(options: {
        openApiSpecPath: string;
        outputPath: string;
        providerName: string;
    }): void {
        try {
            console.log('🔄 Converting OpenAPI spec to Provider Code Specification...');
            console.log(`📄 Input OpenAPI spec: ${options.openApiSpecPath}`);
            console.log(`📁 Output path: ${options.outputPath}`);

            // Read OpenAPI specification
            const openApiContent = fs.readFileSync(options.openApiSpecPath, 'utf8');
            const openApiSpec: OpenAPISpec = JSON.parse(openApiContent);

            // Generate Provider Code Specification
            const providerSpec = this.generateProviderSpecification(openApiSpec, options.providerName);

            // Write specification to file
            const outputContent = JSON.stringify(providerSpec, null, 2);
            fs.writeFileSync(options.outputPath, outputContent, 'utf8');

            console.log('✅ Successfully converted OpenAPI spec to Provider Code Specification');
            console.log(`📝 Generated specification saved to: ${options.outputPath}`);

        } catch (error) {
            console.error('❌ Error converting specification:', error);
            throw new Error(`Failed to convert specification: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private static generateProviderSpecification(openApiSpec: OpenAPISpec, providerName: string): ProviderCodeSpecification {
        const providerSpec: ProviderCodeSpecification = {
            version: "0.1",
            provider: {
                name: providerName,
                schema: {
                    attributes: [
                        // Basic provider configuration attributes
                        {
                            name: "api_url",
                            string: {
                                optional_required: "optional",
                                description: "The base URL for the API"
                            }
                        },
                        {
                            name: "api_key",
                            string: {
                                optional_required: "optional",
                                sensitive: true,
                                description: "API key for authentication"
                            }
                        }
                    ]
                }
            },
            resources: [],
            datasources: []
        };

        // Extract resources and data sources from OpenAPI paths
        if (openApiSpec.paths) {
            const { resources, datasources } = this.extractResourcesAndDataSources(openApiSpec);
            providerSpec.resources = resources;
            providerSpec.datasources = datasources;
        }

        return providerSpec;
    }

    /**
     * Sanitize resource name to follow Terraform naming conventions
     * - Must start with lowercase letter or underscore
     * - Can only contain lowercase letters, numbers, and underscores
     * - Convert hyphens to underscores
     * - Convert to lowercase
     */
    private static sanitizeResourceName(name: string): string {
        return name
            .toLowerCase()
            .replace(/-/g, '_')  // Replace hyphens with underscores
            .replace(/[^a-z0-9_]/g, '_')  // Replace any other invalid characters with underscores
            .replace(/^[0-9]/, '_$&')  // If it starts with a number, prefix with underscore
            .replace(/_+/g, '_');  // Replace multiple consecutive underscores with single underscore
    }

    private static extractResourcesAndDataSources(openApiSpec: OpenAPISpec): {
        resources: Array<{ name: string; schema: any }>;
        datasources: Array<{ name: string; schema: any }>;
    } {
        const resources: Array<{ name: string; schema: any }> = [];
        const datasources: Array<{ name: string; schema: any }> = [];

        // Analyze OpenAPI paths to determine resources and data sources
        for (const [pathKey, pathValue] of Object.entries(openApiSpec.paths)) {
            if (!pathValue || typeof pathValue !== 'object') continue;

            // Extract resource name from path (e.g., /api/v1/monitor -> monitor)
            const pathSegments = pathKey.split('/').filter(segment => 
                segment && 
                !segment.startsWith('{') && 
                segment !== 'api' && 
                !segment.match(/^v\d+$/)
            );

            if (pathSegments.length === 0) continue;

            const lastSegment = pathSegments[pathSegments.length - 1];
            if (!lastSegment) continue;
            
            const resourceName = this.sanitizeResourceName(lastSegment);
            if (!resourceName) continue;

            // Sanitize resource name to be Terraform-compatible
            const sanitizedResourceName = this.sanitizeResourceName(resourceName);

            // Determine if this is a resource (has POST/PUT/DELETE) or data source (only GET)
            const methods = Object.keys(pathValue);
            const hasWriteOperations = methods.some(method => 
                ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase())
            );

            const schema = this.generateSchemaFromPath(pathValue, openApiSpec.components?.schemas);

            if (hasWriteOperations) {
                // This is a resource
                if (!resources.find(r => r.name === sanitizedResourceName)) {
                    resources.push({
                        name: sanitizedResourceName,
                        schema: schema
                    });
                }
            } else if (methods.includes('get')) {
                // This is a data source
                if (!datasources.find(d => d.name === sanitizedResourceName)) {
                    datasources.push({
                        name: sanitizedResourceName,
                        schema: schema
                    });
                }
            }
        }

        return { resources, datasources };
    }

    private static generateSchemaFromPath(pathSpec: any, schemas?: Record<string, any>): any {
        // Generate a basic schema structure
        // This is a simplified implementation - you may want to enhance this based on your specific needs
        const attributes = [
            {
                name: "id",
                string: {
                    computed_optional_required: "computed",
                    description: "The unique identifier"
                }
            },
            {
                name: "name",
                string: {
                    computed_optional_required: "required",
                    description: "The name of the resource"
                }
            },
            {
                name: "description",
                string: {
                    computed_optional_required: "optional",
                    description: "The description of the resource"
                }
            }
        ];

        // Try to extract more attributes from request/response schemas if available
        if (pathSpec.post?.requestBody?.content?.['application/json']?.schema) {
            const requestSchema = pathSpec.post.requestBody.content['application/json'].schema;
            const extractedAttributes = this.extractAttributesFromSchema(requestSchema, schemas);
            attributes.push(...extractedAttributes);
        }

        return {
            attributes: attributes
        };
    }

    private static extractAttributesFromSchema(schema: any, _allSchemas?: Record<string, any>): any[] {
        const attributes: any[] = [];

        if (schema.properties) {
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                if (typeof propSchema !== 'object') continue;

                const attribute = this.convertPropertyToAttribute(propName, propSchema as any);
                if (attribute) {
                    attributes.push(attribute);
                }
            }
        }

        return attributes;
    }

    private static convertPropertyToAttribute(name: string, schema: any): any | null {
        // Skip id field as it's typically computed
        if (name === 'id') return null;

        let attributeType: any;
        let computedOptionalRequired = 'optional';

        switch (schema.type) {
            case 'string':
                attributeType = { string: {} };
                break;
            case 'integer':
            case 'number':
                attributeType = { int64: {} };
                break;
            case 'boolean':
                attributeType = { bool: {} };
                break;
            case 'array':
                if (schema.items?.type === 'string') {
                    attributeType = {
                        list: {
                            element_type: { string: {} }
                        }
                    };
                }
                break;
            case 'object':
                // For objects, create a simplified structure
                attributeType = {
                    object: {
                        attribute_types: [
                            {
                                name: "value",
                                string: {}
                            }
                        ]
                    }
                };
                break;
            default:
                // Default to string for unknown types
                attributeType = { string: {} };
        }

        if (!attributeType) return null;

        const typeKey = Object.keys(attributeType)[0];
        if (!typeKey) return null;

        return {
            name: name,
            [typeKey]: {
                ...attributeType[typeKey],
                computed_optional_required: computedOptionalRequired,
                description: schema.description || `The ${name} field`
            }
        };
    }

    /**
     * Generate a basic Provider Code Specification template
     */
    public static generateBasicTemplate(options: {
        providerName: string;
        outputPath: string;
    }): void {
        const basicSpec: ProviderCodeSpecification = {
            version: "0.1",
            provider: {
                name: options.providerName,
                schema: {
                    attributes: [
                        {
                            name: "api_url",
                            string: {
                                optional_required: "optional",
                                description: "The base URL for the API"
                            }
                        },
                        {
                            name: "api_key",
                            string: {
                                optional_required: "optional",
                                sensitive: true,
                                description: "API key for authentication"
                            }
                        }
                    ]
                }
            },
            resources: [
                {
                    name: "example_resource",
                    schema: {
                        attributes: [
                            {
                                name: "id",
                                string: {
                                    computed_optional_required: "computed",
                                    description: "The unique identifier"
                                }
                            },
                            {
                                name: "name",
                                string: {
                                    computed_optional_required: "required",
                                    description: "The name of the resource"
                                }
                            }
                        ]
                    }
                }
            ],
            datasources: [
                {
                    name: "example_data_source",
                    schema: {
                        attributes: [
                            {
                                name: "id",
                                string: {
                                    computed_optional_required: "computed",
                                    description: "The unique identifier"
                                }
                            },
                            {
                                name: "name",
                                string: {
                                    computed_optional_required: "required",
                                    description: "The name to search for"
                                }
                            }
                        ]
                    }
                }
            ]
        };

        const content = JSON.stringify(basicSpec, null, 2);
        fs.writeFileSync(options.outputPath, content, 'utf8');
        
        console.log('✅ Generated basic Provider Code Specification template');
        console.log(`📝 Template saved to: ${options.outputPath}`);
    }
}
