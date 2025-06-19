import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformResource,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";

export class ResourceGenerator {
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  async generateResources(): Promise<void> {
    // Create parser and set the spec to get resources
    const parser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const resources = parser.getResources();

    // Generate each resource
    for (const resource of resources) {
      await this.generateResource(resource);
    }

    // Update provider.go to include resources
    await this.updateProviderWithResources(resources);
  }

  private async generateResource(resource: TerraformResource): Promise<void> {
    const resourceGoContent = this.generateResourceGoFile(resource);
    const fileName = `resource_${resource.name}.go`;
    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      fileName,
      resourceGoContent,
    );
  }

  private generateResourceGoFile(resource: TerraformResource): string {
    const resourceTypeName = StringUtils.toPascalCase(resource.name);
    const resourceVarName = StringUtils.toCamelCase(resource.name);

    // Determine which imports are needed based on actual usage
    const imports = [
      "context",
      "fmt",
      "github.com/hashicorp/terraform-plugin-framework/path",
      "github.com/hashicorp/terraform-plugin-framework/resource",
      "github.com/hashicorp/terraform-plugin-framework/resource/schema",
      "github.com/hashicorp/terraform-plugin-framework/types",
      "github.com/hashicorp/terraform-plugin-log/tflog",
    ];

    // Add conditional imports only if they're actually used
    const hasNumberFields = Object.values(resource.schema).some((attr) => {
      return attr.type === "number";
    });
    const hasReadOperation = resource.operations.read;

    if (hasNumberFields) {
      imports.push("math/big");
    }

    if (hasReadOperation) {
      imports.push("net/http");
    }

    if (resource.operations.create || resource.operations.update) {
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier",
      );
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier",
      );
    }

    const importStatements = imports
      .map((imp) => {
        return `    "${imp}"`;
      })
      .join("\n");

    return `package provider

import (
${importStatements}
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ resource.Resource = &${resourceTypeName}Resource{}
var _ resource.ResourceWithImportState = &${resourceTypeName}Resource{}

func New${resourceTypeName}Resource() resource.Resource {
    return &${resourceTypeName}Resource{}
}

// ${resourceTypeName}Resource defines the resource implementation.
type ${resourceTypeName}Resource struct {
    client *Client
}

// ${resourceTypeName}ResourceModel describes the resource data model.
type ${resourceTypeName}ResourceModel struct {
${this.generateModelFields(resource)}
}

func (r *${resourceTypeName}Resource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
    resp.TypeName = req.ProviderTypeName + "_${resource.name}"
}

func (r *${resourceTypeName}Resource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
    resp.Schema = schema.Schema{
        MarkdownDescription: "${resource.name} resource",

        Attributes: map[string]schema.Attribute{
${this.generateSchemaAttributes(resource)}
        },
    }
}

func (r *${resourceTypeName}Resource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
    // Prevent panic if the provider has not been configured.
    if req.ProviderData == nil {
        return
    }

    client, ok := req.ProviderData.(*Client)

    if !ok {
        resp.Diagnostics.AddError(
            "Unexpected Resource Configure Type",
            fmt.Sprintf("Expected *Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
        )

        return
    }

    r.client = client
}

${this.generateCRUDMethods(resource, resourceTypeName, resourceVarName)}

func (r *${resourceTypeName}Resource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
    resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
`;
  }

  private generateModelFields(resource: TerraformResource): string {
    const fields: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const fieldName = StringUtils.toPascalCase(name);
      const goType = this.mapTerraformTypeToGo(attr.type);
      fields.push(`    ${fieldName} ${goType} \`tfsdk:"${name}"\``);
    }

    return fields.join("\n");
  }

  private generateSchemaAttributes(resource: TerraformResource): string {
    const attributes: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const schemaAttr = this.generateSchemaAttribute(name, attr);
      attributes.push(`            "${name}": ${schemaAttr},`);
    }

    return attributes.join("\n");
  }

  private generateSchemaAttribute(name: string, attr: any): string {
    const attrType = this.mapTerraformTypeToSchemaType(attr.type);
    const options: string[] = [];

    if (attr.description) {
      options.push(`MarkdownDescription: "${attr.description}"`);
    }

    if (attr.required) {
      options.push("Required: true");
    } else if (attr.computed) {
      options.push("Computed: true");
    } else {
      options.push("Optional: true");
    }

    if (attr.sensitive) {
      options.push("Sensitive: true");
    }

    // For map attributes, add ElementType
    if (attr.type === "map") {
      options.push("ElementType: types.StringType");
    }

    let planModifiers = "";
    if (name === "id") {
      planModifiers = `,
                PlanModifiers: []planmodifier.String{
                    stringplanmodifier.UseStateForUnknown(),
                }`;
    }

    return `schema.${attrType}Attribute{
                ${options.join(",\n                ")}${planModifiers},
            }`;
  }

  private generateCRUDMethods(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    let methods = "";

    // Create method
    if (resource.operations.create) {
      methods += this.generateCreateMethod(
        resource,
        resourceTypeName,
        resourceVarName,
      );
    } else {
      methods += this.generateStubCreateMethod(resourceTypeName);
    }

    // Read method (always required)
    if (resource.operations.read) {
      methods += this.generateReadMethod(
        resource,
        resourceTypeName,
        resourceVarName,
      );
    } else {
      methods += this.generateStubReadMethod(resourceTypeName);
    }

    // Update method
    if (resource.operations.update) {
      methods += this.generateUpdateMethod(
        resource,
        resourceTypeName,
        resourceVarName,
      );
    } else {
      methods += this.generateStubUpdateMethod(resourceTypeName);
    }

    // Delete method
    if (resource.operations.delete) {
      methods += this.generateDeleteMethod(
        resource,
        resourceTypeName,
        resourceVarName,
      );
    } else {
      methods += this.generateStubDeleteMethod(resourceTypeName);
    }

    return methods;
  }

  private generateCreateMethod(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    const operation = resource.operations.create!;
    const path = this.extractPathFromOperation(operation);

    return `
func (r *${resourceTypeName}Resource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // Create API request body
    ${resourceVarName}Request := map[string]interface{}{
${this.generateRequestBody(resource)}
    }

    // Make API call
    httpResp, err := r.client.Post("${path}", ${resourceVarName}Request)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to create ${resource.name}, got error: %s", err))
        return
    }

    var ${resourceVarName}Response map[string]interface{}
    err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${resource.name} response, got error: %s", err))
        return
    }

    // Update the model with response data
${this.generateResponseMapping(resource, resourceVarName + "Response")}

    // Write logs using the tflog package
    tflog.Trace(ctx, "created a resource")

    // Save data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateReadMethod(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    const operation = resource.operations.read!;
    const path = this.extractPathFromOperation(operation);

    // Replace path parameters
    const pathWithParams = path.replace(
      /{([^}]+)}/g,
      `" + data.Id.ValueString() + "`,
    );

    // Clean up the path string construction
    let finalPath: string;
    if (pathWithParams.includes('" + ')) {
      // Path has parameters
      if (pathWithParams.startsWith('" + ')) {
        finalPath = pathWithParams.substring(4);
      } else {
        finalPath = `"${pathWithParams}"`;
      }

      if (finalPath.endsWith(' + "')) {
        finalPath = finalPath.substring(0, finalPath.length - 4);
      }
    } else {
      // Path has no parameters
      finalPath = `"${pathWithParams}"`;
    }

    return `
func (r *${resourceTypeName}Resource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // Make API call
    httpResp, err := r.client.Get(${finalPath})
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${resource.name}, got error: %s", err))
        return
    }

    if httpResp.StatusCode == http.StatusNotFound {
        resp.State.RemoveResource(ctx)
        return
    }

    var ${resourceVarName}Response map[string]interface{}
    err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${resource.name} response, got error: %s", err))
        return
    }

    // Update the model with response data
