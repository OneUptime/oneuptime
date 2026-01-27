import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformDataSource,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";
import { GoCodeGenerator } from "./GoCodeGenerator";

export class DataSourceGenerator {
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateDataSources(): Promise<void> {
    // Create parser and set the spec to get data sources
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const dataSources: TerraformDataSource[] = parser.getDataSources();

    // Generate each data source
    for (const dataSource of dataSources) {
      await this.generateDataSource(dataSource);
    }

    // Update provider.go to include data sources
    await this.updateProviderWithDataSources(dataSources);
  }

  private async generateDataSource(
    dataSource: TerraformDataSource,
  ): Promise<void> {
    const dataSourceGoContent: string =
      this.generateDataSourceGoFile(dataSource);
    const fileName: string = `data_source_${dataSource.name}.go`;
    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      fileName,
      dataSourceGoContent,
    );
  }

  private generateDataSourceGoFile(dataSource: TerraformDataSource): string {
    const dataSourceTypeName: string = StringUtils.toPascalCase(
      dataSource.name,
    );
    const dataSourceVarName: string = StringUtils.toCamelCase(dataSource.name);

    // Check if we need the attr import (for list/map/set types)
    const needsAttrImport: boolean = Object.values(dataSource.schema).some(
      (attr: any) => {
        return attr.type === "list" || attr.type === "map" || attr.type === "set";
      },
    );

    // Check if we need the math/big import (for number types)
    const needsMathBigImport: boolean = Object.values(dataSource.schema).some(
      (attr: any) => {
        return attr.type === "number";
      },
    );

    const attrImport: string = needsAttrImport
      ? '\n    "github.com/hashicorp/terraform-plugin-framework/attr"'
      : "";

    const mathBigImport: string = needsMathBigImport ? '\n    "math/big"' : "";

    return `package provider

import (
    "context"
    "fmt"${mathBigImport}${attrImport}

    "github.com/hashicorp/terraform-plugin-framework/datasource"
    "github.com/hashicorp/terraform-plugin-framework/datasource/schema"
    "github.com/hashicorp/terraform-plugin-framework/types"
    "github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ datasource.DataSource = &${dataSourceTypeName}DataSource{}

func New${dataSourceTypeName}DataSource() datasource.DataSource {
    return &${dataSourceTypeName}DataSource{}
}

// ${dataSourceTypeName}DataSource defines the data source implementation.
type ${dataSourceTypeName}DataSource struct {
    client *Client
}

// ${dataSourceTypeName}DataSourceModel describes the data source data model.
type ${dataSourceTypeName}DataSourceModel struct {
${this.generateModelFields(dataSource)}
}

func (d *${dataSourceTypeName}DataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
    resp.TypeName = req.ProviderTypeName + "_${dataSource.name}"
}

func (d *${dataSourceTypeName}DataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
    resp.Schema = schema.Schema{
        MarkdownDescription: "${dataSource.name} data source",

        Attributes: map[string]schema.Attribute{
${this.generateSchemaAttributes(dataSource)}
        },
    }
}

func (d *${dataSourceTypeName}DataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
    // Prevent panic if the provider has not been configured.
    if req.ProviderData == nil {
        return
    }

    client, ok := req.ProviderData.(*Client)

    if !ok {
        resp.Diagnostics.AddError(
            "Unexpected Data Source Configure Type",
            fmt.Sprintf("Expected *Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
        )

        return
    }

    d.client = client
}

func (d *${dataSourceTypeName}DataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
    var data ${dataSourceTypeName}DataSourceModel

    // Read Terraform configuration data into the model
    resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    ${this.generateReadMethod(dataSource, dataSourceVarName)}

    // Write logs using the tflog package
    tflog.Trace(ctx, "read a data source")

    // Save data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateModelFields(dataSource: TerraformDataSource): string {
    const fields: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const goType: string = this.mapTerraformTypeToGo(attr.type);
      fields.push(`    ${fieldName} ${goType} \`tfsdk:"${sanitizedName}"\``);
    }

    return fields.join("\n");
  }

  private generateSchemaAttributes(dataSource: TerraformDataSource): string {
    const attributes: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const schemaAttr: string = this.generateSchemaAttribute(
        sanitizedName,
        attr,
      );
      attributes.push(`            "${sanitizedName}": ${schemaAttr},`);
    }

    return attributes.join("\n");
  }

  private sanitizeAttributeName(name: string): string {
    // List of reserved attribute names in Terraform
    const reservedNames: string[] = [
      "count",
      "for_each",
      "provider",
      "lifecycle",
      "depends_on",
      "connection",
      "provisioner",
    ];

    if (reservedNames.includes(name)) {
      return `${name}_value`;
    }

    return name;
  }

  private generateSchemaAttribute(_name: string, attr: any): string {
    const attrType: string = this.mapTerraformTypeToSchemaType(attr.type);
    const options: string[] = [];

    if (attr.description) {
      options.push(
        `MarkdownDescription: "${GoCodeGenerator.escapeString(attr.description)}"`,
      );
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

    // For collection attributes, add ElementType
    if (attr.type === "map" || attr.type === "list" || attr.type === "set") {
      options.push("ElementType: types.StringType");
    }

    return `schema.${attrType}Attribute{
                ${options.join(",\n                ")},
            }`;
  }

  private generateReadMethod(
    dataSource: TerraformDataSource,
    dataSourceVarName: string,
  ): string {
    let readCode: string = "";

    if (dataSource.operations.read) {
      const operation: any = dataSource.operations.read;
      const path: string = this.extractPathFromOperation(operation);

      // Replace path parameters with data values
      let finalPath: string;

      // Check if path has parameters
      if (path.includes("{")) {
        // Split the path into parts and handle parameters
        const parts: string[] = [];
        const segments: string[] = path.split("/");

        for (const segment of segments) {
          if (!segment) {
            continue; // Skip empty segments
          }

          if (segment.startsWith("{") && segment.endsWith("}")) {
            const paramName: string = segment.slice(1, -1);
            const fieldName: string = StringUtils.toPascalCase(paramName);
            parts.push(`data.${fieldName}.ValueString()`);
          } else {
            parts.push(`"${segment}"`);
          }
        }

        finalPath = parts.join(' + "/" + ');

        // Ensure it starts and ends with proper quotes
        if (!finalPath.startsWith('"')) {
          finalPath = '"/" + ' + finalPath;
        } else {
          finalPath = '"/" + ' + finalPath;
        }
      } else {
        // No parameters, just quote the path
        finalPath = `"${path}"`;
      }

      // Determine if this is a POST or GET operation
      const method: string = operation.method?.toUpperCase() || "GET";
      const httpMethod: string = method === "POST" ? "Post" : "Get";

      if (method === "POST") {
        // For POST operations, we need to send a request body with select fields
        readCode = `
    // Build API path
    apiPath := ${finalPath}
    
    // Prepare request body with select fields (if needed)
    requestBody := map[string]interface{}{
        "select": map[string]interface{}{}, // Add specific fields to select if needed
    }
    
    // Make API call
    httpResp, err := d.client.${httpMethod}(apiPath, requestBody)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${dataSource.name}, got error: %s", err))
        return
    }

    var ${dataSourceVarName}Response map[string]interface{}
    err = d.client.ParseResponse(httpResp, &${dataSourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${dataSource.name} response, got error: %s", err))
        return
    }

    // Extract data from response
    if dataMap, ok := ${dataSourceVarName}Response["data"].(map[string]interface{}); ok {
        ${dataSourceVarName}Response = dataMap
    }

    // Update the model with response data
${this.generateResponseMapping(dataSource, dataSourceVarName + "Response")}`;
      } else {
        // For GET operations, use the original logic
        readCode = `
    // Build API path
    apiPath := ${finalPath}
    
    // Make API call
    httpResp, err := d.client.${httpMethod}(apiPath)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${dataSource.name}, got error: %s", err))
        return
    }

    var ${dataSourceVarName}Response map[string]interface{}
    err = d.client.ParseResponse(httpResp, &${dataSourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${dataSource.name} response, got error: %s", err))
        return
    }

    // Update the model with response data
${this.generateResponseMapping(dataSource, dataSourceVarName + "Response")}`;
      }
    } else if (dataSource.operations.list) {
      const operation: any = dataSource.operations.list;
      const path: string = this.extractPathFromOperation(operation);
      const method: string = operation.method?.toUpperCase() || "GET";
      const httpMethod: string = method === "POST" ? "Post" : "Get";

      if (method === "POST") {
        // For POST list operations, send appropriate request body
        readCode = `
    // Build request body with query parameters
    requestBody := map[string]interface{}{
        "query": map[string]interface{}{},
        "select": map[string]interface{}{},
    }
    
    // Add filters based on data source inputs
    queryFilters := map[string]interface{}{}
    if !data.Id.IsNull() {
        queryFilters["_id"] = data.Id.ValueString()
    }
    if !data.Name.IsNull() {
        queryFilters["name"] = data.Name.ValueString()
    }
    if len(queryFilters) > 0 {
        requestBody["query"] = queryFilters
    }
    
    // Make API call
    httpResp, err := d.client.${httpMethod}("${path}", requestBody)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${dataSource.name}, got error: %s", err))
        return
    }

    var ${dataSourceVarName}Response map[string]interface{}
    err = d.client.ParseResponse(httpResp, &${dataSourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${dataSource.name} response, got error: %s", err))
        return
    }

    // For list operations, take the first matching item
    if items, ok := ${dataSourceVarName}Response["data"].([]interface{}); ok && len(items) > 0 {
        if firstItem, ok := items[0].(map[string]interface{}); ok {
            ${dataSourceVarName}Response = firstItem
        }
    }

    // Update the model with response data
${this.generateResponseMapping(dataSource, dataSourceVarName + "Response")}`;
      } else {
        // For GET list operations, use query parameters
        readCode = `
    // Build query parameters
    queryParams := ""
    if !data.Id.IsNull() {
        queryParams += "?id=" + data.Id.ValueString()
    }
    if !data.Name.IsNull() {
        if queryParams == "" {
            queryParams += "?name=" + data.Name.ValueString()
        } else {
            queryParams += "&name=" + data.Name.ValueString()
        }
    }
    
    // Make API call
    httpResp, err := d.client.${httpMethod}("${path}" + queryParams)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${dataSource.name}, got error: %s", err))
        return
    }

    var ${dataSourceVarName}Response map[string]interface{}
    err = d.client.ParseResponse(httpResp, &${dataSourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("Parse Error", fmt.Sprintf("Unable to parse ${dataSource.name} response, got error: %s", err))
        return
    }

    // For list operations, take the first matching item
    if items, ok := ${dataSourceVarName}Response["data"].([]interface{}); ok && len(items) > 0 {
        if firstItem, ok := items[0].(map[string]interface{}); ok {
            ${dataSourceVarName}Response = firstItem
        }
    }

    // Update the model with response data
${this.generateResponseMapping(dataSource, dataSourceVarName + "Response")}`;
      }
    }

    return readCode;
  }

  private generateResponseMapping(
    dataSource: TerraformDataSource,
    responseVar: string,
  ): string {
    const mappings: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const setter: string = this.generateResponseSetter(
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
      case "list":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        elements := make([]attr.Value, len(val))
        for i, item := range val {
            if strItem, ok := item.(string); ok {
                elements[i] = types.StringValue(strItem)
            } else {
                elements[i] = types.StringValue("")
            }
        }
        listValue, _ := types.ListValue(types.StringType, elements)
        ${fieldName} = listValue
    }`;
      case "set":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        elements := make([]attr.Value, len(val))
        for i, item := range val {
            if strItem, ok := item.(string); ok {
                elements[i] = types.StringValue(strItem)
            } else {
                elements[i] = types.StringValue("")
            }
        }
        setValue, _ := types.SetValue(types.StringType, elements)
        ${fieldName} = setValue
    }`;
      case "map":
        return `if val, ok := ${responseValue}.(map[string]interface{}); ok {
        elements := make(map[string]attr.Value)
        for key, item := range val {
            if strItem, ok := item.(string); ok {
                elements[key] = types.StringValue(strItem)
            } else {
                elements[key] = types.StringValue("")
            }
        }
        mapValue, _ := types.MapValue(types.StringType, elements)
        ${fieldName} = mapValue
    }`;
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
      case "set":
        return "types.Set";
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
      case "set":
        return "Set";
      case "map":
        return "Map";
      default:
        return "String";
    }
  }

  private async updateProviderWithDataSources(
    dataSources: TerraformDataSource[],
  ): Promise<void> {
    // Generate the list of data source functions
    const dataSourceFunctions: string = dataSources
      .map((dataSource: TerraformDataSource) => {
        const dataSourceTypeName: string = StringUtils.toPascalCase(
          dataSource.name,
        );
        return `        New${dataSourceTypeName}DataSource,`;
      })
      .join("\n");

    /*
     * This would update the provider.go file to include the data sources
     * For now, we'll create a separate file with the data source list
     */
    const dataSourceListContent: string = `package provider

import (
    "github.com/hashicorp/terraform-plugin-framework/datasource"
)

// GetDataSources returns all available data sources
func GetDataSources() []func() datasource.DataSource {
    return []func() datasource.DataSource{
${dataSourceFunctions}
    }
}
`;

    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "data_sources.go",
      dataSourceListContent,
    );
  }
}
