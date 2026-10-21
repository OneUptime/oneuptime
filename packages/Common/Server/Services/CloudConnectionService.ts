import DatabaseService from "./DatabaseService";
import ServiceService from "./ServiceService";
import { Service as SecurityEventConnectionServiceClass } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/CloudConnection";
import TelemetryService from "../../Models/DatabaseModels/Service";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDefinition,
  CloudConnectionField,
  getCloudConnectionAuthMethod,
  getCloudConnectionDefinition,
  getCloudConnectionFieldsForMethod,
  isCloudConnectionProvider,
} from "../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import CloudConnectorRegistry from "../Utils/CloudConnection/CloudConnectorRegistry";
import { CloudConnectionSettings } from "../Utils/CloudConnection/CloudConnectorTypes";
import GcpCloudConnector from "../Utils/CloudConnection/Gcp/GcpCloudConnector";
import logger from "../Utils/Logger";

/*
 * Cloud connections (Cloud > Connect): validated when saved, so a
 * connection that stores is one the read loop can use - a role ARN that is
 * not one, a tenant that is not a GUID, a key that is not a service
 * account key is a form error, not a lastError an hour later.
 *
 * Secrets are write-only: an edit form cannot show them, so on an update a
 * secret left empty keeps the stored one, a value replaces it and null
 * removes it (SecurityEventConnectionService.mergeSecrets, the rule every
 * managed connection is held to).
 *
 * Values OneUptime keeps about a connection - its telemetry service, when
 * it is read next, what its last read found - are no caller's to write, so
 * they are written after the caller's write was permitted
 * (onUpdatePermitted) or after it was made (onCreateSuccess).
 */

// Settings OneUptime writes itself from what was saved; a caller's are ignored.
const DERIVED_CONFIG_KEYS: Array<string> = [
  "authMethod",
  "clientEmail",
  "keyProjectId",
];

