import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionServiceClass } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/NetworkControllerConnection";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  NetworkControllerConfig,
  SECRET_API_KEY,
  readMerakiApiKey,
  readNetworkControllerConfig,
  toNetworkControllerConfigJson,
  validateNetworkControllerConfig,
} from "../../Types/NetworkController/NetworkControllerConnectionSettings";
import NetworkControllerProvider, {
  getNetworkControllerProviderTitle,
  isNetworkControllerProvider,
} from "../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import { NetworkControllerSettings } from "../Utils/NetworkController/NetworkControllerTypes";
import NetworkDeviceService from "./NetworkDeviceService";

// What onBeforeDelete hands onDeleteSuccess: the connections and their projects.
interface ConnectionDeleteCarryForward {
  connections: Array<{ id: ObjectID; projectId: ObjectID }>;
}

/*
 * Network controller connections (a Meraki organization, Network >
 * Traffic): validated when saved, so a connection that stores is one the
 * read loop can use - a region that is not Meraki's, an organization ID
 * that cannot be one, a key that is not a key is a form error, not a
 * lastError ten minutes later.
 *
 * The API key is write-only: an edit form cannot show it, so on an update
 * a key left empty keeps the stored one and a value replaces it.
 *
 * The organization and the region are fixed once a connection is made:
 * where its reads got to (pullState) is the organization's, so reading
 * another one is a connection of its own.
 */

// The longest a connection's name is kept (ColumnLength.Name).
const MAX_NAME_LENGTH: number = 50;

export interface NetworkControllerSecrets {
  apiKey: string;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public static readProvider(value: unknown): NetworkControllerProvider {
    if (value === undefined || value === null || value === "") {
      return NetworkControllerProvider.Meraki;
    }

    if (!isNetworkControllerProvider(value)) {
      throw new BadDataException(
        "Controller must be 'meraki': the network controllers OneUptime can read.",
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
          `Credentials has no "${key.substring(0, 50)}": a Meraki connection takes apiKey.`,
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

    return { apiKey: readMerakiApiKey(apiKey) };
  }

  /*
   * A name for a connection saved without one: the organization's, else
   * the controller's.
   */
  public static getDefaultName(data: {
    provider: NetworkControllerProvider;
    config: NetworkControllerConfig;
  }): string {
    return (
      data.config.organizationName ||
      getNetworkControllerProviderTitle(data.provider)
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
    const provider: NetworkControllerProvider = Service.readProvider(
      createBy.data.provider,
    );

    const config: NetworkControllerConfig = validateNetworkControllerConfig(
      Service.parseJsonObject(createBy.data.config, "Settings"),
      { requireOrganization: true },
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

    await this.assertOrganizationNotConnected({
      projectId,
      provider,
      organizationId: config.organizationId,
    });

    if (!createBy.data.name || !createBy.data.name.trim()) {
      createBy.data.name = Service.getDefaultName({ provider, config });
    }

    createBy.data.provider = provider;
    createBy.data.config = toNetworkControllerConfigJson(config);
    createBy.data.secrets = JSON.stringify({ apiKey: secrets.apiKey });

    return { createBy, carryForward: null };
  }

  /*
   * One connection per organization in a project: two would each read it
   * on their own schedule, write every window twice and spend its API
   * budget twice.
   */
  private async assertOrganizationNotConnected(data: {
    projectId: ObjectID;
    provider: NetworkControllerProvider;
    organizationId: string;
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
          readNetworkControllerConfig(connection.config).organizationId ===
          data.organizationId
        );
      },
    );

    if (taken) {
      throw new BadDataException(
        `This Meraki organization is connected already, as "${taken.name || ""}". Edit that connection instead.`,
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
        "The controller of a connection cannot be changed. Connect it anew instead.",
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

    if (!current || !current.projectId) {
      throw new BadDataException("The connection no longer exists.");
    }

    const stored: NetworkControllerConfig = readNetworkControllerConfig(
      current.config,
    );

    if (incoming["config"] !== undefined) {
      const requested: NetworkControllerConfig =
        validateNetworkControllerConfig(
          {
            ...toNetworkControllerConfigJson(stored),
            ...Service.parseJsonObject(incoming["config"], "Settings"),
          },
          { requireOrganization: true },
        );

      if (requested.organizationId !== stored.organizationId) {
        throw new BadDataException(
          "A connection reads one Meraki organization. To read another one, connect it as well.",
        );
      }

      if (requested.region !== stored.region) {
        throw new BadDataException(
          "A connection's dashboard region cannot be changed. Connect the organization again from its own region.",
        );
      }

      incoming["config"] = toNetworkControllerConfigJson(requested);
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
        : readMerakiApiKey(storedSecrets[SECRET_API_KEY]);

      incoming["secrets"] = JSON.stringify({ apiKey });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A connection whose settings or key changed, or that was turned back
   * on, is read again at once, and its last error - about the old settings
   * - no longer applies. Where its reads got to is kept: reading a window
   * again would count it twice.
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
   * The connections a delete removes, with their projects: what each said
   * about the project's devices is forgotten once it is gone.
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const connections: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: { _id: true, projectId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const carryForward: ConnectionDeleteCarryForward = {
      connections: connections
        .filter((connection: Model): boolean => {
          return Boolean(connection.id && connection.projectId);
        })
        .map((connection: Model): { id: ObjectID; projectId: ObjectID } => {
          return { id: connection.id!, projectId: connection.projectId! };
        }),
    };

    return { deleteBy, carryForward };
  }

  /*
   * A deleted connection's readings of the project's devices go with it
   * (NetworkControllerInventory): Meraki no longer describes them, so their
   * model, serial number and the rest no longer come from it. Guarded: a
   * failure here never undoes the delete.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleted: Set<string> = new Set<string>(
      itemIdsBeforeDelete.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const carried: ConnectionDeleteCarryForward | null =
      (onDelete.carryForward as ConnectionDeleteCarryForward | null) || null;

    for (const connection of carried?.connections || []) {
      if (!deleted.has(connection.id.toString())) {
        continue;
      }

      try {
        await NetworkDeviceService.forgetControllerReadings({
          projectId: connection.projectId,
          connectionId: connection.id,
        });
      } catch (error) {
        logger.error(
          `Network controller connection ${connection.id.toString()} was deleted, but what it said about the project's devices could not be forgotten: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return onDelete;
  }

  /*
   * Decrypted settings for the read loop and "Test". Root read; the result
   * must never be serialized into a response or a log.
   */
  public async getControllerSettings(
    connection: Model,
  ): Promise<NetworkControllerSettings> {
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
      config: readNetworkControllerConfig(config),
      apiKey: readMerakiApiKey(secrets[SECRET_API_KEY]),
    };
  }
}

export default new Service();