${this.generateResponseMapping(resource, resourceVarName + "Response")}

    // Save updated data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateUpdateMethod(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    const operation = resource.operations.update!;
    const path = this.extractPathFromOperation(operation);

    // Replace path parameters
    const pathWithParams = path.replace(
      /{([^}]+)}/g,
      `" + data.Id.ValueString() + "`,
    );

    // Clean up the path string construction
    let finalPath: string;
    if (pathWithParams.includes('" + ')) {
      // Path has parameters
      if (pathWithParams.startsWith('" + ')) {
        finalPath = pathWithParams.substring(4);
      } else {
        finalPath = `"${pathWithParams}"`;
      }

      if (finalPath.endsWith(' + "')) {
        finalPath = finalPath.substring(0, finalPath.length - 4);
      }
    } else {
      // Path has no parameters
      finalPath = `"${pathWithParams}"`;
    }

    const httpMethod =
      operation.method && operation.method.toUpperCase() === "PATCH"
        ? "Patch"
        : "Put";

    return `
func (r *${resourceTypeName}Resource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // Create API request body
    ${resourceVarName}Request := map[string]interface{}{
${this.generateRequestBody(resource)}
    }

    // Make API call
    httpResp, err := r.client.${httpMethod}(${finalPath}, ${resourceVarName}Request)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to update ${resource.name}, got error: %s", err))
        return
    }

    var ${resourceVarName}Response map[string]interface{}
    err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${resource.name} response, got error: %s", err))
        return
    }

    // Update the model with response data
${this.generateResponseMapping(resource, resourceVarName + "Response")}

    // Save updated data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateDeleteMethod(
    resource: TerraformResource,
    resourceTypeName: string,
    _resourceVarName: string,
  ): string {
    const operation = resource.operations.delete!;
    const path = this.extractPathFromOperation(operation);

    // Replace path parameters
    const pathWithParams = path.replace(
      /{([^}]+)}/g,
      `" + data.Id.ValueString() + "`,
    );

    // Clean up the path string construction
    let finalPath: string;
    if (pathWithParams.includes('" + ')) {
      // Path has parameters
      if (pathWithParams.startsWith('" + ')) {
        finalPath = pathWithParams.substring(4);
      } else {
        finalPath = `"${pathWithParams}"`;
      }

      if (finalPath.endsWith(' + "')) {
        finalPath = finalPath.substring(0, finalPath.length - 4);
      }
    } else {
      // Path has no parameters
      finalPath = `"${pathWithParams}"`;
    }

    return `
