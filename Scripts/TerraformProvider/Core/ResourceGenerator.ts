import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformResource,
  TerraformAttribute,
  TerraformRelation,
  HeldEntryAttribute,
  SharedAttribute,
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
import {
  HANDWRITTEN_RESOURCES,
  HandwrittenResource,
} from "./HandwrittenResources";
import {
  PROVIDER_PACKAGE_DIR,
  SHARD_COUNT,
  providerDotImport,
  shardNames,
  shardOf,
  shardRegistrationFile,
  writeAllShardsPackage,
} from "./ProviderShards";
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
    string: "RecordIDValidators",
    set: "RecordIDSetValidators",
    list: "RecordIDListValidators",
  };

  /*
   * The same for the ID of a type with a data source and no resource (an
   * AI run, a scan): the refusal says to read the ID with the data source,
   * not to refer to a resource there is none of.
   */
  public static readonly DATA_SOURCE_RECORD_ID_VALIDATORS: Readonly<
    Record<string, string>
  > = {
    string: "DataSourceRecordIDValidators",
    set: "DataSourceRecordIDSetValidators",
    list: "DataSourceRecordIDListValidators",
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
    /*
     * A secret answered once (shownOnce) is set by the create too, and kept
     * in state from its answer: nothing reads it back.
     */
    return (
      Boolean(attr.shownOnce) ||
      isSetAtCreate(resource?.tableName || "", attr.apiFieldName || name)
    );
  }

  /*
   * The attributes OneUptime answers once, in the create's answer, and never
   * reads back (the spec's x-oneuptime-shown-once): a project API key's
   * api_key. Set from that answer, kept by every read and update after it.
   */
  public static getShownOnceAttributes(
    resource: TerraformResource,
  ): Array<[string, TerraformAttribute]> {
    return Object.entries(resource.schema).filter(
      ([name, attr]: [string, TerraformAttribute]): boolean => {
        return name !== "id" && Boolean(attr.shownOnce);
      },
    );
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

    /*
     * A permission's key, written plainly or with jsonencode() as earlier
     * versions of the provider asked (StaticFiles/permissionkey.go).
     */
    if (attr.type === "string" && attr.isPermission) {
      return "PermissionKeepSameKey()";
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

  /*
   * The plan modifier that keeps the state's value once the record exists
   * (StaticFiles/serverowned.go), for an attribute a create gives and
   * OneUptime keeps from then on (serverOwned "after-create"): a monitor's
   * current status. Null for every other attribute, and for one no
   * configuration writes.
   */
  public static getKeepAfterCreateModifier(
    name: string,
    attr: TerraformAttribute,
  ): string | null {
    if (
      name === "id" ||
      attr.serverOwned !== "after-create" ||
      !(attr.optional || attr.required)
    ) {
      return null;
    }

    const modifierByType: Record<string, string> = {
      string: "StringKeepAfterCreate()",
      bool: "BoolKeepAfterCreate()",
      number: "NumberKeepAfterCreate()",
      list: "ListKeepAfterCreate()",
      set: "SetKeepAfterCreate()",
    };

    return modifierByType[attr.type] || null;
  }

  /*
   * The attributes a create gives and OneUptime keeps from then on, by
   * their Go field names: after a create or an update each keeps its
   * planned value, whatever the configuration says (keepPlannedValues).
   */
  public static getKeptAfterCreateAttributes(
    resource: TerraformResource,
  ): Array<string> {
    return Object.entries(resource.schema)
      .filter(([name, attr]: [string, TerraformAttribute]): boolean => {
        return (
          ResourceGenerator.getKeepAfterCreateModifier(name, attr) !== null
        );
      })
      .map(([name]: [string, TerraformAttribute]): string => {
        return StringUtils.toPascalCase(
          StringUtils.toTerraformAttributeName(name),
        );
      });
  }

  /*
   * The attributes people set and OneUptime changes too (serverOwned
   * "shared", StaticFiles/shared.go): the labels a label rule adds, an
   * exception OneUptime resolves. Left out of a configuration, the plan
   * keeps OneUptime's value, even where the attribute has a default; under
   * Crossplane, a manifest's value is sent when it changes, and a list
   * keeps the entries OneUptime added. By Terraform name, with whether each
   * is a list or a set, held entry by entry.
   */
  public static getSharedAttributes(
    resource: TerraformResource,
  ): Array<SharedAttribute> {
    return Object.entries(resource.schema)
      .filter(([name, attr]: [string, TerraformAttribute]): boolean => {
        return (
          name !== "id" &&
          attr.serverOwned === "shared" &&
          Boolean(attr.optional || attr.required)
        );
      })
      .map(([name, attr]: [string, TerraformAttribute]): SharedAttribute => {
        return {
          name: StringUtils.toTerraformAttributeName(name),
          entries: attr.type === "set" || attr.type === "list",
        };
      })
      .sort((a: SharedAttribute, b: SharedAttribute): number => {
        return a.name.localeCompare(b.name);
      });
  }

  /*
   * The lists OneUptime adds to as well that a configuration holds by the
   * entries it declares (StaticFiles/entries.go, #10134): each list or set
   * of related records people and OneUptime both change - a record's
   * labels, an incident's on-call policies, an SLO's monitors - by
   * Terraform name, with its Go field, its API name and its type.
   */
  public static getHeldEntryAttributes(
    resource: TerraformResource,
  ): Array<HeldEntryAttribute> {
    return Object.entries(resource.schema)
      .filter(([name, attr]: [string, TerraformAttribute]): boolean => {
        return (
          name !== "id" &&
          attr.serverOwned === "shared" &&
          Boolean(attr.optional || attr.required) &&
          (attr.type === "set" || attr.type === "list") &&
          attr.elementKind === "entity"
        );
      })
      .map(([name, attr]: [string, TerraformAttribute]): HeldEntryAttribute => {
        const terraformName: string =
          StringUtils.toTerraformAttributeName(name);

        return {
          name: terraformName,
          fieldName: StringUtils.toPascalCase(terraformName),
          apiName: attr.apiFieldName || name,
          type: attr.type as "set" | "list",
        };
      })
      .sort((a: HeldEntryAttribute, b: HeldEntryAttribute): number => {
        return a.name.localeCompare(b.name);
      });
  }

  /*
   * A resource's methods that hold its lists OneUptime adds to as well to
   * the entries a configuration declares (StaticFiles/entries.go): their
   * state after a read, and after a create or an update. Nothing for a
   * resource with none.
   */
  public static generateHeldEntryMethods(
    resource: TerraformResource,
    resourceTypeName: string,
  ): string {
    const held: Array<HeldEntryAttribute> =
      ResourceGenerator.getHeldEntryAttributes(resource);

    if (held.length === 0) {
      return "";
    }

    const afterRead: string = held
      .map((attribute: HeldEntryAttribute): string => {
        return `    data.${attribute.fieldName} = ${StringUtils.toPascalCase(attribute.type)}EntriesAfterRead(r.client, declared, "${attribute.name}", prior.${attribute.fieldName}, data.${attribute.fieldName})`;
      })
      .join("\n");

    const afterWrite: string = held
      .map((attribute: HeldEntryAttribute): string => {
        return `    data.${attribute.fieldName}, isDeclared = ${StringUtils.toPascalCase(attribute.type)}EntriesAfterWrite(r.client, isCreate, declared["${attribute.name}"], config.${attribute.fieldName}, plan.${attribute.fieldName}, data.${attribute.fieldName})
    declared["${attribute.name}"] = isDeclared`;
      })
      .join("\n");

    return `
// heldEntriesAfterRead holds each list OneUptime adds to as well (${held
      .map((attribute: HeldEntryAttribute): string => {
        return attribute.name;
      })
      .join(", ")}) to
// the entries the configuration declares that the record still has, after
// a read (see entries.go).
func (r *${resourceTypeName}Resource) heldEntriesAfterRead(ctx context.Context, private PrivateState, data *${resourceTypeName}ResourceModel, prior *${resourceTypeName}ResourceModel) {
    declared := ReadDeclaredEntries(ctx, private)
${afterRead}
}

// heldEntriesAfterWrite is the state of each such list after a create or an
// update, and which of them the configuration declares from then on (see
// entries.go): the caller keeps them in the private state.
func (r *${resourceTypeName}Resource) heldEntriesAfterWrite(ctx context.Context, before PrivateState, data *${resourceTypeName}ResourceModel, plan *${resourceTypeName}ResourceModel, config *${resourceTypeName}ResourceModel, isCreate bool) DeclaredEntries {
    declared := DeclaredEntries{}
    if !isCreate {
        declared = ReadDeclaredEntries(ctx, before)
    }
    var isDeclared bool
${afterWrite}
    return declared
}
`;
  }

  /*
   * The step of a resource's ModifyPlan for what people and OneUptime both
   * change (PlanShared, StaticFiles/shared.go), or nothing for a resource
   * with none.
   */
  public static generatePlanSharedCall(resource: TerraformResource): string {
    const shared: Array<SharedAttribute> =
      ResourceGenerator.getSharedAttributes(resource);

    if (shared.length === 0) {
      return "";
    }

    const attributes: string = shared
      .map((attribute: SharedAttribute): string => {
        return `        {Name: "${attribute.name}", Entries: ${attribute.entries}},`;
      })
      .join("\n");

    return `
    // What people and OneUptime both change: OneUptime's change is never one
    // to undo (see shared.go).
    PlanShared(ctx, req, resp, r.client, []SharedAttribute{
${attributes}
    })
`;
  }

  private providerName: string;
  private goModuleName: string;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.spec = spec;
    this.providerName = config.providerName;
    this.goModuleName = config.goModuleName;
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
        LegacyNameStateMover("${this.providerName}_${formerName}", r.schemaDefinition()),
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
     * A permission's key (OneUptime#10300): the type, its plan modifier and
     * validator, which take the key written with jsonencode(), as earlier
     * versions asked, as the same permission; their tests; and a create,
     * refresh, plan, import and lookup of each permission resource through
     * the real protocol server, from either form and from state in either.
     */
    await this.copyStaticFile("permissionkey.go", "internal/provider");
    await this.copyStaticFile("permissionkey_test.go", "internal/provider");
    await this.copyStaticFile(
      "permission_roundtrip_test.go",
      "internal/provider",
    );
    /*
     * NumberFromAPI, which every number attribute - of resources and data
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
     * The packages the generated resources and data sources are in (#7591,
     * Core/ProviderShards.ts): what each hands over and the order the
     * provider lists them in, its tests, and the external test that links
     * every shard into this package's tests.
     */
    await this.copyStaticFile("shards.go", "internal/provider");
    await this.copyStaticFile("shards_order_test.go", "internal/provider");
    await this.copyStaticFile("shards_test.go", "internal/provider");

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
     * What changes only together with a new value of another attribute (a
     * monitor secret's secret_type, with secret_value): the plan's refusal
     * of a change of the one alone, and its tests - the refusal on its own,
     * and type-only, value-only and type-and-value changes of a monitor
     * secret through the real protocol server against a fake API (#9814).
     */
    await this.copyStaticFile("changestogether.go", "internal/provider");
    await this.copyStaticFile("changestogether_test.go", "internal/provider");
    await this.copyStaticFile(
      "changestogether_plan_test.go",
      "internal/provider",
    );

    /*
     * What OneUptime keeps once a record exists (#9985): the plan modifiers
     * that keep the state's value of an attribute a create gives - a
     * monitor's status - and their tests, on their own and through the
     * real protocol server against a fake API.
     */
    await this.copyStaticFile("serverowned.go", "internal/provider");
    await this.copyStaticFile("serverowned_test.go", "internal/provider");
    await this.copyStaticFile("serverowned_plan_test.go", "internal/provider");

    /*
     * What people and OneUptime both change (#10052): the plan that keeps
     * OneUptime's value when the configuration leaves one out, and, under
     * Crossplane, sends a manifest's value only when it changes and keeps
     * the entries OneUptime added to a list - and its tests, on their own
     * and through the real protocol server against a fake API.
     */
    await this.copyStaticFile("shared.go", "internal/provider");
    await this.copyStaticFile("shared_test.go", "internal/provider");
    await this.copyStaticFile("shared_plan_test.go", "internal/provider");

    /*
     * A list OneUptime adds to as well, held to the entries a configuration
     * declares and updated entry by entry (#10134, #10135), and what a
     * create left out because only OneUptime writes it (#10136) - and its
     * tests, on their own and through the real protocol server.
     */
    await this.copyStaticFile("entries.go", "internal/provider");
    await this.copyStaticFile("entries_test.go", "internal/provider");
    await this.copyStaticFile("entries_plan_test.go", "internal/provider");

    /*
     * How the Crossplane provider, which runs this provider in process,
     * reads a field a manifest leaves out: as the record's, even one with a
     * default - and its tests, through the real protocol server.
     */
    await this.copyStaticFile("crossplane.go", "internal/provider");
    await this.copyStaticFile("crossplane_test.go", "internal/provider");

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
     * What a delete says besides the record (#9832): a custom role's
     * workflows_run_as_on_delete, sent in the DELETE's body, the hint a
     * refused destroy gets, and the validator of a choice that goes with
     * another - with their tests, the last through the real protocol
     * server and a stand-in for the API.
     */
    await this.copyStaticFile("deletechoices.go", "internal/provider");
    await this.copyStaticFile("deletechoices_test.go", "internal/provider");

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
    // And its asking again while a name is another resource's (#9855).
    await this.copyStaticFile("client_name_taken_test.go", "internal/provider");
    // And while a domain or an identifier is (#10319).
    await this.copyStaticFile(
      "client_value_taken_test.go",
      "internal/provider",
    );

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
    // A schedule's layers given a new turn order in one apply (#9038).
    await this.copyStaticFile(
      "acceptance_schedule_layers_test.go",
      "internal/provider",
    );
    // A custom role that workflows run as, destroyed (#9832).
    await this.copyStaticFile(
      "acceptance_custom_role_test.go",
      "internal/provider",
    );

    /*
     * The resources written by hand (Core/HandwrittenResources.ts), with
     * their tests. A name the spec gives a resource too would be two
     * resources of one name, so generation stops there.
     */
    for (const handwritten of HANDWRITTEN_RESOURCES) {
      if (
        resources.some((resource: TerraformResource) => {
          return resource.name === handwritten.name;
        })
      ) {
        throw new Error(
          `The spec gives a resource named ${handwritten.name}, which is written by hand (Core/HandwrittenResources.ts): rename one of them.`,
        );
      }

      for (const fileName of handwritten.staticFiles) {
        await this.copyStaticFile(fileName, "internal/provider");
      }
    }

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

  // A generated resource's file, in the shard its name picks.
  private async generateResource(resource: TerraformResource): Promise<void> {
    const resourceGoContent: string = this.generateResourceGoFile(resource);
    const fileName: string = ResourceGenerator.resourceFileName(resource);
    await this.fileGenerator.writeFileInDir(
      `${PROVIDER_PACKAGE_DIR}/${shardOf(fileName)}`,
      fileName,
      resourceGoContent,
    );
  }

  public static resourceFileName(resource: TerraformResource): string {
    return `resource_${resource.name}.go`;
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
          (attr.isComplexObject || attr.isPhone || attr.isPermission) &&
          !(attr.computed && !attr.optional) &&
          !isProjectIdName(name)
        );
      },
    );
    /*
     * A delete choice that goes with another and holds no ID lists its
     * validator itself; one that holds an ID appends it to the ID's.
     */
    const hasDeleteChoiceValidatorList: boolean = Object.values(
      resource.schema,
    ).some((attr: TerraformAttribute) => {
      return (
        attr.type === "string" &&
        Boolean(attr.deleteChoice?.requiredWith) &&
        !attr.relation
      );
    });
    if (
      hasEnumValidators ||
      hasEnvelopeValidators ||
      hasDeleteChoiceValidatorList
    ) {
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

    /*
     * A shard of its own (Core/ProviderShards.ts), which names the provider
     * package's helpers as its own through the dot import.
     */
    return `package ${shardOf(ResourceGenerator.resourceFileName(resource))}

import (
    ${providerDotImport(this.goModuleName)}
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
    id, email, ok := ImportIDOfMembership(ctx, r.client, req.ID, MembershipImport{
        ListPath:        "${resource.membershipImport.listPath}",
        ParentField:     "${resource.membershipImport.parentApiField}",
        ParentAttribute: "${resource.membershipImport.parentAttribute}",
        ParentNoun:      "${resource.membershipImport.parentNoun}",
        PersonField:     "${resource.membershipImport.personApiField}",
        PersonAttribute: "${resource.membershipImport.personAttribute}",
        ByEmail:         ${Boolean(resource.membershipImport.personEmailAttribute)},
        Kind:            "${resource.membershipImport.kind}",
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
      ? `    resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)${this.generateMarkImported(resource)}${this.generateMarkEntriesAdopted(resource)}`
      : `    // Without a read endpoint, a passthrough import would silently create
    // id-only state that can never be refreshed. Fail loudly instead.
    resp.Diagnostics.AddError(
        "Import Not Supported",
        "oneuptime_${resource.name} cannot be imported: the OneUptime API exposes no read endpoint for it.",
    )`
}
}

${this.generateKeepPlannedValuesMethod(resource, resourceTypeName)}${ResourceGenerator.generateHeldEntryMethods(resource, resourceTypeName)}
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
    return ValidOneUptimeObjectTypes[typeStr]
}
`;
  }

  /*
   * Emits the package-level ObjectType registry, generated from
   * Common/Types/JSON.ts so it stays in sync with the API's wrapper types.
   */
  private async generateObjectTypesFile(): Promise<void> {
    const content: string = `package provider

// ValidOneUptimeObjectTypes lists every {_type: ...} wrapper the OneUptime
// API emits. Generated from Common/Types/JSON.ts ObjectType.
var ValidOneUptimeObjectTypes = map[string]bool{
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
      } else if (attr.type === "string" && attr.isPermission) {
        // A permission's key, plain or JSON-encoded (permissionkey.go).
        goType = "PermissionKeyValue";
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
    } else if (attr.type === "string" && attr.isPermission) {
      /*
       * A permission's key and the same key written with jsonencode() are
       * one value (PermissionKeyType), so a read keeps the form the state
       * holds and an apply the form the plan does.
       */
      options.push("CustomType: PermissionKeyType{}");
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

    /*
     * Last, a value a create gives and OneUptime keeps from then on
     * (serverowned.go): once the record exists the plan is the state's
     * value, whatever the configuration says.
     */
    const keepAfterCreate: string | null =
      ResourceGenerator.getKeepAfterCreateModifier(name, attr);
    if (keepAfterCreate) {
      modifiers.push(keepAfterCreate);
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
      attr.isPermission &&
      !isComputedOnly &&
      !isProjectIdField
    ) {
      // A permission's key, never JSON of another kind (permissionkey.go).
      validators = `,
                Validators: []validator.String{
                    PermissionKeyValidator(),
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

    /*
     * A delete choice that goes with another - given only while that one
     * has its value, and needed then (StaticFiles/deletechoices.go) - is
     * held to it too, beside what its kind of value takes.
     */
    const requiredWith: { attribute: string; value: string } | undefined = (
      attr as TerraformAttribute
    ).deleteChoice?.requiredWith;
    if (requiredWith && attr.type === "string") {
      const withValidator: string = `DeleteChoiceRequiredWith("${requiredWith.attribute}", "${GoCodeGenerator.escapeString(requiredWith.value)}")`;
      const relationHelper: string | undefined = attr.relation
        ? ResourceGenerator.getRecordIdValidators(attr.relation, attr.type)
        : undefined;

      validators = relationHelper
        ? `,
                Validators: append(${relationHelper}("${this.providerName}_${attr.relation!.name}"), ${withValidator})`
        : `,
                Validators: []validator.String{
                    ${withValidator},
                }`;
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
          ? `Validators: PersonIDsValidators("${attr.person.emailAttribute}", ${attr.person.isRequired})`
          : `Validators: PersonIDValidators("${attr.person.emailAttribute}", ${attr.person.isRequired})`,
      );
    } else {
      options.push(
        isSet
          ? `PlanModifiers: PersonEmailsPlanModifiers("${attr.personEmailOf}")`
          : `PlanModifiers: PersonEmailPlanModifiers("${attr.personEmailOf}")`,
      );
      options.push(
        isSet
          ? "Validators: PersonEmailsValidators()"
          : "Validators: PersonEmailValidators()",
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
   * First the people it names (people.go PlanPersonID): found by email
   * address here, on the configured resource - a plan modifier would have
   * no client to ask with. It also asks for the replacement a different
   * person needs where the API cannot change them, so the ID attribute has
   * no RequiresReplace of its own.
   *
   * Then what changes only together with a new value of another attribute
   * (TerraformAttribute.changesOnlyWith, changestogether.go): a plan that
   * changes a monitor secret's secret_type and keeps its secret_value fails
   * here, before anything is written, instead of in an update the server
   * refuses half-way through an apply (#9814).
   *
   * Then, for every resource, KeepStateWhenNothingChanges
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
        return `    ${person.isList ? "PlanPeopleIDs" : "PlanPersonID"}(ctx, r.client, req, resp, PersonAttribute{
        ID:       "${this.sanitizeAttributeName(name)}",
        Email:    "${person.emailAttribute}",
        Invites:  ${person.invitesByEmail},
        Replaces: ${Boolean(attr.forceNew)},
    })`;
      });

    const changedTogether: Array<[string, string]> =
      ResourceGenerator.getChangedTogetherAttributes(resource).map(
        ([name, companion]: [string, string]): [string, string] => {
          return [
            this.sanitizeAttributeName(name),
            this.sanitizeAttributeName(companion),
          ];
        },
      );

    const label: string = resource.name.replace(/_/g, " ");

    return `
// ModifyPlan ${
      people.length > 0
        ? `finds, by email address, the people this ${label} names (see people.go),
// and keeps`
        : "keeps"
    } the state when nothing a configuration sets changes (see
// importsettle.go).${changedTogether
      .map(([name, companion]: [string, string]): string => {
        return `\n// It refuses a plan that changes ${name} and keeps ${companion} (see\n// changestogether.go).`;
      })
      .join("")}
func (r *${resourceTypeName}Resource) ModifyPlan(ctx context.Context, req resource.ModifyPlanRequest, resp *resource.ModifyPlanResponse) {
    // Destroying: nothing to plan.
    if req.Plan.Raw.IsNull() {
        return
    }

    // Under Crossplane, what a manifest leaves out is the record's (see crossplane.go).
    KeepLeftOutUnderCrossplane(ctx, req, resp)
${ResourceGenerator.generatePlanSharedCall(resource)}${people.length > 0 ? `\n${people.join("\n")}\n` : ""}${changedTogether
      .map(([name, companion]: [string, string]): string => {
        return `\n    RequireChangedTogether(ctx, req, resp, "${name}", "${companion}")\n`;
      })
      .join("")}
    KeepStateWhenNothingChanges(ctx, req, resp)
}
`;
  }

  /*
   * The attributes that change only together with a new value of another,
   * each with that other one: [secret_type, secret_value] for a monitor
   * secret (the spec's x-oneuptime-changes-only-with, resolved by the
   * parser).
   */
  public static getChangedTogetherAttributes(
    resource: TerraformResource,
  ): Array<[string, string]> {
    return Object.entries(resource.schema)
      .filter(([, attr]: [string, TerraformAttribute]): boolean => {
        return Boolean(attr.changesOnlyWith);
      })
      .map(([name, attr]: [string, TerraformAttribute]): [string, string] => {
        return [name, attr.changesOnlyWith as string];
      });
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

  /*
   * An import adopts the record's entries of each list OneUptime adds to
   * as well: its first read takes the record's whole list into the state
   * (StaticFiles/entries.go), as the configuration's.
   */
  private generateMarkEntriesAdopted(resource: TerraformResource): string {
    const held: Array<HeldEntryAttribute> =
      ResourceGenerator.getHeldEntryAttributes(resource);

    if (held.length === 0) {
      return "";
    }

    return `

    // An import adopts the record's entries of each list OneUptime adds to as well (see entries.go).
    if r.client.HoldsDeclaredEntries() {
        resp.Diagnostics.Append(DeclaredEntries{${held
          .map((attribute: HeldEntryAttribute): string => {
            return `"${attribute.name}": true`;
          })
          .join(", ")}}.Write(ctx, resp.Private)...)
    }`;
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
    resp.Diagnostics.Append(MarkImportedFromServer(ctx, resp.Private, []string{${attributes
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
   * invited (people.go PersonIDForWrite). A team member named by address is
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
          ? `    if !PersonIDsForWrite(ctx, r.client, &data.${person.idField}, data.${person.emailField}, "${person.emailAttribute}", &resp.Diagnostics) {
        return
    }`
          : `    if !PersonIDForWrite(ctx, r.client, &data.${person.idField}, data.${person.emailField}, "${person.emailAttribute}", &resp.Diagnostics) {
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
        if id := APIStringValue(created["${person.apiFieldName}"]); id != "" {
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
   * named by ID, read now (people.go PersonEmailAfterWrite).
   */
  private generatePersonEmailsAfterWrite(resource: TerraformResource): string {
    const lines: Array<string> = this.getPersonAttributes(resource).map(
      (person: PersonAttributeFields) => {
        return person.isSet
          ? `    data.${person.emailField} = PersonEmailsAfterWrite(ctx, r.client, data.${person.idField}, data.${person.emailField})`
          : `    data.${person.emailField} = PersonEmailAfterWrite(ctx, r.client, data.${person.idField}, data.${person.emailField})`;
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
   * outside Terraform (people.go PersonEmailAfterRead).
   */
  private generatePersonEmailsAfterRead(resource: TerraformResource): string {
    const lines: Array<string> = this.getPersonAttributes(resource).map(
      (person: PersonAttributeFields) => {
        return person.isSet
          ? `    data.${person.emailField} = PersonEmailsAfterRead(ctx, r.client, prior${person.idField}, data.${person.idField}, prior${person.emailField})`
          : `    data.${person.emailField} = PersonEmailAfterRead(ctx, r.client, prior${person.idField}, data.${person.idField}, prior${person.emailField})`;
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
        if (ResourceGenerator.getKeepAfterCreateModifier(name, attr)) {
          return true;
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

    const keptAfterCreate: Array<string> =
      ResourceGenerator.getKeptAfterCreateAttributes(resource);

    const assignments: string = fields
      .map((field: string) => {
        if (keptAfterCreate.includes(field)) {
          return `    if !plan.${field}.IsUnknown() {
        data.${field} = plan.${field}
    }`;
        }
        return `    if config.${field}.IsNull() && !plan.${field}.IsUnknown() {
        data.${field} = plan.${field}
    }`;
      })
      .join("\n");

    const afterCreateNote: string =
      keptAfterCreate.length > 0
        ? `
// An attribute a create gives and OneUptime keeps from then on (${keptAfterCreate.join(", ")};
// see serverowned.go) keeps its planned value whatever the configuration says:
// the create's value, or the state's after it, which OneUptime may move on
// before the write is read back.`
        : "";

    return `
// keepPlannedValues puts back, after a create or an update, the planned value
// of each optional attribute the configuration leaves out. The server keeps
// some of these up to date on its own (when it last checked a heartbeat, the
// status a probe last reported...), so the value read back after the write can
// already differ from the plan, and Terraform would fail the apply with
// "Provider produced inconsistent result after apply". The next refresh reads
// the server's value, which is never a diff for an attribute nobody configured.${afterCreateNote}
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
${this.generateResponseMapping(resource, resourceVarName + "Response", true, true)}${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}${this.generateHeldEntriesAfterWriteCall(resource, true)}`;

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
${this.generateShownOnceMapping(resource, resourceVarName + "Response")}
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
    data.Id = types.StringValue(createdId)${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}${this.generateHeldEntriesAfterWriteCall(resource, true)}`;
    }

    /*
     * A membership that exists already says how to import it instead
     * (people.go AlreadyInvitedHint).
     */
    const createError: string =
      resource.membershipImport?.kind === MembershipKind.Member
        ? `resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to create ${resource.name}: %s%s", err, AlreadyInvitedHint(err, "${this.providerName}_${resource.name}", "${resource.membershipImport.parentAttribute}")))`
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

    // What OneUptime left out because only it writes it, if anything (see entries.go).
    resp.Diagnostics.Append(FieldsLeftOutWarning(httpResp, "${resource.name.replace(/_/g, " ")}")...)

    // What the write does that someone should know, if anything (see entries.go).
    resp.Diagnostics.Append(WriteWarnings(httpResp, "${resource.name.replace(/_/g, " ")}")...)
${readBackCode}

    // Write logs using the tflog package
    tflog.Trace(ctx, "created a resource")

${
  this.getImportedFromServerAttributes(resource).length > 0
    ? `
    // Nothing a create made was imported (see importsettle.go).
    resp.Diagnostics.Append(ForgetImportedFromServer(ctx, resp.Private)...)`
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
${
  ResourceGenerator.getHeldEntryAttributes(resource).length > 0
    ? `
    // The state before the read: the entries the configuration declared (see entries.go).
    prior := data
`
    : ""
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
${this.generateResponseMapping(resource, resourceVarName + "Response", false)}${this.generatePersonEmailsAfterRead(resource)}${
      ResourceGenerator.getHeldEntryAttributes(resource).length > 0
        ? `

    // A list OneUptime adds to as well holds the entries the configuration declares (see entries.go).
    r.heldEntriesAfterRead(ctx, req.Private, &data, &prior)`
        : ""
    }

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
    data.Id = state.Id${this.generateKeepPlannedValuesCall(resource)}${this.generatePersonEmailsAfterWrite(resource)}${this.generateListChangesCheck(resource)}${this.generateHeldEntriesAfterWriteCall(resource, false)}`
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
    data.Id = state.Id${this.generateShownOnceKeptOnUpdate(resource)}
${this.generateWrittenFromConfig(resource)}${hasRead ? this.generatePlanAndConfigCapture(resource, resourceTypeName) : ""}${this.generatePersonIDsForWrite(resource, false)}
    // Create API request body
    ${resourceVarName}Request := map[string]interface{}{
        "data": map[string]interface{}{},
    }
${this.generateConditionalUpdateRequestBodyWithDeclaration(resource, resourceVarName)}

    // Only call the API when there are changed fields to send. An empty
    // update body is rejected by the API; state is still refreshed below so
    // this method never writes unverified plan values into state.
    if len(${resourceVarName}Request["data"].(map[string]interface{})) > 0${this.hasHeldEntriesInUpdate(resource) ? " || listChanges.Any()" : ""} {
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

        // What the write does that someone should know, if anything (see entries.go).
        resp.Diagnostics.Append(WriteWarnings(httpResp, "${resource.name.replace(/_/g, " ")}")...)
    }
${readBackCode}${
      this.getImportedFromServerAttributes(resource).length > 0
        ? `

    // What this update wrote is what the configuration says now (see importsettle.go).
    resp.Diagnostics.Append(KeepImportedFromServer(ctx, resp.Private, writtenFromConfig)...)`
        : ""
    }

    // Save updated data into Terraform state
    resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
`;
  }

  /*
   * Whether a resource's update sends a list OneUptime adds to as well:
   * entry by entry, in listChanges (StaticFiles/entries.go).
   */
  private hasHeldEntriesInUpdate(resource: TerraformResource): boolean {
    return this.getHeldEntriesInUpdate(resource).length > 0;
  }

  // The held-entry attributes the update schema writes.
  private getHeldEntriesInUpdate(
    resource: TerraformResource,
  ): Array<HeldEntryAttribute> {
    const updateSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.update || {};
    const written: Set<string> = new Set<string>(
      Object.entries(updateSchema)
        .filter(([name, attr]: [string, TerraformAttribute]): boolean => {
          return name !== "id" && !attr.computed;
        })
        .map(([name]: [string, TerraformAttribute]): string => {
          return this.sanitizeAttributeName(name);
        }),
    );

    return ResourceGenerator.getHeldEntryAttributes(resource).filter(
      (attribute: HeldEntryAttribute): boolean => {
        return written.has(attribute.name);
      },
    );
  }

  /*
   * After an update's read-back: what it added to each list OneUptime adds
   * to as well is there, and what it took off is gone (EntryChanges.Check).
   */
  private generateListChangesCheck(resource: TerraformResource): string {
    const held: Array<HeldEntryAttribute> =
      this.getHeldEntriesInUpdate(resource);

    if (held.length === 0) {
      return "";
    }

    return `

    // What this update added to a list OneUptime adds to as well is there, and what it took off is gone (see entries.go).
${held
  .map((attribute: HeldEntryAttribute): string => {
    return `    resp.Diagnostics.Append(listChanges.Check("${attribute.apiName}", data.${attribute.fieldName})...)`;
  })
  .join("\n")}
    if resp.Diagnostics.HasError() {
        return
    }`;
  }

  /*
   * After a create's or an update's read-back: the state of each list
   * OneUptime adds to as well, and which the configuration declares
   * (StaticFiles/entries.go).
   */
  private generateHeldEntriesAfterWriteCall(
    resource: TerraformResource,
    isCreate: boolean,
  ): string {
    if (ResourceGenerator.getHeldEntryAttributes(resource).length === 0) {
      return "";
    }

    if (this.getKeptPlannedAttributes(resource).length === 0) {
      throw new Error(
        `${resource.name} has a list OneUptime adds to as well but no planned value to hold it to: getKeptPlannedAttributes must keep it.`,
      );
    }

    return `

    // A list OneUptime adds to as well holds the entries the configuration declares (see entries.go).
    resp.Diagnostics.Append(r.heldEntriesAfterWrite(ctx, ${isCreate ? "nil" : "req.Private"}, &data, &plan, &config, ${isCreate}).Write(ctx, resp.Private)...)`;
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

    /*
     * What the delete says besides the record (TerraformResource
     * .deleteChoices): what state holds of each choice, sent in the
     * DELETE's body, and the hint a refusal for a choice none was given
     * gets (StaticFiles/deletechoices.go).
     */
    const deleteChoices: Array<{ key: string; attribute: string }> =
      ResourceGenerator.getDeleteChoiceAttributes(resource);
    const hasDeleteChoices: boolean = deleteChoices.length > 0;
    const deleteChoicesCode: string = hasDeleteChoices
      ? `
    // What the delete says besides the ${resource.name.replace(/_/g, " ")}, from state (see deletechoices.go).
    deleteChoices := []DeleteChoice{
${deleteChoices
  .map((choice: { key: string; attribute: string }) => {
    return `        {Key: "${choice.key}", Attribute: "${choice.attribute}", Value: data.${StringUtils.toPascalCase(this.sanitizeAttributeName(choice.attribute))}},`;
  })
  .join("\n")}
    }
`
      : "";
    const deleteCall: string = hasDeleteChoices
      ? `r.client.DeleteWithBody(ctx, ${finalPath}, DeleteChoicesBody(deleteChoices))`
      : `r.client.Delete(ctx, ${finalPath})`;
    const refusal: string = hasDeleteChoices
      ? `resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to delete ${resource.name}: %s%s", err, DeleteChoicesHint(err, deleteChoices, "${GoCodeGenerator.escapeString(this.getDeleteChoicesHint(resource))}")))`
      : `resp.Diagnostics.AddError("OneUptime API Error", fmt.Sprintf("Unable to delete ${resource.name}: %s", err))`;

    return `
func (r *${resourceTypeName}Resource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
    var data ${resourceTypeName}ResourceModel

    // Read Terraform prior state data into the model
    resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

    if resp.Diagnostics.HasError() {
        return
    }
${deleteChoicesCode}
    // Make API call
    httpResp, err := ${deleteCall}
    if err != nil {
        resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to delete ${resource.name}, got error: %s", err))
        return
    }

    // A failed delete must keep the resource in state — silently dropping it
    // orphans real infrastructure. 404 means it is already gone.
    if httpResp.StatusCode >= 400 && httpResp.StatusCode != http.StatusNotFound {
        err = r.client.ParseResponse(httpResp, nil)
        ${refusal}
        return
    }
    if httpResp.Body != nil {
        httpResp.Body.Close()
    }
}
`;
  }

  /*
   * The attributes that are choices the resource's delete takes
   * (TerraformResource.deleteChoices), with their keys in miscDataProps, in
   * the order the choices are given.
   */
  public static getDeleteChoiceAttributes(
    resource: TerraformResource,
  ): Array<{ key: string; attribute: string }> {
    return (resource.deleteChoices?.attributes || [])
      .map((attribute: string) => {
        return {
          attribute: attribute,
          key: resource.schema[attribute]?.deleteChoice?.key || "",
        };
      })
      .filter((choice: { key: string; attribute: string }) => {
        return Boolean(choice.key);
      });
  }

  /*
   * What a destroy OneUptime refused for a choice it needs adds, in
   * Terraform's words: which attributes say it, and that a delete sends
   * what state holds - so set it, apply, then destroy again. The API's own
   * words say miscDataProps, which a Terraform configuration never writes.
   */
  public getDeleteChoicesHint(resource: TerraformResource): string {
    const attributes: Array<string> = resource.deleteChoices?.attributes || [];
    const main: Array<string> = attributes.filter((attribute: string) => {
      return !resource.schema[attribute]?.deleteChoice?.requiredWith;
    });
    const companions: Array<string> = attributes
      .filter((attribute: string) => {
        return Boolean(resource.schema[attribute]?.deleteChoice?.requiredWith);
      })
      .map((attribute: string) => {
        const requiredWith: { attribute: string; value: string } =
          resource.schema[attribute]!.deleteChoice!.requiredWith!;

        return ` - with ${attribute} when ${requiredWith.attribute} is "${requiredWith.value}" -`;
      });
    const names: string = main.join(" or ");

    return `To say it in Terraform, set ${names} on this ${this.providerName}_${resource.name}${companions.join("")} and run terraform apply, then destroy it again: Terraform deletes a resource with what its state holds.`;
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

    /*
     * A list OneUptime adds to as well is sent entry by entry, in the
     * request's addToList and removeFromList (StaticFiles/entries.go,
     * #10135), but under exclusive_lists.
     */
    const heldInUpdate: Map<string, HeldEntryAttribute> = new Map<
      string,
      HeldEntryAttribute
    >(
      this.getHeldEntriesInUpdate(resource).map(
        (attribute: HeldEntryAttribute): [string, HeldEntryAttribute] => {
          return [attribute.name, attribute];
        },
      ),
    );

    if (heldInUpdate.size > 0) {
      conditionalAssignments.push(
        "    // The entries this update adds to a list OneUptime adds to as well, and takes off it (see entries.go).",
      );
      conditionalAssignments.push("    listChanges := NewEntryChanges()");
    }

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

      const held: HeldEntryAttribute | undefined =
        heldInUpdate.get(sanitizedName);

      if (held) {
        conditionalAssignments.push(
          `    ${changeCheckCondition} {
        if r.client.ChangesEntriesOneByOne() {
            listChanges.Diff("${held.name}", "${held.apiName}", data.${fieldName}, state.${fieldName})
        } else {
            ${valueAssignment}
        }
    }`,
        );
        continue;
      }

      conditionalAssignments.push(
        `    ${changeCheckCondition} {\n        ${valueAssignment}\n    }`,
      );
    }

    if (heldInUpdate.size > 0) {
      conditionalAssignments.push(
        `    listChanges.AddTo(${resourceVarName}Request)`,
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
     * A permission is sent as its key, the way OneUptime takes it, also
     * when the configuration writes it with jsonencode() (permissionkey.go).
     */
    if (terraformAttr.type === "string" && terraformAttr.isPermission) {
      return `requestDataMap["${apiFieldName}"] = PermissionKeyOf(data.${fieldName}.ValueString())`;
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
      // Answered by the create alone: no read holds it.
      if (attr.shownOnce) {
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
    // The create's own answer, which alone holds what it answers once.
    isCreateAnswer: boolean = false,
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

      /*
       * Answered once, by the create (shownOnce): a read's answer never
       * holds it, so mapping one would clear it from state. Set from the
       * create's answer (generateShownOnceMapping) and kept after.
       */
      if (attr.shownOnce && !isCreateAnswer) {
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

  /*
   * What a create answers once (shownOnce), from that answer: the one time
   * the provider is told it. Set before anything else is saved to state,
   * so a read-back that fails cannot lose it.
   */
  private generateShownOnceMapping(
    resource: TerraformResource,
    responseVar: string,
  ): string {
    const shownOnce: Array<[string, TerraformAttribute]> =
      ResourceGenerator.getShownOnceAttributes(resource);

    if (shownOnce.length === 0) {
      return "";
    }

    const mappings: string[] = [
      ``,
      `    // What the create answers once, and nothing reads back: kept from its answer.`,
      `    var shownOnceMap map[string]interface{}`,
      `    if wrapper, ok := ${responseVar}["data"].(map[string]interface{}); ok {`,
      `        shownOnceMap = wrapper`,
      `    } else {`,
      `        shownOnceMap = ${responseVar}`,
      `    }`,
    ];

    for (const [name, attr] of shownOnce) {
      const sanitizedName: string = this.sanitizeAttributeName(name);
      const fieldName: string = StringUtils.toPascalCase(sanitizedName);
      const apiFieldName: string = attr.apiFieldName || name;

      mappings.push(
        `    ${this.generateResponseSetter(
          attr,
          `data.${fieldName}`,
          `shownOnceMap["${apiFieldName}"]`,
          true,
          sanitizedName,
        )}`,
      );
    }

    return mappings.join("\n");
  }

  /*
   * What an update keeps of what the create answered once: its value in
   * state, which no read can tell again - null for an imported record.
   */
  private generateShownOnceKeptOnUpdate(resource: TerraformResource): string {
    return ResourceGenerator.getShownOnceAttributes(resource)
      .map(([name]: [string, TerraformAttribute]): string => {
        const fieldName: string = StringUtils.toPascalCase(
          this.sanitizeAttributeName(name),
        );

        return `\n    // Answered once, by the create: kept as state holds it.\n    data.${fieldName} = state.${fieldName}`;
      })
      .join("");
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

        /*
         * A permission arrives as its key. PermissionKeyType's semantic
         * equality keeps the plan's or the state's form when it is the same
         * key written with jsonencode() (permissionkey.go).
         */
        if (attr.isPermission) {
          return `if val, ok := ${responseValue}.(string); ok && val != "" {
        ${fieldName} = NewPermissionKeyValue(val)
    } else {
        ${fieldName} = NewPermissionKeyNull()
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

  /*
   * The resources' places in GetResources, which lists them in this order:
   * the generated ones, those written by hand, then the deprecated aliases
   * of the renamed ones under their old names. Each shard hands over its own
   * (its resources.go), the provider package holds the ones written by hand
   * (resources.go there), and StaticFiles/shards.go puts them back in order.
   */
  private async updateProviderWithResources(
    resources: TerraformResource[],
  ): Promise<void> {
    const renamedResources: Array<TerraformResource> = resources.filter(
      (resource: TerraformResource) => {
        return Boolean(resource.legacyName);
      },
    );
    const firstHandwritten: number = resources.length;
    const firstAlias: number = firstHandwritten + HANDWRITTEN_RESOURCES.length;

    type Held = {
      entries: Array<{ order: number; constructor: string }>;
      aliases: Array<{
        order: number;
        name: string;
        legacyName: string;
        constructor: string;
        legacyConstructor: string;
      }>;
    };
    const shards: Map<string, Held> = new Map(
      shardNames().map((shard: string): [string, Held] => {
        return [shard, { entries: [], aliases: [] }];
      }),
    );
    const shardHolding: (resource: TerraformResource) => Held = (
      resource: TerraformResource,
    ): Held => {
      return shards.get(shardOf(ResourceGenerator.resourceFileName(resource)))!;
    };

    resources.forEach((resource: TerraformResource, index: number) => {
      shardHolding(resource).entries.push({
        order: index,
        constructor: `New${StringUtils.toPascalCase(resource.name)}Resource`,
      });
    });
    renamedResources.forEach((resource: TerraformResource, index: number) => {
      const typeName: string = StringUtils.toPascalCase(resource.name);
      shardHolding(resource).entries.push({
        order: firstAlias + index,
        constructor: `New${typeName}LegacyResource`,
      });
      shardHolding(resource).aliases.push({
        order: resources.indexOf(resource),
        name: resource.name,
        legacyName: resource.legacyName!,
        constructor: `New${typeName}Resource`,
        legacyConstructor: `New${typeName}LegacyResource`,
      });
    });

    for (const [shard, held] of shards) {
      await this.fileGenerator.writeFileInDir(
        `${PROVIDER_PACKAGE_DIR}/${shard}`,
        "resources.go",
        shardRegistrationFile({
          shard,
          goModuleName: this.goModuleName,
          kind: "Resources",
          entries: held.entries,
          aliases: held.aliases,
        }),
      );
    }

    const handwritten: string = HANDWRITTEN_RESOURCES.map(
      (resource: HandwrittenResource, index: number) => {
        return `    {Order: ${firstHandwritten + index}, New: ${resource.goConstructor}},`;
      },
    ).join("\n");

    await this.fileGenerator.writeFileInDir(
      PROVIDER_PACKAGE_DIR,
      "resources.go",
      `package provider

// generatedShards is how many packages hold the generated resources and data
// sources, ${PROVIDER_PACKAGE_DIR}/${shardNames()[0]} to ${shardNames()[SHARD_COUNT - 1]}: each hands what it
// holds to this package (shards.go).
const generatedShards = ${SHARD_COUNT}

// The resources written by hand, in their places among the generated ones.
var handwrittenResources = []OrderedResource{
${handwritten}
}
`,
    );

    await writeAllShardsPackage(this.fileGenerator, this.goModuleName);
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
