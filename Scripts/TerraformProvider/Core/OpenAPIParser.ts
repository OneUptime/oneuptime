import fs from "fs";
import {
  OpenAPISpec,
  OpenAPIOperation,
  TerraformResource,
  TerraformDataSource,
  TerraformAttribute,
} from "./Types";
import { StringUtils } from "./StringUtils";
import {
  describePersonEmail,
  describePersonEmailLookup,
  getPersonEmailColumnName,
  isDecidedBySomeoneElse,
  isInvitedByEmail,
  getMembershipImport,
  isPersonRelation,
  MembershipImport,
  PersonColumnKind,
} from "Common/Utils/DeveloperDocs/PeopleByEmail";
import { CLIENT_RESOURCE_NAMES } from "Common/Utils/DeveloperDocs/ClientResourceNames";

/*
 * The data sources written by hand (StaticFiles/), each in place of the one
 * the spec would give. `oneuptime_user`: the User endpoints answer a person
 * about themselves only, so a project API key was refused every lookup -
 * people are found among the project's team members instead, by email
 * address, name or ID.
 */
export const HANDWRITTEN_DATA_SOURCES: Readonly<
  Record<
    string,
    { staticFile: string; schema: Record<string, TerraformAttribute> }
  >
> = {
  user: {
    staticFile: "data_source_user.go",
    schema: {
      id: {
        type: "string",
        description:
          "The person's user ID. Set it to look them up by ID instead of by email address or name.",
        optional: true,
        computed: true,
      },
      email: {
        type: "string",
        description:
          "The person's email address, in any case. Set it to look them up by it: the usual way.",
        optional: true,
        computed: true,
        isLookupFilter: true,
      },
      name: {
        type: "string",
        description:
          "The person's name, exactly as it is shown in OneUptime. Set it to look them up by it; two people of the same name are an error, so prefer `email`.",
        optional: true,
        computed: true,
        isLookupFilter: true,
      },
      has_accepted_invitation: {
        type: "bool",
        description:
          "Whether they have joined the project: false while every invitation they have is still waiting for them.",
        computed: true,
      },
      team_ids: {
        type: "set",
        elementKind: "scalar",
        elementType: "string",
        description:
          "IDs of the `oneuptime_team` resources of this project they are in, or invited to.",
        computed: true,
      },
    },
  },
};

type OperationType = "create" | "read" | "update" | "delete" | "list";

/*
 * A property parsed from an OpenAPI schema, before it is merged into a
 * Terraform attribute. Tracks which operation schemas it appeared in so
 * Required/Optional/Computed can be derived from the spec instead of guessed.
 */
interface ParsedProperty {
  attribute: TerraformAttribute;
  requiredInCreate: boolean;
}

export class OpenAPIParser {
  public spec: OpenAPISpec | null = null;

  /*
   * Resources that were discovered but skipped, with the reason. Surfaced by
   * GenerateProvider so CI can fail loudly instead of silently shipping an
   * incomplete provider.
   */
  public warnings: string[] = [];

