import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../Types/ObjectID";
import GlobalCache from "../../Infrastructure/GlobalCache";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudResourceService from "../../Services/CloudResourceService";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import logger from "../Logger";
import CloudChangeRecorder, {
  CloudChangeRecordOutcome,
} from "./CloudChangeRecorder";
import CloudConnectionPullRunner from "./CloudConnectionPullRunner";
import CloudConnectorRegistry from "./CloudConnectorRegistry";
import {
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorTransport,
  CloudReadBudget,
} from "./CloudConnectorTypes";

/*
 * WHAT CHANGED IN A RESOURCE'S CLOUD, READ THE MOMENT AN INVESTIGATION
 * STARTS.
 *
 * A connection reads its accounts' activity logs on its own interval -
 * every ten minutes, say - and CloudTrail delivers up to fifteen minutes
 * late, so the change that broke the resource an incident opened a minute
 * ago is often not a change event yet when OneUptime AI starts looking.
 * So when an incident or alert linked to cloud resources is investigated,
 * the accounts those resources are in are read once more, there and then:
 *
 *   - only those accounts, and only the Regions the resources are in;
 *   - from LOOK_BACK_MINUTES before the subject opened (the window the
 *     investigation reads changes from) to now;
 *   - with a copy of the connection's read state, so no cursor moves - the
 *     regular reads carry on exactly as before;
 *   - within a small budget of its own (LOOK_BACK_MAX_REQUESTS a
 *     connection, LOOK_BACK_MAX_DURATION_MS each);
 *   - once per subject in LOOK_BACK_FENCE_SECONDS, however many reads of
 *     its changes ask (an investigation, then a remediation decision).
 *
 * What it finds is written like any change: CloudChangeRecorder claims
 * each one, so the regular read that later brings the same change in does
 * not write it twice. It never throws: an investigation goes on with the
 * changes already written.
 */

export const LOOK_BACK_MAX_REQUESTS: number = 60;
export const LOOK_BACK_MAX_DURATION_MS: number = 20 * 1000;
// The connections and resources one look back reads at most.
export const LOOK_BACK_MAX_CONNECTIONS: number = 5;
export const LOOK_BACK_MAX_RESOURCES: number = 20;
// One look back per subject in this long.
export const LOOK_BACK_FENCE_SECONDS: number = 10 * 60;
const LOOK_BACK_FENCE_NAMESPACE: string = "cloud-change-look-back";

export interface CloudChangeLookBackOutcome {
  // Connections read.
  connections: number;
  // Change events written.
  recorded: number;
  // Why nothing was read, when nothing was.
  skipped?:
    | "no-cloud-resources"
    | "no-connection"
    | "not-allowed"
    | "already-read"
    | undefined;
}

