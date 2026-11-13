import { MembershipKind } from "Common/Utils/DeveloperDocs/PeopleByEmail";

export interface TerraformProviderConfig {
  outputDir: string;
  providerName: string;
  providerVersion: string;
  goModuleName: string;
}

export interface OpenAPIOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, OpenAPIResponse>;
}

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema: OpenAPISchema;
  description?: string;
}

export interface OpenAPIRequestBody {
  content: Record<string, OpenAPIMediaType>;
  required?: boolean;
  description?: string;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIMediaType {
  schema: OpenAPISchema;
}

export interface OpenAPISchema {
  type?: string;
  format?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  description?: string;
  example?: any;
  enum?: any[];
  $ref?: string;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, any>;
  };
  tags?: Array<{
    name: string;
    description?: string;
    /*
     * The names the model had before it was renamed (TableMetadata's
     * formerSingularName): the first is kept as a deprecated alias.
     */
    "x-former-names"?: Array<string>;
    // The model's table: two models can share a singular name, so a tag's.
    "x-oneuptime-table"?: string;
    /*
     * A telemetry table's (logs, spans, metrics...): records the product
     * keeps for a while, which the provider reads but never manages.
     */
    "x-oneuptime-telemetry"?: boolean;
  }>;
}

/*
 * The resource or data source a relation attribute points at, from the
 * spec's x-oneuptime-relation: `name` is its Terraform name (without the
 * provider prefix).
 */
export interface TerraformRelation {
  name: string;
  isList: boolean;
  /*
   * A type with a data source and no resource - a record OneUptime makes
   * itself, such as an AI run or a scan: its ID is read with the data
   * source, never referred to as a resource's.
   */
  dataSourceOnly?: boolean;
}

export interface TerraformResource {
  name: string;
  /*
   * The model's table name (TeamMember for team_member), from its schemas'
   * names: what Common's rules for clients are keyed by.
   */
  tableName?: string | undefined;
  /*
   * The name this resource had before type names kept mixed-case words whole
   * (io_t_fleet for iot_fleet). Still registered, as a deprecated alias, so
   * configurations that use it keep working.
   */
  legacyName?: string | undefined;
  /*
   * A name this resource had that another resource has now (the link of a
   * status page and a subscriber notification template, whose name is the
   * template's): no alias can keep it, so a moved block brings state across
   * from it instead.
   */
  movedFrom?: string | undefined;
  goTypeName: string;
  description?: string; // Human description from the spec's tag (model tableDescription)
  operations: {
    create?: OpenAPIOperation;
    read?: OpenAPIOperation;
    update?: OpenAPIOperation;
    delete?: OpenAPIOperation;
    list?: OpenAPIOperation;
  };
  schema: Record<string, TerraformAttribute>;
  operationSchemas?: {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  };
  /*
   * A row imported by what it joins and who or what joins it -
   * `<team_id>/<email address or user id>`, `<monitor_id>/<team_id>` - as
   * well as by its own ID.
   */
  membershipImport?: TerraformMembershipImport | undefined;
}

export interface TerraformMembershipImport {
  // The Terraform attribute of what the row joins: team_id, monitor_id.
  parentAttribute: string;
  // What that is, in words: "team", "on call schedule layer".
  parentNoun: string;
  // Its API field: teamId.
  parentApiField: string;
  // The Terraform attribute of who or what joins it: user_id, team_id.
  personAttribute: string;
  // Its API field: userId.
  personApiField: string;
  /*
   * The attribute naming the person by email address (user_email), when it
   * is a person: then the import takes their address too.
   */
  personEmailAttribute?: string | undefined;
  // The list endpoint the membership is found in.
  listPath: string;
  // A team's member, an owner, or who an on-call layer or rule pages.
  kind: MembershipKind;
}

export interface TerraformDataSource {
  name: string;
  // See TerraformResource.legacyName.
  legacyName?: string | undefined;
  goTypeName: string;
  description?: string; // Human description from the spec's tag (model tableDescription)
  operations: {
    read?: OpenAPIOperation;
    list?: OpenAPIOperation;
  };
  schema: Record<string, TerraformAttribute>;
  /*
   * A data source written by hand, in StaticFiles/, in place of the one the
   * spec would give: the file's name. `oneuptime_user` is one - a project
   * API key cannot read User records, so it finds people among the
   * project's team members.
   */
  staticFile?: string | undefined;
}

export interface TerraformAttribute {
  type: string;
  description?: string;
  required?: boolean;
  computed?: boolean;
  optional?: boolean; // Explicitly mark as optional (useful for optional+computed fields)
  sensitive?: boolean;
  forceNew?: boolean;
  default?: any;
  apiFieldName?: string; // Original OpenAPI field name for API requests
  example?: any; // Example value from OpenAPI spec
  isComplexObject?: boolean; // Flag to indicate this string field is actually a complex object
  /*
   * A complex object that is one value in a wrapper ({_type: "Color",
   * value: "#ff0000"}): written, and kept in state, as the plain value.
   */
  isWrappedScalar?: boolean;
  format?: string; // OpenAPI format information (e.g., "binary", "date-time", etc.)
  isDateTime?: boolean; // RFC3339 timestamp (spec DateTime wrapper) — uses semantic instant equality
  /*
   * A phone number (spec Phone wrapper): written and kept in state as the
   * plain number, and compared as OneUptime keeps it - as written, or as its
   * digits (StaticFiles/phone.go).
   */
  isPhone?: boolean;
  isMonitorSteps?: boolean; // MonitorSteps wrapper — emitted as a typed nested attribute (monitorsteps.go)
  enumValues?: string[]; // Allowed values from the spec's enum — emitted as a OneOf validator
  /*
   * For list/set attributes: how elements are shaped on the wire.
   * "entity" = array of entity references ({_id: "..."}), "scalar" = plain values.
   */
  elementKind?: "entity" | "scalar";
  elementType?: string; // OpenAPI type of scalar elements ("string" | "number" | ...)
  /*
   * What a relation id (or a list of them) points at, when the spec says.
   * Set by the parser once every resource and data source is known.
   */
  relationTag?: string | undefined;
  // The table of what the relation points at (User for a person).
  relationTableName?: string | undefined;
  relation?: TerraformRelation | undefined;
  /*
   * Data sources: a lookup argument. Set in configuration, it filters the
   * list the data source must find exactly one match in.
   */
  isLookupFilter?: boolean;
  /*
   * A person, or people, the resource names by user ID (`user_id`,
   * `owner_users`): the attribute that names them by email address instead
   * (Common/Utils/DeveloperDocs/PeopleByEmail.ts).
   */
  person?: TerraformPersonAttribute | undefined;
  /*
   * The email companion of a person attribute (`user_email` beside
   * `user_id`): the Terraform name of the attribute it names the person of.
   * It is never sent to the API: the provider finds the person by it.
   */
  personEmailOf?: string | undefined;
}

export interface TerraformPersonAttribute {
  // The companion's Terraform name: user_email, owner_user_emails.
  emailAttribute: string;
  // One person (a user ID) or a set of them (user IDs).
  isList: boolean;
  /*
   * The API requires the person: in Terraform the ID or the email address
   * is, exactly one of them.
   */
  isRequired: boolean;
  /*
   * Someone named by an address nobody in the project has is invited by it
   * (a team member), instead of refused.
   */
  invitesByEmail: boolean;
}

export interface GoType {
  name: string;
  type: string;
  jsonTag?: string;
  description?: string;
  required?: boolean;
}