  public async parseOpenAPISpec(filePath: string): Promise<OpenAPISpec> {
    try {
      const content: string = fs.readFileSync(filePath, "utf-8");
      this.spec = JSON.parse(content) as OpenAPISpec;
      this.groupedOperations = undefined;
      return this.spec;
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  public setSpec(spec: OpenAPISpec): void {
    this.spec = spec;
    this.groupedOperations = undefined;
  }

  public getResources(): TerraformResource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const resources: TerraformResource[] = [];
    const names: Set<string> = new Set<string>(
      this.groupOperationsByResource().keys(),
    );

    const telemetryNames: Set<string> = this.getTelemetryNames();

    for (const [resourceName, operations] of this.groupOperationsByResource()) {
      /*
       * A Terraform resource must be creatable. Models that only expose
       * list/count/read endpoints (insight tables, ...) are not manageable
       * infrastructure — they surface as data sources instead.
       */
      if (!operations.create) {
        continue;
      }

      /*
       * Neither is telemetry, which the API can create: a log line or a
       * span is a record the product keeps for a while, not something to
       * manage - no field of one can be updated, and it expires with its
       * table's retention. It is a data source only.
       */
      if (telemetryNames.has(resourceName)) {
        continue;
      }

      const resource: TerraformResource = {
        name: resourceName,
        tableName: this.getTableName(operations, resourceName),
        goTypeName: StringUtils.toPascalCase(resourceName),
        operations: operations,
        schema: {},
      };
      const legacyName: string | undefined =
        this.getLegacyNames().get(resourceName);
      if (legacyName && names.has(legacyName)) {
        // Another resource has that name now: moved from, never an alias.
        resource.movedFrom = legacyName;
      } else if (legacyName) {
        resource.legacyName = legacyName;
      }
      const resourceDescription: string | undefined =
        this.getTagDescriptions().get(resourceName);
      if (resourceDescription) {
        resource.description = resourceDescription;
      }

      resource.operationSchemas = this.generateOperationSpecificSchemas(
        operations,
        resourceName,
      );
      this.keepWhatOthersDecideReadOnly(resource);
      resource.schema = this.generateResourceSchema(resource.operationSchemas);
      this.resolveRelations(resource.schema);
      for (const operationSchema of Object.values(resource.operationSchemas)) {
        this.resolveRelations(operationSchema || {});
      }
      this.addPersonEmailCompanions(resource);
      this.addMembershipImport(resource);

      const writableFields: string[] = Object.entries(
        resource.operationSchemas.create || {},
      )
        .filter(([name, attr]: [string, TerraformAttribute]) => {
          return name !== "id" && !attr.computed;
        })
        .map(([name]: [string, TerraformAttribute]) => {
          return name;
        });

      if (writableFields.length === 0) {
        this.warnings.push(
          `Skipped resource "${resourceName}": its create schema has no writable fields (all columns are computed or permission-filtered).`,
        );
        continue;
      }

      resources.push(resource);
    }

    return resources;
  }

  public getDataSources(): TerraformDataSource[] {
    if (!this.spec) {
      throw new Error("OpenAPI spec not loaded. Call parseOpenAPISpec first.");
    }

    const dataSources: TerraformDataSource[] = [];
    const dataSourceNames: Set<string> = new Set<string>(
      this.groupOperationsByResource().keys(),
    );

    for (const [resourceName, operations] of this.groupOperationsByResource()) {
      // A data source needs a way to read: a get-item and/or a list endpoint.
      if (!operations.read && !operations.list) {
        continue;
      }

      /*
       * Data sources intentionally share the resource's type name
       * (data "oneuptime_monitor" ...) — resource and data source namespaces
       * are separate in Terraform, and this matches every mainstream provider.
       */
      const dataSourceOperations: TerraformDataSource["operations"] = {};
      if (operations.read) {
        dataSourceOperations.read = operations.read;
      }
      if (operations.list) {
        dataSourceOperations.list = operations.list;
      }

      const dataSource: TerraformDataSource = {
        name: resourceName,
        goTypeName: StringUtils.toPascalCase(resourceName),
        operations: dataSourceOperations,
        schema: {},
      };
      const legacyName: string | undefined =
        this.getLegacyNames().get(resourceName);
      // An alias only for a name nothing else has now.
      if (legacyName && !dataSourceNames.has(legacyName)) {
        dataSource.legacyName = legacyName;
      }
      const dataSourceDescription: string | undefined =
        this.getTagDescriptions().get(resourceName);
      if (dataSourceDescription) {
        dataSource.description = dataSourceDescription;
      }

      const handwritten:
        | { staticFile: string; schema: Record<string, TerraformAttribute> }
        | undefined = HANDWRITTEN_DATA_SOURCES[resourceName];

      if (handwritten) {
        dataSource.staticFile = handwritten.staticFile;
        dataSource.schema = JSON.parse(
          JSON.stringify(handwritten.schema),
        ) as Record<string, TerraformAttribute>;
        dataSources.push(dataSource);
        continue;
      }

      dataSource.schema = this.generateDataSourceSchema(dataSource.operations);
      this.resolveRelations(dataSource.schema);
      this.addPersonEmailFilters(dataSource, operations);
      dataSources.push(dataSource);
    }

    return dataSources;
  }

  /*
   * Groups every operation in the spec by resource (tag), classified by
   * operationId prefix. Count operations are dropped — POST /count is not a
   * CRUD operation and misclassifying it as "create" was the source of
   * resources that stored null ids.
   */
  private groupOperationsByResource(): Map<
    string,
    TerraformResource["operations"]
  > {
    if (this.groupedOperations) {
      return this.groupedOperations;
    }

    const resourceMap: Map<string, TerraformResource["operations"]> = new Map<
      string,
      TerraformResource["operations"]
    >();
    // The model each resource name was made from.
    const tablesByName: Map<string, string> = new Map<string, string>();
    const tablesByBasePath: Map<string, string> = this.getTablesByBasePath();

    for (const [path, pathItem] of Object.entries(this.spec!.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (
          !operation.operationId ||
          !operation.tags ||
          operation.tags.length === 0
        ) {
          this.warnings.push(
            `Skipped operation ${method.toUpperCase()} ${path}: missing operationId or tags.`,
          );
          continue;
        }

        /*
         * The model the operation is of: by the schema it reads or writes,
         * or - a delete, a count - by the path its model's other endpoints
         * are under.
         */
        const table: string | null =
          this.getTableOfOperation(operation) ||
          tablesByBasePath.get(OpenAPIParser.getBasePath(path)) ||
          null;

        const resourceName: string | null = this.extractResourceName(
          operation,
          table,
        );
        if (!resourceName) {
          continue;
        }

        const operationType: OperationType | null = this.getOperationType(
          method,
          path,
          operation,
        );
        if (!operationType) {
          continue;
        }

        if (!resourceMap.has(resourceName)) {
          resourceMap.set(resourceName, {});
        }

        /*
         * Two models of one name would make one resource, the endpoints of
         * whichever came last winning (it happened to the subscriber
         * notification template and its link to a status page). Stop
         * instead, and say how to fix it.
         */
        const seenTable: string | undefined = tablesByName.get(resourceName);
        if (table && seenTable && seenTable !== table) {
          throw new Error(
            `Two models make the resource "${resourceName}": ${seenTable} and ${table}. Give one a name of its own in Common/Utils/DeveloperDocs/ClientResourceNames.ts.`,
          );
        }
        if (table) {
          tablesByName.set(resourceName, table);
        }

        const operations: TerraformResource["operations"] =
          resourceMap.get(resourceName)!;
        operations[operationType] = {
          ...operation,
          method: method,
          path: path,
        };
      }
    }

    this.groupedOperations = resourceMap;
    return resourceMap;
  }

  private groupedOperations:
    | Map<string, TerraformResource["operations"]>
    | undefined = undefined;

  /*
   * The path a model's endpoints are all under: /monitor for /monitor,
   * /monitor/get-list, /monitor/count, /monitor/{id} and
   * /monitor/{id}/get-item.
   */
  public static getBasePath(path: string): string {
    const idSegment: number = path.indexOf("/{");
    const withoutId: string =
      idSegment === -1 ? path : path.slice(0, idSegment);
    for (const suffix of ["/get-list", "/count"]) {
      if (withoutId.endsWith(suffix)) {
        return withoutId.slice(0, -suffix.length);
      }
    }
    return withoutId;
  }

  // The model of each base path, from the operations whose schema says it.
  private getTablesByBasePath(): Map<string, string> {
    const tables: Map<string, string> = new Map<string, string>();
    for (const [path, pathItem] of Object.entries(this.spec!.paths)) {
      for (const operation of Object.values(pathItem)) {
        const table: string | null = this.getTableOfOperation(operation);
        if (table && !tables.has(OpenAPIParser.getBasePath(path))) {
          tables.set(OpenAPIParser.getBasePath(path), table);
        }
      }
    }
    return tables;
  }

  /*
   * Tag descriptions carry the model's tableDescription — the best available
   * human summary for a resource ("Monitors track the health of ...").
   */
  private getTagDescriptions(): Map<string, string> {
    const map: Map<string, string> = new Map<string, string>();
    for (const tag of this.spec?.tags || []) {
      if (tag.name && tag.description) {
        map.set(this.getNameOfTag(tag), tag.description);
      }
    }
    return map;
  }

  // The resources whose tag marks them telemetry (x-oneuptime-telemetry).
  private getTelemetryNames(): Set<string> {
    const names: Set<string> = new Set<string>();
    for (const tag of this.spec?.tags || []) {
      if (tag.name && tag["x-oneuptime-telemetry"]) {
        names.add(this.getNameOfTag(tag));
      }
    }
    return names;
  }

  /*
   * The resource name of a tag: the name clients give its model where its
   * own reads poorly as one (CLIENT_RESOURCE_NAMES, by the model's table,
   * which the tag says: x-oneuptime-table), else its own.
   */
  public getNameOfTag(tag: {
    name: string;
    "x-oneuptime-table"?: string;
  }): string {
    const clientName: string | undefined = tag["x-oneuptime-table"]
      ? CLIENT_RESOURCE_NAMES[tag["x-oneuptime-table"]]
      : undefined;
    return StringUtils.toSnakeCase(clientName || tag.name);
  }

  // The resource name of a relation: by the table it points at.
  private getNameOfRelation(
    tag: string,
    tableName: string | undefined,
  ): string {
    const clientName: string | undefined = tableName
      ? CLIENT_RESOURCE_NAMES[tableName]
      : undefined;
    return StringUtils.toSnakeCase(clientName || tag);
  }

  /*
   * Resource names that changed: new name -> the name it had before. A
   * model renamed in the product names its former name on its tag
   * (x-former-names: "Auto Remediation Rule" for ai_rule), spelled the way
   * the provider always spelled it; otherwise a name changed when type
   * names started keeping mixed-case words whole (iot_fleet ->
   * io_t_fleet). The old name stays registered as a deprecated alias.
   */
  private getLegacyNames(): Map<string, string> {
    const map: Map<string, string> = new Map<string, string>();
    for (const tag of this.spec?.tags || []) {
      if (!tag.name) {
        continue;
      }
      const name: string = this.getNameOfTag(tag);
      /*
       * A model renamed in the product names its former name; one a client
       * names otherwise (CLIENT_RESOURCE_NAMES, by its x-oneuptime-table)
       * had the name of its tag.
       */
      const formerName: string | undefined = (tag["x-former-names"] || [])[0];
      const legacyName: string = formerName
        ? StringUtils.toLegacySnakeCase(formerName)
        : StringUtils.toLegacySnakeCase(tag.name);
      if (legacyName !== name) {
        map.set(name, legacyName);
      }
    }
    return map;
  }

  /*
   * Every name a relation can point at: the resources (creatable models, but
   * telemetry) and the data sources (readable ones).
   */
  private getRelationTargets(): { resources: Set<string>; all: Set<string> } {
    if (!this.relationTargets) {
      const telemetryNames: Set<string> = this.getTelemetryNames();
      const resources: Set<string> = new Set<string>();
      const all: Set<string> = new Set<string>();
      for (const [name, operations] of this.groupOperationsByResource()) {
        if (operations.create && !telemetryNames.has(name)) {
          resources.add(name);
        }
        if (operations.create || operations.read || operations.list) {
          all.add(name);
        }
      }
      this.relationTargets = { resources, all };
    }
    return this.relationTargets;
  }

  private relationTargets:
    | { resources: Set<string>; all: Set<string> }
    | undefined = undefined;

  /*
   * Turns each attribute's spec relation (a tag) into the Terraform resource
   * or data source it names, and says so in its description: an id is only
   * useful to someone who knows what it is the id of.
   */
  private resolveRelations(schema: Record<string, TerraformAttribute>): void {
    const targets: { resources: Set<string>; all: Set<string> } =
      this.getRelationTargets();

    for (const attribute of Object.values(schema)) {
      if (!attribute.relationTag || attribute.relation) {
        continue;
      }

      const name: string = this.getNameOfRelation(
        attribute.relationTag,
        attribute.relationTableName,
      );

      if (!targets.all.has(name)) {
        continue;
      }

      const isList: boolean =
        attribute.type === "list" || attribute.type === "set";

      attribute.relation = {
        name,
        isList,
        ...(targets.resources.has(name) ? {} : { dataSourceOnly: true }),
      };

      const target: string = `\`oneuptime_${name}\``;
      const sentence: string = isList
        ? `IDs of ${target} ${targets.resources.has(name) ? "resources" : "records"}.`
        : `The ID of a ${target}${targets.resources.has(name) ? "" : " (see the data source)"}.`;

      attribute.description = attribute.description
        ? `${attribute.description} ${sentence}`
        : sentence;
    }
  }

  /*
   * The model an operation is of, by the schema it reads or writes:
   * MonitorCreateSchema, MonitorUpdateSchema, MonitorReadSchema or Monitor
   * itself. Null for one that names none (count, delete).
   */
  private getTableOfOperation(operation: OpenAPIOperation): string | null {
    const refs: Array<unknown> = [
      (operation.requestBody as any)?.content?.["application/json"]?.schema
        ?.properties?.["data"]?.$ref,
    ];
    for (const status of ["200", "201"]) {
      const data: any = (operation.responses as any)?.[status]?.content?.[
        "application/json"
      ]?.schema?.properties?.["data"];
      refs.push(data?.$ref, data?.items?.$ref);
    }

    const suffix: RegExp = new RegExp(
      "(CreateSchema|UpdateSchema|ReadSchema)$",
    );
    for (const ref of refs) {
      if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
        return ref.replace("#/components/schemas/", "").replace(suffix, "");
      }
    }
    return null;
  }