interface LookBackDependencies {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

/*
 * The accounts and Regions of the resources one connection reads, as
 * readChanges' `only` takes them.
 */
export function getLookBackPlaces(
  resources: Array<{ accountId: string; region: string }>,
): Array<{ accountId: string; regions: Array<string> }> {
  const byAccount: Map<string, Set<string>> = new Map();

  for (const resource of resources) {
    const accountId: string = resource.accountId.trim();

    if (!accountId) {
      continue;
    }

    const regions: Set<string> = byAccount.get(accountId) || new Set<string>();
    const region: string = resource.region.trim();

    if (region && region.toLowerCase() !== "global") {
      regions.add(region);
    }

    byAccount.set(accountId, regions);
  }

  return Array.from(byAccount.entries()).map(
    ([accountId, regions]: [string, Set<string>]) => {
      return { accountId, regions: Array.from(regions) };
    },
  );
}

export default class CloudChangeLookBack {
  public static async readForSubject(
    data: {
      projectId: ObjectID;
      // The incident's or alert's id: one look back for it in a while.
      subjectId: ObjectID;
      cloudResourceIds: Array<string>;
      // Read from here: the start of the window the investigation reads.
      since: Date;
    },
    dependencies: LookBackDependencies = {},
  ): Promise<CloudChangeLookBackOutcome> {
    const ids: Array<string> = Array.from(
      new Set(
        data.cloudResourceIds.filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
      ),
    ).slice(0, LOOK_BACK_MAX_RESOURCES);

    if (ids.length === 0) {
      return { connections: 0, recorded: 0, skipped: "no-cloud-resources" };
    }

    try {
      if (!(await CloudChangeLookBack.claimSubject(data.subjectId))) {
        return { connections: 0, recorded: 0, skipped: "already-read" };
      }

      if (!(await LlmConnectionPullRunner.isTelemetryAllowed(data.projectId))) {
        return { connections: 0, recorded: 0, skipped: "not-allowed" };
      }

      // Pinned to the project: the ids are the subject's, read as the system.
      const resources: Array<CloudResource> = await CloudResourceService.findBy(
        {
          query: {
            projectId: data.projectId,
            _id: new Includes(ids),
          },
          select: {
            _id: true,
            cloudProvider: true,
            cloudAccountId: true,
            cloudRegion: true,
            cloudConnectionId: true,
          },
          skip: 0,
          limit: LOOK_BACK_MAX_RESOURCES,
          props: { isRoot: true },
        },
      );

      const byConnection: Map<string, Array<CloudResource>> = new Map();

      for (const resource of resources) {
        const connectionId: string =
          resource.cloudConnectionId?.toString() || "";

        if (!connectionId || !resource.cloudAccountId) {
          continue;
        }

        const list: Array<CloudResource> = byConnection.get(connectionId) || [];
        list.push(resource);
        byConnection.set(connectionId, list);
      }

      if (byConnection.size === 0) {
        return { connections: 0, recorded: 0, skipped: "no-connection" };
      }

      let connections: number = 0;
      let recorded: number = 0;

      for (const [connectionId, held] of Array.from(
        byConnection.entries(),
      ).slice(0, LOOK_BACK_MAX_CONNECTIONS)) {
        const written: number | null = await CloudChangeLookBack.readConnection(
          {
            projectId: data.projectId,
            connectionId: new ObjectID(connectionId),
            resources: held,
            since: data.since,
          },
          dependencies,
        );

        if (written !== null) {
          connections++;
          recorded += written;
        }
      }

      return { connections, recorded };
    } catch (error) {
      logger.error(
        `Cloud changes of project ${data.projectId.toString()} could not be read for an investigation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { connections: 0, recorded: 0 };
    }
  }

  /*
   * One connection's accounts read back from `since`: the changes written,
   * or null when the connection could not be read (disabled, not found, or
   * a cloud without an activity log reader).
   */
  private static async readConnection(
    data: {
      projectId: ObjectID;
      connectionId: ObjectID;
      resources: Array<CloudResource>;
      since: Date;
    },
    dependencies: LookBackDependencies,
  ): Promise<number | null> {
    try {
      const connection: CloudConnection | null =
        await CloudConnectionService.findOneBy({
          query: {
            _id: data.connectionId,
            projectId: data.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
            secrets: true,
            isEnabled: true,
            pullState: true,
          },
          props: { isRoot: true },
        });

      if (!connection || !connection.isEnabled || !connection.provider) {
        return null;
      }

      const connector: CloudConnector = CloudConnectorRegistry.getConnector(
        connection.provider,
      );

      if (!connector.readChanges) {
        return null;
      }

      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);
      // A copy: a look back moves nothing of the regular reads'.
      const state: CloudConnectionPullState = JSON.parse(
        JSON.stringify(
          CloudConnectionPullRunner.readPullState(connection.pullState),
        ),
      ) as CloudConnectionPullState;

      const result: CloudChangesResult = await connector.readChanges(settings, {
        transport:
          dependencies.transport ||
          DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        now: dependencies.now,
        sleep: dependencies.sleep,
        state,
        connectionId: data.connectionId.toString(),
        budget: new CloudReadBudget({
          maxRequests: LOOK_BACK_MAX_REQUESTS,
          maxDurationMs: LOOK_BACK_MAX_DURATION_MS,
        }),
        since: data.since,
        only: getLookBackPlaces(
          data.resources.map((resource: CloudResource) => {
            return {
              accountId: resource.cloudAccountId || "",
              region: resource.cloudRegion || "",
            };
          }),
        ),
      });

      const outcome: CloudChangeRecordOutcome =
        await CloudChangeRecorder.record({
          projectId: data.projectId,
          provider: connection.provider as CloudProvider,
          changes: result.changes,
        });

      return outcome.recorded;
    } catch (error) {
      logger.error(
        `Cloud connection ${data.connectionId.toString()}: its changes could not be read for an investigation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  /*
   * True for the first look back of a subject in LOOK_BACK_FENCE_SECONDS.
   * A cache that does not answer lets every one through.
   */
  private static async claimSubject(subjectId: ObjectID): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfNotExists(
        LOOK_BACK_FENCE_NAMESPACE,
        subjectId.toString(),
        "1",
        { expiresInSeconds: LOOK_BACK_FENCE_SECONDS },
      );
    } catch {
      return true;
    }
  }
}
