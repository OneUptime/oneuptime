import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionServiceClass } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/DeviceManagementConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  DeviceManagementConfig,
  SECRET_API_KEY,
  readDeviceManagementConfig,
  readEsperApiKey,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import DeviceManagementProvider, {
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
} from "../../Types/DeviceManagement/DeviceManagementProvider";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import { DeviceManagementSettings } from "../Utils/DeviceManagement/DeviceManagementTypes";
import ManagedDeviceInventory from "../Utils/DeviceManagement/ManagedDeviceInventory";

// The connections a delete removes, and their projects.
interface ConnectionDeleteCarryForward {
  connections: Array<{ id: ObjectID; projectId: ObjectID }>;
}

/*
 * Device management connections (an Esper tenant, Inventory > Managed
 * Devices): validated when saved, so a connection that stores is one the
 * read loop can use - a tenant that is not one, a key that is not a key is
 * a form error, not a lastError fifteen minutes later.
 *
 * The API key is write-only: an edit form cannot show it, so on an update
 * a key left empty keeps the stored one and a value replaces it.
 *
 * The tenant is fixed once a connection is made: its devices are the
 * tenant's, so reading another tenant is a connection of its own.
 */

// The longest a connection's name is kept.
const MAX_NAME_LENGTH: number = 50;

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
        "Service must be 'esper': the device management services OneUptime can read.",
      );
    }

    return value;
  }

  // A form's JSON (an object or JSON text); anything else is a 400.
  public static parseJsonObject(value: unknown, label: string): JSONObject {
    return SecurityEventConnectionServiceClass.parseJsonObject(value, label);
  }

  /*
   * The secrets a request carries, checked: the API key, and nothing else
   * (an unknown key is refused rather than stored, so a typo is not "no
   * key"). With `requireApiKey` false, an empty key means "keep the
   * stored one" and reads as undefined.
   */
  public static readSecrets(
    value: unknown,
    options: { requireApiKey: boolean },
  ): { apiKey?: string | undefined } {
    const secrets: JSONObject = Service.parseJsonObject(value, "Credentials");

    for (const key of Object.keys(secrets)) {
      if (key !== SECRET_API_KEY) {
        throw new BadDataException(
          `Credentials has no "${key.substring(0, 50)}": an Esper connection takes apiKey.`,
        );
      }
    }

    const apiKey: unknown = secrets[SECRET_API_KEY];

    if (
      !options.requireApiKey &&
      (apiKey === undefined || apiKey === null || apiKey === "")
    ) {
      return {};
    }

    return { apiKey: readEsperApiKey(apiKey) };
  }

  // A name for a connection saved without one: the tenant's.
  public static getDefaultName(data: {
    provider: DeviceManagementProvider;
    config: DeviceManagementConfig;
  }): string {
    return (
      data.config.tenant
        ? `${getDeviceManagementProviderTitle(data.provider)} ${data.config.tenant}`
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
      { requireTenant: true },
    );

    const secrets: { apiKey?: string | undefined } = Service.readSecrets(
      createBy.data.secrets,
      { requireApiKey: true },
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
      tenant: config.tenant,
    });

    if (!createBy.data.name || !createBy.data.name.trim()) {
      createBy.data.name = Service.getDefaultName({ provider, config });
    }

    createBy.data.name = createBy.data.name
      .trim()
      .substring(0, MAX_NAME_LENGTH);
    createBy.data.provider = provider;
    createBy.data.config = toDeviceManagementConfigJson(config);
    createBy.data.secrets = JSON.stringify({ apiKey: secrets.apiKey });

    return { createBy, carryForward: null };
  }

  /*
   * One connection per tenant in a project: two would each read it on their
   * own schedule, import every device twice and spend its API budget twice.
   */
  private async assertTenantNotConnected(data: {
    projectId: ObjectID;
    provider: DeviceManagementProvider;
    tenant: string;
  }): Promise<void> {
    const existing: Array<Model> = await this.findBy({
      query: { projectId: data.projectId, provider: data.provider },
      select: { _id: true, name: true, config: true },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

    const taken: Model | undefined = existing.find(
      (connection: Model): boolean => {
        return (
          readDeviceManagementConfig(connection.config).tenant === data.tenant
        );
      },
    );

    if (taken) {
      throw new BadDataException(
        `This Esper tenant is connected already, as "${taken.name || ""}". Edit that connection instead.`,
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

    if (!current || !current.projectId) {
      throw new BadDataException("The connection no longer exists.");
    }

    const stored: DeviceManagementConfig = readDeviceManagementConfig(
      current.config,
    );

    if (incoming["config"] !== undefined) {
      const requested: DeviceManagementConfig = validateDeviceManagementConfig(
        {
          ...toDeviceManagementConfigJson(stored),
          ...Service.parseJsonObject(incoming["config"], "Settings"),
        },
        { requireTenant: true },
      );

      if (requested.tenant !== stored.tenant) {
        throw new BadDataException(
          "A connection reads one Esper tenant. To read another one, connect it as well.",
        );
      }

      incoming["config"] = toDeviceManagementConfigJson(requested);
    }

    if (incoming["secrets"] !== undefined) {
      const provided: { apiKey?: string | undefined } = Service.readSecrets(
        incoming["secrets"],
        { requireApiKey: false },
      );

      const storedSecrets: JSONObject = Service.parseJsonObject(
        current.secrets,
        "Credentials",
      );

      const apiKey: string = provided.apiKey
        ? provided.apiKey
        : readEsperApiKey(storedSecrets[SECRET_API_KEY]);

      incoming["secrets"] = JSON.stringify({ apiKey });
    }

    return { updateBy, carryForward: null };
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
   * The connections a delete removes, with their projects: their devices go
   * with them (the database removes them with the connection), and each
   * device's host in Inventory is let go first (onDeleteSuccess). Read as
   * the delete reads them - the ones its caller may delete - and the delete
   * held to them (findRowsAndHoldDeleteToThem).
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const connections: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { _id: true, projectId: true },
    );

    const carryForward: ConnectionDeleteCarryForward = {
      connections: connections
        .filter((connection: Model): boolean => {
          return Boolean(connection.id && connection.projectId);
        })
        .map((connection: Model): { id: ObjectID; projectId: ObjectID } => {
          return { id: connection.id!, projectId: connection.projectId! };
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
          connectionId: connection.id,
        });
      } catch (error) {
        logger.error(
          `Device management connection ${connection.id.toString()} is being deleted, but its devices' hosts in Inventory could not be let go: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { deleteBy, carryForward };
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

    return {
      provider: Service.readProvider(provider),
      projectId: projectId.toString(),
      config: readDeviceManagementConfig(config),
      apiKey: readEsperApiKey(secrets[SECRET_API_KEY]),
    };
  }
}

export default new Service();