  /*
   * The model's table name: what its schemas are named after
   * (TeamMemberCreateSchema, TeamMemberReadSchema...), else the resource's
   * name in PascalCase.
   */
  private getTableName(
    operations: TerraformResource["operations"],
    resourceName: string,
  ): string {
    const createSchemaRef: unknown = (operations.create?.requestBody as any)
      ?.content?.["application/json"]?.schema?.properties?.["data"]?.$ref;
    const createSchemaSuffix: RegExp = new RegExp("CreateSchema$");

    if (typeof createSchemaRef === "string") {
      const schemaName: string = createSchemaRef.replace(
        "#/components/schemas/",
        "",
      );
      if (createSchemaSuffix.test(schemaName)) {
        return schemaName.replace(createSchemaSuffix, "");
      }
    }

    return StringUtils.toPascalCase(resourceName);
  }

  /*
   * What someone else decides is read-only: whether a membership's invited
   * person accepted, and when (the server ignores a project caller's
   * value), and whether OneUptime has told the owners yet (it sets it once
   * it has). Planned from a configuration, each made every plan after it
   * moved a change - a refused update of an accepted member, a replaced and
   * re-notified owner row (Common/Utils/DeveloperDocs/PeopleByEmail.ts).
   */
  private keepWhatOthersDecideReadOnly(resource: TerraformResource): void {
    const tableName: string = resource.tableName || "";

    for (const operation of ["create", "update"] as const) {
      const schema: Record<string, TerraformAttribute> | undefined =
        resource.operationSchemas?.[operation];

      if (!schema) {
        continue;
      }

      for (const [name, attr] of Object.entries(schema)) {
        if (isDecidedBySomeoneElse(tableName, attr.apiFieldName || name)) {
          delete schema[name];
        }
      }
    }
  }

