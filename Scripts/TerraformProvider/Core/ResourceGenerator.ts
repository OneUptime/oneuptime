import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformResource,
  TerraformAttribute,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";
import { GoCodeGenerator } from "./GoCodeGenerator";
import { ObjectType } from "Common/Types/JSON";
import path from "path";
import fs from "fs";

/*
 * StaticFiles holds Go source we copy verbatim into the generated provider
 * tree. Editing these as real .go files (rather than embedded TS template
 * literals) gives full Go tooling — syntax highlighting, gofmt, go test —
 * and avoids backtick-escaping the JSON fixtures inside the test file.
 */
const STATIC_FILES_DIR: string = path.join(__dirname, "..", "StaticFiles");

export class ResourceGenerator {
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateResources(): Promise<void> {
    // Create parser and set the spec to get resources
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const resources: TerraformResource[] = parser.getResources();

    /*
     * Emit shared helpers used across all resources (JSON subset semantic
     * equality for complex JSON string fields), plus the unit tests that
     * pin its behavior to the framework's actual call convention. Both come
     * straight from StaticFiles/ — they're plain Go, not generated.
     */
    await this.copyStaticFile("jsonsubset.go", "internal/provider");
    await this.copyStaticFile("jsonsubset_test.go", "internal/provider");
    await this.copyStaticFile("rfc3339.go", "internal/provider");
    await this.copyStaticFile("rfc3339_test.go", "internal/provider");
    await this.copyStaticFile("jsonenvelope.go", "internal/provider");
    await this.copyStaticFile("jsonenvelope_test.go", "internal/provider");
    await this.copyStaticFileIfExists("monitorsteps.go", "internal/provider");
    await this.copyStaticFileIfExists(
      "monitorsteps_test.go",
      "internal/provider",
    );
    await this.copyStaticFile(
      "provider_schema_smoke_test.go",
      "internal/provider",
    );

    /*
     * Package-level ObjectType registry shared by every resource and the
     * envelope validator (was duplicated as a per-resource map).
     */
    await this.generateObjectTypesFile();

    // Generate each resource
    for (const resource of resources) {
      await this.generateResource(resource);
    }

    // Update provider.go to include resources
    await this.updateProviderWithResources(resources);
  }

  /*
   * Copies a Go file from StaticFiles/ verbatim into the generated provider
   * tree. Used for `jsonsubset.go` and `jsonsubset_test.go` — these are real
   * Go files (not generated), so we keep gofmt/IDE support and don't have to
   * embed multi-line Go inside TypeScript template literals.
   */
  private async copyStaticFile(
    fileName: string,
    targetDir: string,
  ): Promise<void> {
    const sourcePath: string = path.join(STATIC_FILES_DIR, fileName);
    const content: string = this.fileGenerator.readTemplateFile(sourcePath);
    await this.fileGenerator.writeFileInDir(targetDir, fileName, content);
  }

  private async copyStaticFileIfExists(
    fileName: string,
    targetDir: string,
  ): Promise<boolean> {
    const sourcePath: string = path.join(STATIC_FILES_DIR, fileName);
    if (!fs.existsSync(sourcePath)) {
      return false;
    }
    await this.copyStaticFile(fileName, targetDir);
    return true;
  }

