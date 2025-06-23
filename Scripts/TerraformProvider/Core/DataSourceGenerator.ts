import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformDataSource,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";

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

    return `package provider

import (
    "context"
    "fmt"

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

    // For collection attributes, add ElementType
    if (attr.type === "map" || attr.type === "list") {
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
      let path: string = this.extractPathFromOperation(operation);

      // Replace path parameters with data values
      path = path.replace(/{([^}]+)}/g, (_match: string, paramName: string) => {
        const fieldName: string = StringUtils.toPascalCase(paramName);
        return `" + data.${fieldName}.ValueString() + "`;
      });

      if (path.startsWith(`" + `)) {
        path = path.substring(4);
      }
      if (path.endsWith(` + "`)) {
        path = path.substring(0, path.length - 4);
      }
      path = `"${path}"`;

      readCode = `
    // Build API path
    apiPath := ${path}
    
    // Make API call
    httpResp, err := d.client.Get(apiPath)
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
    } else if (dataSource.operations.list) {
      const operation: any = dataSource.operations.list;
      const path: string = this.extractPathFromOperation(operation);

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
    httpResp, err := d.client.Get("${path}" + queryParams)
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

    return readCode;
  }

  private generateResponseMapping(
    dataSource: TerraformDataSource,
    responseVar: string,
  ): string {
    const mappings: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const fieldName: string = StringUtils.toPascalCase(name);
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

    // This would update the provider.go file to include the data sources
    // For now, we'll create a separate file with the data source list
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
