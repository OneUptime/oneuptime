import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformDataSource,
  TerraformAttribute,
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

    const needsAttrImport: boolean = Object.values(dataSource.schema).some(
      (attr: any) => {
        return (
          attr.type === "list" || attr.type === "map" || attr.type === "set"
        );
      },
    );
    const needsSortImport: boolean = Object.values(dataSource.schema).some(
      (attr: any) => {
        return attr.type === "set";
      },
    );
    const needsMathBigImport: boolean = Object.values(dataSource.schema).some(
      (attr: any) => {
        return attr.type === "number";
      },
    );

    const conditionalImports: string = [
      // http.StatusNotFound is only referenced by the get-item branch.
      dataSource.operations.read ? '\n    "net/http"' : "",
      needsMathBigImport ? '\n    "math/big"' : "",
      needsAttrImport
        ? '\n    "github.com/hashicorp/terraform-plugin-framework/attr"'
        : "",
      needsSortImport ? '\n    "sort"' : "",
    ].join("");

    return `package provider

import (
    "context"
    "encoding/json"
    "fmt"${conditionalImports}

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
        MarkdownDescription: "${GoCodeGenerator.escapeString(dataSource.description || "")} Look up an existing ${dataSource.name} by \`id\` or by \`name\`.",

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
    } else if (attr.optional && attr.computed) {
      // Lookup keys (id, name): user-settable, server-populated afterwards.
      options.push("Optional: true");
      options.push("Computed: true");
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

  /*
   * The read flow:
   *   - exactly one of id/name must be set, enforced with a clear error
   *   - id  -> POST {crud}/{id}/get-item with a full select
   *   - name -> POST {crud}/get-list with query {name}, limit 2; exactly one
   *     match required — zero or multiple matches are errors, never silently
   *     empty state or an arbitrary first item
   *
   * Both paths post through the client's select-dropping helpers, so a column
   * the server rejects (permission-gated, or unknown to an older deployment)
   * costs that one attribute rather than the whole lookup.
   */
  private generateReadMethod(
    dataSource: TerraformDataSource,
    dataSourceVarName: string,
  ): string {
    const readOperation: any = dataSource.operations.read;
    const listOperation: any = dataSource.operations.list;

    const selectParam: string = this.generateSelectParameter(dataSource);

    const readById: string = readOperation
      ? `
        readPath := ${this.buildGetItemPathExpression(readOperation.path)}
        httpResp, err := d.client.PostWithSelect(ctx, readPath, selectParam)
        if err != nil {
            resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${dataSource.name}, got error: %s", err))
            return
        }
        if httpResp.StatusCode == http.StatusNotFound {
            resp.Diagnostics.AddError("Not Found", fmt.Sprintf("No ${dataSource.name} found with id %q.", data.Id.ValueString()))
            return
        }
        var itemResponse map[string]interface{}
        if err := d.client.ParseResponse(httpResp, &itemResponse); err != nil {
            resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to read ${dataSource.name}: %s", err))
            return
        }
        if wrapper, ok := itemResponse["data"].(map[string]interface{}); ok {
            item = wrapper
        } else {
            item = itemResponse
        }`
      : `
        resp.Diagnostics.AddError("Lookup Not Supported", "${dataSource.name} cannot be looked up by id: the API exposes no get endpoint. Use the name filter instead.")
        return`;

    const readByName: string = listOperation
      ? `
        listBody := map[string]interface{}{
            "query": map[string]interface{}{
                "name": data.Name.ValueString(),
            },
            "select": selectParam,
            // limit 2 is enough to detect ambiguity without paging.
            "limit": 2,
        }
        httpResp, err := d.client.PostBodyWithSelect(ctx, "${listOperation.path}", listBody)
        if err != nil {
            resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to list ${dataSource.name}, got error: %s", err))
            return
        }
        var listResponse map[string]interface{}
        if err := d.client.ParseResponse(httpResp, &listResponse); err != nil {
            resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to list ${dataSource.name}: %s", err))
            return
        }
        items, _ := listResponse["data"].([]interface{})
        if len(items) == 0 {
            resp.Diagnostics.AddError("Not Found", fmt.Sprintf("No ${dataSource.name} found with name %q.", data.Name.ValueString()))
            return
        }
        if len(items) > 1 {
            resp.Diagnostics.AddError("Ambiguous Match", fmt.Sprintf("More than one ${dataSource.name} matches name %q. Use the id attribute to disambiguate.", data.Name.ValueString()))
            return
        }
        first, ok := items[0].(map[string]interface{})
        if !ok {
            resp.Diagnostics.AddError("OneUptime API Error", "Unexpected list response shape for ${dataSource.name}.")
            return
        }
        item = first`
      : `
        resp.Diagnostics.AddError("Lookup Not Supported", "${dataSource.name} cannot be looked up by name: the API exposes no list endpoint. Use the id filter instead.")
        return`;

    return `
    hasId := !data.Id.IsNull() && data.Id.ValueString() != ""
    hasName := !data.Name.IsNull() && data.Name.ValueString() != ""
    if hasId == hasName {
        resp.Diagnostics.AddError(
            "Invalid Lookup",
            "Exactly one of \`id\` or \`name\` must be set to look up a ${dataSource.name}.",
        )
        return
    }

    selectParam := map[string]interface{}{
${selectParam}
    }

    var item map[string]interface{}
    if hasId {${readById}
    } else {${readByName}
    }

    // Update the model with response data
