import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformResource,
  TerraformAttribute,
  TerraformRelation,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";
import { GoCodeGenerator } from "./GoCodeGenerator";
import { ObjectType } from "Common/Types/JSON";
import {
  INVITATION_EMAIL_FIELD,
  MembershipKind,
} from "Common/Utils/DeveloperDocs/PeopleByEmail";
import { isSetAtCreate } from "Common/Utils/DeveloperDocs/SetAtCreate";
import {
  MONITOR_STEPS_VALUES_CASES_FILE,
  monitorStepsValuesCasesFile,
} from "./MonitorStepsValuesCases";
import { PHONE_CASES_FILE, phoneCasesFile } from "./PhoneCases";
import path from "path";
import fs from "fs";

/*
 * StaticFiles holds Go source we copy verbatim into the generated provider
 * tree. Editing these as real .go files (rather than embedded TS template
 * literals) gives full Go tooling — syntax highlighting, gofmt, go test —
 * and avoids backtick-escaping the JSON fixtures inside the test file.
 */
const STATIC_FILES_DIR: string = path.join(__dirname, "..", "StaticFiles");

// A person attribute and its email companion, as the generated Go names them.
export interface PersonAttributeFields {
  idField: string;
  emailField: string;
  emailAttribute: string;
  apiFieldName: string;
  isSet: boolean;
  invitesByEmail: boolean;
}

export interface SchemaFlags {
  required: boolean;
  optional: boolean;
  computed: boolean;
}

export class ResourceGenerator {
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  /*
   * The validators of an attribute that holds the ID of another record, or
   * the IDs of several, by the attribute's type (StaticFiles/ids.go): a
   * name or a slug where an ID goes is refused at plan time.
   */
  public static readonly RECORD_ID_VALIDATORS: Readonly<
    Record<string, string>
  > = {
    string: "recordIDValidators",
    set: "recordIDSetValidators",
    list: "recordIDListValidators",
  };

  /*
   * The same for the ID of a type with a data source and no resource (an
   * AI run, a scan): the refusal says to read the ID with the data source,
   * not to refer to a resource there is none of.
   */
  public static readonly DATA_SOURCE_RECORD_ID_VALIDATORS: Readonly<
    Record<string, string>
  > = {
    string: "dataSourceRecordIDValidators",
    set: "dataSourceRecordIDSetValidators",
    list: "dataSourceRecordIDListValidators",
  };

  // The ID validators of an attribute of `type` that holds `relation`'s IDs.
  public static getRecordIdValidators(
    relation: TerraformRelation,
    type: string,
  ): string | undefined {
    return (
      relation.dataSourceOnly
        ? ResourceGenerator.DATA_SOURCE_RECORD_ID_VALIDATORS
        : ResourceGenerator.RECORD_ID_VALIDATORS
    )[type];
  }

  /*
   * Read-only attributes the server sets once, at create, and never changes
   * (Common/Utils/DeveloperDocs/SetAtCreate.ts: when, by whom, the project,
   * the slug, a record's number, a project's own teams' flags): planned as
   * their state value rather than "(known after apply)", so an update's plan
   * lists only what actually changes.
   */
  public static isSetAtCreateAttribute(
    name: string,
    attr: TerraformAttribute,
    resource?: TerraformResource,
  ): boolean {
    return isSetAtCreate(resource?.tableName || "", attr.apiFieldName || name);
  }

  /*
   * Required / Optional / Computed for one attribute, exactly as its schema
   * declares them. Everything that has to agree with the schema (the
   * attribute itself, the plan modifiers, which values Create and Update
   * keep from the plan, the docs) asks here.
   */
  public static getSchemaFlags(
    name: string,
    attr: TerraformAttribute,
    resource?: TerraformResource,
  ): SchemaFlags {
    // project_id is inferred from the API key, so it is computed-only.
    if (name === "project_id" || name === "projectId") {
      return { required: false, optional: false, computed: true };
    }

    if (attr.required) {
      return { required: true, optional: false, computed: false };
    }

    if (attr.computed && !attr.optional) {
      return { required: false, optional: false, computed: true };
    }

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
    const hasDefault: boolean =
      attr.default !== undefined && attr.default !== null;

    if (attr.optional && attr.computed) {
      return { required: false, optional: true, computed: true };
    }

    /*
     * A default on a field neither request writes is the server's to keep:
     * computed only, so it is never drift.
     */
    if (hasDefault && !isInCreateSchema && !isInUpdateSchema) {
      return { required: false, optional: false, computed: true };
    }

    /*
     * A schema default needs Computed, and so do lists and sets, which
     * default to empty so null and [] are never a diff.
     */
    if (hasDefault || attr.type === "list" || attr.type === "set") {
      return { required: false, optional: true, computed: true };
    }

    return { required: false, optional: true, computed: false };
  }

