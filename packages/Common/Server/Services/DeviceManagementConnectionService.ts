import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionServiceClass } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/DeviceManagementConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  DeviceManagementConfig,
  SECRET_API_KEY,
  SECRET_CLIENT_SECRET_KEY,
  SECRET_PASSWORD_KEY,
  getDeviceManagementConnectionAddress,
  readDeviceManagementConfig,
  readEsperApiKey,
  readIntuneClientSecret,
  readSotiClientSecret,
  readSotiPassword,
  readWorkspaceOneApiKey,
  readWorkspaceOneClientSecret,
  readWorkspaceOnePassword,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import DeviceManagementProvider, {
  getDeviceManagementProviderShortTitle,
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
} from "../../Types/DeviceManagement/DeviceManagementProvider";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import DeviceManagementConnectionAlerts, {
  DeviceManagementConnectionGone,
} from "../Utils/DeviceManagement/DeviceManagementConnectionAlerts";
import { DeviceManagementSettings } from "../Utils/DeviceManagement/DeviceManagementTypes";
import ManagedDeviceInventory from "../Utils/DeviceManagement/ManagedDeviceInventory";

// The connections a delete removes, with what their alerts' notes name them by.
interface ConnectionDeleteCarryForward {
  connections: Array<DeviceManagementConnectionGone>;
}

// The connections an update turns off: those it writes isEnabled false to that were on.
interface ConnectionUpdateCarryForward {
  turnedOff: Array<DeviceManagementConnectionGone>;
}

/*
 * Device management connections (an Esper tenant, a Microsoft Intune
 * tenant, a Workspace ONE UEM or SOTI MobiControl server: Inventory >
 * Managed Devices): validated when saved, so a connection that stores is
 * one the read loop can use - a tenant that is not one, a key that is not a
 * key is a form error, not a lastError fifteen minutes later.
 *
 * The secrets (Esper's API key, Intune's client secret, Workspace ONE's
 * client secret - or an administrator's password and the REST API key -
 * and SOTI's API client secret and user's password) are write-only: an
 * edit form cannot show them, so on an update a secret left empty keeps the
 * stored one and a value replaces it. A Workspace ONE connection that
 * changes how it signs in takes the new way's secrets: the old ones are
 * not the new way's to keep.
 *
 * The tenant is fixed once a connection is made, and so are its service and
 * an Intune tenant's cloud: its devices are the tenant's, so reading
 * another tenant (or another server) is a connection of its own.
 */

// The longest a connection's name is kept.
const MAX_NAME_LENGTH: number = 50;

// The secrets a connection's service takes, decrypted: those of how it signs in.
export interface DeviceManagementSecretValues {
  apiKey?: string | undefined;
  clientSecret?: string | undefined;
  password?: string | undefined;
}

type SecretKey = keyof DeviceManagementSecretValues;

// A secret a service takes: the key it is kept under, and how it is read.
interface SecretRule {
  key: SecretKey;
  read: (value: unknown) => string;
}

/*
 * The secrets a connection takes, by its service and - for Workspace ONE -
 * how it signs in: an OAuth client's secret, or an administrator's
 * password and the tenant's REST API key.
 */
export function getDeviceManagementSecretRules(
  provider: DeviceManagementProvider,
  config?: DeviceManagementConfig | undefined,
): Array<SecretRule> {
  switch (provider) {
    case DeviceManagementProvider.Intune:
      return [
        {
          key: SECRET_CLIENT_SECRET_KEY as SecretKey,
          read: readIntuneClientSecret,
        },
      ];
    case DeviceManagementProvider.WorkspaceOne:
      return config?.authMethod === "basic"
        ? [
            {
              key: SECRET_PASSWORD_KEY as SecretKey,
              read: readWorkspaceOnePassword,
            },
            { key: SECRET_API_KEY as SecretKey, read: readWorkspaceOneApiKey },
          ]
        : [
            {
              key: SECRET_CLIENT_SECRET_KEY as SecretKey,
              read: readWorkspaceOneClientSecret,
            },
          ];
    case DeviceManagementProvider.Soti:
      return [
        {
          key: SECRET_CLIENT_SECRET_KEY as SecretKey,
          read: readSotiClientSecret,
        },
        { key: SECRET_PASSWORD_KEY as SecretKey, read: readSotiPassword },
      ];
    case DeviceManagementProvider.Esper:
    default:
      return [{ key: SECRET_API_KEY as SecretKey, read: readEsperApiKey }];
  }
}

