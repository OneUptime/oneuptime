import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityEventConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityEventConnectorProvider, {
  isSecurityEventConnectorProvider,
} from "../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import DataSourceEgressGuard from "../Utils/DataSource/EgressGuard";
import SecurityEventConnectorRegistry from "../Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import { SecurityConnectorSettings } from "../Utils/SecurityEvent/Connectors/Types";

/*
 * Validation happens at save time so a connection that stores is a
 * connection the poller can use: a wrong key, a missing secret or an
 * unsupported URL surfaces to the person configuring it, not as a
 * lastError on the cron an hour later.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Parse the JSON a form submits for `config`/`secrets`. Both may arrive
   * as an object or as a JSON string; anything else is a 400.
   */
  public static parseJsonObject(value: unknown, fieldName: string): JSONObject {
    if (value === undefined || value === null || value === "") {
      return {};
    }

    let parsed: unknown = value;

    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadDataException(`${fieldName} must be a JSON object.`);
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(`${fieldName} must be a JSON object.`);
    }

    return parsed as JSONObject;
  }

  /*
   * Keys are the catalog's; values are strings, numbers or booleans. Unknown
   * keys are rejected rather than stored, so a typo in a field key cannot
   * silently become "the setting was never provided".
   */
  public static validateFields(data: {
    definition: SecurityEventConnectorDefinition;
    fields: Array<ConnectorField>;
    values: JSONObject;
    label: string;
    requireRequiredFields: boolean;
  }): void {
    const knownKeys: Set<string> = new Set(
      data.fields.map((field: ConnectorField): string => {
        return field.key;
      }),
    );

    for (const key of Object.keys(data.values)) {
      if (!knownKeys.has(key)) {
        throw new BadDataException(
          `${data.label} contains an unknown setting "${key}" for ${data.definition.title}.`,
        );
      }

      const value: JSONValue = data.values[key] as JSONValue;

      if (
        value !== null &&
        value !== undefined &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new BadDataException(
          `${data.label} setting "${key}" must be a string, number or boolean.`,
        );
      }
    }

    for (const field of data.fields) {
      const raw: JSONValue | undefined = data.values[field.key];
      const isEmpty: boolean =
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim() === "");

      if (isEmpty) {
        if (field.required && data.requireRequiredFields) {
          throw new BadDataException(
            `${field.title} is required for ${data.definition.title}.`,
          );
        }

        continue;
      }

      if (field.type === "dropdown" && field.options) {
        const allowed: Array<string> = field.options.map(
          (option: { value: string }): string => {
            return option.value;
          },
        );

        if (!allowed.includes(String(raw))) {
          throw new BadDataException(
            `${field.title} must be one of: ${allowed.join(", ")}.`,
          );
        }
      }

      if (field.type === "number") {
        const numeric: number = Number(raw);

        if (!Number.isFinite(numeric)) {
          throw new BadDataException(`${field.title} must be a number.`);
        }
      }

      if (field.type === "toggle" && typeof raw !== "boolean") {
        throw new BadDataException(`${field.title} must be true or false.`);
      }

      if (field.type === "url") {
        let parsed: URL;

        try {
          parsed = new URL(String(raw));
        } catch {
          throw new BadDataException(
            `${field.title} must be an absolute https URL.`,
          );
        }

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new BadDataException(
            `${field.title} must be an http or https URL.`,
          );
        }

        if (parsed.username || parsed.password) {
          throw new BadDataException(
            `${field.title} must not embed credentials in the URL.`,
          );
        }
      }
    }
  }

  /*
   * Tenant-chosen hosts go through the same egress policy every other
   * outbound connector uses. Validated here so a blocked address is a
   * form error rather than a poll that fails forever.
   */
  private static async assertUrlsAllowed(
    definition: SecurityEventConnectorDefinition,
    config: JSONObject,
  ): Promise<void> {
    for (const field of definition.configFields) {
      if (field.type !== "url") {
        continue;
      }

      const value: JSONValue | undefined = config[field.key];

      if (typeof value !== "string" || !value.trim()) {
        continue;
      }

      await DataSourceEgressGuard.assertUrlAllowed(value.trim());
    }
  }

  public static getDefinitionOrThrow(
    provider: unknown,
  ): SecurityEventConnectorDefinition {
    if (!isSecurityEventConnectorProvider(provider)) {
      throw new BadDataException(
        "Provider must be one of the supported security event connectors.",
      );
    }

    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(provider);

    if (!definition) {
      throw new BadDataException(
        "Provider must be one of the supported security event connectors.",
      );
    }

    return definition;
  }

  /*
   * Full validation of unsaved settings: catalog shape, provider-specific
   * rules and egress policy. Used on create, on update (with the merged
   * secrets) and by the synchronous connection test for settings that were
   * never stored.
   */
  public static async validateSettings(data: {
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
    alertingOnly: boolean;
    requireRequiredSecrets: boolean;
  }): Promise<SecurityConnectorSettings> {
    const definition: SecurityEventConnectorDefinition =
      this.getDefinitionOrThrow(data.provider);

    this.validateFields({
      definition,
      fields: definition.configFields,
      values: data.config,
      label: "Configuration",
      requireRequiredFields: true,
    });

    this.validateFields({
      definition,
      fields: definition.secretFields,
      values: data.secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    const settings: SecurityConnectorSettings = {
      provider: definition.provider,
      config: data.config,
      secrets: data.secrets,
      alertingOnly: data.alertingOnly,
    };

    SecurityEventConnectorRegistry.getConnector(
      definition.provider,
    ).validateSettings(settings);

    await this.assertUrlsAllowed(definition, data.config);

    return settings;
  }

  /*
   * Secrets are write-only, so an edit form cannot echo them back and a
   * rotation may replace only one key. Each submitted key is read as:
   *   - a non-empty value: replaces the stored one;
   *   - "" or undefined: keeps the stored one (an untouched password input);
   *   - null: removes the stored key.
   * Without the null case nothing could ever clear an optional credential,
   * and a stale one keeps winning downstream: a leftover AWS session token
   * is sent with a new long-lived key, a revoked Splunk token outranks the
   * username and password now on the form (review finding
   * optional-secret-cannot-be-cleared).
   *
   * The result is not validated here. Callers validate the merged object,
   * so clearing a required secret fails with that field's "is required"
   * message. A null for a key that is neither a credential of this
   * provider nor stored is refused, so a typo in a clear request is not
   * silently a no-op that leaves the credential in place.
   */
  public static mergeSecrets(data: {
    definition: SecurityEventConnectorDefinition;
    stored: JSONObject;
    provided: JSONObject;
  }): JSONObject {
    const knownKeys: Set<string> = new Set(
      data.definition.secretFields.map((field: ConnectorField): string => {
        return field.key;
      }),
    );
    const merged: JSONObject = { ...data.stored };

    for (const key of Object.keys(data.provided)) {
      const value: JSONValue | undefined = data.provided[key];

      if (value === null) {
        if (
          !knownKeys.has(key) &&
          !Object.prototype.hasOwnProperty.call(data.stored, key)
        ) {
          throw new BadDataException(
            `Credentials contains an unknown setting "${key}" for ${data.definition.title}.`,
          );
        }

        delete merged[key];
        continue;
      }

      if (value === undefined || value === "") {
        continue;
      }

      merged[key] = value;
    }

    return merged;
  }

  private static validatePollInterval(value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 1440
    ) {
      throw new BadDataException(
        "Poll interval must be a whole number of minutes between 1 and 1440.",
      );
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const definition: SecurityEventConnectorDefinition =
      Service.getDefinitionOrThrow(createBy.data.provider);

    const config: JSONObject = Service.parseJsonObject(
      createBy.data.config,
      "Configuration",
    );
    const secrets: JSONObject = Service.parseJsonObject(
      createBy.data.secrets,
      "Credentials",
    );

    Service.validatePollInterval(createBy.data.pollIntervalInMinutes);

    if (
      createBy.data.alertingOnly !== undefined &&
      typeof createBy.data.alertingOnly !== "boolean"
    ) {
      throw new BadDataException(
        "Alerting records only must be true or false.",
      );
    }

    await Service.validateSettings({
      provider: definition.provider,
      config,
      secrets,
      alertingOnly: createBy.data.alertingOnly !== false,
      requireRequiredSecrets: true,
    });

    createBy.data.config = config;
    createBy.data.secrets = JSON.stringify(secrets);

    if (createBy.data.pollIntervalInMinutes === undefined) {
      createBy.data.pollIntervalInMinutes =
        definition.defaultPollIntervalInMinutes;
    }

    return { createBy, carryForward: null };
  }

  /*
   * Provided secrets are merged over the stored ones by mergeSecrets (a
   * value replaces, "" or undefined keeps, null removes); the merged object
   * is what gets validated and re-encrypted.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Read through a plain JSON view: the typed partial of a model with JSON
     * columns is recursive enough that TypeScript gives up instantiating it
     * ("excessively deep"), and the values are validated by hand anyway.
     */
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["provider"] !== undefined) {
      throw new BadDataException(
        "The provider of a connection cannot be changed. Create a new connection instead.",
      );
    }

    Service.validatePollInterval(incoming["pollIntervalInMinutes"]);

    if (
      incoming["alertingOnly"] !== undefined &&
      typeof incoming["alertingOnly"] !== "boolean"
    ) {
      throw new BadDataException(
        "Alerting records only must be true or false.",
      );
    }

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (!touchesSettings) {
      return { updateBy, carryForward: null };
    }

    const idFromQuery: unknown = (updateBy.query as JSONObject)["_id"];
    const connectionId: string | undefined =
      typeof idFromQuery === "string"
        ? idFromQuery
        : idFromQuery instanceof ObjectID
          ? idFromQuery.toString()
          : undefined;

    if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException(
        "Configuration and credentials can only be updated one connection at a time.",
      );
    }

    const current: Model | null = await this.findOneById({
      id: new ObjectID(connectionId),
      select: {
        _id: true,
        provider: true,
        config: true,
        secrets: true,
        alertingOnly: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider) {
      throw new BadDataException("The connection no longer exists.");
    }

    const config: JSONObject =
      incoming["config"] !== undefined
        ? Service.parseJsonObject(incoming["config"], "Configuration")
        : Service.parseJsonObject(current.config, "Configuration");

    const storedSecrets: JSONObject = Service.parseJsonObject(
      current.secrets,
      "Credentials",
    );
    const providedSecrets: JSONObject =
      incoming["secrets"] !== undefined
        ? Service.parseJsonObject(incoming["secrets"], "Credentials")
        : {};

    const mergedSecrets: JSONObject = Service.mergeSecrets({
      definition: Service.getDefinitionOrThrow(current.provider),
      stored: storedSecrets,
      provided: providedSecrets,
    });

    await Service.validateSettings({
      provider: current.provider,
      config,
      secrets: mergedSecrets,
      alertingOnly:
        typeof incoming["alertingOnly"] === "boolean"
          ? incoming["alertingOnly"]
          : current.alertingOnly !== false,
      requireRequiredSecrets: true,
    });

    incoming["config"] = config;
    incoming["secrets"] = JSON.stringify(mergedSecrets);

    return { updateBy, carryForward: null };
  }

  /*
   * Decrypted settings for the poller and the tester. Root read; the
   * returned object must never be serialized into a response or a log.
   */
  public async getConnectorSettings(
    connection: Model,
  ): Promise<SecurityConnectorSettings> {
    let secretsJson: string | undefined = connection.secrets;
    let config: JSONObject | undefined = connection.config;
    let provider: SecurityEventConnectorProvider | undefined =
      connection.provider;
    let alertingOnly: boolean = connection.alertingOnly !== false;

    if (
      (secretsJson === undefined ||
        config === undefined ||
        provider === undefined) &&
      connection.id
    ) {
      const loaded: Model | null = await this.findOneById({
        id: connection.id,
        select: {
          _id: true,
          provider: true,
          config: true,
          secrets: true,
          alertingOnly: true,
        },
        props: { isRoot: true },
      });

      if (!loaded) {
        throw new BadDataException("The connection no longer exists.");
      }

      secretsJson = loaded.secrets;
      config = loaded.config;
      provider = loaded.provider;
      alertingOnly = loaded.alertingOnly !== false;
    }

    const definition: SecurityEventConnectorDefinition =
      Service.getDefinitionOrThrow(provider);

    return {
      provider: definition.provider,
      config: Service.parseJsonObject(config, "Configuration"),
      secrets: Service.parseJsonObject(secretsJson, "Credentials"),
      alertingOnly,
    };
  }
}

export default new Service();
