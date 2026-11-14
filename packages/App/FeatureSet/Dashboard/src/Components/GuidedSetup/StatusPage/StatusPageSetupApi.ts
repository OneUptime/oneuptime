import {
  StatusPageSetupMonitor,
  getStatusPageNameIdentity,
  isSameStatusPageName,
} from "./StatusPageSetup";
import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorsResult,
} from "../../StatusPage/BulkAddStatusPageMonitors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  GUIDED_SETUP_RESOURCE_OPTIONS,
  buildGuidedStatusPage,
} from "Common/Utils/GuidedSetup/StatusPageRecords";

/*
 * THE RECORDS THE STATUS PAGE GUIDED SETUP READS AND WRITES (issue #6806),
 * through the same model API Create Status Page and Add Multiple Monitors
 * use, so every permission, plan limit and default the server applies to
 * them applies here too.
 */

export interface StatusPageSetupRecord {
  id: string;
  name: string;
}

// Creating the page and putting monitors on it: both, or the setup cannot.
export const mayCreateStatusPage: () => boolean = (): boolean => {
  return (
    PermissionGate.check(new StatusPage(), ModelAction.Create).isAllowed &&
    PermissionGate.check(new StatusPageResource(), ModelAction.Create).isAllowed
  );
};

const getProjectId: () => ObjectID = (): ObjectID => {
  return ProjectUtil.getCurrentProjectId()!;
};

/*
 * How many of this person's newest status pages are read to find one with
 * a name: the page a lost run made is the newest, and a person the guided
 * setup is for has a handful (as WebsiteDownApi's OWN_MONITORS_READ_LIMIT).
 */
export const OWN_STATUS_PAGES_READ_LIMIT: number = 100;

export default class StatusPageSetupApi {
  // The project's monitors, by name, with their current status.
  public static async loadMonitors(): Promise<Array<StatusPageSetupMonitor>> {
    const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        projectId: getProjectId(),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        currentMonitorStatus: {
          name: true,
          color: true,
        },
      },
      sort: {
        name: SortOrder.Ascending,
      },
    });

    return result.data
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor._id);
      })
      .map((monitor: Monitor): StatusPageSetupMonitor => {
        const status: MonitorStatus | undefined = monitor.currentMonitorStatus;

        return {
          id: monitor._id!.toString(),
          name: monitor.name || "",
          statusName: status?.name || undefined,
          statusColor: status?.color?.toString() || undefined,
        };
      });
  }

  /*
   * The page, as Create Status Page makes it: the name, and everything else
   * the server's defaults (public, at <host>/status-page/<id>).
   */
  public static async createStatusPage(name: string): Promise<string> {
    // Built as Ask AI's publish_status_page builds it (Common).
    const statusPage: StatusPage = buildGuidedStatusPage({
      name: name,
      projectId: getProjectId(),
    });

    const response: HTTPResponse<StatusPage> =
      (await ModelAPI.create<StatusPage>({
        model: statusPage,
        modelType: StatusPage,
      })) as HTTPResponse<StatusPage>;

    const id: string | undefined = response.data?.id?.toString();

    if (!id) {
      throw new Error("The status page was made, but it can't be shown.");
    }

    return id;
  }

  /*
   * The status page this person already made with a name (#7252): one they
   * created - from this setup or from Create Status Page - whose name is the
   * one typed, trimmed and in any case (isSameStatusPageName), and that is
   * not archived (an archived page is offline), the newest first. A run the
   * browser lost - a private window, another device, storage cleared - or a
   * second tab finds the page it made instead of making a second page with
   * the same name. A teammate's page is never taken over. Null when they
   * have none. A read that fails throws, so nothing is made on a guess.
   */
  public static async findOwnStatusPage(data: {
    name: string;
    userId: string;
  }): Promise<StatusPageSetupRecord | null> {
    if (!data.userId || !getStatusPageNameIdentity(data.name)) {
      return null;
    }

    const pages: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>({
      modelType: StatusPage,
      query: {
        projectId: getProjectId(),
        createdByUserId: new ObjectID(data.userId),
      },
      limit: OWN_STATUS_PAGES_READ_LIMIT,
      skip: 0,
      select: { _id: true, name: true, isArchived: true },
      sort: { createdAt: SortOrder.Descending },
    });

    const found: StatusPage | undefined = pages.data.find(
      (page: StatusPage): boolean => {
        return (
          Boolean(page._id) &&
          !page.isArchived &&
          isSameStatusPageName(page.name || "", data.name)
        );
      },
    );

    if (!found?._id) {
      return null;
    }

    return { id: found._id.toString(), name: found.name || "" };
  }

  /*
   * The monitors picked, put on the page as Add Multiple Monitors puts them
   * (each a resource named after its monitor, with its current status and
   * its uptime), skipping any the page lists already. Throws when none of
   * them could be added, so the step never reads as done on an empty page.
   */
  public static async addMonitors(data: {
    statusPageId: string;
    monitors: Array<StatusPageSetupMonitor>;
  }): Promise<BulkAddStatusPageMonitorsResult> {
    const existing: ListResult<StatusPageResource> =
      await ModelAPI.getList<StatusPageResource>({
        modelType: StatusPageResource,
        query: {
          statusPageId: new ObjectID(data.statusPageId),
          projectId: getProjectId(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, monitorId: true },
        sort: {},
      });

    const result: BulkAddStatusPageMonitorsResult =
      await bulkAddStatusPageMonitors({
        projectId: getProjectId(),
        statusPageId: new ObjectID(data.statusPageId),
        monitors: data.monitors.map(
          (picked: StatusPageSetupMonitor): Monitor => {
            const monitor: Monitor = new Monitor();
            monitor._id = picked.id;
            monitor.name = picked.name;
            return monitor;
          },
        ),
        existingMonitorIds: existing.data
          .map((resource: StatusPageResource): string => {
            return resource.monitorId?.toString() || "";
          })
          .filter(Boolean),
        // Shown as Ask AI's publish_status_page shows them (Common).
        resourceOptions: GUIDED_SETUP_RESOURCE_OPTIONS,
      });

    if (result.succeeded.length + result.skipped.length === 0) {
      throw result.failed[0]?.error || new Error("No monitor was added.");
    }

    return result;
  }

  // The page this run made, or null once it is gone.
  public static async loadStatusPage(
    id: string,
  ): Promise<StatusPageSetupRecord | null> {
    const statusPage: StatusPage | null = await ModelAPI.getItem<StatusPage>({
      modelType: StatusPage,
      id: new ObjectID(id),
      select: { _id: true, name: true },
    });

    if (!statusPage?._id) {
      return null;
    }

    return { id: statusPage._id.toString(), name: statusPage.name || "" };
  }

  // What the page shows: its monitors' names, in the page's order.
  public static async loadShownMonitors(statusPageId: string): Promise<{
    count: number;
    names: Array<string>;
  }> {
    const result: ListResult<StatusPageResource> =
      await ModelAPI.getList<StatusPageResource>({
        modelType: StatusPageResource,
        query: {
          statusPageId: new ObjectID(statusPageId),
          projectId: getProjectId(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, displayName: true, order: true },
        sort: { order: SortOrder.Ascending },
      });

    return {
      count: result.count ?? result.data.length,
      names: result.data
        .map((resource: StatusPageResource): string => {
          return resource.displayName || "";
        })
        .filter(Boolean),
    };
  }
}
