import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
  MAX_DEVICE_ADD_FAILURES_KEPT,
  MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
  NetworkControllerDeviceAddRequest,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  buildQueuedNetworkControllerDeviceAddState,
  isNetworkControllerDeviceAddUnderWay,
  readNetworkControllerDeviceAddState,
  toNetworkControllerDeviceAddStateJson,
} from "../../../Types/NetworkController/NetworkControllerDeviceAdd";
import { readNetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkDeviceRoleService from "../../Services/NetworkDeviceRoleService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ModelPermission from "../../Types/Database/Permissions/Index";
import CallerPlan from "../Billing/CallerPlan";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";
import NetworkControllerConnectorRegistry from "./NetworkControllerConnectorRegistry";
import {
  ControllerDeviceAddPlan,
  ControllerDeviceAddVerdict,
  ControllerIdentityHolder,
  ControllerIdentityLookup,
  ControllerSitePlan,
  buildNetworkDeviceFromController,
  getControllerDeviceBaseName,
  getControllerDeviceNameChoices,
  getControllerDeviceRoleKey,
  getControllerIdentityLookup,
  getControllerSiteNames,
  judgeControllerDevices,
  planControllerDeviceAdd,
  planControllerDeviceNames,
  planControllerSites,
} from "./NetworkControllerDeviceAdd";
import {
  ControllerInventoryCandidate,
  ControllerInventoryConnection,
  ControllerInventoryLookup,
  ControllerInventoryMatch,
  FindControllerCandidatesFunction,
  MAX_INVENTORY_CANDIDATES,
  getControllerInventoryLookup,
  matchControllerDevices,
} from "./NetworkControllerInventory";
import NetworkControllerScheduler from "./NetworkControllerScheduler";
import {
  NetworkControllerDevice,
  NetworkControllerDeviceListing,
  NetworkControllerListOptions,
  NetworkControllerSettings,
  NetworkControllerTransport,
} from "./NetworkControllerTypes";

/*
 * ADD DEVICES, ON THE SERVER (Types/NetworkController/NetworkControllerDeviceAdd
 * says what it is for).
 *
 *   ask      the add-devices route, for a project owner or admin who may
 *            create network devices: the ask is recorded on the connection
 *            (lastDeviceAdd, Queued) and a job queued. One ask of a
 *            connection is under way at a time; one whose worker was lost
 *            is replaced by the next.
 *   (worker) lists the organization's devices again - an ask is answered
 *            with what Meraki says now, never with what a read said minutes
 *            ago - works out which are no device here and may be added
 *            (NetworkControllerDeviceAdd), adds the sites they need and
 *            then the devices, as the person who asked, and writes how far
 *            it got on the connection every couple of seconds, so the
 *            connection's row can follow it, from any tab, after a reload.
 *            Then it queues a read of the connection, which places the new
 *            devices' clients and links on the map and counts again.
 *
 * AS THE PERSON. Every site and device is created with the permissions of
 * the person who asked, read from the database when the worker starts and
 * again every minute, as Network Discovery's import does: someone who lost
 * the right to create devices half way stops creating them half way. Their
 * name is on every device as its creator.
 *
 * NOTHING TWICE. A device is added only when nothing here holds its serial
 * number, MAC or address, read just before the adds; a second ask while one
 * runs is refused; the job runs under a lock of the connection, and its
 * queue keeps one job of a connection waiting at a time. Asking again after
 * an ask that stopped carries on: what it added is a device here by then.
 */

export const NETWORK_CONTROLLER_DEVICE_ADD_JOB: string =
  "NetworkControllerConnection:AddDevices";

// The worker's limit for one job. 5,000 devices take a few minutes.
export const NETWORK_CONTROLLER_DEVICE_ADD_JOB_TIMEOUT_MS: number =
  60 * 60 * 1000;

/*
 * Bounds on the listing an ask reads: the largest organization's devices
 * (50 pages) and networks (50 pages) and the organization, with room for a
 * few retries; and minutes, at the pace the client keeps.
 */
export const DEVICE_ADD_LIST_MAX_REQUESTS: number = 120;
export const DEVICE_ADD_LIST_MAX_DURATION_MS: number = 5 * 60 * 1000;

// Progress is written at most this often while devices are added.
export const DEVICE_ADD_FLUSH_INTERVAL_MS: number = 2000;

// The person's permissions are read again after this long.
export const DEVICE_ADD_PERMISSION_REFRESH_MS: number = 60 * 1000;

// Names and sites one lookup asks about.
const LOOKUP_CHUNK_SIZE: number = 500;

const LOCK_NAMESPACE: string = "NetworkControllerDeviceAdd";
const LOCK_TIMEOUT_MS: number = NETWORK_CONTROLLER_DEVICE_ADD_JOB_TIMEOUT_MS;

export const DEVICE_ADD_UNDER_WAY: string =
  "Devices are being added from this connection already. Wait for them to be added, then add more.";
export const DEVICE_ADD_CONNECTION_OFF: string =
  "This connection is turned off. Turn it on to add its devices.";
export const DEVICE_ADD_PROBE_NOT_ATTACHABLE: string =
  "Pick a probe of this project, or none.";
export const DEVICE_ADD_MAY_NOT_CREATE_DEVICES: string =
  "You may not create network devices in this project, so you cannot add Meraki's devices. Ask a project owner or admin.";
export const DEVICE_ADD_MAY_NOT_CREATE_SITES: string =
  "You may not create network sites in this project, so the devices cannot be put in sites named after their Meraki networks. Add them without sites, or ask a project owner or admin.";
export const DEVICE_ADD_CONNECTION_GONE: string =
  "The connection no longer exists.";
export const DEVICE_ADD_NAME_TAKEN_REASON: string =
  "Another network device has this name.";

export type ReadPersonPropsFunction = (data: {
  userId: ObjectID;
  projectId: ObjectID;
}) => Promise<DatabaseCommonInteractionProps>;

export type FindControllerIdentityHoldersFunction = (data: {
  projectId: ObjectID;
  lookup: ControllerIdentityLookup;
  limit: number;
}) => Promise<Array<ControllerIdentityHolder>>;

// The names of the project's devices among these, in lower case.
export type FindTakenDeviceNamesFunction = (data: {
  projectId: ObjectID;
  names: Array<string>;
}) => Promise<Set<string>>;

// The project's sites of these names: id and name.
export type FindSitesByNameFunction = (data: {
  projectId: ObjectID;
  names: Array<string>;
}) => Promise<Array<{ id: string; name: string }>>;

export type CreateSiteFunction = (data: {
  projectId: ObjectID;
  name: string;
  address: string;
  props: DatabaseCommonInteractionProps;
}) => Promise<string>;

// The project's device roles: id by key.
export type FindRoleIdsFunction = (
  projectId: ObjectID,
) => Promise<Map<string, string>>;

export type CreateDeviceFunction = (data: {
  device: NetworkDevice;
  props: DatabaseCommonInteractionProps;
}) => Promise<void>;

export type ListControllerDevicesFunction = (
  settings: NetworkControllerSettings,
  options: NetworkControllerListOptions,
) => Promise<NetworkControllerDeviceListing>;

export interface NetworkControllerDeviceAddDependencies {
  now?: (() => Date) | undefined;
  transport?: NetworkControllerTransport | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  readConnection?:
    | ((connectionId: ObjectID) => Promise<NetworkControllerConnection | null>)
    | undefined;
  writeState?:
    | ((data: {
        connectionId: ObjectID;
        state: NetworkControllerDeviceAddState;
      }) => Promise<void>)
    | undefined;
  getSettings?:
    | ((
        connection: NetworkControllerConnection,
      ) => Promise<NetworkControllerSettings>)
    | undefined;
  listDevices?: ListControllerDevicesFunction | undefined;
  readPersonProps?: ReadPersonPropsFunction | undefined;
  findCandidates?: FindControllerCandidatesFunction | undefined;
  findHolders?: FindControllerIdentityHoldersFunction | undefined;
  findTakenNames?: FindTakenDeviceNamesFunction | undefined;
  findSites?: FindSitesByNameFunction | undefined;
  createSite?: CreateSiteFunction | undefined;
  findRoleIds?: FindRoleIdsFunction | undefined;
  createDevice?: CreateDeviceFunction | undefined;
  enqueueRead?:
    | ((connectionId: ObjectID, now: Date) => Promise<void>)
    | undefined;
  // Skip the connection's lock: tests run one job at a time.
  skipLock?: boolean | undefined;
}

export interface NetworkControllerDeviceAddOutcome {
  status: NetworkControllerDeviceAddStatus | "skipped";
  state?: NetworkControllerDeviceAddState | undefined;
}

function isRefusalOfThePerson(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

const WHITESPACE_RUNS: RegExp = /\s+/g;

function toReason(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message || "" : String(error ?? "");

  return (
    message
      .substring(0, MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH * 4)
      .replace(WHITESPACE_RUNS, " ")
      .trim() || "Something went wrong."
  ).substring(0, MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH);
}

function isNameTaken(error: unknown): boolean {
  return (
    error instanceof BadDataException &&
    error.message === "Network Device with the same name already exists."
  );
}

function chunks<T>(items: Array<T>, size: number): Array<Array<T>> {
  const result: Array<Array<T>> = [];

  for (let offset: number = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }

  return result;
}

export default class NetworkControllerDeviceAddRunner {
  // ---- Asked for through the API.

  /*
   * Record an ask and queue it. The route has checked who is asking; this
   * refuses an ask while another one of the connection is under way, and
   * one of a connection that is off. Returns the queued state.
   */
  public static async ask(data: {
    connectionId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID;
    request: NetworkControllerDeviceAddRequest;
    now?: Date | undefined;
    enqueue?: ((connectionId: ObjectID) => Promise<void>) | undefined;
  }): Promise<NetworkControllerDeviceAddState> {
    const now: Date = data.now || new Date();

    const connection: NetworkControllerConnection | null =
      await NetworkControllerConnectionService.findOneBy({
        query: { _id: data.connectionId, projectId: data.projectId },
        select: { _id: true, isEnabled: true, lastDeviceAdd: true },
        props: { isRoot: true },
      });

    if (!connection) {
      throw new BadDataException(DEVICE_ADD_CONNECTION_GONE);
    }

    if (!connection.isEnabled) {
      throw new BadDataException(DEVICE_ADD_CONNECTION_OFF);
    }

    if (
      isNetworkControllerDeviceAddUnderWay(
        readNetworkControllerDeviceAddState(connection.lastDeviceAdd),
        now,
      )
    ) {
      throw new BadDataException(DEVICE_ADD_UNDER_WAY);
    }

    const state: NetworkControllerDeviceAddState =
      buildQueuedNetworkControllerDeviceAddState({
        request: data.request,
        requestedByUserId: data.userId.toString(),
        now,
      });

    await NetworkControllerConnectionService.updateOneById({
      id: data.connectionId,
      data: {
        lastDeviceAdd: toNetworkControllerDeviceAddStateJson(state),
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    await (data.enqueue || NetworkControllerDeviceAddRunner.enqueue)(
      data.connectionId,
    );

    return state;
  }

  // Queue the job of one connection. Its payload is the id only.
  public static async enqueue(connectionId: ObjectID): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      `network-controller-device-add-${connectionId.toString()}-${Date.now()}`,
      NETWORK_CONTROLLER_DEVICE_ADD_JOB,
      { connectionId: connectionId.toString() },
      {
        attempts: 1,
        deduplication: {
          id: `network-controller-device-add-${connectionId.toString()}`,
        },
      },
    );
  }

  // ---- The worker's side.

  /*
   * Answer the connection's queued ask - see the header. Never throws: a
   * failure is the ask's, recorded on the connection.
   */
  public static async run(
    connectionId: ObjectID,
    dependencies: NetworkControllerDeviceAddDependencies = {},
  ): Promise<NetworkControllerDeviceAddOutcome> {
    if (dependencies.skipLock) {
      return await NetworkControllerDeviceAddRunner.runLocked(
        connectionId,
        dependencies,
      );
    }

    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        namespace: LOCK_NAMESPACE,
        key: connectionId.toString(),
        lockTimeout: LOCK_TIMEOUT_MS,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
      });
    } catch (error) {
      // Another job holds the connection: it answers the ask.
      logger.debug(
        `Network controller connection ${connectionId.toString()}: devices are being added by another job: ${error}`,
      );
      return { status: "skipped" };
    }

    try {
      return await NetworkControllerDeviceAddRunner.runLocked(
        connectionId,
        dependencies,
      );
    } finally {
      try {
        await Semaphore.release(lock);
      } catch {
        logger.error(
          "Network controller device add: a connection lock could not be released and will expire on its own.",
        );
      }
    }
  }

  private static async runLocked(
    connectionId: ObjectID,
    dependencies: NetworkControllerDeviceAddDependencies,
  ): Promise<NetworkControllerDeviceAddOutcome> {
    const clock: () => Date =
      dependencies.now ||
      ((): Date => {
        return new Date();
      });

    const connection: NetworkControllerConnection | null = await (
      dependencies.readConnection ||
      ((id: ObjectID): Promise<NetworkControllerConnection | null> => {
        return NetworkControllerConnectionService.findOneById({
          id,
          select: {
            _id: true,
            projectId: true,
            name: true,
            provider: true,
            config: true,
            secrets: true,
            isEnabled: true,
            lastDeviceAdd: true,
          },
          props: { isRoot: true },
        });
      })
    )(connectionId);

    const queued: NetworkControllerDeviceAddState | undefined =
      readNetworkControllerDeviceAddState(connection?.lastDeviceAdd);

    if (
      !connection ||
      !connection.projectId ||
      !queued ||
      queued.status !== NetworkControllerDeviceAddStatus.Queued
    ) {
      return { status: "skipped" };
    }

    const projectId: ObjectID = connection.projectId;
    const write: (state: NetworkControllerDeviceAddState) => Promise<void> =
      async (state: NetworkControllerDeviceAddState): Promise<void> => {
        await NetworkControllerDeviceAddRunner.writeState(
          { connectionId, state },
          dependencies,
        );
      };

    const state: NetworkControllerDeviceAddState = {
      ...queued,
      status: NetworkControllerDeviceAddStatus.Adding,
      startedAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    };

    await write(state);

    let settings: NetworkControllerSettings | null = null;

    try {
      if (!connection.isEnabled) {
        throw new BadDataException(DEVICE_ADD_CONNECTION_OFF);
      }

      const readProps: ReadPersonPropsFunction =
        dependencies.readPersonProps ||
        (async (person: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return await CallerPlan.withPlan(
            await WorkspaceActionAuthorization.getProjectMemberProps(person),
          );
        });
      const userId: ObjectID = new ObjectID(queued.requestedByUserId);
      let props: DatabaseCommonInteractionProps = await readProps({
        userId,
        projectId,
      });
      let propsReadAt: number = clock().getTime();

      NetworkControllerDeviceAddRunner.assertMayAdd(props, queued.request);

      settings = await (
        dependencies.getSettings ||
        ((
          row: NetworkControllerConnection,
        ): Promise<NetworkControllerSettings> => {
          return NetworkControllerConnectionService.getControllerSettings(row);
        })
      )(connection);

      const listing: NetworkControllerDeviceListing = await (
        dependencies.listDevices ||
        ((
          connectorSettings: NetworkControllerSettings,
          options: NetworkControllerListOptions,
        ): Promise<NetworkControllerDeviceListing> => {
          return NetworkControllerConnectorRegistry.getConnector(
            connectorSettings.provider,
          ).listDevices(connectorSettings, options);
        })
      )(settings, {
        transport:
          dependencies.transport ||
          DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        now: clock,
        sleep: dependencies.sleep,
        maxRequests: DEVICE_ADD_LIST_MAX_REQUESTS,
        maxDurationMs: DEVICE_ADD_LIST_MAX_DURATION_MS,
      });

      const inventoryConnection: ControllerInventoryConnection = {
        id: connectionId.toString(),
        name:
          connection.name ||
          listing.organizationName ||
          readNetworkControllerConfig(connection.config).organizationName,
        provider: settings.provider,
      };

      const plan: ControllerDeviceAddPlan =
        await NetworkControllerDeviceAddRunner.plan({
          projectId,
          connectionId,
          devices: listing.devices,
          request: queued.request,
          dependencies,
        });

      state.toAddCount = plan.toAdd.length;
      state.withoutAddressCount = plan.withoutAddressCount;
      state.takenCount = plan.takenCount;
      state.archivedCount = plan.archivedCount;
      state.remainingCount = plan.remainingCount;
      state.updatedAt = clock().toISOString();
      await write(state);

      if (plan.toAdd.length > 0) {
        const siteIdBySerial: Map<string, string> = queued.request.groupBySite
          ? await NetworkControllerDeviceAddRunner.ensureSites({
              projectId,
              devices: plan.toAdd,
              props,
              state,
              dependencies,
            })
          : new Map<string, string>();

        const roleIds: Map<string, string> = await (
          dependencies.findRoleIds || NetworkControllerDeviceAddRunner.findRoleIds
        )(projectId);

        const names: Map<string, string> = planControllerDeviceNames({
          devices: plan.toAdd,
          takenNames: await (
            dependencies.findTakenNames ||
            NetworkControllerDeviceAddRunner.findTakenNames
          )({
            projectId,
            names: NetworkControllerDeviceAddRunner.getNameCandidates(
              plan.toAdd,
            ),
          }),
        });

        const createDevice: CreateDeviceFunction =
          dependencies.createDevice ||
          (async (create: {
            device: NetworkDevice;
            props: DatabaseCommonInteractionProps;
          }): Promise<void> => {
            await NetworkDeviceService.create({
              data: create.device,
              props: create.props,
            });
          });

        const readAt: Date = clock();
        let lastFlushAt: number = clock().getTime();

        for (const device of plan.toAdd) {
          // Who asked is read again now and then: a lost right stops the adds.
          if (
            clock().getTime() - propsReadAt >=
            DEVICE_ADD_PERMISSION_REFRESH_MS
          ) {
            props = await readProps({ userId, projectId });
            propsReadAt = clock().getTime();
            NetworkControllerDeviceAddRunner.assertMayAdd(props, {
              ...queued.request,
              groupBySite: false,
            });
          }

          const roleKey: string | undefined =
            getControllerDeviceRoleKey(device);
          const roleId: string | undefined = roleKey
            ? roleIds.get(roleKey)
            : undefined;
          const siteId: string | undefined = siteIdBySerial.get(device.serial);
          const build: (name: string) => NetworkDevice = (
            name: string,
          ): NetworkDevice => {
            return buildNetworkDeviceFromController({
              projectId,
              device,
              name,
              connection: inventoryConnection,
              readAt,
              ...(roleId ? { roleId: new ObjectID(roleId) } : {}),
              ...(siteId ? { siteId: new ObjectID(siteId) } : {}),
              ...(queued.request.probeId
                ? { probeId: new ObjectID(queued.request.probeId) }
                : {}),
            });
          };

          const name: string =
            names.get(device.serial) || getControllerDeviceBaseName(device);

          try {
            await NetworkControllerDeviceAddRunner.createUnderName({
              build,
              name,
              device,
              props,
              createDevice,
            });
            state.addedCount++;
          } catch (error) {
            if (isRefusalOfThePerson(error)) {
              throw error;
            }

            state.failedCount++;

            if (state.failures.length < MAX_DEVICE_ADD_FAILURES_KEPT) {
              state.failures.push({
                name: name.substring(0, MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH),
                reason: toReason(error),
              });
            }
          }

          if (clock().getTime() - lastFlushAt >= DEVICE_ADD_FLUSH_INTERVAL_MS) {
            state.updatedAt = clock().toISOString();
            await write(state);
            lastFlushAt = clock().getTime();
          }
        }
      }

      state.status = NetworkControllerDeviceAddStatus.Done;
      state.updatedAt = clock().toISOString();
      state.finishedAt = state.updatedAt;
      await write(state);
    } catch (error) {
      state.status = NetworkControllerDeviceAddStatus.Failed;
      state.message = NetworkControllerDeviceAddRunner.toFailureMessage(
        error,
        settings,
      );
      state.updatedAt = clock().toISOString();
      state.finishedAt = state.updatedAt;
      await write(state);
    }

    /*
     * The devices it added are read at once: their clients and links go on
     * the map, and the connection's row counts what is still left to add.
     */
    if (state.addedCount > 0) {
      try {
        await (
          dependencies.enqueueRead ||
          ((id: ObjectID, now: Date): Promise<void> => {
            return NetworkControllerScheduler.enqueue(id, now);
          })
        )(connectionId, clock());
      } catch (error) {
        logger.error(
          `Network controller connection ${connectionId.toString()}: a read after adding devices could not be queued: ${toReason(error)}`,
        );
      }
    }

    return { status: state.status, state };
  }

  /*
   * Which devices of the listing this ask adds: the inventory's matching of
   * the project's devices, then every device here that holds one of the
   * listing's identities (archived ones too), then the verdicts.
   */
  public static async plan(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    devices: Array<NetworkControllerDevice>;
    request: NetworkControllerDeviceAddRequest;
    dependencies?: NetworkControllerDeviceAddDependencies | undefined;
  }): Promise<ControllerDeviceAddPlan> {
    const dependencies: NetworkControllerDeviceAddDependencies =
      data.dependencies || {};
    const lookup: ControllerInventoryLookup = getControllerInventoryLookup(
      data.devices,
    );

    const candidates: Array<ControllerInventoryCandidate> = await (
      dependencies.findCandidates ||
      ((query: {
        projectId: ObjectID;
        connectionId: ObjectID;
        lookup: ControllerInventoryLookup;
        limit: number;
      }): Promise<Array<ControllerInventoryCandidate>> => {
        return NetworkDeviceService.findControllerMatchCandidates(query);
      })
    )({
      projectId: data.projectId,
      connectionId: data.connectionId,
      lookup,
      limit: MAX_INVENTORY_CANDIDATES,
    });

    const matches: Map<string, ControllerInventoryMatch> =
      matchControllerDevices({ devices: data.devices, candidates });

    const holders: Array<ControllerIdentityHolder> = await (
      dependencies.findHolders || NetworkControllerDeviceAddRunner.findHolders
    )({
      projectId: data.projectId,
      lookup: getControllerIdentityLookup(data.devices),
      limit: MAX_INVENTORY_CANDIDATES,
    });

    const verdicts: Map<string, ControllerDeviceAddVerdict> =
      judgeControllerDevices({ devices: data.devices, matches, holders });

    return planControllerDeviceAdd({
      devices: data.devices,
      verdicts,
      productTypes: data.request.productTypes,
      limit: MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
    });
  }

  // The project's devices that hold one of these identities.
  public static async findHolders(data: {
    projectId: ObjectID;
    lookup: ControllerIdentityLookup;
    limit: number;
  }): Promise<Array<ControllerIdentityHolder>> {
    return await NetworkDeviceService.findControllerIdentityHolders({
      projectId: data.projectId,
      serials: data.lookup.serials,
      macs: data.lookup.macs,
      addresses: data.lookup.addresses,
      limit: data.limit,
    });
  }

  /*
   * Refused unless the person may create network devices - and sites, when
   * the ask puts the devices in sites.
   */
  public static assertMayAdd(
    props: DatabaseCommonInteractionProps,
    request: NetworkControllerDeviceAddRequest,
  ): void {
    try {
      ModelPermission.checkCreatePermissions(
        NetworkDevice,
        new NetworkDevice(),
        props,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(DEVICE_ADD_MAY_NOT_CREATE_DEVICES);
      }

      throw error;
    }

    if (!request.groupBySite) {
      return;
    }

    try {
      ModelPermission.checkCreatePermissions(
        NetworkSite,
        new NetworkSite(),
        props,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(DEVICE_ADD_MAY_NOT_CREATE_SITES);
      }

      throw error;
    }
  }

  /*
   * Every name a device may be given (getControllerDeviceNameChoices), in
   * lower case: what the project's taken names are looked up among.
   */
  public static getNameCandidates(
    devices: Array<NetworkControllerDevice>,
  ): Array<string> {
    const names: Set<string> = new Set<string>();

    for (const device of devices) {
      for (const choice of getControllerDeviceNameChoices(device)) {
        names.add(choice.toLowerCase());
      }
    }

    return Array.from(names);
  }

  // The project's device names among these, in lower case.
  public static async findTakenNames(data: {
    projectId: ObjectID;
    names: Array<string>;
  }): Promise<Set<string>> {
    const taken: Set<string> = new Set<string>();

    for (const chunk of chunks(data.names, LOOKUP_CHUNK_SIZE)) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameTextAnyOf(chunk),
        },
        select: { name: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const device of devices) {
        if (device.name) {
          taken.add(device.name.trim().toLowerCase());
        }
      }
    }

    return taken;
  }

  // The project's sites of these names.
  public static async findSitesByName(data: {
    projectId: ObjectID;
    names: Array<string>;
  }): Promise<Array<{ id: string; name: string }>> {
    const found: Array<{ id: string; name: string }> = [];

    for (const chunk of chunks(data.names, LOOKUP_CHUNK_SIZE)) {
      const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameTextAnyOf(chunk),
        },
        select: { _id: true, name: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const site of sites) {
        if (site.id && site.name) {
          found.push({ id: site.id.toString(), name: site.name });
        }
      }
    }

    return found;
  }

  // The project's device roles, id by key.
  public static async findRoleIds(
    projectId: ObjectID,
  ): Promise<Map<string, string>> {
    const roles: Array<NetworkDeviceRole> =
      await NetworkDeviceRoleService.findBy({
        query: { projectId },
        select: { _id: true, key: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    const ids: Map<string, string> = new Map();

    for (const role of roles) {
      if (role.id && role.key && !ids.has(role.key)) {
        ids.set(role.key, role.id.toString());
      }
    }

    return ids;
  }

  /*
   * The site each device goes into, by its serial number: the project's site
   * named after its Meraki network, added first when there is none. A site
   * that cannot be added - another one of its name was added meanwhile, say
   * - is looked up again; its devices are added without a site when it is
   * still not there, and the reason is kept.
   */
  private static async ensureSites(data: {
    projectId: ObjectID;
    devices: Array<NetworkControllerDevice>;
    props: DatabaseCommonInteractionProps;
    state: NetworkControllerDeviceAddState;
    dependencies: NetworkControllerDeviceAddDependencies;
  }): Promise<Map<string, string>> {
    const findSites: FindSitesByNameFunction =
      data.dependencies.findSites ||
      NetworkControllerDeviceAddRunner.findSitesByName;
    const names: Array<string> = getControllerSiteNames(data.devices);
    const idByName: Map<string, string> = new Map();

    for (const site of await findSites({
      projectId: data.projectId,
      names,
    })) {
      idByName.set(site.name.trim().toLowerCase(), site.id);
    }

    const sitePlan: ControllerSitePlan = planControllerSites({
      devices: data.devices,
      existingSiteNames: new Set<string>(idByName.keys()),
    });

    const createSite: CreateSiteFunction =
      data.dependencies.createSite ||
      (async (create: {
        projectId: ObjectID;
        name: string;
        address: string;
        props: DatabaseCommonInteractionProps;
      }): Promise<string> => {
        const site: NetworkSite = new NetworkSite();
        site.projectId = create.projectId;
        site.name = create.name;

        if (create.address) {
          site.address = create.address;
        }

        const created: NetworkSite = await NetworkSiteService.create({
          data: site,
          props: create.props,
        });

        return created.id!.toString();
      });

    for (const site of sitePlan.sitesToCreate) {
      try {
        const id: string = await createSite({
          projectId: data.projectId,
          name: site.name,
          address: site.address,
          props: data.props,
        });
        idByName.set(site.name.toLowerCase(), id);
        data.state.createdSiteCount++;
      } catch (error) {
        if (isRefusalOfThePerson(error)) {
          throw error;
        }

        const again: Array<{ id: string; name: string }> = await findSites({
          projectId: data.projectId,
          names: [site.name],
        });

        if (again[0]) {
          idByName.set(site.name.toLowerCase(), again[0].id);
          continue;
        }

        logger.error(
          `Network controller device add: the site "${site.name}" could not be added: ${toReason(error)}`,
        );
      }
    }

    const siteIdBySerial: Map<string, string> = new Map();

    for (const [serial, name] of sitePlan.siteNameBySerial) {
      const id: string | undefined = idByName.get(name.toLowerCase());

      if (id) {
        siteIdBySerial.set(serial, id);
      }
    }

    return siteIdBySerial;
  }

  /*
   * One device, created under its planned name - and, when another device
   * took that name meanwhile, once more under its serial number's.
   */
  private static async createUnderName(data: {
    build: (name: string) => NetworkDevice;
    name: string;
    device: NetworkControllerDevice;
    props: DatabaseCommonInteractionProps;
    createDevice: CreateDeviceFunction;
  }): Promise<void> {
    try {
      await data.createDevice({
        device: data.build(data.name),
        props: data.props,
      });
    } catch (error) {
      if (!isNameTaken(error)) {
        throw error;
      }

      const choices: Array<string> = getControllerDeviceNameChoices(
        data.device,
      );
      const fallback: string = choices[choices.length - 1] || data.name;

      if (fallback.toLowerCase() === data.name.toLowerCase()) {
        throw new BadDataException(DEVICE_ADD_NAME_TAKEN_REASON);
      }

      try {
        await data.createDevice({
          device: data.build(fallback),
          props: data.props,
        });
      } catch (second) {
        throw isNameTaken(second)
          ? new BadDataException(DEVICE_ADD_NAME_TAKEN_REASON)
          : second;
      }
    }
  }

  // What the connection's row says when the ask failed as a whole.
  private static toFailureMessage(
    error: unknown,
    settings: NetworkControllerSettings | null,
  ): string {
    if (
      error instanceof BadDataException ||
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    ) {
      return toReason(error);
    }

    return toReason(
      LlmProviderError.from({
        error,
        step: "list of devices",
        providerTitle: "Meraki",
        secretValues: settings ? [settings.apiKey] : [],
      }),
    );
  }

  // The bookkeeping write: guarded, so a failure to record never escapes.
  private static async writeState(
    data: {
      connectionId: ObjectID;
      state: NetworkControllerDeviceAddState;
    },
    dependencies: NetworkControllerDeviceAddDependencies,
  ): Promise<void> {
    try {
      if (dependencies.writeState) {
        await dependencies.writeState(data);
        return;
      }

      await NetworkControllerConnectionService.updateOneById({
        id: data.connectionId,
        data: {
          lastDeviceAdd: toNetworkControllerDeviceAddStateJson(
            data.state,
          ) as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `Network controller connection ${data.connectionId.toString()}: how adding its devices went could not be recorded: ${toReason(error)}`,
      );
    }
  }
}