  /*
   * PEOPLE BY EMAIL ADDRESS. Beside every attribute a resource writes that
   * names a person by user ID - user_id, assigned_to_user_id, owner_users -
   * a companion names them by email address instead: user_email,
   * assigned_to_user_email, owner_user_emails. A configuration gives one of
   * the two; the provider finds the person among the project's members and
   * invitees and sends their ID, and a team member named by an address
   * nobody in the project has is invited by it. The rules and the names are
   * Common/Utils/DeveloperDocs/PeopleByEmail.ts, which the dashboard's
   * Terraform pages read too.
   *
   * The companion is only ever in `schema`, never in the request schemas:
   * nothing sends it to the API. The ID attribute becomes Optional and
   * Computed - the provider fills it in from the address.
   */
  private addPersonEmailCompanions(resource: TerraformResource): void {
    const createSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.create || {};
    const updateSchema: Record<string, TerraformAttribute> =
      resource.operationSchemas?.update || {};

    for (const [name, attr] of Object.entries(resource.schema)) {
      if (!isPersonRelation(attr.relationTableName) || name === "id") {
        continue;
      }

      const isWritten: boolean =
        Object.prototype.hasOwnProperty.call(createSchema, name) ||
        Object.prototype.hasOwnProperty.call(updateSchema, name);

      // Who created or acknowledged a record is the server's to say.
      if (!isWritten) {
        continue;
      }

      // People are a set (owners, notify lists): order never counts.
      if (attr.type === "list") {
        this.warnings.push(
          `Resource "${resource.name}": ${name} is an ordered list of people, which has no email companion.`,
        );
        continue;
      }

      const isList: boolean = attr.type === "set";
      const apiFieldName: string = attr.apiFieldName || name;
      const emailAttribute: string = StringUtils.toLegacySnakeCase(
        getPersonEmailColumnName(
          apiFieldName,
          isList ? PersonColumnKind.Many : PersonColumnKind.One,
        ),
      );

      if (resource.schema[emailAttribute]) {
        this.warnings.push(
          `Resource "${resource.name}": ${name} names a person, but ${emailAttribute} is already an attribute, so it has no email companion.`,
        );
        continue;
      }

      const invitesByEmail: boolean = isInvitedByEmail(
        resource.tableName || "",
        apiFieldName,
      );

      attr.person = {
        emailAttribute: emailAttribute,
        isList: isList,
        isRequired: Boolean(attr.required),
        invitesByEmail: invitesByEmail,
      };
      attr.required = false;
      attr.optional = true;
      attr.computed = true;
      attr.description = [
        attr.description,
        `Or name them by email address, in \`${emailAttribute}\`.`,
      ]
        .filter(Boolean)
        .join(" ");

      resource.schema[emailAttribute] = {
        type: isList ? "set" : "string",
        description: OpenAPIParser.getPersonEmailDescription({
          idAttribute: name,
          isList: isList,
          invitesByEmail: invitesByEmail,
        }),
        required: false,
        optional: true,
        computed: true,
        personEmailOf: name,
      };
    }
  }