// The pull state a settings change forgets: where resources were found.
const INVENTORY_STATE_KEYS: Array<string> = [
  "inventoryAt",
  "fullSweepAt",
  "activePairs",
  "disabledRegions",
  "azureMetricDefinitions",
  "accounts",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public static getDefinitionOrThrow(
    provider: unknown,
  ): CloudConnectionDefinition {
    const definition: CloudConnectionDefinition | undefined =
      isCloudConnectionProvider(provider)
        ? getCloudConnectionDefinition(provider)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Cloud must be 'aws', 'azure' or 'gcp': the clouds OneUptime can connect to.",
      );
    }

    return definition;
  }

  // A form's JSON (object or JSON text); anything else is a 400.
  public static parseJsonObject(value: unknown, label: string): JSONObject {
    return SecurityEventConnectionServiceClass.parseJsonObject(value, label);
  }

  /*
   * The sign-in method settings ask for: the one they name, or - for an API
   * client that names none - the one their keys belong to (a role ARN is a
   * role, an access key ID an access key).
   */
  public static readAuthMethod(
    definition: CloudConnectionDefinition,
    config: JSONObject,
  ): CloudConnectionAuthMethod {
    if (config["authMethod"] !== undefined) {
      const named: CloudConnectionAuthMethod = getCloudConnectionAuthMethod(
        definition,
        config["authMethod"],
      );

      if (named !== config["authMethod"]) {
        throw new BadDataException(
          `Sign-in method must be one of: ${definition.authMethods
            .map((method: { method: string }): string => {
              return method.method;
            })
            .join(", ")}.`,
        );
      }

      return named;
    }

    if (definition.provider === CloudProvider.AWS) {
      if (typeof config["roleArn"] === "string" && config["roleArn"].trim()) {
        return CloudConnectionAuthMethod.AwsRole;
      }

      return CloudConnectionAuthMethod.AwsAccessKey;
    }

    return getCloudConnectionAuthMethod(definition, undefined);
  }

  // Config with every unset field that has a default given its default.
  public static withDefaults(
    fields: Array<CloudConnectionField>,
    config: JSONObject,
  ): JSONObject {
    const result: JSONObject = { ...config };

    for (const field of fields) {
      const value: JSONValue | undefined = result[field.key];
      const isEmpty: boolean =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "");

      if (isEmpty && field.defaultValue !== undefined) {
        result[field.key] = field.defaultValue;
      }
    }

    return result;
  }

  // Only the keys of the method: a form that switched methods sends both.
  private static keepKeys(
    values: JSONObject,
    fields: Array<CloudConnectionField>,
    allFields: Array<CloudConnectionField>,
  ): JSONObject {
    const allowed: Set<string> = new Set(
      fields.map((field: CloudConnectionField): string => {
        return field.key;
      }),
    );
    const known: Set<string> = new Set(
      allFields.map((field: CloudConnectionField): string => {
        return field.key;
      }),
    );
    const kept: JSONObject = {};

    for (const key of Object.keys(values)) {
      if (DERIVED_CONFIG_KEYS.includes(key)) {
        continue;
      }

      // A key of another method is dropped; one no method has is refused below.
      if (known.has(key) && !allowed.has(key)) {
        continue;
      }

      kept[key] = values[key] as JSONValue;
    }

    return kept;
  }

  /*
   * Catalog shape (known keys, required values, dropdown values, JSON
   * text) and the connector's own checks, for settings that may never have
   * been stored: used on create, on update with the merged secrets, and by
   * "Test connection" before a save. Returns the settings as they are
   * stored: with the method and what OneUptime reads off the credential.
   */
  public static validateSettings(data: {
    provider: unknown;
    projectId: ObjectID | string;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): CloudConnectionSettings {
    const definition: CloudConnectionDefinition = Service.getDefinitionOrThrow(
      data.provider,
    );
    const method: CloudConnectionAuthMethod = Service.readAuthMethod(
      definition,
      data.config,
    );
    const configFields: Array<CloudConnectionField> =
      getCloudConnectionFieldsForMethod(definition.configFields, method);
    const secretFields: Array<CloudConnectionField> =
      getCloudConnectionFieldsForMethod(definition.secretFields, method);

    const config: JSONObject = Service.withDefaults(
      configFields,
      Service.keepKeys(data.config, configFields, definition.configFields),
    );
    const secrets: JSONObject = Service.keepKeys(
      data.secrets,
      secretFields,
      definition.secretFields,
    );

    SecurityEventConnectionServiceClass.validateFields({
      definition: { title: definition.title },
      fields: configFields,
      values: config,
      label: "Settings",
      requireRequiredFields: true,
    });

    SecurityEventConnectionServiceClass.validateFields({
      definition: { title: definition.title },
      fields: secretFields,
      values: secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    config["authMethod"] = method;

    const settings: CloudConnectionSettings = {
      provider: definition.provider,
      projectId: data.projectId.toString(),
      config,
      secrets,
    };

    CloudConnectorRegistry.getConnector(definition.provider).validateSettings(
      settings,
    );

    // What the list shows of a Google Cloud key: its service account and project.
    if (
      definition.provider === CloudProvider.GCP &&
      typeof secrets["serviceAccountJson"] === "string"
    ) {
      const key: { projectId: string; clientEmail: string } =
        GcpCloudConnector.readKey(secrets["serviceAccountJson"]);

      config["clientEmail"] = key.clientEmail;

      if (key.projectId) {
        config["keyProjectId"] = key.projectId;
      }
    }

    return settings;
  }

  // Provided secrets merged over the stored ones (value / "" keeps / null removes).
  public static mergeSecrets(data: {
    definition: CloudConnectionDefinition;
    stored: JSONObject;
    provided: JSONObject;
  }): JSONObject {
    return SecurityEventConnectionServiceClass.mergeSecrets({
      definition: {
        title: data.definition.title,
        secretFields: data.definition.secretFields,
      },
      stored: data.stored,
      provided: data.provided,
    });
  }

  /*
   * A name for a connection saved without one: the cloud, and the account
   * when the settings say which (a role's ARN carries its account id, a
   * Google Cloud key its project).
   */
  public static getDefaultName(settings: CloudConnectionSettings): string {
    const definition: CloudConnectionDefinition = Service.getDefinitionOrThrow(
      settings.provider,
    );
    const roleArn: unknown = settings.config["roleArn"];

    if (typeof roleArn === "string" && roleArn.split(":").length === 6) {
      return `AWS ${roleArn.split(":")[4]}`;
    }

    const project: unknown = settings.config["keyProjectId"];

    if (typeof project === "string" && project) {
      return `Google Cloud ${project}`;
    }

    return definition.title;
  }

  private static readBoolean(value: unknown, label: string): void {
    if (value !== undefined && typeof value !== "boolean") {
      throw new BadDataException(`${label} must be true or false.`);
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const definition: CloudConnectionDefinition = Service.getDefinitionOrThrow(
      createBy.data.provider,
    );

    const config: JSONObject = Service.parseJsonObject(
      createBy.data.config,
      "Settings",
    );
    const secrets: JSONObject = Service.parseJsonObject(
      createBy.data.secrets,
      "Credentials",
    );

    Service.readBoolean(createBy.data.isEnabled, "Enabled");

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("A connection belongs to a project.");
    }

    const settings: CloudConnectionSettings = Service.validateSettings({
      provider: definition.provider,
      projectId,
      config,
      secrets,
      requireRequiredSecrets: true,
    });

    if (!createBy.data.name || !createBy.data.name.trim()) {
      createBy.data.name = Service.getDefaultName(settings);
    }

    createBy.data.config = settings.config;
    createBy.data.secrets = JSON.stringify(settings.secrets);

    return { createBy, carryForward: null };
  }

  /*
   * The connection's own telemetry service is made once the connection
   * exists. A failure here leaves the connection without one, and the read
   * loop makes it on its next read (ensureTelemetryService).
   */
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    try {
      await this.ensureTelemetryService(createdItem);
    } catch (error) {
      logger.error(
        `Cloud connection ${createdItem.id?.toString() || ""}: its telemetry service could not be created yet; the next read will try again. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return createdItem;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * A plain JSON view of the update: the typed partial of a model with
     * JSON columns is too deep for TypeScript to instantiate, and every
     * value is checked by hand anyway.
     */
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["provider"] !== undefined) {
      throw new BadDataException(
        "The cloud of a connection cannot be changed. Create a new connection instead.",
      );
    }

    Service.readBoolean(incoming["isEnabled"], "Enabled");

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (!touchesSettings) {
      return { updateBy, carryForward: null };
    }

    const connectionId: string | undefined = Service.getOneRowIdNamedBy(
      updateBy.query,
    )?.toString();

    if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException(
        "Settings and credentials can only be updated one connection at a time.",
      );
    }

    const current: Model | null = await this.findOneById({
      id: new ObjectID(connectionId),
      select: {
        _id: true,
        projectId: true,
        provider: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider || !current.projectId) {
      throw new BadDataException("The connection no longer exists.");
    }

    const definition: CloudConnectionDefinition = Service.getDefinitionOrThrow(
      current.provider,
    );

    const config: JSONObject =
      incoming["config"] !== undefined
        ? Service.parseJsonObject(incoming["config"], "Settings")
        : Service.parseJsonObject(current.config, "Settings");

    const merged: JSONObject = Service.mergeSecrets({
      definition,
      stored: Service.parseJsonObject(current.secrets, "Credentials"),
      provided:
        incoming["secrets"] !== undefined
          ? Service.parseJsonObject(incoming["secrets"], "Credentials")
          : {},
    });

    const settings: CloudConnectionSettings = Service.validateSettings({
      provider: current.provider,
      projectId: current.projectId,
      config,
      secrets: merged,
      requireRequiredSecrets: true,
    });

    incoming["config"] = settings.config;
    incoming["secrets"] = JSON.stringify(settings.secrets);

    return { updateBy, carryForward: null };
  }

  /*
   * A connection whose settings or credentials changed, or that was switched
   * back on, is read again at once, its last error - about the old settings
   * - no longer applies, and where it found resources is found again. Where
   * its metrics were read up to is kept: reading it again would write each
   * datapoint twice.
   */
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;
    const settingsChanged: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (settingsChanged || incoming["isEnabled"] === true) {
      incoming["nextPullAt"] = null;
      incoming["lastError"] = null;
    }

    if (!settingsChanged) {
      return;
    }

    const connectionId: ObjectID | null | undefined =
      Service.getOneRowIdNamedBy(updateBy.query);

    if (!connectionId) {
      return;
    }

    const current: Model | null = await this.findOneById({
      id: connectionId,
      select: { _id: true, pullState: true },
      props: { isRoot: true },
    });

    const state: JSONObject = {
      ...((current?.pullState as JSONObject | undefined) || {}),
    };

    for (const key of INVENTORY_STATE_KEYS) {
      delete state[key];
    }

    incoming["pullState"] = state;
  }

  /*
   * The connection's telemetry service: the one it has, or a new one named
   * after the connection - never a service the project already has, so a
   * connection never writes its metrics into an app's own service.
   */
  public async ensureTelemetryService(
    connection: Model,
  ): Promise<{ serviceId: ObjectID; serviceName: string }> {
    if (!connection.id || !connection.projectId) {
      throw new BadDataException("The connection is not saved yet.");
    }

    if (connection.serviceId) {
      const existing: TelemetryService | null =
        await ServiceService.findOneById({
          id: connection.serviceId,
          select: { _id: true, name: true },
          props: { isRoot: true },
        });

      if (existing && existing.name) {
        return { serviceId: existing.id!, serviceName: existing.name };
      }
    }

    const serviceName: string = await this.pickTelemetryServiceName({
      projectId: connection.projectId,
      baseName:
        connection.name ||
        getCloudConnectionDefinition(connection.provider)?.defaultServiceName ||
        "Cloud",
    });

    const service: TelemetryService = new TelemetryService();
    service.projectId = connection.projectId;
    service.name = serviceName;
    service.description = `The metrics the cloud connection "${connection.name || serviceName}" reads.`;

    const created: TelemetryService = await ServiceService.create({
      data: service,
      props: { isRoot: true },
    });

    await this.updateOneById({
      id: connection.id,
      data: { serviceId: created.id! },
      props: { isRoot: true, ignoreHooks: true },
    });

    return { serviceId: created.id!, serviceName: serviceName };
  }

  private async pickTelemetryServiceName(data: {
    projectId: ObjectID;
    baseName: string;
  }): Promise<string> {
    const base: string = data.baseName.trim().substring(0, 90) || "Cloud";

    for (let index: number = 1; index <= 25; index++) {
      const candidate: string = index === 1 ? base : `${base} ${index}`;

      const taken: TelemetryService | null = await ServiceService.findOneBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameText(candidate),
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });

      if (!taken) {
        return candidate;
      }
    }

    return `${base} ${ObjectID.generate().toString().substring(0, 8)}`;
  }

  /*
   * Decrypted settings for the read loop and "Test connection". Root read;
   * the result must never be serialized into a response or a log.
   */
  public async getConnectorSettings(
    connection: Model,
  ): Promise<CloudConnectionSettings> {
    let secretsJson: string | undefined = connection.secrets;
    let config: JSONObject | undefined = connection.config;
    let provider: unknown = connection.provider;
    let projectId: ObjectID | undefined = connection.projectId;

    if (
      (secretsJson === undefined ||
        config === undefined ||
        provider === undefined ||
        projectId === undefined) &&
      connection.id
    ) {
      const loaded: Model | null = await this.findOneById({
        id: connection.id,
        select: {
          _id: true,
          projectId: true,
          provider: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

      if (!loaded) {
        throw new BadDataException("The connection no longer exists.");
      }

      secretsJson = loaded.secrets;
      config = loaded.config;
      provider = loaded.provider;
      projectId = loaded.projectId;
    }

    const definition: CloudConnectionDefinition =
      Service.getDefinitionOrThrow(provider);

    if (!projectId) {
      throw new BadDataException("The connection belongs to no project.");
    }

    const parsedConfig: JSONObject = Service.parseJsonObject(
      config,
      "Settings",
    );
    const method: CloudConnectionAuthMethod = Service.readAuthMethod(
      definition,
      parsedConfig,
    );

    return {
      provider: definition.provider,
      projectId: projectId.toString(),
      config: {
        ...Service.withDefaults(
          getCloudConnectionFieldsForMethod(definition.configFields, method),
          parsedConfig,
        ),
        authMethod: method,
      },
      secrets: Service.parseJsonObject(secretsJson, "Credentials"),
    };
  }
}

export default new Service();