${this.generateResponseMapping(dataSource, dataSourceVarName)}`;
  }

  /*
   * Builds the get-item path expression with the {id} placeholder replaced by
   * the configured id.
   */
  private buildGetItemPathExpression(path: string): string {
    const withParams: string = path.replace(
      /{([^}]+)}/g,
      `" + data.Id.ValueString() + "`,
    );
    let expression: string = `"${withParams}"`;
    if (expression.endsWith(' + ""')) {
      expression = expression.substring(0, expression.length - 5);
    }
    return expression;
  }

  private generateSelectParameter(dataSource: TerraformDataSource): string {
    const selectFields: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      if (name === "id") {
        continue;
      }
      const apiFieldName: string = attr.apiFieldName || name;
      selectFields.push(`        "${apiFieldName}": true,`);
    }

    selectFields.push(`        "_id": true,`);

    return selectFields.join("\n");
  }

  private generateResponseMapping(
    dataSource: TerraformDataSource,
    _responseVar: string,
  ): string {
    const mappings: string[] = [];

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const apiFieldName: string = attr.apiFieldName || name;
      const setter: string = this.generateResponseSetter(
        attr,
        `data.${fieldName}`,
        `item["${apiFieldName}"]`,
      );
      mappings.push(`    ${setter}`);
    }

    return mappings.join("\n");
  }

  private generateResponseSetter(
    attr: TerraformAttribute,
    fieldName: string,
    responseValue: string,
  ): string {
    switch (attr.type) {
      case "monitor_steps":
      case "string":
        /*
         * Strings may arrive raw or wrapped ({_id}, {_type, value}). Unwrap
         * to a plain string; marshal unrecognized objects to JSON.
         */
        return `if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        if val, ok := obj["_id"].(string); ok && val != "" {
            ${fieldName} = types.StringValue(val)
        } else if val, ok := obj["value"].(string); ok {
            ${fieldName} = types.StringValue(val)
        } else if val, ok := obj["value"].(float64); ok {
            ${fieldName} = types.StringValue(fmt.Sprintf("%v", val))
        } else if jsonBytes, err := json.Marshal(obj); err == nil {
            ${fieldName} = types.StringValue(string(jsonBytes))
        } else {
            ${fieldName} = types.StringNull()
        }
    } else if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    } else {
        ${fieldName} = types.StringNull()
    }`;
      case "number":
        return `if val, ok := ${responseValue}.(float64); ok {
        ${fieldName} = types.NumberValue(big.NewFloat(val))
    } else if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        if val, ok := obj["value"].(float64); ok {
            ${fieldName} = types.NumberValue(big.NewFloat(val))
        } else {
            ${fieldName} = types.NumberNull()
        }
    } else {
        ${fieldName} = types.NumberNull()
    }`;
      case "bool":
        return `if val, ok := ${responseValue}.(bool); ok {
        ${fieldName} = types.BoolValue(val)
    } else {
        ${fieldName} = types.BoolNull()
    }`;
      case "list":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        var listItems []attr.Value
        for _, item := range val {
            if itemMap, ok := item.(map[string]interface{}); ok {
                if id, ok := itemMap["_id"].(string); ok {
                    listItems = append(listItems, types.StringValue(id))
                } else if id, ok := itemMap["id"].(string); ok {
                    listItems = append(listItems, types.StringValue(id))
                } else if jsonBytes, err := json.Marshal(itemMap); err == nil {
                    listItems = append(listItems, types.StringValue(string(jsonBytes)))
                }
            } else if str, ok := item.(string); ok {
                listItems = append(listItems, types.StringValue(str))
            } else {
                listItems = append(listItems, types.StringValue(fmt.Sprintf("%v", item)))
            }
        }
        ${fieldName} = types.ListValueMust(types.StringType, listItems)
    } else {
        ${fieldName} = types.ListNull(types.StringType)
    }`;
      case "set":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        var setItems []attr.Value
        for _, item := range val {
            if itemMap, ok := item.(map[string]interface{}); ok {
                if id, ok := itemMap["_id"].(string); ok {
                    setItems = append(setItems, types.StringValue(id))
                } else if id, ok := itemMap["id"].(string); ok {
                    setItems = append(setItems, types.StringValue(id))
                } else if jsonBytes, err := json.Marshal(itemMap); err == nil {
                    setItems = append(setItems, types.StringValue(string(jsonBytes)))
                }
            } else if str, ok := item.(string); ok {
                setItems = append(setItems, types.StringValue(str))
            } else {
                setItems = append(setItems, types.StringValue(fmt.Sprintf("%v", item)))
            }
        }
        sort.Slice(setItems, func(i, j int) bool {
            return setItems[i].(types.String).ValueString() < setItems[j].(types.String).ValueString()
        })
        ${fieldName} = types.SetValueMust(types.StringType, setItems)
    } else {
        ${fieldName} = types.SetNull(types.StringType)
    }`;
      case "map":
        return `if val, ok := ${responseValue}.(map[string]interface{}); ok {
        elements := make(map[string]attr.Value)
        for key, item := range val {
            if strItem, ok := item.(string); ok {
                elements[key] = types.StringValue(strItem)
            } else {
                elements[key] = types.StringValue(fmt.Sprintf("%v", item))
            }
        }
        mapValue, _ := types.MapValue(types.StringType, elements)
        ${fieldName} = mapValue
    } else {
        ${fieldName} = types.MapNull(types.StringType)
    }`;
      default:
        return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    } else {
        ${fieldName} = types.StringNull()
    }`;
    }
  }

  private mapTerraformTypeToGo(terraformType: string): string {
    switch (terraformType) {
      // Data sources expose monitor steps as their raw JSON (read-only).
      case "monitor_steps":
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
      case "monitor_steps":
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