  /*
   * A data source looks a record up by the person it names the way the
   * resource names them: by email address, beside the user ID
   * (`user_email` beside `user_id`). The provider finds the person by the
   * address and matches their ID. Only the people a configuration writes -
   * the columns the resource takes an address for, never who created a
   * record - and one person each: a set of people is no lookup argument.
   */
  private addPersonEmailFilters(
    dataSource: TerraformDataSource,
    operations: TerraformResource["operations"],
  ): void {
    const written: Set<string> = new Set<string>();

    for (const operation of [operations.create, operations.update]) {
      if (operation) {
        for (const name of Object.keys(
          this.extractRequestSchema(operation, `${dataSource.name}-lookup`),
        )) {
          written.add(name);
        }
      }
    }

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      if (
        !attr.isLookupFilter ||
        attr.type !== "string" ||
        !isPersonRelation(attr.relationTableName) ||
        !written.has(name)
      ) {
        continue;
      }

      const emailAttribute: string = StringUtils.toLegacySnakeCase(
        getPersonEmailColumnName(
          attr.apiFieldName || name,
          PersonColumnKind.One,
        ),
      );

      if (dataSource.schema[emailAttribute]) {
        this.warnings.push(
          `Data source "${dataSource.name}": ${name} names a person, but ${emailAttribute} is already an attribute, so it has no email lookup.`,
        );
        continue;
      }

      attr.person = {
        emailAttribute: emailAttribute,
        isList: false,
        isRequired: false,
        invitesByEmail: false,
      };
      attr.description = [
        attr.description,
        `Or look them up by email address, in \`${emailAttribute}\`.`,
      ]
        .filter(Boolean)
        .join(" ");

      dataSource.schema[emailAttribute] = {
        type: "string",
        description: describePersonEmailLookup({ idName: name }),
        required: false,
        optional: true,
        computed: true,
        isLookupFilter: true,
        personEmailOf: name,
      };
    }
  }

  /*
   * A row no screen shows the ID of is imported by what it joins and who or
   * what joins it: a membership by `<team_id>/alice@example.com`, a
   * monitor's owner by `<monitor_id>/alice@example.com`, an owner team by
   * `<monitor_id>/<team_id>`, an escalation rule's team by
   * `<rule_id>/<team_id>` (PeopleByEmail.getMembershipImport). It needs the
   * list endpoint to find it in, and both columns among its attributes.
   */
  private addMembershipImport(resource: TerraformResource): void {
    // The relations a create of the row names: the parent and the member.
    const relationColumns: Array<string> = Object.entries(
      resource.operationSchemas?.create || {},
    )
      .filter(([, attr]: [string, TerraformAttribute]) => {
        return Boolean(attr.relationTableName);
      })
      .map(([name, attr]: [string, TerraformAttribute]) => {
        return attr.apiFieldName || name;
      });
    const rule: MembershipImport | undefined = getMembershipImport(
      resource.tableName || "",
      relationColumns,
    );
    const listPath: string | undefined = resource.operations.list?.path;

    if (!rule || !listPath || !resource.operations.read) {
      return;
    }

    const parent: [string, TerraformAttribute] | undefined = Object.entries(
      resource.schema,
    ).find(([name, attr]: [string, TerraformAttribute]) => {
      return (attr.apiFieldName || name) === rule.parentColumn;
    });
    const person: [string, TerraformAttribute] | undefined = Object.entries(
      resource.schema,
    ).find(([name, attr]: [string, TerraformAttribute]) => {
      return (attr.apiFieldName || name) === rule.personColumn;
    });

    if (!parent || !person) {
      return;
    }

    resource.membershipImport = {
      parentAttribute: parent[0],
      // What it is, as a person says it: the resource the parent's ID is of.
      parentNoun: (
        parent[1].relation?.name || parent[0].replace(/_id$/, "")
      ).replace(/_/g, " "),
      parentApiField: rule.parentColumn,
      personAttribute: person[0],
      personApiField: rule.personColumn,
      personEmailAttribute: person[1].person?.emailAttribute,
      listPath: listPath,
      kind: rule.kind,
    };
  }

  /*
   * What a person attribute's email companion says it is: Common's words
   * (PeopleByEmail.describePersonEmail), which the dashboard's Terraform
   * examples use for the same attribute.
   */
  public static getPersonEmailDescription(data: {
    idAttribute: string;
    isList: boolean;
    invitesByEmail: boolean;
  }): string {
    return describePersonEmail({
      idName: data.idAttribute,
      isList: data.isList,
      invitesByEmail: data.invitesByEmail,
    });
  }

  /*
   * Column descriptions in the spec end with an appended
   * "Permissions - Create: [...], Read: [...], Update: [...]" clause. That is
   * API-reference material, not Terraform documentation — strip it so schema
   * descriptions read like prose.
   */
  private cleanDescription(description: string): string {
    const text: string = description
      .replace(/\s*Permissions - Create: \[[\s\S]*$/, "")
      .replace(/\s+/g, " ")
      .trim()
      // The spec joins a column's description to its permissions with ". ".
      .replace(/\s*\.+$/, "");

    if (!text) {
      return "";
    }

    const endsWithPunctuation: RegExp = new RegExp("[.!?:]$");

    return endsWithPunctuation.test(text) ? text : `${text}.`;
  }

  /*
   * The resource an operation belongs to: the name clients give its model
   * (Common/Utils/DeveloperDocs/ClientResourceNames.ts), else its tag's.
   */
  private extractResourceName(
    operation: OpenAPIOperation,
    table: string | null,
  ): string | null {
    const clientName: string | undefined = table
      ? CLIENT_RESOURCE_NAMES[table]
      : undefined;
    if (clientName) {
      return StringUtils.toSnakeCase(clientName);
    }
    if (operation.tags && operation.tags.length > 0 && operation.tags[0]) {
      return StringUtils.toSnakeCase(operation.tags[0]);
    }
    return null;
  }

  /*
   * The spec generator (Common/Server/Utils/OpenAPI.ts) emits deterministic
   * operationIds: create<Table>, get<Table>, update<Table>, delete<Table>,
   * list<Table>, count<Table>. Classify by prefix — never by substring
   * heuristics, which misfiled POST /count as the create operation.
   */
  private getOperationType(
    method: string,
    path: string,
    operation: OpenAPIOperation,
  ): OperationType | null {
    const operationId: string = operation.operationId || "";

    /*
     * Hoisted regex constants rather than bare literals in the condition:
     * the repo's wrap-regex lint rule and prettier disagree about
     * parenthesised regex literals, and named constants satisfy both.
     */
    const createPrefix: RegExp = new RegExp("^create", "i");
    const getPrefix: RegExp = new RegExp("^get", "i");
    const updatePrefix: RegExp = new RegExp("^update", "i");
    const deletePrefix: RegExp = new RegExp("^delete", "i");
    const listPrefix: RegExp = new RegExp("^list", "i");
    const countPrefix: RegExp = new RegExp("^count", "i");

    if (createPrefix.test(operationId)) {
      return "create";
    }
    if (getPrefix.test(operationId)) {
      return "read";
    }
    if (updatePrefix.test(operationId)) {
      return "update";
    }
    if (deletePrefix.test(operationId)) {
      return "delete";
    }
    if (listPrefix.test(operationId)) {
      return "list";
    }
    if (countPrefix.test(operationId)) {
      // Count endpoints are not CRUD operations.
      return null;
    }

    // Fallback for operations with non-conforming ids: classify by method.
    const lowerMethod: string = method.toLowerCase();
    const hasIdParam: boolean = path.includes("{id}");
    switch (lowerMethod) {
      case "get":
        return hasIdParam ? "read" : "list";
      case "put":
      case "patch":
        return "update";
      case "delete":
        return "delete";
      case "post":
        /*
         * POST on an item path is a read in the OneUptime API; a bare
         * collection POST is a create. /count and /get-list are handled by
         * the prefixes above for conforming specs; guard anyway.
         */
        if (path.endsWith("/count")) {
          return null;
        }
        if (path.endsWith("/get-list")) {
          return "list";
        }
        if (hasIdParam) {
          return "read";
        }
        return "create";
      default:
        return null;
    }
  }

  /*
   * Merges the per-operation schemas into the resource schema. The spec is
   * the source of truth:
   *   - fields in the create/update request schemas are writable
   *   - `required` on the create schema is the only source of Required
   *   - fields only in response schemas are Computed
   *   - optional writable fields that the server also returns are
   *     Optional+Computed (the server may fill defaults)
   *   - fields writable at create but absent from the update schema are
   *     immutable -> RequiresReplace
   */
  private generateResourceSchema(operationSchemas: {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  }): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    schema["id"] = {
      type: "string",
      description: "Unique identifier for the resource.",
      computed: true,
    };

    const createSchema: Record<string, TerraformAttribute> =
      operationSchemas.create || {};
    const updateSchema: Record<string, TerraformAttribute> =
      operationSchemas.update || {};
    const readSchema: Record<string, TerraformAttribute> =
      operationSchemas.read || {};
    const hasUpdateOperation: boolean = Boolean(operationSchemas.update);

    const allFieldNames: Set<string> = new Set<string>([
      ...Object.keys(createSchema),
      ...Object.keys(updateSchema),
      ...Object.keys(readSchema),
    ]);

    for (const name of allFieldNames) {
      if (name === "id") {
        continue;
      }

      const inCreate: boolean = Object.prototype.hasOwnProperty.call(
        createSchema,
        name,
      );
      const inUpdate: boolean = Object.prototype.hasOwnProperty.call(
        updateSchema,
        name,
      );
      const inRead: boolean = Object.prototype.hasOwnProperty.call(
        readSchema,
        name,
      );

      if (
        !inCreate &&
        !inUpdate &&
        OpenAPIParser.isBookkeepingField(name, readSchema[name])
      ) {
        continue;
      }

      // Prefer the writable definition for type metadata; fall back to read.
      const source: TerraformAttribute = (
        inCreate
          ? createSchema[name]
          : inUpdate
            ? updateSchema[name]
            : readSchema[name]
      ) as TerraformAttribute;

      if (!inCreate && !inUpdate) {
        // Server-managed: only ever appears in responses.
        schema[name] = {
          ...source,
          required: false,
          optional: false,
          computed: true,
        };
        continue;
      }

      const required: boolean = Boolean(
        inCreate && createSchema[name]?.required,
      );

      schema[name] = {
        ...source,
        required: required,
        /*
         * Optional writable fields are also Computed when the server returns
         * them: the server may fill defaults, and Optional+Computed (plus
         * UseStateForUnknown) is how the framework models that without
         * "inconsistent result after apply".
         */
        optional: !required,
        computed: !required && inRead,
        forceNew: inCreate && hasUpdateOperation && !inUpdate,
      };
    }

    return schema;
  }

  private generateOperationSpecificSchemas(
    operations: TerraformResource["operations"],
    resourceName: string,
  ): {
    create?: Record<string, TerraformAttribute>;
    update?: Record<string, TerraformAttribute>;
    read?: Record<string, TerraformAttribute>;
  } {
    const operationSchemas: {
      create?: Record<string, TerraformAttribute>;
      update?: Record<string, TerraformAttribute>;
      read?: Record<string, TerraformAttribute>;
    } = {};

    if (operations.create) {
      operationSchemas.create = this.extractRequestSchema(
        operations.create,
        `${resourceName}-create`,
      );
    }
    if (operations.update) {
      operationSchemas.update = this.extractRequestSchema(
        operations.update,
        `${resourceName}-update`,
      );
    }

    /*
     * The read schema is the union of every response the API can return for
     * this model: the get-item response, plus the create/update responses
     * (some models, e.g. File, have no read endpoint — server-populated
     * fields only ever appear in the create response).
     */
    const readSchema: Record<string, TerraformAttribute> = {};
    for (const operation of [
      operations.read,
      operations.create,
      operations.update,
    ]) {
      if (operation) {
        this.addResponseProperties(readSchema, operation);
      }
    }
    if (Object.keys(readSchema).length > 0) {
      operationSchemas.read = readSchema;
    }

    return operationSchemas;
  }

  /*
   * Fields every model carries for the server's own bookkeeping, which say
   * nothing about a live resource: the soft-delete pair (always empty on
   * anything Terraform can read) and the optimistic-locking counter. Shown,
   * they only add a "(known after apply)" line to every plan.
   */
  public static isBookkeepingField(
    name: string,
    attribute: TerraformAttribute | undefined,
  ): boolean {
    if (name === "deleted_at" || name === "deleted_by_user_id") {
      return true;
    }

    return name === "version" && attribute?.type === "number";
  }

  /*
   * Whether a data source attribute can be a lookup argument: a single plain
   * value the list endpoint can match exactly. JSON, timestamps, phone
   * numbers (kept in OneUptime's spelling, which a lookup would have to
   * write exactly), lists and secrets cannot.
   */
  public static isLookupFilterCandidate(
    name: string,
    attribute: TerraformAttribute,
  ): boolean {
    // Every lookup is already scoped to the API key's project.
    if (name === "project_id") {
      return false;
    }

    if (
      attribute.sensitive ||
      attribute.isDateTime ||
      attribute.isPhone ||
      attribute.isMonitorSteps
    ) {
      return false;
    }

    if (attribute.type === "string") {
      return !attribute.isComplexObject;
    }

    return attribute.type === "number" || attribute.type === "bool";
  }

  private generateDataSourceSchema(
    operations: TerraformDataSource["operations"],
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    const outputFields: Record<string, TerraformAttribute> = {};
    for (const operation of [operations.read, operations.list]) {
      if (operation) {
        this.addResponseProperties(outputFields, operation);
      }
    }

    /*
     * Look up by `id`, or by any combination of the plain attributes below:
     * each one set in configuration narrows the list, which must then hold
     * exactly one item. Everything else is read-only output.
     */
    schema["id"] = {
      type: "string",
      description:
        "Look up by unique identifier. Leave unset to look up by the other arguments instead.",
      required: false,
      optional: true,
      computed: true,
      apiFieldName: "_id",
    };

    for (const [name, attr] of Object.entries(outputFields)) {
      if (name === "id" || OpenAPIParser.isBookkeepingField(name, attr)) {
        continue;
      }

      /*
       * `name` has always been a lookup argument, typed as a plain string -
       * also on the few models whose name is a wrapped type.
       */
      const candidate: TerraformAttribute =
        name === "name" && attr.type === "string"
          ? { ...attr, isComplexObject: false }
          : attr;

      if (OpenAPIParser.isLookupFilterCandidate(name, candidate)) {
        schema[name] = {
          ...candidate,
          required: false,
          optional: true,
          computed: true,
          isLookupFilter: true,
        };
        continue;
      }

      schema[name] = {
        ...attr,
        required: false,
        optional: false,
        computed: true,
      };
    }

    return schema;
  }

  /*
   * Extracts the writable fields of a create/update operation from its
   * request body ({data: <Schema>}).
   */
  private extractRequestSchema(
    operation: OpenAPIOperation,
    context: string,
  ): Record<string, TerraformAttribute> {
    const schema: Record<string, TerraformAttribute> = {};

    const content: any = (operation.requestBody as any)?.content?.[
      "application/json"
    ];
    const dataSchema: any = content?.schema?.properties?.["data"];
    if (dataSchema) {
      this.addPropertiesFromSchema(schema, dataSchema, false, context);
    }

    return schema;
  }

  private addResponseProperties(
    schema: Record<string, TerraformAttribute>,
    operation: OpenAPIOperation,
  ): void {
    const responses: any = operation.responses;
    if (!responses) {
      return;
    }
    const successResponse: any = responses["200"] || responses["201"];
    let dataSchema: any =
      successResponse?.content?.["application/json"]?.schema?.properties?.[
        "data"
      ];

    /*
     * A list response's data is an array of the model. Without reading its
     * items, a model that has a list endpoint and no get-item endpoint had a
     * data source with nothing but an id.
     */
    const resolved: any = this.resolveSchema(dataSchema);
    if (resolved?.type === "array" && resolved.items) {
      dataSchema = resolved.items;
    }

    if (dataSchema) {
      this.addPropertiesFromSchema(schema, dataSchema, true, "response");
    }
  }

  private addPropertiesFromSchema(
    schema: Record<string, TerraformAttribute>,
    openApiSchema: any,
    computed: boolean,
    context: string,
  ): void {
    const resolved: any = this.resolveSchema(openApiSchema);
    if (!resolved || !resolved.properties) {
      return;
    }

    for (const [propName, propSchema] of Object.entries(resolved.properties)) {
      /*
       * Attribute names keep the spelling they have always had: renaming one
       * would break every configuration that sets it.
       */
      const terraformName: string = StringUtils.toLegacySnakeCase(propName);
      if (terraformName === "id" || terraformName === "_id") {
        continue;
      }

      if (schema[terraformName]) {
        // First definition wins; later passes only fill a missing description.
        const existing: TerraformAttribute = schema[terraformName]!;
        if (!existing.description) {
          const prop: any = this.resolveSchema(propSchema);
          if (prop?.description) {
            existing.description = prop.description;
          }
        }
        continue;
      }

      const attribute: ParsedProperty | null = this.parseProperty(
        propName,
        propSchema,
        resolved.required || [],
        computed,
      );
      if (attribute) {
        schema[terraformName] = attribute.attribute;
      }
    }

    void context;
  }

  /*
   * Converts one OpenAPI property into a Terraform attribute, preserving the
   * semantic signals the spec now carries: DateTime wrappers, enum values,
   * password format, array element shape, ordered-ness.
   */
  private parseProperty(
    propName: string,
    propSchema: any,
    requiredList: string[],
    computed: boolean,
  ): ParsedProperty | null {
    const prop: any = this.resolveSchema(propSchema);
    if (!prop) {
      return null;
    }

    const description: string = this.cleanDescription(prop.description || "");
    const example: any = prop.example;
    const defaultValue: any = prop.default;
    const ordered: boolean = Boolean(prop["x-ordered"]);
    const format: string | undefined = prop.format;
    const required: boolean = requiredList.includes(propName);

    const relationTag: unknown = prop["x-oneuptime-relation"]?.tag;
    const relationTableName: unknown = prop["x-oneuptime-relation"]?.tableName;
    /*
     * A secret - a key, a token, a passphrase, a webhook address - whatever
     * its type: the spec marks every one x-oneuptime-secret
     * (Common/Utils/Schema/ModelSchema.isSecretColumn), and an encrypted
     * string format: password too. Sensitive, so plans, logs and outputs
     * print (sensitive value) instead of it.
     */
    const isSecret: boolean =
      prop["x-oneuptime-secret"] === true || format === "password";

    const base: TerraformAttribute = {
      type: "string",
      description: description,
      required: !computed && required,
      computed: computed,
      apiFieldName: propName,
      example: example,
      default: defaultValue,
      ...(format ? { format } : {}),
      ...(typeof relationTag === "string" && relationTag
        ? { relationTag }
        : {}),
      ...(typeof relationTableName === "string" && relationTableName
        ? { relationTableName }
        : {}),
      ...(isSecret ? { sensitive: true } : {}),
    };

    /*
     * MonitorSteps wrappers become a typed nested attribute backed by the
     * hand-written monitorsteps.go module instead of a JSON string.
     */
    if (prop["x-oneuptime-type"] === "MonitorSteps") {
      return {
        attribute: { ...base, type: "monitor_steps", isMonitorSteps: true },
        requiredInCreate: required,
      };
    }

    // RFC3339 timestamps: the spec marks the DateTime wrapper explicitly.
    if (this.isDateTimeSchema(prop)) {
      return {
        attribute: { ...base, type: "string", isDateTime: true },
        requiredInCreate: required,
      };
    }

    /*
     * Phone numbers: a plain string, which OneUptime may keep in another
     * spelling - "+1 415 555 0100" as "+14155550100" (StaticFiles/phone.go).
     */
    if (this.isPhoneSchema(prop)) {
      return {
        attribute: { ...base, type: "string", isPhone: true },
        requiredInCreate: required,
      };
    }

    const propType: string = prop.type || "string";

    switch (propType) {
      case "integer":
      case "number":
        return {
          attribute: { ...base, type: "number" },
          requiredInCreate: required,
        };
      case "boolean":
        return {
          attribute: { ...base, type: "bool" },
          requiredInCreate: required,
        };
      case "array": {
        const items: any = this.resolveSchema(prop.items) || {};
        const isEntityArray: boolean =
          items.type === "object" &&
          Boolean(items.properties?.["_id"] || items.properties?.["id"]);
        return {
          attribute: {
            ...base,
            type: ordered ? "list" : "set",
            elementKind: isEntityArray ? "entity" : "scalar",
            elementType: isEntityArray ? "string" : items.type || "string",
          },
          requiredInCreate: required,
        };
      }
      case "object": {
        /*
         * Complex nested objects are JSON strings with subset semantic
         * equality. A wrapped scalar (a Color, a Name...) is written as its
         * plain value; anything else needs jsonencode(), which is worth
         * saying where the attribute is documented.
         */
        const isWrappedScalar: boolean =
          Boolean(example) &&
          typeof example === "object" &&
          typeof example._type === "string" &&
          (typeof example.value === "string" ||
            typeof example.value === "number");
        /*
         * A value only the server writes is read, not written: a read-only
         * attribute and every data source attribute decode it instead.
         */
        const hint: string =
          isWrappedScalar ||
          description.includes("jsonencode") ||
          description.includes("jsondecode")
            ? ""
            : computed
              ? "A JSON value: read it with `jsondecode()`."
              : "A JSON value: write it with `jsonencode()`.";
        return {
          attribute: {
            ...base,
            type: "string",
            isComplexObject: true,
            ...(isWrappedScalar ? { isWrappedScalar: true } : {}),
            description: [description, hint].filter(Boolean).join(" "),
          },
          requiredInCreate: required,
        };
      }
      default: {
        const attribute: TerraformAttribute = { ...base, type: "string" };
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          attribute.enumValues = prop.enum.map((value: any) => {
            return String(value);
          });
        }
        return { attribute, requiredInCreate: required };
      }
    }
  }

  /*
   * The Phone wrapper ({_type: "Phone", value}): the spec marks it, and its
   * example is one.
   */
  private isPhoneSchema(prop: any): boolean {
    if (!prop) {
      return false;
    }
    if (prop["x-oneuptime-type"] === "Phone") {
      return true;
    }
    const example: any = prop.example;
    return (
      Boolean(example) &&
      typeof example === "object" &&
      example._type === "Phone" &&
      typeof example.value === "string"
    );
  }

  private isDateTimeSchema(prop: any): boolean {
    if (!prop) {
      return false;
    }
    if (prop["x-oneuptime-type"] === "DateTime") {
      return true;
    }
    if (prop.format === "date-time") {
      return true;
    }
    // Structural fallback: {_type: "DateTime", value: string} wrapper.
    const typeProp: any = prop.properties?.["_type"];
    if (typeProp) {
      const literalValues: any[] = Array.isArray(typeProp.enum)
        ? typeProp.enum
        : [];
      if (
        literalValues.includes("DateTime") ||
        typeProp.example === "DateTime"
      ) {
        return true;
      }
    }
    return false;
  }

  /*
   * Resolves $ref schemas (one level deep is enough for the generated spec;
   * nested refs are resolved recursively as they are encountered).
   */
  private resolveSchema(schema: any): any {
    if (!schema) {
      return null;
    }
    if (schema.$ref) {
      const resolved: any = this.resolveSchemaRef(schema.$ref);
      return resolved || null;
    }
    return schema;
  }

  private resolveSchemaRef(ref: string): any {
    if (!this.spec || !ref.startsWith("#/components/schemas/")) {
      return null;
    }

    const schemaName: string = ref.replace("#/components/schemas/", "");
    return this.spec.components?.schemas?.[schemaName] || null;
  }
}