func (r *${resourceTypeName}Resource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // Make API call
    _, err := r.client.Delete(${finalPath})
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to delete ${resource.name}, got error: %s", err))
        return
    }
}
`;
  }

  private generateStubCreateMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
    resp.Diagnostics.AddError(
        "Create Not Implemented",
        "This resource does not support create operations",
    )
}
`;
  }

  private generateStubReadMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
    resp.Diagnostics.AddError(
        "Read Not Implemented", 
        "This resource does not support read operations",
    )
}
`;
  }

  private generateStubUpdateMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
    resp.Diagnostics.AddError(
        "Update Not Implemented",
        "This resource does not support update operations",
    )
}
`;
  }

  private generateStubDeleteMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
    resp.Diagnostics.AddError(
        "Delete Not Implemented",
        "This resource does not support delete operations", 
    )
}
`;
  }

  private generateRequestBody(resource: TerraformResource): string {
    const fields: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      if (name === "id" || attr.computed) {
        continue;
      }

      // Skip map and list types for now as they are complex objects
      if (attr.type === "map" || attr.type === "list") {
        continue;
      }

      const fieldName = StringUtils.toPascalCase(name);
      const value = this.getGoValueForTerraformType(
        attr.type,
        `data.${fieldName}`,
      );
      fields.push(`        "${name}": ${value},`);
    }

    return fields.join("\n");
  }

  private generateResponseMapping(
    resource: TerraformResource,
    responseVar: string,
  ): string {
    const mappings: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const fieldName = StringUtils.toPascalCase(name);
      const setter = this.generateResponseSetter(
        attr.type,
        `data.${fieldName}`,
        `${responseVar}["${name}"]`,
      );
      mappings.push(`    ${setter}`);
    }

    return mappings.join("\n");
  }

  private generateResponseSetter(
    terraformType: string,
    fieldName: string,
    responseValue: string,
  ): string {
    switch (terraformType) {
      case "string":
        return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    }`;
      case "number":
        return `if val, ok := ${responseValue}.(float64); ok {
        ${fieldName} = types.NumberValue(big.NewFloat(val))
    }`;
      case "bool":
        return `if val, ok := ${responseValue}.(bool); ok {
        ${fieldName} = types.BoolValue(val)
    }`;
      case "map":
        return `// Map type field ${fieldName} - skipping complex object assignment
    // TODO: Implement proper map handling for complex objects`;
      case "list":
        return `// List type field ${fieldName} - skipping list assignment
    // TODO: Implement proper list handling`;
      default:
        return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    }`;
    }
  }

  private extractPathFromOperation(operation: any): string {
    return operation.path || "";
  }

  private mapTerraformTypeToGo(terraformType: string): string {
    switch (terraformType) {
      case "string":
        return "types.String";
      case "number":
        return "types.Number";
      case "bool":
        return "types.Bool";
      case "list":
        return "types.List";
      case "map":
        return "types.Map";
      default:
        return "types.String";
    }
  }

  private mapTerraformTypeToSchemaType(terraformType: string): string {
    switch (terraformType) {
      case "string":
        return "String";
      case "number":
        return "Number";
      case "bool":
        return "Bool";
      case "list":
        return "List";
      case "map":
        return "Map";
      default:
        return "String";
    }
  }

  private getGoValueForTerraformType(
    terraformType: string,
    fieldRef: string,
  ): string {
    switch (terraformType) {
      case "string":
        return `${fieldRef}.ValueString()`;
      case "number":
        return `${fieldRef}.ValueBigFloat()`;
      case "bool":
        return `${fieldRef}.ValueBool()`;
      case "map":
        // For map types, we need to handle them differently
        // For now, we'll skip them in request bodies since they're typically complex objects
        return `""`;
      case "list":
        // For list types, we need to handle them differently
        return `[]string{}`;
      default:
        return `${fieldRef}.ValueString()`;
    }
  }

  private async updateProviderWithResources(
    resources: TerraformResource[],
  ): Promise<void> {
    // Generate the list of resource functions
    const resourceFunctions = resources
      .map((resource) => {
        const resourceTypeName = StringUtils.toPascalCase(resource.name);
        return `        New${resourceTypeName}Resource,`;
      })
      .join("\n");

    // This would update the provider.go file to include the resources
    // For now, we'll create a separate file with the resource list
    const resourceListContent = `package provider

import (
    "github.com/hashicorp/terraform-plugin-framework/resource"
)

// GetResources returns all available resources
func GetResources() []func() resource.Resource {
    return []func() resource.Resource{
${resourceFunctions}
    }
}
`;

    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "resources.go",
      resourceListContent,
    );
  }
}