  private async generateResource(resource: TerraformResource): Promise<void> {
    const resourceGoContent: string = this.generateResourceGoFile(resource);
    const fileName: string = `resource_${resource.name}.go`;
    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      fileName,
      resourceGoContent,
    );
  }

  private generateResourceGoFile(resource: TerraformResource): string {
    const resourceTypeName: string = StringUtils.toPascalCase(resource.name);
    const resourceVarName: string = StringUtils.toCamelCase(resource.name);

    // Determine which imports are needed based on actual usage
    const imports: string[] = [
      "context",
      "fmt",
      "github.com/hashicorp/terraform-plugin-framework/resource",
      "github.com/hashicorp/terraform-plugin-framework/resource/schema",
      "github.com/hashicorp/terraform-plugin-framework/types",
      /*
       * basetypes is always pulled in because parseJSONField accepts the
       * generic StringValuable interface (so it works for both types.String
       * and the JSONSubsetValue used on complex-JSON fields).
       */
      "github.com/hashicorp/terraform-plugin-framework/types/basetypes",
      "github.com/hashicorp/terraform-plugin-log/tflog",
    ];

    // Add conditional imports only if they're actually used
    const hasReadOperation: boolean = Boolean(resource.operations.read);
    const hasDeleteOperation: boolean = Boolean(resource.operations.delete);
    const hasDefaultValues: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return attr.default !== undefined && attr.default !== null;
      },
    );

    // Always add math/big since the bigFloatToFloat64 helper method uses it
    imports.push("math/big");

    // Read uses http.StatusNotFound for gone-detection; Delete for tolerating it.
    if (hasReadOperation || hasDeleteOperation) {
      imports.push("net/http");
    }

    /*
     * path.Root is only used by the passthrough importer, which requires a
     * read endpoint; read-less resources emit an error importer instead.
     */
    if (hasReadOperation) {
      imports.push("github.com/hashicorp/terraform-plugin-framework/path");
    }

    // Always add encoding/json since we have helper methods that use it
    imports.push("encoding/json");
    // Always add net/url and strings for URL normalization helpers
    imports.push("net/url");
    imports.push("strings");

    if (hasDefaultValues) {
      const hasDefaultBools: boolean = Object.entries(resource.schema).some(
        ([name, attr]: [string, any]) => {
          const isInCreateSchema: boolean = Boolean(
            resource?.operationSchemas?.create &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.create,
                name,
              ),
          );
          const isInUpdateSchema: boolean = Boolean(
            resource?.operationSchemas?.update &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.update,
                name,
              ),
          );
          return (
            attr.default !== undefined &&
            attr.default !== null &&
            attr.type === "bool" &&
            !(
              attr.default !== undefined &&
              attr.default !== null &&
              !isInCreateSchema &&
              !isInUpdateSchema
            )
          );
        },
      );
      const hasDefaultNumbers: boolean = Object.entries(resource.schema).some(
        ([name, attr]: [string, any]) => {
          const isInCreateSchema: boolean = Boolean(
            resource?.operationSchemas?.create &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.create,
                name,
              ),
          );
          const isInUpdateSchema: boolean = Boolean(
            resource?.operationSchemas?.update &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.update,
                name,
              ),
          );
          return (
            attr.default !== undefined &&
            attr.default !== null &&
            attr.type === "number" &&
            !(
              attr.default !== undefined &&
              attr.default !== null &&
              !isInCreateSchema &&
              !isInUpdateSchema
            )
          );
        },
      );
      const hasDefaultStrings: boolean = Object.entries(resource.schema).some(
        ([name, attr]: [string, any]) => {
          const isInCreateSchema: boolean = Boolean(
            resource?.operationSchemas?.create &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.create,
                name,
              ),
          );
          const isInUpdateSchema: boolean = Boolean(
            resource?.operationSchemas?.update &&
              Object.prototype.hasOwnProperty.call(
                resource.operationSchemas.update,
                name,
              ),
          );
          return (
            attr.default !== undefined &&
            attr.default !== null &&
            attr.type === "string" &&
            !(
              attr.default !== undefined &&
              attr.default !== null &&
              !isInCreateSchema &&
              !isInUpdateSchema
            )
          );
        },
      );

      if (hasDefaultBools) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault",
        );
      }
      if (hasDefaultNumbers) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/numberdefault",
        );
      }
      if (hasDefaultStrings) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault",
        );
      }
    }

    // Check for collection types that need the attr package (for response mapping)
    const hasCollectionTypes: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return attr.type === "list" || attr.type === "set";
      },
    );
    const hasSetTypes: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return attr.type === "set";
      },
    );

    // Check for list types that need default empty lists (excluding computed fields)
    const hasListDefaults: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return (
          attr.type === "list" &&
          !attr.required &&
          attr.default === undefined &&
          !attr.computed
        );
      },
    );

    const hasSetDefaults: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return (
          attr.type === "set" &&
          !attr.required &&
          attr.default === undefined &&
          !attr.computed
        );
      },
    );

    if (hasCollectionTypes) {
      imports.push("github.com/hashicorp/terraform-plugin-framework/attr");
    }
    if (hasSetTypes) {
      // Add sort import for deterministic ordering in set outputs
      imports.push("sort");
    }

    if (hasListDefaults) {
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/listdefault",
      );
    }
    if (hasSetDefaults) {
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/setdefault",
      );
    }

    if (resource.operations.create || resource.operations.update) {
      /*
       * A per-type plan modifier import is needed when a field of that type is
       * Optional+Computed (UseStateForUnknown) or immutable (RequiresReplace).
       */
      const needsPlanModifier: (type: string) => boolean = (
        type: string,
      ): boolean => {
        return Object.entries(resource.schema).some(
          ([name, attr]: [string, any]) => {
            if (attr.type !== type) {
              return false;
            }
            const isProjectId: boolean =
              name === "project_id" || name === "projectId";
            const isComputedOnly: boolean = Boolean(
              attr.computed && !attr.optional,
            );
            /*
             * Must mirror generateSchemaAttribute's emission conditions
             * exactly, or Go ends up with unused imports.
             */
            return (
              (attr.optional && attr.computed && !isProjectId) ||
              (attr.forceNew && !isComputedOnly && !isProjectId)
            );
          },
        );
      };

      // Always need planmodifier and stringplanmodifier for the id field and Optional+Computed strings
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier",
      );
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier",
      );

      // Only add other plan modifier imports if needed
      if (needsPlanModifier("bool")) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier",
        );
      }
      if (needsPlanModifier("number")) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/numberplanmodifier",
        );
      }
      if (needsPlanModifier("list")) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/listplanmodifier",
        );
      }
      if (needsPlanModifier("set")) {
        imports.push(
          "github.com/hashicorp/terraform-plugin-framework/resource/schema/setplanmodifier",
        );
      }
    }

    /*
     * Enum strings get OneOf validators; writable complex-JSON fields get
     * the plan-time envelope validator. Both need the validator package.
     */
    const isProjectIdName: (name: string) => boolean = (
      name: string,
    ): boolean => {
      return name === "project_id" || name === "projectId";
    };
    const hasEnumValidators: boolean = Object.entries(resource.schema).some(
      ([name, attr]: [string, any]) => {
        return (
          attr.type === "string" &&
          Array.isArray(attr.enumValues) &&
          attr.enumValues.length > 0 &&
          !(attr.computed && !attr.optional) &&
          !isProjectIdName(name)
        );
      },
    );
    const hasEnvelopeValidators: boolean = Object.entries(resource.schema).some(
      ([name, attr]: [string, any]) => {
        return (
          attr.type === "string" &&
          attr.isComplexObject &&
          !(attr.computed && !attr.optional) &&
          !isProjectIdName(name)
        );
      },
    );
    if (hasEnumValidators || hasEnvelopeValidators) {
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework/schema/validator",
      );
    }
    if (hasEnumValidators) {
      imports.push(
        "github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator",
      );
    }

    // Scalar (non-entity) list/set attributes need strconv for numeric round-trips.
    const hasScalarCollections: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return (
          (attr.type === "list" || attr.type === "set") &&
          attr.elementKind === "scalar"
        );
      },
    );
    if (hasScalarCollections) {
      imports.push("strconv");
    }

    const importStatements: string = imports
      .map((imp: string) => {
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
        MarkdownDescription: "${GoCodeGenerator.escapeString(resource.description || `Manages a ${resource.name.replace(/_/g, " ")} in OneUptime.`)}",

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
${
  resource.operations.read
    ? `    resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)`
    : `    // Without a read endpoint, a passthrough import would silently create
    // id-only state that can never be refreshed. Fail loudly instead.
    resp.Diagnostics.AddError(
        "Import Not Supported",
        "oneuptime_${resource.name} cannot be imported: the OneUptime API exposes no read endpoint for it.",
    )`
}
}

// Helper method to convert Terraform map to Go interface{}
func (r *${resourceTypeName}Resource) convertTerraformMapToInterface(terraformMap types.Map) interface{} {
    if terraformMap.IsNull() || terraformMap.IsUnknown() {
        return nil
    }
    
    result := make(map[string]string)
    terraformMap.ElementsAs(context.Background(), &result, false)
    
    // Convert map[string]string to map[string]interface{}
    interfaceResult := make(map[string]interface{})
    for key, value := range result {
        interfaceResult[key] = value
    }
    
    return interfaceResult
}

// Helper method to convert Terraform list to Go interface{}
func (r *${resourceTypeName}Resource) convertTerraformListToInterface(terraformList types.List) interface{} {
    if terraformList.IsNull() || terraformList.IsUnknown() {
        return nil
    }

    var stringList []string
    terraformList.ElementsAs(context.Background(), &stringList, false)

    // Convert string array to OneUptime format with _id fields
    var result []interface{}
    for _, str := range stringList {
        if str != "" {
            result = append(result, map[string]interface{}{
                "_id": str,
            })
        }
    }
    return result
}

// Helper method to convert Terraform set to Go interface{}
func (r *${resourceTypeName}Resource) convertTerraformSetToInterface(terraformSet types.Set) interface{} {
    if terraformSet.IsNull() || terraformSet.IsUnknown() {
        return nil
    }

    var stringList []string
    terraformSet.ElementsAs(context.Background(), &stringList, false)

    // Convert string array to OneUptime format with _id fields
    var result []interface{}
    for _, str := range stringList {
        if str != "" {
            result = append(result, map[string]interface{}{
                "_id": str,
            })
        }
    }
    return result
}
${this.generateScalarCollectionHelpers(resource, resourceTypeName)}

// Helper method to parse JSON field for complex objects
func (r *${resourceTypeName}Resource) parseJSONField(terraformString basetypes.StringValuable) interface{} {
    sv, _ := terraformString.ToStringValue(context.Background())
    if sv.IsNull() || sv.IsUnknown() || sv.ValueString() == "" {
        return nil
    }

    var result interface{}
    if err := json.Unmarshal([]byte(sv.ValueString()), &result); err != nil {
        // If JSON parsing fails, return the raw string
        return sv.ValueString()
    }

    return result
}

// Normalize URL wrapper objects to avoid drift (e.g., trailing slash differences).
func (r *${resourceTypeName}Resource) normalizeURLWrappers(value interface{}) interface{} {
    switch v := value.(type) {
    case map[string]interface{}:
        if typeStr, ok := v["_type"].(string); ok && typeStr == "URL" {
            if val, ok := v["value"].(string); ok {
                v["value"] = r.normalizeURLString(val)
            }
        }
        for key, child := range v {
            v[key] = r.normalizeURLWrappers(child)
        }
        return v
    case []interface{}:
        for i, child := range v {
            v[i] = r.normalizeURLWrappers(child)
        }
        return v
    default:
        return v
    }
}

func (r *${resourceTypeName}Resource) normalizeURLString(value string) string {
    parsed, err := url.Parse(value)
    if err != nil {
        return value
    }
    if parsed.Path == "/" && parsed.RawQuery == "" && parsed.Fragment == "" {
        return strings.TrimSuffix(value, "/")
    }
    return value
}

// Helper method to convert *big.Float to float64 for JSON serialization
func (r *${resourceTypeName}Resource) bigFloatToFloat64(bf *big.Float) interface{} {
    if bf == nil {
        return nil
    }
    f, _ := bf.Float64()
    return f
}

// Helper method to check if a type string is a valid OneUptime ObjectType.
// The registry itself lives in objecttypes.go, shared across the package.
func (r *${resourceTypeName}Resource) isValidOneUptimeObjectType(typeStr string) bool {
    return validOneUptimeObjectTypes[typeStr]
}
`;
  }

  /*
   * Emits the package-level ObjectType registry, generated from
   * Common/Types/JSON.ts so it stays in sync with the API's wrapper types.
   */
  private async generateObjectTypesFile(): Promise<void> {
    const content: string = `package provider

// validOneUptimeObjectTypes lists every {_type: ...} wrapper the OneUptime
// API emits. Generated from Common/Types/JSON.ts ObjectType.
var validOneUptimeObjectTypes = map[string]bool{
${this.generateValidObjectTypesMap()}
}
`;
    await this.fileGenerator.writeFileInDir(
      "internal/provider",
      "objecttypes.go",
      content,
    );
  }

  private generateModelFields(resource: TerraformResource): string {
    const fields: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      /*
       * Complex JSON string fields use a custom type whose semantic-equality
       * tolerates server-side defaults (see jsonsubset.go); RFC3339 fields use
       * a custom type whose semantic-equality compares instants (rfc3339.go).
       */
      let goType: string = this.mapTerraformTypeToGo(attr.type);
      if (attr.type === "monitor_steps") {
        goType = "MonitorStepsValue";
      } else if (attr.type === "string" && attr.isDateTime) {
        goType = "RFC3339Value";
      } else if (attr.type === "string" && attr.isComplexObject) {
        goType = "JSONSubsetValue";
      }
      fields.push(`    ${fieldName} ${goType} \`tfsdk:"${sanitizedName}"\``);
    }

    return fields.join("\n");
  }

  private generateSchemaAttributes(resource: TerraformResource): string {
    const attributes: string[] = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const schemaAttr: string = this.generateSchemaAttribute(
        sanitizedName,
        attr,
        resource,
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

  private generateSchemaAttribute(
    name: string,
    attr: any,
    resource?: TerraformResource,
  ): string {
    /*
     * MonitorSteps fields use the hand-written typed nested attribute
     * (monitorsteps.go) instead of a generated JSON-string attribute.
     */
    if (attr.isMonitorSteps) {
      return `MonitorStepsSchemaAttribute("${GoCodeGenerator.escapeString(
        attr.description ||
          "Monitoring steps: destinations, request settings, and alerting criteria.",
      )}")`;
    }

    const attrType: string = this.mapTerraformTypeToSchemaType(attr.type);
    const options: string[] = [];

    if (attr.description) {
      options.push(
        `MarkdownDescription: "${GoCodeGenerator.escapeString(attr.description)}"`,
      );
    }

    /*
     * Complex JSON string fields use JSONSubsetType so the framework treats
     * server-supplied defaults as semantically equal to the planned value.
     * RFC3339 fields use RFC3339Type so server-side timestamp normalization
     * (e.g. "...Z" -> "...000Z") is not reported as drift.
     */
    if (attr.type === "string" && attr.isDateTime) {
      options.push("CustomType: RFC3339Type{}");
    } else if (attr.type === "string" && attr.isComplexObject) {
      options.push("CustomType: JSONSubsetType{}");
    }

    // Check if this field is in the create or update schema (for fields with defaults)
    const isInCreateSchema: boolean = Boolean(
      resource?.operationSchemas?.create &&
        Object.prototype.hasOwnProperty.call(
          resource.operationSchemas.create,
          name,
        ),
    );
    const isInUpdateSchema: boolean = Boolean(
      resource?.operationSchemas?.update &&
        Object.prototype.hasOwnProperty.call(
          resource.operationSchemas.update,
          name,
        ),
    );

    // project_id is inferred from API key authentication, so make it computed-only
    const isProjectIdField: boolean =
      name === "project_id" || name === "projectId";

    if (isProjectIdField) {
      // Project ID is always computed from API key - users don't need to provide it
      options.push("Computed: true");
    } else if (attr.required) {
      options.push("Required: true");
    } else if (attr.optional && attr.computed) {
      // Handle fields that are both optional and computed (server-managed with optional user input)
      options.push("Optional: true");
      options.push("Computed: true");
    } else if (attr.computed) {
      options.push("Computed: true");
    } else if (
      attr.default !== undefined &&
      attr.default !== null &&
      !isInCreateSchema &&
      !isInUpdateSchema
    ) {
      /*
       * Fields with defaults that are not in create or update schema should be Computed only
       * This prevents drift when the server manages these fields
       */
      options.push("Computed: true");
    } else {
      options.push("Optional: true");
    }

    // Attributes with default values that are in the create or update schema must also be computed
    if (
      attr.default !== undefined &&
      attr.default !== null &&
      !attr.required &&
      !attr.computed &&
      (isInCreateSchema || isInUpdateSchema)
    ) {
      options.push("Computed: true");
    }

    if (attr.sensitive) {
      options.push("Sensitive: true");
    }

    // Add default value if available and field is not computed-only
    if (
      attr.default !== undefined &&
      attr.default !== null &&
      !(
        attr.default !== undefined &&
        attr.default !== null &&
        !isInCreateSchema &&
        !isInUpdateSchema
      )
    ) {
      if (attr.type === "bool") {
        // Convert various values to boolean
        let boolValue: boolean;
        if (typeof attr.default === "boolean") {
          boolValue = attr.default;
        } else if (typeof attr.default === "number") {
          boolValue = attr.default !== 0;
        } else if (typeof attr.default === "string") {
          boolValue = attr.default.toLowerCase() === "true";
        } else {
          boolValue = Boolean(attr.default);
        }
        options.push(`Default: booldefault.StaticBool(${boolValue})`);
      } else if (attr.type === "number") {
        options.push(
          `Default: numberdefault.StaticBigFloat(big.NewFloat(${attr.default}))`,
        );
      } else if (attr.type === "string") {
        options.push(`Default: stringdefault.StaticString("${attr.default}")`);
      }
    }

    /*
     * Add default empty list/set for collection types to avoid null vs empty list/set inconsistencies
     * Exception: Don't add defaults for computed fields as they should be server-managed
     */
    if (
      attr.type === "list" &&
      !attr.required &&
      attr.default === undefined &&
      !attr.computed
    ) {
      options.push(
        "Default: listdefault.StaticValue(types.ListValueMust(types.StringType, []attr.Value{}))",
      );
      // Ensure the attribute is also computed since it has a default
      if (!options.includes("Computed: true")) {
        options.push("Computed: true");
      }
    }
    if (
      attr.type === "set" &&
      !attr.required &&
      attr.default === undefined &&
      !attr.computed
    ) {
      options.push(
        "Default: setdefault.StaticValue(types.SetValueMust(types.StringType, []attr.Value{}))",
      );
      // Ensure the attribute is also computed since it has a default
      if (!options.includes("Computed: true")) {
        options.push("Computed: true");
      }
    }

    // For collection attributes, add ElementType
    if (attr.type === "map" || attr.type === "list" || attr.type === "set") {
      options.push("ElementType: types.StringType");
    }

    /*
     * Plan modifiers: UseStateForUnknown for the id and Optional+Computed
     * fields (prevents "inconsistent result after apply" when the server
     * fills defaults); RequiresReplace for fields the API only accepts at
     * create time.
     */
    const modifierPackageByType: Record<string, string> = {
      string: "stringplanmodifier",
      bool: "boolplanmodifier",
      number: "numberplanmodifier",
      list: "listplanmodifier",
      set: "setplanmodifier",
    };
    const modifierInterfaceByType: Record<string, string> = {
      string: "String",
      bool: "Bool",
      number: "Number",
      list: "List",
      set: "Set",
    };
    const modifierPackage: string | undefined =
      modifierPackageByType[attr.type];
    const modifierInterface: string | undefined =
      modifierInterfaceByType[attr.type];

    const modifiers: string[] = [];
    if (name === "id" || (attr.optional && attr.computed && modifierPackage)) {
      modifiers.push(
        `${modifierPackage || "stringplanmodifier"}.UseStateForUnknown()`,
      );
    }
    const isComputedOnly: boolean = Boolean(attr.computed && !attr.optional);

    if (
      attr.forceNew &&
      name !== "id" &&
      !isComputedOnly &&
      !isProjectIdField &&
      modifierPackage
    ) {
      modifiers.push(`${modifierPackage}.RequiresReplace()`);
    }

    let planModifiers: string = "";
    if (modifiers.length > 0 && modifierInterface) {
      planModifiers = `,
                PlanModifiers: []planmodifier.${modifierInterface}{
                    ${modifiers.join(",\n                    ")},
                }`;
    }

    /*
     * Plan-time validators: OneOf for enum strings; the JSON-envelope
     * validator for writable complex-JSON fields, so malformed JSON, bogus
     * {_type} values, and unparseable DateTime values fail at plan time
     * instead of as API 400/500s at apply time.
     */
    let validators: string = "";
    if (
      attr.type === "string" &&
      Array.isArray(attr.enumValues) &&
      attr.enumValues.length > 0 &&
      !isComputedOnly &&
      !isProjectIdField
    ) {
      const values: string = attr.enumValues
        .map((value: string) => {
          return `"${GoCodeGenerator.escapeString(value)}"`;
        })
        .join(", ");
      validators = `,
                Validators: []validator.String{
                    stringvalidator.OneOf(${values}),
                }`;
    } else if (
      attr.type === "string" &&
      attr.isComplexObject &&
      !isComputedOnly &&
      !isProjectIdField
    ) {
      validators = `,
                Validators: []validator.String{
                    JSONEnvelopeValidator(),
                }`;
    }

    return `schema.${attrType}Attribute{
                ${options.join(",\n                ")}${planModifiers}${validators},
            }`;
  }

  private generateCRUDMethods(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    let methods: string = "";

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
    const operation: any = resource.operations.create!;
    const path: string = this.extractPathFromOperation(operation);

    /*
     * After a successful POST, re-read the resource through the get-item
     * endpoint (when one exists) with the full select. The raw create
     * response omits server-computed fields, and mapping it directly is what
     * produced "planned value -> null" inconsistencies.
     */
    let readBackCode: string = `
    // No read endpoint for this resource: map the create response directly.
    // Update the model with response data
${this.generateResponseMapping(resource, resourceVarName + "Response", true)}`;

    if (resource.operations.read) {
      const readPath: string = this.buildPathExpression(
        this.extractPathFromOperation(resource.operations.read),
      );
      readBackCode = `
    // Extract the new resource id from the create response.
    createdId := ""
    if wrapper, ok := ${resourceVarName}Response["data"].(map[string]interface{}); ok {
        if val, ok := wrapper["_id"].(string); ok {
            createdId = val
        }
    } else if val, ok := ${resourceVarName}Response["_id"].(string); ok {
        createdId = val
    }
    if createdId == "" {
        resp.Diagnostics.AddError("OneUptime API Error", "Create response for ${resource.name} did not contain an id. This is a bug in the provider or the API; please report it.")
        return
    }
    data.Id = types.StringValue(createdId)

    /*
     * The server has committed the row. Persist what we know to state BEFORE
     * the read-back: if the read-back fails and we return without setting
     * state, Terraform never learns the resource exists and the created
     * ${resource.name} is orphaned server-side — never refreshed, never
     * destroyed. Delete already refuses to drop state on failure for the
     * same reason; Create must not either.
     */
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
    if resp.Diagnostics.HasError() {
        return
    }

    // Re-read the resource so state reflects server-normalized values.
    selectParam := map[string]interface{}{
${this.generateSelectParameter(resource)}
    }

    readResp, err := r.client.PostWithSelect(ctx, ${readPath}, selectParam)
    if err != nil {
        /*
         * State already owns the id, so the resource is tracked and the next
         * refresh reconciles the remaining attributes. Warn rather than
         * error: erroring here would strand a real resource.
         */
        resp.Diagnostics.AddWarning("Read After Create Failed", fmt.Sprintf("Created ${resource.name} but could not read it back; state is incomplete until the next refresh: %s", err))
        return
    }

    var readResponse map[string]interface{}
    err = r.client.ParseResponse(readResp, &readResponse)
    if err != nil {
        resp.Diagnostics.AddWarning("Read After Create Failed", fmt.Sprintf("Created ${resource.name} but could not parse the read-back response; state is incomplete until the next refresh: %s", err))
        return
    }

    // Update the model with the authoritative read response
${this.generateResponseMapping(resource, "readResponse", true)}
    // The read response is authoritative, but never let it clobber the id we just received.
    data.Id = types.StringValue(createdId)`;
    }

    return `
func (r *${resourceTypeName}Resource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

${this.generateOriginalValueStorage(resource)}

    // Create API request body. Unset (null/unknown) optional fields are
    // omitted so server-side defaults apply instead of being overwritten
    // with zero values.
    ${resourceVarName}Request := map[string]interface{}{
        "data": map[string]interface{}{},
    }
${this.generateGuardedCreateRequestBody(resource, resourceVarName)}

    // Make API call
    httpResp, err := r.client.Post(ctx, "${path}", ${resourceVarName}Request)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to create ${resource.name}, got error: %s", err))
        return
    }

    var ${resourceVarName}Response map[string]interface{}
    err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
    if err != nil {
        resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to create ${resource.name}: %s", err))
        return
    }
${readBackCode}

    // Write logs using the tflog package
    tflog.Trace(ctx, "created a resource")

    // Save data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  /*
   * Builds a Go string expression for an API path, replacing {param}
   * placeholders with the resource id from state.
   */
  private buildPathExpression(path: string): string {
    const pathWithParams: string = path.replace(
      /{([^}]+)}/g,
      `" + data.Id.ValueString() + "`,
    );

    let finalPath: string;
    if (pathWithParams.includes('" + ')) {
      if (pathWithParams.startsWith('" + ')) {
        finalPath = pathWithParams.substring(4);
      } else {
        finalPath = `"${pathWithParams}"`;
      }
      if (finalPath.endsWith(' + "')) {
        finalPath = finalPath.substring(0, finalPath.length - 4);
      }
    } else {
      finalPath = `"${pathWithParams}"`;
    }
    return finalPath;
  }

  private generateReadMethod(
    resource: TerraformResource,
    resourceTypeName: string,
    resourceVarName: string,
  ): string {
    const operation: any = resource.operations.read!;
    const path: string = this.extractPathFromOperation(operation);

    // Replace path parameters
    const pathWithParams: string = path.replace(
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

    // Create select parameter to get full object
    selectParam := map[string]interface{}{
${this.generateSelectParameter(resource)}
    }

    // Make API call with select parameter
    httpResp, err := r.client.PostWithSelect(ctx, ${finalPath}, selectParam)
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
${this.generateResponseMapping(resource, resourceVarName + "Response", false)}

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
    const updateOperation: any = resource.operations.update!;
    const finalUpdatePath: string = this.buildPathExpression(
      this.extractPathFromOperation(updateOperation),
    );

    // Refresh through the read endpoint after update, when one exists.
    const hasRead: boolean = Boolean(resource.operations.read);
    const finalReadPath: string = hasRead
      ? this.buildPathExpression(
          this.extractPathFromOperation(resource.operations.read),
        )
      : "";

    const httpMethod: string =
      updateOperation.method && updateOperation.method.toUpperCase() === "PATCH"
        ? "Patch"
        : "Put";

    const readBackCode: string = hasRead
      ? `
    // After successful update, fetch the current state by calling Read with select parameter
    selectParam := map[string]interface{}{
${this.generateSelectParameter(resource)}
    }

    readResp, err := r.client.PostWithSelect(ctx, ${finalReadPath}, selectParam)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to read ${resource.name} after update, got error: %s", err))
        return
    }

    var readResponse map[string]interface{}
    err = r.client.ParseResponse(readResp, &readResponse)
    if err != nil {
        resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to read ${resource.name} after update: %s", err))
        return
    }

    // Update the model with response data from the Read operation
${this.generateResponseMapping(resource, "readResponse", false)}
    data.Id = state.Id`
      : `
    // No read endpoint for this resource: the planned values become state.`;

    return `
func (r *${resourceTypeName}Resource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
    var data ${resourceTypeName}ResourceModel
    var state ${resourceTypeName}ResourceModel

    // Read Terraform current state data to get the ID
    resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
    if resp.Diagnostics.HasError() {
        return
    }

    // Read Terraform plan data to get the new values
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)
    if resp.Diagnostics.HasError() {
        return
    }

    // Use the ID from the current state
    data.Id = state.Id

    // Create API request body
    ${resourceVarName}Request := map[string]interface{}{
        "data": map[string]interface{}{},
    }
${this.generateConditionalUpdateRequestBodyWithDeclaration(resource, resourceVarName)}

    // Only call the API when there are changed fields to send. An empty
    // update body is rejected by the API; state is still refreshed below so
    // this method never writes unverified plan values into state.
    if len(${resourceVarName}Request["data"].(map[string]interface{})) > 0 {
        httpResp, err := r.client.${httpMethod}(ctx, ${finalUpdatePath}, ${resourceVarName}Request)
        if err != nil {
            resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to update ${resource.name}, got error: %s", err))
            return
        }

        // Parse the update response
        var ${resourceVarName}Response map[string]interface{}
        err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
        if err != nil {
            resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to update ${resource.name}: %s", err))
            return
        }
        _ = ${resourceVarName}Response
    }
${readBackCode}

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
    const operation: any = resource.operations.delete!;
    const path: string = this.extractPathFromOperation(operation);

    // Replace path parameters
    const pathWithParams: string = path.replace(
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
    httpResp, err := r.client.Delete(ctx, ${finalPath})
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to delete ${resource.name}, got error: %s", err))
        return
    }

    // A failed delete must keep the resource in state — silently dropping it
    // orphans real infrastructure. 404 means it is already gone.
    if httpResp.StatusCode >= 400 && httpResp.StatusCode != http.StatusNotFound {
        err = r.client.ParseResponse(httpResp, nil)
        resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to delete ${resource.name}: %s", err))
        return
    }
    if httpResp.Body != nil {
        httpResp.Body.Close()
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
    var data ${resourceTypeName}ResourceModel

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // This resource does not have a read API endpoint.
    // Preserve the existing state as-is to prevent drift errors.
    tflog.Trace(ctx, "read a resource (no-op: preserving existing state)")

    // Save existing data back into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateStubUpdateMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }

    // This resource does not have an update API endpoint.
    // Preserve the planned state.
    tflog.Trace(ctx, "updated a resource (no-op: preserving planned state)")

    // Save planned data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  private generateStubDeleteMethod(resourceTypeName: string): string {
    return `
func (r *${resourceTypeName}Resource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
    // This resource does not have a delete API endpoint.
    // Simply remove the resource from Terraform state.
    tflog.Trace(ctx, "deleted a resource (no-op: removed from state only)")
}
`;
  }

  /*
   * Emits the Create request body: one guarded assignment per writable field
   * in the create schema. Null/unknown values are omitted entirely — sending
   * ""/false/null for unset optionals overrode server defaults and corrupted
   * created resources.
   */
  private generateGuardedCreateRequestBody(
    resource: TerraformResource,
    resourceVarName: string,
  ): string {
    const createSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.create || {};
    const serverInferredFields: Array<string> = ["projectId", "project_id"];
    const assignments: string[] = [];

    const fieldNames: string[] = Object.keys(createSchema).filter(
      (name: string) => {
        const attr: TerraformAttribute = createSchema[name]!;
        return (
          name !== "id" &&
          !(attr.computed && !attr.optional) &&
          !serverInferredFields.includes(name)
        );
      },
    );

    if (fieldNames.length === 0) {
      return "";
    }

    assignments.push(
      `    requestDataMap := ${resourceVarName}Request["data"].(map[string]interface{})`,
    );
    assignments.push("");

    for (const name of fieldNames) {
      // Prefer the merged schema's metadata (elementKind, isDateTime, ...).
      const attr: TerraformAttribute =
        resource.schema[name] || createSchema[name]!;
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const apiFieldName: string = attr.apiFieldName || name;

      const valueAssignment: string = this.generateValueAssignment(
        fieldName,
        apiFieldName,
        attr,
      );

      if (attr.isMonitorSteps) {
        assignments.push(
          `    if !data.${fieldName}.IsNull() && !data.${fieldName}.IsUnknown() {
        ${StringUtils.toCamelCase(fieldName)}Value, ${StringUtils.toCamelCase(fieldName)}Diags := MonitorStepsToAPI(ctx, data.${fieldName}.ListValue)
        resp.Diagnostics.Append(${StringUtils.toCamelCase(fieldName)}Diags...)
        if resp.Diagnostics.HasError() {
            return
        }
        requestDataMap["${apiFieldName}"] = ${StringUtils.toCamelCase(fieldName)}Value
    }`,
        );
      } else if (attr.type === "string" && attr.isComplexObject) {
        // parseJSONField already returns nil for null/unknown/empty.
        assignments.push(
          `    if parsed${fieldName} := r.parseJSONField(data.${fieldName}); parsed${fieldName} != nil {
        requestDataMap["${apiFieldName}"] = parsed${fieldName}
    }`,
        );
      } else {
        assignments.push(
          `    if !data.${fieldName}.IsNull() && !data.${fieldName}.IsUnknown() {
        ${valueAssignment}
    }`,
        );
      }
    }

    return assignments.join("\n");
  }

  private generateConditionalUpdateRequestBodyWithDeclaration(
    resource: TerraformResource,
    resourceVarName: string,
  ): string {
    const updateSchema: any = resource.operationSchemas?.update || {};
    const conditionalAssignments: string[] = [];

    // Fields that should never be included in requests (inferred from API key)
    const serverInferredFields: Array<string> = ["projectId", "project_id"];

    // Check if there are any fields to process
    const hasFields: boolean = Object.entries(updateSchema).some(
      ([name, attr]: [string, any]) => {
        return (
          name !== "id" &&
          !attr.computed &&
          !serverInferredFields.includes(name)
        );
      },
    );

    // If no fields to process, return empty string
    if (!hasFields) {
      return "";
    }

    // Add the declaration only if we have fields
    conditionalAssignments.push(
      "    requestDataMap := " +
        resourceVarName +
        'Request["data"].(map[string]interface{})',
    );
    conditionalAssignments.push("");

    for (const [name, attr] of Object.entries(updateSchema)) {
      const terraformAttr: TerraformAttribute = attr as TerraformAttribute;
      if (name === "id" || terraformAttr.computed) {
        continue;
      }

      // Skip server-inferred fields (project_id is inferred from API key)
      if (serverInferredFields.includes(name)) {
        continue;
      }

      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const apiFieldName: string = terraformAttr.apiFieldName || name;

      // Generate code to only include field if it has changed between state and plan
      const changeCheckCondition: string = this.generateChangeCheckCondition(
        fieldName,
        terraformAttr.type,
      );

      const valueAssignment: string = this.generateValueAssignment(
        fieldName,
        apiFieldName,
        terraformAttr,
      );

      conditionalAssignments.push(
        `    ${changeCheckCondition} {\n        ${valueAssignment}\n    }`,
      );
    }

    return conditionalAssignments.join("\n");
  }

  private generateChangeCheckCondition(
    fieldName: string,
    fieldType: string,
  ): string {
    /*
     * For unknown values (computed fields that are "known after apply"),
     * we should not include them in update requests
     */
    const baseCondition: string = `!data.${fieldName}.IsUnknown() && !state.${fieldName}.IsUnknown() && !data.${fieldName}.Equal(state.${fieldName})`;

    switch (fieldType) {
      case "string":
        return `if ${baseCondition}`;
      case "bool":
        return `if ${baseCondition}`;
      case "number":
        return `if ${baseCondition}`;
      case "list":
        return `if ${baseCondition}`;
      case "set":
        return `if ${baseCondition}`;
      case "map":
        return `if ${baseCondition}`;
      default:
        return `if ${baseCondition}`;
    }
  }

  private generateValueAssignment(
    fieldName: string,
    apiFieldName: string,
    terraformAttr: TerraformAttribute,
  ): string {
    const value: string = this.getGoValueForTerraformType(
      terraformAttr.type,
      `data.${fieldName}`,
    );

    if (terraformAttr.isMonitorSteps) {
      return `${StringUtils.toCamelCase(fieldName)}Value, ${StringUtils.toCamelCase(fieldName)}Diags := MonitorStepsToAPI(ctx, data.${fieldName}.ListValue)
        resp.Diagnostics.Append(${StringUtils.toCamelCase(fieldName)}Diags...)
        if resp.Diagnostics.HasError() {
            return
        }
        requestDataMap["${apiFieldName}"] = ${StringUtils.toCamelCase(fieldName)}Value`;
    }

    /*
     * Scalar arrays are sent as plain values; only entity-reference arrays
     * are wrapped in {_id: ...} objects.
     */
    const isScalarCollection: boolean = terraformAttr.elementKind === "scalar";

    if (terraformAttr.type === "map") {
      return `requestDataMap["${apiFieldName}"] = r.convertTerraformMapToInterface(data.${fieldName})`;
    } else if (terraformAttr.type === "list") {
      if (isScalarCollection) {
        return `requestDataMap["${apiFieldName}"] = r.convertTerraformListToScalarSlice(data.${fieldName}, ${terraformAttr.elementType === "number" || terraformAttr.elementType === "integer"})`;
      }
      return `requestDataMap["${apiFieldName}"] = r.convertTerraformListToInterface(data.${fieldName})`;
    } else if (terraformAttr.type === "set") {
      if (isScalarCollection) {
        return `requestDataMap["${apiFieldName}"] = r.convertTerraformSetToScalarSlice(data.${fieldName}, ${terraformAttr.elementType === "number" || terraformAttr.elementType === "integer"})`;
      }
      return `requestDataMap["${apiFieldName}"] = r.convertTerraformSetToInterface(data.${fieldName})`;
    } else if (
      terraformAttr.type === "string" &&
      terraformAttr.isComplexObject
    ) {
      /*
       * Try to parse as JSON first, but if it fails (e.g., for simple strings like "#FF0000"),
       * fall back to sending the raw string value. Server-side defaults
       * filled in on the response are absorbed by JSONSubsetType's semantic
       * equality, so we do not pre-normalize here.
       */
      return `var ${fieldName.toLowerCase()}Data interface{}
        if err := json.Unmarshal([]byte(data.${fieldName}.ValueString()), &${fieldName.toLowerCase()}Data); err == nil {
            requestDataMap["${apiFieldName}"] = ${fieldName.toLowerCase()}Data
        } else {
            requestDataMap["${apiFieldName}"] = data.${fieldName}.ValueString()
        }`;
    }
    return `requestDataMap["${apiFieldName}"] = ${value}`;
  }

  /*
   * The select clause only asks for fields the read schema says are
   * readable. Selecting write-only columns (passwords, permission-gated
   * fields) made the server reject the entire Read.
   */
  private generateSelectParameter(resource: TerraformResource): string {
    const selectFields: string[] = [];
    const readSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.read || {};

    for (const [name, attr] of Object.entries(resource.schema)) {
      if (name === "id") {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(readSchema, name)) {
        continue;
      }

      const apiFieldName: string = attr.apiFieldName || name;
      selectFields.push(`        "${apiFieldName}": true,`);
    }

    // Always include _id field which is the actual API field
    selectFields.push(`        "_id": true,`);

    return selectFields.join("\n");
  }

  private generateResponseMapping(
    resource: TerraformResource,
    responseVar: string,
    isCreateMethod: boolean = false,
  ): string {
    const mappings: string[] = [];

    // Extract data from the response wrapper
    mappings.push(`    // Extract data from response wrapper`);
    mappings.push(`    var dataMap map[string]interface{}`);
    mappings.push(
      `    if wrapper, ok := ${responseVar}["data"].(map[string]interface{}); ok {`,
    );
    mappings.push(`        // Response is wrapped in a data field`);
    mappings.push(`        dataMap = wrapper`);
    mappings.push(`    } else {`);
    mappings.push(`        // Response is the direct object`);
    mappings.push(`        dataMap = ${responseVar}`);
    mappings.push(`    }`);
    mappings.push(``);

    const readSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.read || {};

    for (const [name, attr] of Object.entries(resource.schema)) {
      // id is mapped from _id at the end of this block.
      if (name === "id") {
        continue;
      }

      /*
       * Write-only fields (in the create/update schemas but never in a
       * response) are not present in API responses. Skip mapping them so the
       * value the user configured is preserved instead of being nulled out.
       */
      if (!Object.prototype.hasOwnProperty.call(readSchema, name)) {
        continue;
      }

      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const apiFieldName: string = attr.apiFieldName || name; // Use original OpenAPI field name

      if (apiFieldName === "projectId") {
        // Special handling for projectId which might come as ObjectID type
        mappings.push(
          `    if obj, ok := dataMap["${apiFieldName}"].(map[string]interface{}); ok {`,
        );
        mappings.push(`        if val, ok := obj["value"].(string); ok {`);
        mappings.push(`            data.${fieldName} = types.StringValue(val)`);
        mappings.push(`        } else {`);
        mappings.push(`            data.${fieldName} = types.StringNull()`);
        mappings.push(`        }`);
        mappings.push(
          `    } else if val, ok := dataMap["${apiFieldName}"].(string); ok {`,
        );
        mappings.push(`        data.${fieldName} = types.StringValue(val)`);
        mappings.push(`    } else {`);
        mappings.push(`        data.${fieldName} = types.StringNull()`);
        mappings.push(`    }`);
      } else {
        const setter: string = this.generateResponseSetter(
          attr,
          `data.${fieldName}`,
          `dataMap["${apiFieldName}"]`,
          isCreateMethod,
          sanitizedName,
        );
        mappings.push(`    ${setter}`);
      }
    }

    // Handle the ID field mapping (_id -> id)
    mappings.push(`    if val, ok := dataMap["_id"].(string); ok {`);
    mappings.push(`        data.Id = types.StringValue(val)`);
    mappings.push(`    } else {`);
    mappings.push(`        data.Id = types.StringNull()`);
    mappings.push(`    }`);

    return mappings.join("\n");
  }

  private generateResponseSetter(
    attr: TerraformAttribute,
    fieldName: string,
    responseValue: string,
    isCreateMethod: boolean = false,
    originalFieldName?: string,
  ): string {
    const terraformType: string = attr.type;
    const hasDefault: boolean =
      attr.default !== undefined && attr.default !== null;
    const isComplexObject: boolean = attr.isComplexObject || false;
    const format: string | undefined = attr.format;
    const isScalarCollection: boolean = attr.elementKind === "scalar";

    switch (terraformType) {
      case "monitor_steps":
        /*
         * Typed nested monitor steps: conversion (and dropping of
         * server-injected extras like ids) lives in monitorsteps.go.
         */
        return `{
        mappedSteps, stepsDiags := MonitorStepsFromAPI(ctx, ${responseValue})
        resp.Diagnostics.Append(stepsDiags...)
        ${fieldName} = MonitorStepsValue{ListValue: mappedSteps}
    }`;
      case "string":
        // Handle binary format fields (like base64 file content) specially
        if (format === "binary") {
          // For binary fields, treat the response as a simple string without complex object processing
          if (isCreateMethod && originalFieldName) {
            // In Create method, preserve original value if API doesn't return the file content
            return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    } else {
        // Preserve original value from the request since API doesn't return file content
        ${fieldName} = types.StringValue(original${StringUtils.toPascalCase(originalFieldName)}Value)
    }`;
          }
          /*
           * In Read/Update methods, preserve existing value if not present in API response
           * This prevents drift detection when API doesn't return binary content
           */
          return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    } else {
        // Keep existing value to prevent drift - API doesn't return binary content
        // ${fieldName} value is already set from the existing state
    }`;
        }

        /*
         * RFC3339 timestamps arrive either as a {_type: "DateTime", value}
         * wrapper or as a raw string. Unwrap to the raw string; RFC3339Type's
         * semantic equality absorbs server-side normalization (e.g. added
         * milliseconds), so no byte-level comparison drift.
         */
        if (attr.isDateTime) {
          return `if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        if val, ok := obj["value"].(string); ok && val != "" {
            ${fieldName} = NewRFC3339Value(val)
        } else {
            ${fieldName} = NewRFC3339Null()
        }
    } else if val, ok := ${responseValue}.(string); ok && val != "" {
        ${fieldName} = NewRFC3339Value(val)
    } else {
        ${fieldName} = NewRFC3339Null()
    }`;
        }

        if (isComplexObject) {
          /*
           * For complex object strings, check if it's a wrapper object with _type and value fields
           * (e.g., {"_type":"Version","value":"1.0.0"})
           * If so, extract the value for simple types; preserve full structure for complex typed objects
           * This path uses the same robust unwrapping logic as the default string handler
           * to ensure consistent behavior between CREATE and READ operations.
           * Uses NewJSONSubset* constructors to keep the field's JSONSubsetType.
           */
          return `if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        // Handle ObjectID type responses and wrapper objects (e.g., Version, Name types)
        if val, ok := obj["_id"].(string); ok && val != "" {
            ${fieldName} = NewJSONSubsetValue(val)
        } else if val, ok := obj["value"].(string); ok {
            // Unwrap wrapper objects - extract the inner value regardless of whether it's empty
            ${fieldName} = NewJSONSubsetValue(val)
        } else if val, ok := obj["value"].(float64); ok {
            // Handle numeric values that might be returned as float64
            ${fieldName} = NewJSONSubsetValue(fmt.Sprintf("%v", val))
        } else if typeStr, typeOk := obj["_type"].(string); typeOk && r.isValidOneUptimeObjectType(typeStr) && obj["value"] != nil {
            // For typed wrapper objects (only valid OneUptime ObjectTypes), preserve the full structure including _type
            normalizedObj := r.normalizeURLWrappers(obj)
            if jsonBytes, err := json.Marshal(normalizedObj); err == nil {
                ${fieldName} = NewJSONSubsetValue(string(jsonBytes))
            } else {
                ${fieldName} = NewJSONSubsetValue(fmt.Sprintf("%v", normalizedObj))
            }
        } else if obj["value"] != nil {
            // Handle complex value types (maps, arrays) by marshaling to JSON
            normalizedValue := r.normalizeURLWrappers(obj["value"])
            if jsonBytes, err := json.Marshal(normalizedValue); err == nil {
                ${fieldName} = NewJSONSubsetValue(string(jsonBytes))
            } else {
                ${fieldName} = NewJSONSubsetValue(fmt.Sprintf("%v", normalizedValue))
            }
        } else if jsonBytes, err := json.Marshal(obj); err == nil {
            // Fallback to JSON marshaling for other complex objects
            ${fieldName} = NewJSONSubsetValue(string(jsonBytes))
        } else {
            ${fieldName} = NewJSONSubsetNull()
        }
    } else if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = NewJSONSubsetValue(val)
    } else {
        ${fieldName} = NewJSONSubsetNull()
    }`;
        }
        /*
         * Default string handling - also unwrap wrapper objects for consistency
         * This ensures that even if isComplexObject is not set correctly,
         * wrapper objects like {"_type":"Version","value":"1.0.0"} are still properly unwrapped
         * This fixes the READ operation drift issue where API returns wrapped format
         */
        return `if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        // Handle ObjectID type responses and wrapper objects (e.g., Version, DateTime, Name types)
        if val, ok := obj["_id"].(string); ok && val != "" {
            ${fieldName} = types.StringValue(val)
        } else if val, ok := obj["value"].(string); ok {
            // Unwrap wrapper objects - extract the inner value regardless of whether it's empty
            ${fieldName} = types.StringValue(val)
        } else if val, ok := obj["value"].(float64); ok {
            // Handle numeric values that might be returned as float64
            ${fieldName} = types.StringValue(fmt.Sprintf("%v", val))
        } else if typeStr, typeOk := obj["_type"].(string); typeOk && r.isValidOneUptimeObjectType(typeStr) && obj["value"] != nil {
            // For typed wrapper objects (only valid OneUptime ObjectTypes), preserve the full structure including _type
            normalizedObj := r.normalizeURLWrappers(obj)
            if jsonBytes, err := json.Marshal(normalizedObj); err == nil {
                ${fieldName} = types.StringValue(string(jsonBytes))
            } else {
                ${fieldName} = types.StringValue(fmt.Sprintf("%v", normalizedObj))
            }
        } else if obj["value"] != nil {
            // Handle complex value types (maps, arrays) by marshaling to JSON
            normalizedValue := r.normalizeURLWrappers(obj["value"])
            if jsonBytes, err := json.Marshal(normalizedValue); err == nil {
                ${fieldName} = types.StringValue(string(jsonBytes))
            } else {
                ${fieldName} = types.StringValue(fmt.Sprintf("%v", normalizedValue))
            }
        } else if jsonBytes, err := json.Marshal(obj); err == nil {
            // Fallback to JSON marshaling for other complex objects
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
    } else if val, ok := ${responseValue}.(int); ok {
        ${fieldName} = types.NumberValue(big.NewFloat(float64(val)))
    } else if val, ok := ${responseValue}.(int64); ok {
        ${fieldName} = types.NumberValue(big.NewFloat(float64(val)))
    } else if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        // Unwrap numeric wrapper objects (e.g. {_type: "Port", value: 443})
        if val, ok := obj["value"].(float64); ok {
            ${fieldName} = types.NumberValue(big.NewFloat(val))
        } else {
            ${fieldName} = types.NumberNull()
        }
    } else {
        // Missing or unrecognized value: null, never unknown, so apply can complete.
        ${fieldName} = types.NumberNull()
    }`;
      case "bool":
        if (hasDefault) {
          // For boolean fields with defaults, don't set to null when missing - let the default value be used
          return `if val, ok := ${responseValue}.(bool); ok {
        ${fieldName} = types.BoolValue(val)
    }`;
        }
        return `if val, ok := ${responseValue}.(bool); ok {
        ${fieldName} = types.BoolValue(val)
    } else {
        ${fieldName} = types.BoolNull()
    }`;

      case "map":
        return `if val, ok := ${responseValue}.(map[string]interface{}); ok {
        // Convert API response map to Terraform map
        mapValue, _ := types.MapValueFrom(ctx, types.StringType, val)
        ${fieldName} = mapValue
    } else if ${responseValue} == nil {
        ${fieldName} = types.MapNull(types.StringType)
    }`;
      case "list":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        // Convert API response list to Terraform list
        var listItems []attr.Value
        for _, item := range val {
            if itemMap, ok := item.(map[string]interface{}); ok {
                // Handle objects with _id field (OneUptime format)
                if id, ok := itemMap["_id"].(string); ok {
                    listItems = append(listItems, types.StringValue(id))
                } else if id, ok := itemMap["id"].(string); ok {
                    listItems = append(listItems, types.StringValue(id))
                } else {
                    // Convert entire object to JSON string if no id field
                    if jsonBytes, err := json.Marshal(itemMap); err == nil {
                        listItems = append(listItems, types.StringValue(string(jsonBytes)))
                    }
                }
            } else if str, ok := item.(string); ok {
                // Handle direct string values
                listItems = append(listItems, types.StringValue(str))
            }${
              isScalarCollection
                ? ` else if num, ok := item.(float64); ok {
                listItems = append(listItems, types.StringValue(strconv.FormatFloat(num, 'f', -1, 64)))
            } else if b, ok := item.(bool); ok {
                listItems = append(listItems, types.StringValue(fmt.Sprintf("%t", b)))
            }`
                : ""
            }
        }
        ${fieldName} = types.ListValueMust(types.StringType, listItems)
    } else {
        // For lists, always use empty list instead of null to match default values
        ${fieldName} = types.ListValueMust(types.StringType, []attr.Value{})
    }`;
      case "set":
        return `if val, ok := ${responseValue}.([]interface{}); ok {
        // Convert API response list to Terraform set
        var setItems []attr.Value
        for _, item := range val {
            if itemMap, ok := item.(map[string]interface{}); ok {
                // Handle objects with _id field (OneUptime format)
                if id, ok := itemMap["_id"].(string); ok {
                    setItems = append(setItems, types.StringValue(id))
                } else if id, ok := itemMap["id"].(string); ok {
                    setItems = append(setItems, types.StringValue(id))
                } else {
                    // Convert entire object to JSON string if no id field
                    if jsonBytes, err := json.Marshal(itemMap); err == nil {
                        setItems = append(setItems, types.StringValue(string(jsonBytes)))
                    }
                }
            } else if str, ok := item.(string); ok {
                // Handle direct string values
                setItems = append(setItems, types.StringValue(str))
            }${
              isScalarCollection
                ? ` else if num, ok := item.(float64); ok {
                setItems = append(setItems, types.StringValue(strconv.FormatFloat(num, 'f', -1, 64)))
            } else if b, ok := item.(bool); ok {
                setItems = append(setItems, types.StringValue(fmt.Sprintf("%t", b)))
            }`
                : ""
            }
        }
        // Sort set items for deterministic state representation
        sort.Slice(setItems, func(i, j int) bool {
            iStr := setItems[i].(types.String).ValueString()
            jStr := setItems[j].(types.String).ValueString()
            return iStr < jStr
        })
        ${fieldName} = types.SetValueMust(types.StringType, setItems)
    } else {
        // For sets, always use empty set instead of null to match default values
        ${fieldName} = types.SetValueMust(types.StringType, []attr.Value{})
    }`;
      default:
        return `if val, ok := ${responseValue}.(string); ok {
        ${fieldName} = types.StringValue(val)
    } else if ${responseValue} == nil {
        ${fieldName} = types.StringNull()
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

  private getGoValueForTerraformType(
    terraformType: string,
    fieldRef: string,
  ): string {
    switch (terraformType) {
      case "string":
        return `${fieldRef}.ValueString()`;
      case "number":
        // Use helper to convert *big.Float to float64 for proper JSON serialization
        return `r.bigFloatToFloat64(${fieldRef}.ValueBigFloat())`;
      case "bool":
        return `${fieldRef}.ValueBool()`;
      case "map":
        /*
         * For map types, we need to handle them differently
         * For now, we'll skip them in request bodies since they're typically complex objects
         */
        return `""`;
      case "list":
        // For list types, we need to handle them differently
        return `[]string{}`;
      case "set":
        // For set types, we need to handle them differently
        return `[]string{}`;
      default:
        return `${fieldRef}.ValueString()`;
    }
  }

  private async updateProviderWithResources(
    resources: TerraformResource[],
  ): Promise<void> {
    // Generate the list of resource functions
    const resourceFunctions: string = resources
      .map((resource: TerraformResource) => {
        const resourceTypeName: string = StringUtils.toPascalCase(
          resource.name,
        );
        return `        New${resourceTypeName}Resource,`;
      })
      .join("\n");

    /*
     * This would update the provider.go file to include the resources
     * For now, we'll create a separate file with the resource list
     */
    const resourceListContent: string = `package provider

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

  private generateOriginalValueStorage(resource: TerraformResource): string {
    const storage: string[] = [];

    // Find binary format fields and store their original values
    for (const [name, attr] of Object.entries(resource.schema)) {
      if (attr.format === "binary") {
        const sanitizedName: string = this.sanitizeAttributeName(name);
        const fieldName: string = StringUtils.toPascalCase(sanitizedName);
        storage.push(
          `    // Store the original ${sanitizedName} value since API won't return it`,
        );
        storage.push(
          `    original${fieldName}Value := data.${fieldName}.ValueString()`,
        );
        storage.push(``);
      }
    }

    return storage.join("\n");
  }

  /*
   * Converters for scalar (non-entity) list/set attributes: plain values on
   * the wire, never wrapped in {_id}. Only emitted when the resource has at
   * least one such attribute — they need strconv, which is imported
   * conditionally.
   */
  private generateScalarCollectionHelpers(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    const hasScalarCollections: boolean = Object.values(resource.schema).some(
      (attr: any) => {
        return (
          (attr.type === "list" || attr.type === "set") &&
          attr.elementKind === "scalar"
        );
      },
    );
    if (!hasScalarCollections) {
      return "";
    }

    return `
// Converts a Terraform list of scalars to the wire format. Numeric elements
// are sent as numbers; everything else as strings.
func (r *${resourceTypeName}Resource) convertTerraformListToScalarSlice(terraformList types.List, numeric bool) interface{} {
    if terraformList.IsNull() || terraformList.IsUnknown() {
        return nil
    }

    var stringList []string
    terraformList.ElementsAs(context.Background(), &stringList, false)

    result := []interface{}{}
    for _, str := range stringList {
        if numeric {
            if f, err := strconv.ParseFloat(str, 64); err == nil {
                result = append(result, f)
                continue
            }
        }
        result = append(result, str)
    }
    return result
}

// Set variant of convertTerraformListToScalarSlice.
func (r *${resourceTypeName}Resource) convertTerraformSetToScalarSlice(terraformSet types.Set, numeric bool) interface{} {
    if terraformSet.IsNull() || terraformSet.IsUnknown() {
        return nil
    }

    var stringList []string
    terraformSet.ElementsAs(context.Background(), &stringList, false)

    result := []interface{}{}
    for _, str := range stringList {
        if numeric {
            if f, err := strconv.ParseFloat(str, 64); err == nil {
                result = append(result, f)
                continue
            }
        }
        result = append(result, str)
    }
    return result
}
`;
  }

  /**
   * Generates Go code for the valid OneUptime ObjectType map entries.
   * This dynamically generates the map from the ObjectType enum to ensure
   * it stays in sync with Common/Types/JSON.ts
   */
  private generateValidObjectTypesMap(): string {
    const entries: string[] = Object.values(ObjectType).map(
      (typeValue: string) => {
        return `        "${typeValue}": true,`;
      },
    );
    return entries.join("\n");
  }
}