  /*
   * The plan modifier that keeps the state's value where the
   * configuration's means the same thing (StaticFiles/importsettle.go), for
   * an attribute a configuration writes: a timestamp the same instant, a
   * number the same to OneUptime, a phone number OneUptime keeps as the same
   * number (StaticFiles/phone.go), a JSON value that is a subset of the
   * record an import read. Null for every other attribute.
   */
  public static getImportSettleModifier(
    attr: TerraformAttribute,
  ): string | null {
    if (attr.type === "string" && attr.isDateTime) {
      return "RFC3339KeepSameInstant()";
    }

    if (attr.type === "string" && attr.isPhone) {
      return "PhoneKeepSameNumber()";
    }

    if (attr.type === "number") {
      return "NumberKeepSameAPINumber()";
    }

    // A wrapped scalar (a Color) is kept as its plain value, not as JSON.
    if (
      attr.type === "string" &&
      attr.isComplexObject &&
      !attr.isWrappedScalar
    ) {
      return "JSONSubsetKeepImported()";
    }

    return null;
  }

  private providerName: string;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.spec = spec;
    this.providerName = config.providerName;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  /*
   * What a configuration that still uses a resource's old name is told:
   * the new name, and the moved block that moves its state across.
   */
  private getLegacyAliasDeprecationMessage(
    resource: TerraformResource,
  ): string {
    return `${this.providerName}_${resource.legacyName} has been renamed to ${this.providerName}_${resource.name}. Rename the resource in your configuration and add a moved block (from = ${this.providerName}_${resource.legacyName}.<name>, to = ${this.providerName}_${resource.name}.<name>) to keep the existing ${resource.name.replace(/_/g, " ")}; the old name keeps working until then.`;
  }

  private generateLegacyAliasConstructor(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    if (!resource.legacyName) {
      return "";
    }

    return `
// New${resourceTypeName}LegacyResource registers this resource under the name it
// had before resource type names kept mixed-case words whole,
// ${this.providerName}_${resource.legacyName}, so configurations that use it keep
// working. Deprecated: plans that use it say so.
func New${resourceTypeName}LegacyResource() resource.Resource {
    return &${resourceTypeName}Resource{isLegacyAlias: true}
}
`;
  }

