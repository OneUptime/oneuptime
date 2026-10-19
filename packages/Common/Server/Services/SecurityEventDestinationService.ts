import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionService } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/SecurityEventDestination";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider, {
  isSecurityEventDestinationProvider,
} from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import {
  DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE,
  isSecurityEventDestinationScope,
} from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import SecurityEventDestinationRegistry from "../Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import { SecurityEventDestinationSettings } from "../Utils/SecurityEvent/Destinations/Types";

/*
 * Validation happens at save time, the way a connection's does, so a
 * destination that stores is one the forwarder can send to: an unknown
 * provider, a missing key or a region that does not match the instance is
 * an error on the form, not a lastError on the cron an hour later.
 *
 * Secrets are write-only and merged on update like a connection's: a
 * non-empty value replaces the stored one, "" or undefined keeps it, null
 * removes it (SecurityEventConnectionService.mergeSecrets).
 *
 * A new destination starts sending from the moment it is saved: its cursor
 * starts at "now", so turning one on never floods a SIEM with history.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public static getDefinitionOrThrow(
    provider: unknown,
  ): SecurityEventDestinationDefinition {
    const definition: SecurityEventDestinationDefinition | undefined =
      isSecurityEventDestinationProvider(provider)
        ? getSecurityEventDestinationDefinition(provider)
        : undefined;

    if (!definition) {
      throw new BadDataException(
        "Provider must be one of the SIEMs OneUptime can send security events to.",
      );
    }

    return definition;
  }

  // Catalog shape, then the provider's own rules (a region matching the instance...).
  public static validateSettings(data: {
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
    requireRequiredSecrets: boolean;
  }): SecurityEventDestinationSettings {
    const definition: SecurityEventDestinationDefinition =
      this.getDefinitionOrThrow(data.provider);

    SecurityEventConnectionService.validateFields({
      definition,
      fields: definition.configFields,
      values: data.config,
      label: "Configuration",
      requireRequiredFields: true,
    });

    SecurityEventConnectionService.validateFields({
      definition,
      fields: definition.secretFields,
      values: data.secrets,
      label: "Credentials",
      requireRequiredFields: data.requireRequiredSecrets,
    });

    const settings: SecurityEventDestinationSettings = {
      provider: definition.provider,
      config: data.config,
      secrets: data.secrets,
    };

    if (data.requireRequiredSecrets) {
      SecurityEventDestinationRegistry.getSender(
        definition.provider,
      ).validateSettings(settings);
    }

    return settings;
  }

  private static validateScope(value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (!isSecurityEventDestinationScope(value)) {
      throw new BadDataException(
        "What to send must be 'detections' or 'all-events'.",
      );
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const definition: SecurityEventDestinationDefinition =
      Service.getDefinitionOrThrow(createBy.data.provider);

    const config: JSONObject = SecurityEventConnectionService.parseJsonObject(
      createBy.data.config,
      "Configuration",
    );
    const secrets: JSONObject = SecurityEventConnectionService.parseJsonObject(
      createBy.data.secrets,
      "Credentials",
    );

    Service.validateScope(createBy.data.sendScope);

    Service.validateSettings({
      provider: definition.provider,
      config,
      secrets,
      requireRequiredSecrets: true,
    });

    createBy.data.config = config;
    createBy.data.secrets = JSON.stringify(secrets);

    if (!createBy.data.sendScope) {
      createBy.data.sendScope = DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE;
    }

    // A destination saved without saying is on: that is why it was saved.
    if (createBy.data.isEnabled === undefined) {
      createBy.data.isEnabled = true;
    }

    return { createBy, carryForward: null };
  }

  /*
   * Send what arrives from now on, never the project's history. The cursor
   * is OneUptime's to write, so it is written once the caller's column
   * permissions have let the create through.
   */
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    onCreate.createBy.data.cursor =
      OneUptimeDate.getCurrentDate().toISOString();
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // A plain JSON view: the typed partial of a model with JSON columns is too deep for TypeScript.
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["provider"] !== undefined) {
      throw new BadDataException(
        "The provider of a destination cannot be changed. Create a new destination instead.",
      );
    }

    Service.validateScope(incoming["sendScope"]);

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (!touchesSettings) {
      return { updateBy, carryForward: null };
    }

    const destinationId: string | undefined = Service.getOneRowIdNamedBy(
      updateBy.query,
    )?.toString();

    if (!destinationId || !ObjectID.isValidUUID(destinationId)) {
      throw new BadDataException(
        "Configuration and credentials can only be updated one destination at a time.",
      );
    }

    const current: Model | null = await this.findOneById({
      id: new ObjectID(destinationId),
      select: {
        _id: true,
        provider: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider) {
      throw new BadDataException("The destination no longer exists.");
    }

    const definition: SecurityEventDestinationDefinition =
      Service.getDefinitionOrThrow(current.provider);

    const config: JSONObject =
      incoming["config"] !== undefined
        ? SecurityEventConnectionService.parseJsonObject(
            incoming["config"],
            "Configuration",
          )
        : SecurityEventConnectionService.parseJsonObject(
            current.config,
            "Configuration",
          );

    const mergedSecrets: JSONObject =
      SecurityEventConnectionService.mergeSecrets({
        definition,
        stored: SecurityEventConnectionService.parseJsonObject(
          current.secrets,
          "Credentials",
        ),
        provided:
          incoming["secrets"] !== undefined
            ? SecurityEventConnectionService.parseJsonObject(
                incoming["secrets"],
                "Credentials",
              )
            : {},
      });

    Service.validateSettings({
      provider: current.provider,
      config,
      secrets: mergedSecrets,
      requireRequiredSecrets: true,
    });

    incoming["config"] = config;
    incoming["secrets"] = JSON.stringify(mergedSecrets);

    return { updateBy, carryForward: null };
  }

  /*
   * Decrypted settings for the forwarder and the test. Root read; never
   * serialize the result into a response or a log.
   */
  public async getSettings(
    destination: Model,
  ): Promise<SecurityEventDestinationSettings> {
    let provider: SecurityEventDestinationProvider | undefined =
      destination.provider;
    let config: JSONObject | undefined = destination.config;
    let secrets: string | undefined = destination.secrets;

    if (
      (provider === undefined ||
        config === undefined ||
        secrets === undefined) &&
      destination.id
    ) {
      const loaded: Model | null = await this.findOneById({
        id: destination.id,
        select: {
          _id: true,
          provider: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

      if (!loaded) {
        throw new BadDataException("The destination no longer exists.");
      }

      provider = loaded.provider;
      config = loaded.config;
      secrets = loaded.secrets;
    }

    const definition: SecurityEventDestinationDefinition =
      Service.getDefinitionOrThrow(provider);

    return {
      provider: definition.provider,
      config: SecurityEventConnectionService.parseJsonObject(
        config,
        "Configuration",
      ),
      secrets: SecurityEventConnectionService.parseJsonObject(
        secrets,
        "Credentials",
      ),
    };
  }
}

export default new Service();
