import DatabaseService from "./DatabaseService";
import ServiceService from "./ServiceService";
import { Service as SecurityEventConnectionServiceClass } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/LlmObservabilityConnection";
import TelemetryService from "../../Models/DatabaseModels/Service";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  LlmConnectionDefinition,
  LlmConnectionField,
  getLlmConnectionDefinition,
} from "../../Types/LlmObservability/LlmConnectionCatalog";
import { isLlmConnectionProvider } from "../../Types/LlmObservability/LlmConnectionProvider";
import LlmConversationReaders, {
  isLlmConversationReaders,
} from "../../Types/LlmObservability/LlmConversationReaders";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import LlmConnectorRegistry from "../Utils/LlmObservability/LlmConnectorRegistry";
import { LlmConnectionSettings } from "../Utils/LlmObservability/LlmConnectorTypes";
import LlmConversationPrivacy from "../Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../Utils/Logger";

/*
 * AI / LLM observability connections: validated when saved, so a connection
 * that stores is one the read loop can use - a malformed key, a missing
 * secret or a subscription that is not a GUID is a form error, not a
 * lastError an hour later.
 *
 * Secrets are write-only: an edit form cannot show them, so on an update a
 * secret left empty keeps the stored one, a value replaces it and null
 * removes it (the rule SecurityEventConnectionService.mergeSecrets holds
 * every managed connection to).
 *
 * Values OneUptime keeps about a connection - its telemetry service, when
 * it is read next, what its last read found - are no caller's to write, so
 * they are written after the caller's write was permitted (onUpdatePermitted)
 * or after it was made (onCreateSuccess), never in onBefore* where the
 * caller's column permissions would refuse them.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public static getDefinitionOrThrow(
    provider: unknown,
  ): LlmConnectionDefinition {
    const definition: LlmConnectionDefinition | undefined =
      isLlmConnectionProvider(provider)
        ? getLlmConnectionDefinition(provider)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Provider must be one of the AI providers and AI tools OneUptime can connect to.",
      );
    }

    return definition;
  }

  // A form's JSON (object or JSON text); anything else is a 400.
  public static parseJsonObject(value: unknown, label: string): JSONObject {
    return SecurityEventConnectionServiceClass.parseJsonObject(value, label);
  }

  /*
   * Catalog shape (known keys, required values, dropdown values, JSON
   * text) and the connector's own checks, for settings that may never have
   * been stored: used on create, on update with the merged secrets, and by
   * "Test connection" before a save.
   */
  public static validateSettings(data: {
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): LlmConnectionSettings {
    const definition: LlmConnectionDefinition = Service.getDefinitionOrThrow(
      data.provider,
    );

    SecurityEventConnectionServiceClass.validateFields({
      definition: { title: definition.title },
      fields: definition.configFields,
      values: data.config,
      label: "Settings",
      requireRequiredFields: true,
    });

    SecurityEventConnectionServiceClass.validateFields({
      definition: { title: definition.title },
      fields: definition.secretFields,
      values: data.secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    const settings: LlmConnectionSettings = {
      provider: definition.provider,
      config: Service.withDefaults(definition.configFields, data.config),
      secrets: data.secrets,
    };

    LlmConnectorRegistry.getConnector(definition.provider).validateSettings(
      settings,
    );

    return settings;
  }

  // Config with every unset field that has a default given its default.
  public static withDefaults(
    fields: Array<LlmConnectionField>,
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

  // Provided secrets merged over the stored ones (value / "" keeps / null removes).
  public static mergeSecrets(data: {
    definition: LlmConnectionDefinition;
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

  public static readConversationReaders(
    value: unknown,
  ): LlmConversationReaders | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!isLlmConversationReaders(value)) {
      throw new BadDataException(
        "Who can read conversations must be 'admins' or 'everyone'.",
      );
    }

    return value;
  }

  private static readBoolean(value: unknown, label: string): void {
    if (value !== undefined && typeof value !== "boolean") {
      throw new BadDataException(`${label} must be true or false.`);
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const definition: LlmConnectionDefinition = Service.getDefinitionOrThrow(
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
    Service.readBoolean(
      createBy.data.storeConversationText,
      "Keep what was written",
    );
    Service.readConversationReaders(createBy.data.conversationReaders);

    const settings: LlmConnectionSettings = Service.validateSettings({
      provider: definition.provider,
      config,
      secrets,
      requireRequiredSecrets: true,
    });

    if (!createBy.data.name || !createBy.data.name.trim()) {
      createBy.data.name = definition.title;
    }

    createBy.data.config = settings.config;
    createBy.data.secrets = JSON.stringify(secrets);

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
        `AI connection ${createdItem.id?.toString() || ""}: its telemetry service could not be created yet; the next read will try again. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    LlmConversationPrivacy.invalidate(createdItem.projectId);

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
        "The provider of a connection cannot be changed. Create a new connection instead.",
      );
    }

    Service.readBoolean(incoming["isEnabled"], "Enabled");
    Service.readBoolean(
      incoming["storeConversationText"],
      "Keep what was written",
    );
    Service.readConversationReaders(incoming["conversationReaders"]);

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
        provider: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider) {
      throw new BadDataException("The connection no longer exists.");
    }

    const definition: LlmConnectionDefinition = Service.getDefinitionOrThrow(
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

    const settings: LlmConnectionSettings = Service.validateSettings({
      provider: current.provider,
      config,
      secrets: merged,
      requireRequiredSecrets: true,
    });

    incoming["config"] = settings.config;
    incoming["secrets"] = JSON.stringify(merged);

    return { updateBy, carryForward: null };
  }

  /*
   * A connection whose settings or credentials changed, or that was switched
   * back on, is read again at once, and its last error - about the old
   * settings - no longer applies.
   */
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (
      incoming["config"] !== undefined ||
      incoming["secrets"] !== undefined ||
      incoming["isEnabled"] === true
    ) {
      incoming["nextPullAt"] = null;
      incoming["lastError"] = null;
    }
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    Service.invalidatePrivacy(onUpdate.updateBy.props.tenantId);
    return onUpdate;
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    Service.invalidatePrivacy(
      (onDelete.deleteBy as DeleteBy<Model>).props.tenantId,
    );
    return onDelete;
  }

  private static invalidatePrivacy(projectId: ObjectID | undefined): void {
    if (projectId) {
      LlmConversationPrivacy.invalidate(projectId);
      return;
    }

    // A write across projects (root): forget them all in this process.
    LlmConversationPrivacy.clearCache();
  }

  /*
   * The connection's telemetry service: the one it has, or a new one named
   * after the connection - never a service the project already has, so a
   * connection never writes into, or restricts, an app's own service.
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
        getLlmConnectionDefinition(connection.provider)?.defaultServiceName ||
        "AI connection",
    });

    const service: TelemetryService = new TelemetryService();
    service.projectId = connection.projectId;
    service.name = serviceName;
    service.description = `What the AI connection "${connection.name || serviceName}" brings in.`;

    const created: TelemetryService = await ServiceService.create({
      data: service,
      props: { isRoot: true },
    });

    await this.updateOneById({
      id: connection.id,
      data: { serviceId: created.id! },
      props: { isRoot: true, ignoreHooks: true },
    });

    LlmConversationPrivacy.invalidate(connection.projectId);

    return { serviceId: created.id!, serviceName: serviceName };
  }

  private async pickTelemetryServiceName(data: {
    projectId: ObjectID;
    baseName: string;
  }): Promise<string> {
    const base: string = data.baseName.trim().substring(0, 90) || "AI";

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
  ): Promise<LlmConnectionSettings> {
    let secretsJson: string | undefined = connection.secrets;
    let config: JSONObject | undefined = connection.config;
    let provider: unknown = connection.provider;

    if (
      (secretsJson === undefined ||
        config === undefined ||
        provider === undefined) &&
      connection.id
    ) {
      const loaded: Model | null = await this.findOneById({
        id: connection.id,
        select: { _id: true, provider: true, config: true, secrets: true },
        props: { isRoot: true },
      });

      if (!loaded) {
        throw new BadDataException("The connection no longer exists.");
      }

      secretsJson = loaded.secrets;
      config = loaded.config;
      provider = loaded.provider;
    }

    const definition: LlmConnectionDefinition =
      Service.getDefinitionOrThrow(provider);

    return {
      provider: definition.provider,
      config: Service.withDefaults(
        definition.configFields,
        Service.parseJsonObject(config, "Settings"),
      ),
      secrets: Service.parseJsonObject(secretsJson, "Credentials"),
    };
  }
}

export default new Service();