  private generateMoveStateMethod(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    const formerName: string | undefined =
      resource.legacyName || resource.movedFrom;

    if (!formerName) {
      return "";
    }

    return `
// MoveState lets a moved block bring state over from the old name:
//
//     moved {
//       from = ${this.providerName}_${formerName}.example
//       to   = ${this.providerName}_${resource.name}.example
//     }
func (r *${resourceTypeName}Resource) MoveState(ctx context.Context) []resource.StateMover {${
      resource.legacyName
        ? `
    if r.isLegacyAlias {
        return nil
    }
`
        : ""
    }
    return []resource.StateMover{
        legacyNameStateMover("${this.providerName}_${formerName}", r.schemaDefinition()),
    }
}
`;
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
    /*
     * Phone numbers, which OneUptime may keep in another spelling (#7777):
     * the type, its plan modifier and validator, and their tests, which read
     * what the server's own code keeps for each of a list of numbers
     * (Core/PhoneCases.ts).
     */
    await this.copyStaticFile("phone.go", "internal/provider");
    await this.copyStaticFile("phone_test.go", "internal/provider");
    await this.fileGenerator.writeFileInDir(
      "internal/provider/testdata",
      PHONE_CASES_FILE,
      phoneCasesFile(),
    );
    /*
     * numberFromAPI, which every number attribute - of resources and data
     * sources alike - is read through, and its tests: the shapes the API
     * answers numbers in, and a create, read, plan and lookup of the
     * resource issue #4719 was about, through the real protocol server.
     */
    await this.copyStaticFile("apinumber.go", "internal/provider");
    await this.copyStaticFile("apinumber_test.go", "internal/provider");
    await this.copyStaticFile(
      "apinumber_roundtrip_test.go",
      "internal/provider",
    );
    /*
     * A runbook whose steps the API answers as a JSON array, created,
     * refreshed, updated and looked up through the real protocol server
     * (OneUptime/terraform-provider-oneuptime#18).
     */
    await this.copyStaticFile(
      "jsonarray_roundtrip_test.go",
      "internal/provider",
    );
    await this.copyStaticFile("jsonenvelope.go", "internal/provider");
    await this.copyStaticFile("jsonenvelope_test.go", "internal/provider");
    /*
     * The provider's one public package: the Crossplane provider
     * (Scripts/CrossplaneProvider) runs this provider in process through it,
     * as Go lets no other module import internal/provider.
     */
    await this.copyStaticFile("xpprovider.go", "xpprovider");
    await this.copyStaticFile("xpprovider_test.go", "xpprovider");
    await this.copyStaticFileIfExists("monitorsteps.go", "internal/provider");
    await this.copyStaticFileIfExists(
      "monitorsteps_test.go",
      "internal/provider",
    );
    // An NTP monitor's check_on values (#4617), which shipped untested.
    await this.copyStaticFile("monitorsteps_ntp_test.go", "internal/provider");
    /*
     * The values in a monitor's steps the server reads written another way
     * (#6723): a rolling time ("15 minutes" is "Past 15 Minutes") and a
     * filter's aggregation and no-data policy ("avg" is "Average"), compared
     * as the server stores them and refused at plan time where it refuses
     * them. The tests check every rule against cases this generator writes
     * from the server's own code, and apply, refresh and plan a monitor
     * through the real protocol server.
     */
    await this.copyStaticFile("monitorstepsvalues.go", "internal/provider");
    await this.copyStaticFile(
      "monitorstepsvalues_test.go",
      "internal/provider",
    );
    await this.copyStaticFile(
      "monitorstepsvalues_roundtrip_test.go",
      "internal/provider",
    );
    /*
     * A project's own Twilio account and mail server (#7737), applied,
     * refreshed, updated and imported through the real protocol server: the
     * credentials sent and read back, is_project_default sent as false when
     * left out, and the defaults for SMS and calls OneUptime sets. It drives
     * Terraform with monitorstepsvalues_roundtrip_test.go's helpers.
     */
    await this.copyStaticFile(
      "notificationchannels_roundtrip_test.go",
      "internal/provider",
    );
    await this.fileGenerator.writeFileInDir(
      "internal/provider/testdata",
      MONITOR_STEPS_VALUES_CASES_FILE,
      monitorStepsValuesCasesFile(),
    );
    await this.copyStaticFile(
      "provider_schema_smoke_test.go",
      "internal/provider",
    );
    // Plans an update of every resource: replaces nothing it did not change.
    await this.copyStaticFile(
      "provider_update_plan_test.go",
      "internal/provider",
    );
    await this.copyStaticFile("legacynames.go", "internal/provider");
    await this.copyStaticFile("legacynames_test.go", "internal/provider");

    /*
     * Imports that settle: the plan modifiers that keep what an import read
     * where the configuration says the same thing another way, and their
     * tests - the modifiers alone, and an import of each kind of attribute
     * through the real protocol server.
     */
    await this.copyStaticFile("importsettle.go", "internal/provider");
    await this.copyStaticFile("importsettle_test.go", "internal/provider");
    await this.copyStaticFile("import_plan_test.go", "internal/provider");

    /*
     * People named by email address beside their user IDs (user_email
     * beside user_id): the lookups, plan modifiers and validators every
     * resource that names a person shares, and their tests - the lookups
     * against a fake API, and the plans through the real protocol server.
     */
    await this.copyStaticFile("people.go", "internal/provider");
    await this.copyStaticFile("people_test.go", "internal/provider");
    await this.copyStaticFile("people_plan_test.go", "internal/provider");

    // The ID of another record is a UUID, refused otherwise at plan time.
    await this.copyStaticFile("ids.go", "internal/provider");
    await this.copyStaticFile("ids_test.go", "internal/provider");

    /*
     * A choice takes one of its values (the spec's enum, a OneOf
     * validator), and a probe, an AI agent or a Runner only its name:
     * through the protocol server, as terraform validate calls it.
     */
    await this.copyStaticFile("allowedvalues_test.go", "internal/provider");

    // Writes the built provider's schema for the docs generator.
    await this.copyStaticFile(
      "provider_schema_dump_test.go",
      "internal/provider",
    );

    /*
     * Exercises client.go's select-rejection retry against a real httptest
     * server. client.go is generated (it lives in a template literal in
     * ProviderGenerator.ts), so its test has to be a static file copied in
     * beside it — copyStaticFile, not copyStaticFileIfExists, so a rename
     * fails generation instead of silently testing nothing.
     */
    await this.copyStaticFile("client_test.go", "internal/provider");

    /*
     * The acceptance tests: the core resources through a real Terraform and
     * a real OneUptime, with terraform-plugin-testing, the harness HashiCorp
     * asks partner providers to pass. They skip unless TF_ACC is set
     * (terraform-provider-e2e.yml sets it).
     */
    await this.copyStaticFile(
      "acceptance_helpers_test.go",
      "internal/provider",
    );
    await this.copyStaticFile("acceptance_test.go", "internal/provider");
    // People named by email address: invitations, on-call, owners, lookups.
    await this.copyStaticFile("acceptance_people_test.go", "internal/provider");

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
            // A person's attributes get their plan modifiers from people.go.
            if (attr.person || attr.personEmailOf) {
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
            const flags: SchemaFlags = ResourceGenerator.getSchemaFlags(
              name,
              attr,
              resource,
            );
            return (
              (attr.optional && attr.computed && !isProjectId) ||
              (attr.forceNew && !isComputedOnly && !isProjectId) ||
              (flags.computed &&
                !flags.optional &&
                ResourceGenerator.isSetAtCreateAttribute(name, attr, resource))
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
          (attr.isComplexObject || attr.isPhone) &&
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
var _ resource.ResourceWithModifyPlan = &${resourceTypeName}Resource{}
${
  resource.legacyName || resource.movedFrom
    ? `var _ resource.ResourceWithMoveState = &${resourceTypeName}Resource{}
`
    : ""
}
func New${resourceTypeName}Resource() resource.Resource {
    return &${resourceTypeName}Resource{}
}
${this.generateLegacyAliasConstructor(resource, resourceTypeName)}
// ${resourceTypeName}Resource defines the resource implementation.
type ${resourceTypeName}Resource struct {
    client *Client${
      resource.legacyName
        ? `
    // Registered under the name this resource had before (see New${resourceTypeName}LegacyResource).
    isLegacyAlias bool`
        : ""
    }
}

// ${resourceTypeName}ResourceModel describes the resource data model.
type ${resourceTypeName}ResourceModel struct {
${this.generateModelFields(resource)}
}

func (r *${resourceTypeName}Resource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {${
      resource.legacyName
        ? `
    if r.isLegacyAlias {
        resp.TypeName = req.ProviderTypeName + "_${resource.legacyName}"
        return
    }`
        : ""
    }
    resp.TypeName = req.ProviderTypeName + "_${resource.name}"
}

func (r *${resourceTypeName}Resource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
    resp.Schema = r.schemaDefinition()${
      resource.legacyName
        ? `
    if r.isLegacyAlias {
        resp.Schema.DeprecationMessage = "${GoCodeGenerator.escapeString(this.getLegacyAliasDeprecationMessage(resource))}"
    }`
        : ""
    }
}

func (r *${resourceTypeName}Resource) schemaDefinition() schema.Schema {
    return schema.Schema{
        MarkdownDescription: "${GoCodeGenerator.escapeString(resource.description || `Manages a ${resource.name.replace(/_/g, " ")} in OneUptime.`)}",

        Attributes: map[string]schema.Attribute{
${this.generateSchemaAttributes(resource)}
        },
    }
}
${this.generateMoveStateMethod(resource, resourceTypeName)}${this.generateModifyPlan(resource, resourceTypeName)}
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
  resource.membershipImport
    ? `    // By its own ID, or by what it joins and who or what joins it: <${resource.membershipImport.parentAttribute}>/${resource.membershipImport.personEmailAttribute ? "<email address or user id>" : `<${resource.membershipImport.personAttribute}>`} (see people.go).
    id, email, ok := importIDOfMembership(ctx, r.client, req.ID, membershipImport{
        listPath:        "${resource.membershipImport.listPath}",
        parentField:     "${resource.membershipImport.parentApiField}",
        parentAttribute: "${resource.membershipImport.parentAttribute}",
        parentNoun:      "${resource.membershipImport.parentNoun}",
        personField:     "${resource.membershipImport.personApiField}",
        personAttribute: "${resource.membershipImport.personAttribute}",
        byEmail:         ${Boolean(resource.membershipImport.personEmailAttribute)},
        kind:            "${resource.membershipImport.kind}",
    }, &resp.Diagnostics)
    if !ok {
        return
    }
    resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), id)...)${this.generateMarkImported(resource)}${
      resource.membershipImport.personEmailAttribute
        ? `
    // The address it was imported by, as written: the refresh keeps it.
    if email != "" {
        resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("${resource.membershipImport.personEmailAttribute}"), email)...)
    }`
        : `
    _ = email`
    }`
    : resource.operations.read
      ? `    resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)${this.generateMarkImported(resource)}`
      : `    // Without a read endpoint, a passthrough import would silently create
    // id-only state that can never be refreshed. Fail loudly instead.
    resp.Diagnostics.AddError(
        "Import Not Supported",
        "oneuptime_${resource.name} cannot be imported: the OneUptime API exposes no read endpoint for it.",
    )`
}
}

${this.generateKeepPlannedValuesMethod(resource, resourceTypeName)}
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
       * a custom type whose semantic-equality compares instants (rfc3339.go),
       * and phone numbers one that compares them as OneUptime keeps them
       * (phone.go).
       */
      let goType: string = this.mapTerraformTypeToGo(attr.type);
      if (attr.type === "monitor_steps") {
        goType = "MonitorStepsValue";
      } else if (attr.type === "string" && attr.isDateTime) {
        goType = "RFC3339Value";
      } else if (attr.type === "string" && attr.isPhone) {
        goType = "PhoneValue";
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
    return StringUtils.toTerraformAttributeName(name);
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

    if (attr.person || attr.personEmailOf) {
      return this.generatePersonSchemaAttribute(attr as TerraformAttribute);
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
     * (e.g. "...Z" -> "...000Z") is not reported as drift. Phone numbers use
     * PhoneType, so a number OneUptime keeps as its digits ("+1 415 555
     * 0100" as "+14155550100") is not either.
     */
    if (attr.type === "string" && attr.isDateTime) {
      options.push("CustomType: RFC3339Type{}");
    } else if (attr.type === "string" && attr.isPhone) {
      options.push("CustomType: PhoneType{}");
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

    const flags: SchemaFlags = ResourceGenerator.getSchemaFlags(
      name,
      attr,
      resource,
    );

    if (flags.required) {
      options.push("Required: true");
    }
    if (flags.optional) {
      options.push("Optional: true");
    }
    if (flags.computed) {
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
    const isComputedOnly: boolean = Boolean(attr.computed && !attr.optional);

    /*
     * First, the value in state where the configuration's means the same
     * (importsettle.go): an import reads a timestamp with milliseconds, a
     * number as the float OneUptime keeps, a JSON value whole. A modifier
     * after this one - RequiresReplace - sees the value it kept, so the
     * same thing written another way replaces nothing either.
     */
    const settleModifier: string | null =
      isComputedOnly || isProjectIdField
        ? null
        : ResourceGenerator.getImportSettleModifier(attr);
    if (settleModifier) {
      modifiers.push(settleModifier);
    }

    if (
      name === "id" ||
      (attr.optional && attr.computed && modifierPackage) ||
      (flags.computed &&
        !flags.optional &&
        ResourceGenerator.isSetAtCreateAttribute(name, attr, resource) &&
        modifierPackage)
    ) {
      modifiers.push(
        `${modifierPackage || "stringplanmodifier"}.UseStateForUnknown()`,
      );
    }

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
      attr.isPhone &&
      !isComputedOnly &&
      !isProjectIdField
    ) {
      // A number OneUptime takes (phone.go): its refusal at plan time.
      validators = `,
                Validators: []validator.String{
                    PhoneValidator(),
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
    } else if (attr.relation && !isComputedOnly && !isProjectIdField) {
      // The ID of another record, a UUID (StaticFiles/ids.go).
      const helper: string | undefined =
        ResourceGenerator.getRecordIdValidators(attr.relation, attr.type);
      if (helper) {
        validators = `,
                Validators: ${helper}("${this.providerName}_${attr.relation.name}")`;
      }
    }

    return `schema.${attrType}Attribute{
                ${options.join(",\n                ")}${planModifiers}${validators},
            }`;
  }

  /*
   * A person's ID attribute (user_id, owner_users) and its email companion
   * (user_email, owner_user_emails): both optional and computed - the
   * provider fills in one from the other - with the validators of
   * people.go, and the address's plan modifiers (the ID is planned by the
   * resource's ModifyPlan). Exactly one of the two when the API needs the
   * person, at most one otherwise.
   */
  private generatePersonSchemaAttribute(attr: TerraformAttribute): string {
    const isSet: boolean = attr.type === "set";
    const options: Array<string> = [];

    if (attr.description) {
      options.push(
        `MarkdownDescription: "${GoCodeGenerator.escapeString(attr.description)}"`,
      );
    }

    options.push("Optional: true");
    options.push("Computed: true");

    if (isSet) {
      options.push("ElementType: types.StringType");
    }

    if (attr.person) {
      // Planned by the resource's ModifyPlan (generateModifyPlan).
      options.push(
        isSet
          ? `Validators: personIDsValidators("${attr.person.emailAttribute}", ${attr.person.isRequired})`
          : `Validators: personIDValidators("${attr.person.emailAttribute}", ${attr.person.isRequired})`,
      );
    } else {
      options.push(
        isSet
          ? `PlanModifiers: personEmailsPlanModifiers("${attr.personEmailOf}")`
          : `PlanModifiers: personEmailPlanModifiers("${attr.personEmailOf}")`,
      );
      options.push(
        isSet
          ? "Validators: personEmailsValidators()"
          : "Validators: personEmailValidators()",
      );
    }

    return `schema.${isSet ? "Set" : "String"}Attribute{
                ${options.join(",\n                ")},
            }`;
  }

  /*
   * The resource's ModifyPlan, which runs after every attribute's plan
   * modifiers.
   *
   * First the people it names (people.go planPersonID): found by email
   * address here, on the configured resource - a plan modifier would have
   * no client to ask with. It also asks for the replacement a different
   * person needs where the API cannot change them, so the ID attribute has
   * no RequiresReplace of its own.
   *
   * Then, for every resource, keepStateWhenNothingChanges
   * (importsettle.go): a plan whose every attribute a configuration sets
   * came out the same as the state - a timestamp, number, JSON value or
   * monitor steps written another way, kept by their plan modifiers - makes
   * no update, so nothing OneUptime sets changes either, and the attributes
   * the framework had made "(known after apply)" keep their state values.
   */
  private generateModifyPlan(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    const people: Array<string> = Object.entries(resource.schema)
      .filter(([, attr]: [string, TerraformAttribute]) => {
        return Boolean(attr.person);
      })
      .map(([name, attr]: [string, TerraformAttribute]) => {
        const person: NonNullable<TerraformAttribute["person"]> = attr.person!;
        return `    ${person.isList ? "planPeopleIDs" : "planPersonID"}(ctx, r.client, req, resp, personAttribute{
        id:       "${this.sanitizeAttributeName(name)}",
        email:    "${person.emailAttribute}",
        invites:  ${person.invitesByEmail},
        replaces: ${Boolean(attr.forceNew)},
    })`;
      });

    const label: string = resource.name.replace(/_/g, " ");

    return `
// ModifyPlan ${
      people.length > 0
        ? `finds, by email address, the people this ${label} names (see people.go),
// and keeps`
        : "keeps"
    } the state when nothing a configuration sets changes (see
// importsettle.go).
func (r *${resourceTypeName}Resource) ModifyPlan(ctx context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse) {
    // Destroying: nothing to plan.
    if req.Plan.Raw.IsNull() {
        return
    }
${people.length > 0 ? `\n${people.join("\n")}\n` : ""}
    keepStateWhenNothingChanges(ctx, req, resp)
}
`;
  }

  /*
   * The attributes an import may read with keys a configuration never writes
   * - JSON values, and a monitor's steps - which plan as no change while
   * the configuration's are a subset of what was imported
   * (StaticFiles/importsettle.go).
   */
  public getImportedFromServerAttributes(
    resource: TerraformResource,
  ): Array<string> {
    return Object.entries(resource.schema)
      .filter(([name, attr]: [string, TerraformAttribute]) => {
        if (name === "id" || name === "project_id" || name === "projectId") {
          return false;
        }
        if (attr.computed && !attr.optional) {
          return false;
        }
        return Boolean(
          attr.isMonitorSteps ||
            (attr.type === "string" &&
              attr.isComplexObject &&
              !attr.isWrappedScalar),
        );
      })
      .map(([name]: [string, TerraformAttribute]) => {
        return this.sanitizeAttributeName(name);
      })
      .sort();
  }

  // An import names the attributes that hold what it read.
  private generateMarkImported(resource: TerraformResource): string {
    const attributes: Array<string> =
      this.getImportedFromServerAttributes(resource);

    if (attributes.length === 0) {
      return "";
    }

    return `
    // These hold the record as OneUptime keeps it, keys it fills in itself
    // included, until an update writes them (see importsettle.go).
    resp.Diagnostics.Append(markImportedFromServer(ctx, resp.Private, []string{${attributes
      .map((attribute: string) => {
        return `"${attribute}"`;
      })
      .join(", ")}})...)`;
  }

  // Before an update writes anything: which of those it writes.
  private generateWrittenFromConfig(resource: TerraformResource): string {
    const attributes: Array<string> =
      this.getImportedFromServerAttributes(resource);

    if (attributes.length === 0) {
      return "";
    }

    return `
    // The attributes this update writes from the configuration (see importsettle.go).
    writtenFromConfig := map[string]bool{
${attributes
  .map((attribute: string) => {
    const field: string = StringUtils.toPascalCase(attribute);
    return `        "${attribute}": !data.${field}.Equal(state.${field}),`;
  })
  .join("\n")}
    }
`;
  }

  // Each person attribute and its email companion, as Go field names.
  private getPersonAttributes(
    resource: TerraformResource,
  ): Array<PersonAttributeFields> {
    return Object.entries(resource.schema)
      .filter(([, attr]: [string, TerraformAttribute]) => {
        return Boolean(attr.person);
      })
      .map(([name, attr]: [string, TerraformAttribute]) => {
        const person: NonNullable<TerraformAttribute["person"]> = attr.person!;
        return {
          idField: StringUtils.toPascalCase(this.sanitizeAttributeName(name)),
          emailField: StringUtils.toPascalCase(
            this.sanitizeAttributeName(person.emailAttribute),
          ),
          emailAttribute: person.emailAttribute,
          apiFieldName: attr.apiFieldName || name,
          isSet: attr.type === "set",
          invitesByEmail: person.invitesByEmail,
        };
      });
  }

  /*
   * Before a create or an update: the user IDs of the people named by an
   * address the plan could not find yet - someone this apply has just
   * invited (people.go personIDForWrite). A team member named by address is
   * invited by it instead, so its ID is not needed.
   */
  private generatePersonIDsForWrite(
    resource: TerraformResource,
    isCreate: boolean,
  ): string {
    const lines: Array<string> = [];

    for (const person of this.getPersonAttributes(resource)) {
      if (isCreate && person.invitesByEmail) {
        continue;
      }

      lines.push(
        person.isSet
          ? `    if !personIDsForWrite(ctx, r.client, &data.${person.idField}, data.${person.emailField}, "${person.emailAttribute}", &resp.Diagnostics) {
        return
    }`
          : `    if !personIDForWrite(ctx, r.client, &data.${person.idField}, data.${person.emailField}, "${person.emailAttribute}", &resp.Diagnostics) {
        return
    }`,
      );
    }

    if (lines.length === 0) {
      return "";
    }

    return `
    // People named by email address: the user IDs to send (see people.go).
${lines.join("\n")}
`;
  }

  /*
   * A team member named by address is invited by it, as the dashboard's
   * Invite does: OneUptime finds the account with that address - or makes
   * one - and emails the invitation; someone already in the project joins
   * the team at once.
   */
  private generateInvitationByEmail(
    resource: TerraformResource,
    resourceVarName: string,
  ): string {
    const invited: Array<PersonAttributeFields> = this.getPersonAttributes(
      resource,
    ).filter((person: PersonAttributeFields) => {
      return person.invitesByEmail;
    });

    if (invited.length === 0) {
      return "";
    }

    return invited
      .map((person: PersonAttributeFields) => {
        return `
    // Named by email address: invited by it (see people.go).
    if !data.${person.emailField}.IsNull() && !data.${person.emailField}.IsUnknown() {
        delete(${resourceVarName}Request["data"].(map[string]interface{}), "${person.apiFieldName}")
        ${resourceVarName}Request["miscDataProps"] = map[string]interface{}{
            "${INVITATION_EMAIL_FIELD}": data.${person.emailField}.ValueString(),
        }
    }`;
      })
      .join("\n");
  }

  /*
   * After a create, the people the response names, for a person whose ID
   * the plan could not know (one invited by address): state must hold it
   * even if the read that follows fails.
   */
  private generatePersonIDsFromCreateResponse(
    resource: TerraformResource,
    responseVar: string,
  ): string {
    const lines: Array<string> = this.getPersonAttributes(resource)
      .filter((person: PersonAttributeFields) => {
        return !person.isSet;
      })
      .map((person: PersonAttributeFields) => {
        return `    if data.${person.idField}.IsUnknown() {
        created := ${responseVar}
        if wrapper, ok := ${responseVar}["data"].(map[string]interface{}); ok {
            created = wrapper
        }
        if id := apiStringValue(created["${person.apiFieldName}"]); id != "" {
            data.${person.idField} = types.StringValue(id)
        } else {
            data.${person.idField} = types.StringNull()
        }
    }`;
      });

    if (lines.length === 0) {
      return "";
    }

    return `
    // The person a create named by address, as the API has them.
${lines.join("\n")}
`;
  }

  /*
   * After a create or an update: the address of a person the configuration
   * named by ID, read now (people.go personEmailAfterWrite).
   */
  private generatePersonEmailsAfterWrite(resource: TerraformResource): string {
    const lines: Array<string> = this.getPersonAttributes(resource).map(
      (person: PersonAttributeFields) => {
        return person.isSet
          ? `    data.${person.emailField} = personEmailsAfterWrite(ctx, r.client, data.${person.idField}, data.${person.emailField})`
          : `    data.${person.emailField} = personEmailAfterWrite(ctx, r.client, data.${person.idField}, data.${person.emailField})`;
      },
    );

    if (lines.length === 0) {
      return "";
    }

    return `
    // The address of a person named by ID (see people.go).
${lines.join("\n")}`;
  }

  // Before a refresh maps the response: who the state named.
  private generatePriorPeople(resource: TerraformResource): string {
    const lines: Array<string> = this.getPersonAttributes(resource).map(
      (person: PersonAttributeFields) => {
        return `    prior${person.idField} := data.${person.idField}
    prior${person.emailField} := data.${person.emailField}`;
      },
    );

    if (lines.length === 0) {
      return "";
    }

    return `
    // Who the state named, to keep their address (see people.go).
${lines.join("\n")}
`;
  }

  /*
   * After a refresh: the address stays while the resource names the same
   * person, and is read when there is none (an import) or the person changed
   * outside Terraform (people.go personEmailAfterRead).
   */
  private generatePersonEmailsAfterRead(resource: TerraformResource): string {
    const lines: Array<string> = this.getPersonAttributes(resource).map(
      (person: PersonAttributeFields) => {
        return person.isSet
          ? `    data.${person.emailField} = personEmailsAfterRead(ctx, r.client, prior${person.idField}, data.${person.idField}, prior${person.emailField})`
          : `    data.${person.emailField} = personEmailAfterRead(ctx, r.client, prior${person.idField}, data.${person.idField}, prior${person.emailField})`;
      },
    );

    if (lines.length === 0) {
      return "";
    }

    return `
    // The person's address (see people.go).
${lines.join("\n")}`;
  }

  /*
   * The optional attributes Terraform also computes: the ones whose planned
   * value Create and Update keep when the configuration leaves them out.
   */
  private getKeptPlannedAttributes(resource: TerraformResource): string[] {
    return Object.entries(resource.schema)
      .filter(([name, attr]: [string, TerraformAttribute]) => {
        if (name === "id" || attr.format === "binary") {
          return false;
        }
        const flags: SchemaFlags = ResourceGenerator.getSchemaFlags(
          name,
          attr,
          resource,
        );
        return flags.optional && flags.computed;
      })
      .map(([name]: [string, TerraformAttribute]) => {
        return StringUtils.toPascalCase(this.sanitizeAttributeName(name));
      });
  }

  private generatePlanAndConfigCapture(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    if (this.getKeptPlannedAttributes(resource).length === 0) {
      return "";
    }

    return `
    // What the configuration sets, and what Terraform planned (see keepPlannedValues).
    var config ${resourceTypeName}ResourceModel
    resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
    if resp.Diagnostics.HasError() {
        return
    }
    plan := data
`;
  }

  private generateKeepPlannedValuesCall(resource: TerraformResource): string {
    if (this.getKeptPlannedAttributes(resource).length === 0) {
      return "";
    }

    return `

    // Unconfigured attributes keep their planned value; see keepPlannedValues.
    r.keepPlannedValues(&data, &plan, &config)`;
  }

  private generateKeepPlannedValuesMethod(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    const fields: string[] = this.getKeptPlannedAttributes(resource);

    if (fields.length === 0) {
      return "";
    }

    const assignments: string = fields
      .map((field: string) => {
        return `    if config.${field}.IsNull() && !plan.${field}.IsUnknown() {
        data.${field} = plan.${field}
    }`;
      })
      .join("\n");

    return `
// keepPlannedValues puts back, after a create or an update, the planned value
// of each optional attribute the configuration leaves out. The server keeps
// some of these up to date on its own (when it last checked a heartbeat, the
// status a probe last reported...), so the value read back after the write can
// already differ from the plan, and Terraform would fail the apply with
// "Provider produced inconsistent result after apply". The next refresh reads
// the server's value, which is never a diff for an attribute nobody configured.
func (r *${resourceTypeName}Resource) keepPlannedValues(data *${resourceTypeName}ResourceModel, plan *${resourceTypeName}ResourceModel, config *${resourceTypeName}ResourceModel) {
${assignments}
}
`;
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
${this.generateResponseMapping(resource, resourceVarName + "Response", true)}${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}`;

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
${this.generatePersonIDsFromCreateResponse(resource, resourceVarName + "Response")}
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
    data.Id = types.StringValue(createdId)${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}`;
    }

    /*
     * A membership that exists already says how to import it instead
     * (people.go alreadyInvitedHint).
     */
    const createError: string =
      resource.membershipImport?.kind === MembershipKind.Member
        ? `resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to create ${resource.name}: %s%s", err, alreadyInvitedHint(err, "${this.providerName}_${resource.name}", "${resource.membershipImport.parentAttribute}")))`
        : `resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to create ${resource.name}: %s", err))`;

    return `
func (r *${resourceTypeName}Resource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform plan data into the model
    resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }
${this.generatePlanAndConfigCapture(resource, resourceTypeName)}
${this.generateOriginalValueStorage(resource)}${this.generatePersonIDsForWrite(resource, true)}

    // Create API request body. Unset (null/unknown) optional fields are
    // omitted so server-side defaults apply instead of being overwritten
    // with zero values.
    ${resourceVarName}Request := map[string]interface{}{
        "data": map[string]interface{}{},
    }
${this.generateGuardedCreateRequestBody(resource, resourceVarName)}${this.generateInvitationByEmail(resource, resourceVarName)}

    // Make API call
    httpResp, err := r.client.Post(ctx, "${path}", ${resourceVarName}Request)
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to create ${resource.name}, got error: %s", err))
        return
    }

    var ${resourceVarName}Response map[string]interface{}
    err = r.client.ParseResponse(httpResp, &${resourceVarName}Response)
    if err != nil {
        ${createError}
        return
    }
${readBackCode}

    // Write logs using the tflog package
    tflog.Trace(ctx, "created a resource")

${
  this.getImportedFromServerAttributes(resource).length > 0
    ? `
    // Nothing a create made was imported (see importsettle.go).
    resp.Diagnostics.Append(forgetImportedFromServer(ctx, resp.Private)...)`
    : ""
}
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
${this.generatePriorPeople(resource)}
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
${this.generateResponseMapping(resource, resourceVarName + "Response", false)}${this.generatePersonEmailsAfterRead(resource)}

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
    data.Id = state.Id${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}`
      : `
    // No read endpoint for this resource: the planned values become state.${this.generatePersonEmailsAfterWrite(resource)}`;

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
${this.generateWrittenFromConfig(resource)}${hasRead ? this.generatePlanAndConfigCapture(resource, resourceTypeName) : ""}${this.generatePersonIDsForWrite(resource, false)}
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
${readBackCode}${
      this.getImportedFromServerAttributes(resource).length > 0
        ? `

    // What this update wrote is what the configuration says now (see importsettle.go).
    resp.Diagnostics.Append(keepImportedFromServer(ctx, resp.Private, writtenFromConfig)...)`
        : ""
    }

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

        /*
         * Phone numbers arrive as a {_type: "Phone", value} wrapper. Unwrap
         * to the number; PhoneType's semantic equality keeps the
         * configuration's spelling when OneUptime answers the number as its
         * digits.
         */
        if (attr.isPhone) {
          return `if obj, ok := ${responseValue}.(map[string]interface{}); ok {
        if val, ok := obj["value"].(string); ok && val != "" {
            ${fieldName} = NewPhoneValue(val)
        } else {
            ${fieldName} = NewPhoneNull()
        }
    } else if val, ok := ${responseValue}.(string); ok && val != "" {
        ${fieldName} = NewPhoneValue(val)
    } else {
        ${fieldName} = NewPhoneNull()
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
    } else if arr, ok := ${responseValue}.([]interface{}); ok {
        // A JSON array column, such as a runbook's steps: the array, as JSON
        if jsonBytes, err := json.Marshal(r.normalizeURLWrappers(arr)); err == nil {
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
    } else if arr, ok := ${responseValue}.([]interface{}); ok {
        // A JSON array column: the array, as JSON
        if jsonBytes, err := json.Marshal(r.normalizeURLWrappers(arr)); err == nil {
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
        return GoCodeGenerator.generateNumberFromAPI(fieldName, responseValue);
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

    const renamedResources: Array<TerraformResource> = resources.filter(
      (resource: TerraformResource) => {
        return Boolean(resource.legacyName);
      },
    );

    const legacyAliasFunctions: string = renamedResources
      .map((resource: TerraformResource) => {
        return `        New${StringUtils.toPascalCase(resource.name)}LegacyResource,`;
      })
      .join("\n");

    const legacyAliasEntries: string = renamedResources
      .map((resource: TerraformResource) => {
        const resourceTypeName: string = StringUtils.toPascalCase(
          resource.name,
        );
        return `    {Name: "${resource.name}", LegacyName: "${resource.legacyName}", New: New${resourceTypeName}Resource, NewLegacy: New${resourceTypeName}LegacyResource},`;
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
${resourceFunctions}${
      legacyAliasFunctions
        ? `
        // Deprecated aliases: the names these resources had before resource
        // type names kept mixed-case words whole.
${legacyAliasFunctions}`
        : ""
    }
    }
}

// legacyResourceAliases pairs each renamed resource with the alias that keeps
// its old name working.
var legacyResourceAliases = []legacyResourceAlias{
${legacyAliasEntries}
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