// What a refused credential says a connection takes: the end of a sentence.
function describeSecretsTaken(
  provider: DeviceManagementProvider,
  config?: DeviceManagementConfig | undefined,
): string {
  switch (provider) {
    case DeviceManagementProvider.Intune:
      return "an Intune connection takes clientSecret";
    case DeviceManagementProvider.WorkspaceOne:
      return config?.authMethod === "basic"
        ? "a Workspace ONE connection that signs in with an administrator's account takes password and apiKey"
        : "a Workspace ONE connection that signs in with an OAuth client takes clientSecret";
    case DeviceManagementProvider.Soti:
      return "a SOTI connection takes clientSecret and password";
    case DeviceManagementProvider.Esper:
    default:
      return "an Esper connection takes apiKey";
  }
}

/*
 * What a project already connected says: the tenant, or the server, is
 * connected - and what a saved connection's fixed settings say.
 */
const CONNECTED_ALREADY: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]: "This Esper tenant is connected already",
  [DeviceManagementProvider.Intune]: "This Intune tenant is connected already",
  [DeviceManagementProvider.WorkspaceOne]:
    "This Workspace ONE server is connected already",
  [DeviceManagementProvider.Soti]:
    "This MobiControl server is connected already",
};

const ONE_TENANT_A_CONNECTION: Record<DeviceManagementProvider, string> = {
  [DeviceManagementProvider.Esper]:
    "A connection reads one Esper tenant. To read another one, connect it as well.",
  [DeviceManagementProvider.Intune]:
    "A connection reads one Intune tenant, in one cloud. To read another one, connect it as well.",
  [DeviceManagementProvider.WorkspaceOne]:
    "A connection reads one Workspace ONE server. To read another one, connect it as well.",
  [DeviceManagementProvider.Soti]:
    "A connection reads one MobiControl server. To read another one, connect it as well.",
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public static readProvider(value: unknown): DeviceManagementProvider {
    if (value === undefined || value === null || value === "") {
      return DeviceManagementProvider.Esper;
    }

    if (!isDeviceManagementProvider(value)) {
      throw new BadDataException(
        "Service must be 'esper', 'intune', 'workspaceone' or 'soti': the device management services OneUptime can read.",
      );
    }

    return value;
  }

  // A form's JSON (an object or JSON text); anything else is a 400.
  public static parseJsonObject(value: unknown, label: string): JSONObject {
    return SecurityEventConnectionServiceClass.parseJsonObject(value, label);
  }

  /*
   * The secrets a request carries, checked: those of the service and of how
   * it signs in (an Esper API key; an Intune client secret; a Workspace ONE
   * client secret, or a password and a REST API key; a SOTI client secret
   * and password), and nothing else - an unknown key is refused rather than
   * stored, so a typo is not "no secret". With `required` false, an empty
   * secret means "keep the stored one" and is left out.
   */
  public static readSecrets(
    value: unknown,
    options: {
      required: boolean;
      // The connection's service; Esper when absent.
      provider?: DeviceManagementProvider | undefined;
      // Its settings, which say how a Workspace ONE connection signs in.
      config?: DeviceManagementConfig | undefined;
    },
  ): DeviceManagementSecretValues {
    const provider: DeviceManagementProvider =
      options.provider || DeviceManagementProvider.Esper;
    const rules: Array<SecretRule> = getDeviceManagementSecretRules(
      provider,
      options.config,
    );
    const secrets: JSONObject = Service.parseJsonObject(value, "Credentials");

    for (const key of Object.keys(secrets)) {
      if (
        !rules.some((rule: SecretRule): boolean => {
          return rule.key === key;
        })
      ) {
        throw new BadDataException(
          `Credentials has no "${key.substring(0, 50)}": ${describeSecretsTaken(provider, options.config)}.`,
        );
      }
    }

    const values: DeviceManagementSecretValues = {};

    for (const rule of rules) {
      const secret: unknown = secrets[rule.key];

      if (
        !options.required &&
        (secret === undefined || secret === null || secret === "")
      ) {
        continue;
      }

      values[rule.key] = rule.read(secret);
    }

    return values;
  }

  // The JSON a connection's secrets are stored as: those its service takes.
  public static toSecretsJson(
    provider: DeviceManagementProvider,
    secrets: DeviceManagementSecretValues,
    config?: DeviceManagementConfig | undefined,
  ): string {
    const json: Record<string, string | undefined> = {};

    for (const rule of getDeviceManagementSecretRules(provider, config)) {
      json[rule.key] = secrets[rule.key];
    }

    return JSON.stringify(json);
  }

  // A name for a connection saved without one: the tenant's.
  public static getDefaultName(data: {
    provider: DeviceManagementProvider;
    config: DeviceManagementConfig;
  }): string {
    return (
      data.config.tenant
        ? `${getDeviceManagementProviderShortTitle(data.provider)} ${data.config.tenant}`
        : getDeviceManagementProviderTitle(data.provider)
    ).substring(0, MAX_NAME_LENGTH);
  }

  private static readBoolean(value: unknown, label: string): void {
    if (value !== undefined && typeof value !== "boolean") {
      throw new BadDataException(`${label} must be true or false.`);
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const provider: DeviceManagementProvider = Service.readProvider(
      createBy.data.provider,
    );

    const config: DeviceManagementConfig = validateDeviceManagementConfig(
      Service.parseJsonObject(createBy.data.config, "Settings"),
      { requireTenant: true, provider },
    );

    const secrets: DeviceManagementSecretValues = Service.readSecrets(
      createBy.data.secrets,
      { required: true, provider, config },
    );

    Service.readBoolean(createBy.data.isEnabled, "Enabled");

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("A connection belongs to a project.");
    }

    await this.assertTenantNotConnected({
      projectId,
      provider,
      config,
    });

    if (!createBy.data.name || !createBy.data.name.trim()) {
      createBy.data.name = Service.getDefaultName({ provider, config });
    }

    createBy.data.name = createBy.data.name
      .trim()
      .substring(0, MAX_NAME_LENGTH);
    createBy.data.provider = provider;
    createBy.data.config = toDeviceManagementConfigJson(config);
    createBy.data.secrets = Service.toSecretsJson(provider, secrets, config);

    return { createBy, carryForward: null };
  }

  /*
   * One connection per tenant in a project: two would each read it on their
   * own schedule, import every device twice and spend its API budget twice.
   * An Intune tenant is one per cloud it is in, and a Workspace ONE or SOTI
   * server one per host.
   */
  private async assertTenantNotConnected(data: {
    projectId: ObjectID;
    provider: DeviceManagementProvider;
    config: DeviceManagementConfig;
  }): Promise<void> {
    const existing: Array<Model> = await this.findBy({
      query: { projectId: data.projectId, provider: data.provider },
      select: { _id: true, name: true, config: true },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

    const address: string = getDeviceManagementConnectionAddress({
      provider: data.provider,
      config: data.config,
    });
    const taken: Model | undefined = existing.find(
      (connection: Model): boolean => {
        return (
          getDeviceManagementConnectionAddress({
            provider: data.provider,
            config: readDeviceManagementConfig(
              connection.config,
              data.provider,
            ),
          }) === address
        );
      },
    );

    if (taken) {
      throw new BadDataException(
        `${CONNECTED_ALREADY[data.provider]}, as "${taken.name || ""}". Edit that connection instead.`,
      );
    }
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
        "The service of a connection cannot be changed. Connect it anew instead.",
      );
    }

    Service.readBoolean(incoming["isEnabled"], "Enabled");

    if (typeof incoming["name"] === "string") {
      const name: string = (incoming["name"] as string).trim();

      if (!name) {
        throw new BadDataException("Enter a name for the connection.");
      }

      incoming["name"] = name.substring(0, MAX_NAME_LENGTH);
    }

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (touchesSettings) {
      await this.checkSettingsOfUpdate(updateBy);
    }

    /*
     * Read after the settings' checks, which name the one row they allow
     * by its plain id: reading the rows holds the update to them.
     */
    return {
      updateBy,
      carryForward: await this.readConnectionsTurnedOff(updateBy),
    };
  }

  /*
   * The connections an update turns off (#10286): those it writes isEnabled
   * false to that are on now, read as the update writes them
   * (findRowsAndHoldUpdateToThem). Writing the switch back as it is turns
   * nothing off. None for an update that leaves the switch alone.
   */
  private async readConnectionsTurnedOff(
    updateBy: UpdateBy<Model>,
  ): Promise<ConnectionUpdateCarryForward | null> {
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["isEnabled"] !== false) {
      return null;
    }

    const connections: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        name: true,
        provider: true,
        config: true,
        isEnabled: true,
        lastSuccessfulPullAt: true,
        createdAt: true,
      },
    );

    const turnedOff: Array<DeviceManagementConnectionGone> = connections
      .filter((connection: Model): boolean => {
        return Boolean(
          connection.id &&
            connection.projectId &&
            connection.isEnabled !== false,
        );
      })
      .map((connection: Model): DeviceManagementConnectionGone => {
        return {
          connectionId: connection.id!,
          projectId: connection.projectId!,
          name: connection.name,
          provider: connection.provider,
          readIntervalInMinutes: readDeviceManagementConfig(connection.config)
            .readIntervalInMinutes,
          lastSuccessfulPullAt: connection.lastSuccessfulPullAt,
          createdAt: connection.createdAt,
        };
      });

    return turnedOff.length > 0 ? { turnedOff } : null;
  }

  /*
   * An update of a connection's settings or credentials, checked and made
   * ready to store: one connection at a time, its tenant and service fixed,
   * its secrets kept or replaced.
   */
  private async checkSettingsOfUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

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

    if (!current || !current.projectId) {
      throw new BadDataException("The connection no longer exists.");
    }

    const provider: DeviceManagementProvider = Service.readProvider(
      current.provider,
    );
    const stored: DeviceManagementConfig = readDeviceManagementConfig(
      current.config,
      provider,
    );

    let requested: DeviceManagementConfig = stored;

    if (incoming["config"] !== undefined) {
      requested = validateDeviceManagementConfig(
        {
          ...toDeviceManagementConfigJson(stored),
          ...Service.parseJsonObject(incoming["config"], "Settings"),
        },
        { requireTenant: true, provider },
      );

      if (
        requested.tenant !== stored.tenant ||
        (requested.cloud || "") !== (stored.cloud || "")
      ) {
        throw new BadDataException(ONE_TENANT_A_CONNECTION[provider]);
      }

      incoming["config"] = toDeviceManagementConfigJson(requested);
    }

    /*
     * A connection that signs in another way (a Workspace ONE connection
     * moving to an OAuth client) takes that way's secrets: none of the
     * stored ones is kept for it.
     */
    const isSameSignIn: boolean =
      (requested.authMethod || "") === (stored.authMethod || "");

    if (incoming["secrets"] !== undefined || !isSameSignIn) {
      const provided: DeviceManagementSecretValues = Service.readSecrets(
        incoming["secrets"] === undefined ? {} : incoming["secrets"],
        { required: false, provider, config: requested },
      );

      const storedSecrets: JSONObject = Service.parseJsonObject(
        current.secrets,
        "Credentials",
      );
      const secrets: DeviceManagementSecretValues = {};

      for (const rule of getDeviceManagementSecretRules(provider, requested)) {
        secrets[rule.key] =
          provided[rule.key] ||
          rule.read(isSameSignIn ? storedSecrets[rule.key] : undefined);
      }

      incoming["secrets"] = Service.toSecretsJson(provider, secrets, requested);
    }
  }

  /*
   * A connection whose settings or key changed, or that was turned back
   * on, is read again at once, and its last error - about the old settings
   * - no longer applies. Where its reads got to is kept.
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
  }

  /*
   * Connections turned off (#10286): each writes its last reading, and what
   * its Connection Stopped Reading monitors opened about it is resolved,
   * saying who turned it off (DeviceManagementConnectionAlerts). Only the
   * rows the update wrote; never fails the update.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const turnedOff: Array<DeviceManagementConnectionGone> =
      Service.ofRowsWritten(
        (onUpdate.carryForward as ConnectionUpdateCarryForward | null)
          ?.turnedOff || [],
        updatedItemIds,
      );

    if (turnedOff.length > 0) {
      try {
        await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
          connections: turnedOff,
          turnedOffByUserId: onUpdate.updateBy.props.userId,
        });
      } catch (error) {
        logger.error(
          `Device management connections were turned off, but what their monitors had open about them could not be resolved: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return onUpdate;
  }

  /*
   * The connections a delete removes, with their projects and names: their
   * devices go with them (the database removes them with the connection),
   * each device's host in Inventory is let go first, and the monitors that
   * read only them are turned off once they are gone (onDeleteSuccess).
   * Read as the delete reads them - the ones its caller may delete - and the
   * delete held to them (findRowsAndHoldDeleteToThem).
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const connections: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { _id: true, projectId: true, name: true, provider: true },
    );

    const carryForward: ConnectionDeleteCarryForward = {
      connections: connections
        .filter((connection: Model): boolean => {
          return Boolean(connection.id && connection.projectId);
        })
        .map((connection: Model): DeviceManagementConnectionGone => {
          return {
            connectionId: connection.id!,
            projectId: connection.projectId!,
            name: connection.name,
            provider: connection.provider,
          };
        }),
    };

    /*
     * The hosts are let go before the devices are deleted with the
     * connection: once they are, nothing says which hosts were theirs.
     */
    for (const connection of carryForward.connections) {
      try {
        await ManagedDeviceInventory.releaseConnection({
          projectId: connection.projectId,
          connectionId: connection.connectionId,
        });
      } catch (error) {
        logger.error(
          `Device management connection ${connection.connectionId.toString()} is being deleted, but its devices' hosts in Inventory could not be let go: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { deleteBy, carryForward };
  }

  /*
   * Connections deleted (#10286): every monitor that read one of them alone
   * has nothing left to read. What it had open is resolved, its monitoring
   * turned off, and its feed says why (DeviceManagementConnectionAlerts).
   * Only the rows the delete removed; never fails the delete.
   */
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleted: Array<DeviceManagementConnectionGone> =
      Service.ofRowsWritten(
        (onDelete.carryForward as ConnectionDeleteCarryForward | null)
          ?.connections || [],
        deletedItemIds,
      );

    if (deleted.length > 0) {
      try {
        await DeviceManagementConnectionAlerts.onConnectionsDeleted({
          connections: deleted,
          deletedByUserId: onDelete.deleteBy.props.userId,
        });
      } catch (error) {
        logger.error(
          `Device management connections were deleted, but the monitors that read them could not be turned off: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return onDelete;
  }

  // The connections of a carry the write really wrote, by id.
  private static ofRowsWritten(
    connections: Array<DeviceManagementConnectionGone>,
    writtenIds: Array<ObjectID>,
  ): Array<DeviceManagementConnectionGone> {
    const written: Set<string> = new Set<string>(
      writtenIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    return connections.filter(
      (connection: DeviceManagementConnectionGone): boolean => {
        return written.has(connection.connectionId.toString());
      },
    );
  }

  /*
   * Decrypted settings for the read loop and "Test". Root read; the result
   * must never be serialized into a response or a log.
   */
  public async getDeviceManagementSettings(
    connection: Model,
  ): Promise<DeviceManagementSettings> {
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

    if (!projectId) {
      throw new BadDataException("The connection belongs to no project.");
    }

    const secrets: JSONObject = Service.parseJsonObject(
      secretsJson,
      "Credentials",
    );
    const service: DeviceManagementProvider = Service.readProvider(provider);
    const settingsConfig: DeviceManagementConfig = readDeviceManagementConfig(
      config,
      service,
    );
    const values: DeviceManagementSecretValues = {};

    for (const rule of getDeviceManagementSecretRules(
      service,
      settingsConfig,
    )) {
      values[rule.key] = rule.read(secrets[rule.key]);
    }

    return {
      provider: service,
      projectId: projectId.toString(),
      config: settingsConfig,
      apiKey: values.apiKey || "",
      ...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
      ...(values.password ? { password: values.password } : {}),
    };
  }
}

export default new Service();
