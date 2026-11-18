import {
  NO_STATUS_PAGE_EDIT_REACH,
  StatusPageEditReach,
  StatusPageSetupLabel,
  StatusPageSetupMonitor,
  StatusPageSetupMonitorGroup,
  StatusPageSetupPage,
  getStatusPageNameIdentity,
  isSameStatusPageName,
  mayEditStatusPage,
} from "./StatusPageSetup";
import bulkAddStatusPageMonitorGroups, {
  BulkAddStatusPageMonitorGroupsResult,
} from "../../StatusPage/BulkAddStatusPageMonitorGroups";
import bulkAddStatusPageMonitors, {
  BulkAddStatusPageMonitorsResult,
} from "../../StatusPage/BulkAddStatusPageMonitors";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "Common/Types/HeldPermissions";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
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
  /*
   * Its Page Title, if it has one: with the name, what its visitors read it
   * as (StatusPagePublicName), and what the preview shows (#7467).
   */
  pageTitle?: string | undefined;
}

// What a page's Page Title is read back as: nothing for none.
const pageTitleOf: (page: StatusPage) => string | undefined = (
  page: StatusPage,
): string | undefined => {
  return page.pageTitle?.trim() || undefined;
};

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

/*
 * How many of the project's newest status pages step 1 offers (#7517): a
 * picker of names, newest first. A project with more finds the older ones
 * on Status Pages.
 */
export const PROJECT_STATUS_PAGES_READ_LIMIT: number = 100;

// A record's labels as the list names them, or nothing for none.
const labelsOf: (
  labels: Array<Label> | undefined,
) => Array<StatusPageSetupLabel> | undefined = (
  labels: Array<Label> | undefined,
): Array<StatusPageSetupLabel> | undefined => {
  const named: Array<StatusPageSetupLabel> = (labels || [])
    .filter((label: Label): boolean => {
      return Boolean(label._id && label.name);
    })
    .map((label: Label): StatusPageSetupLabel => {
      return {
        id: label._id!.toString(),
        name: label.name || "",
        color: label.color?.toString() || undefined,
      };
    });

  return named.length > 0 ? named : undefined;
};

// An id as a permission row or a record carries it, compared in any case.
const idText: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "";
  }

  // An ObjectID read back from storage without its type: { value }.
  if (
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return String((value as { value: unknown }).value).toLowerCase();
  }

  return String(value).toLowerCase();
};

/*
 * WHICH STATUS PAGES THIS PERSON MAY CHANGE (#7517): the grants and blocks
 * of their permission rows that weigh a change of a status page - its own
 * update permissions and the operational wildcard while it grants
 * (HeldPermissionsUtil, as the server counts them) - read for the reach
 * each one gives (StatusPageEditReach). Adding a monitor to a page also
 * needs Create on its resources. A master admin changes every page; someone
 * the snapshot refuses either, none.
 */
export const getStatusPageEditReach: () => StatusPageEditReach =
  (): StatusPageEditReach => {
    if (UserUtil.isMasterAdmin()) {
      return { ...NO_STATUS_PAGE_EDIT_REACH, isProjectWide: true };
    }

    if (
      !PermissionGate.check(new StatusPage(), ModelAction.Update).isAllowed ||
      !PermissionGate.check(new StatusPageResource(), ModelAction.Create)
        .isAllowed
    ) {
      return NO_STATUS_PAGE_EDIT_REACH;
    }

    const updatePermissions: Array<Permission> =
      PermissionGate.getModelPermissions(new StatusPage(), ModelAction.Update);
    const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
      isOperationalResource: new StatusPage().isOperationalResource,
      operation: "update",
    });
    const held: HeldPermissions = PermissionGate.getHeldPermissions();
    const granting: Array<Permission> =
      HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: updatePermissions,
        wildcard: wildcard,
      });
    const blocking: Array<Permission> =
      HeldPermissionsUtil.getLabelBlockingPermissions(held, {
        modelPermissions: updatePermissions,
        wildcard: wildcard,
      });
    const reach: StatusPageEditReach = {
      isProjectWide: granting.some((permission: Permission): boolean => {
        return held.allowedProjectWide.includes(permission);
      }),
      labelIds: [],
      reachesOwned: false,
      blockedLabelIds: [],
    };

    const rows: Array<UserPermission> =
      PermissionUtil.getProjectPermissions()?.permissions || [];

    for (const row of rows) {
      if (!row || !row.permission) {
        continue;
      }

      const labelIds: Array<string> = (row.labelIds || [])
        .map(idText)
        .filter(Boolean);

      if (HeldPermissionsUtil.isBlockRow(row)) {
        if (blocking.includes(row.permission)) {
          reach.blockedLabelIds.push(...labelIds);
        }
        continue;
      }

      if (!granting.includes(row.permission)) {
        continue;
      }

      if (PermissionHelper.isLimitedToLabels(row)) {
        reach.labelIds.push(...labelIds);
      } else if (
        row.scope === PermissionScope.Owned &&
        PermissionHelper.isScopeApplicable(row.permission)
      ) {
        reach.reachesOwned = true;
      }
    }

    return reach;
  };

/*
 * The teams whose pages a grant limited to owned records reaches: the
 * teams of the rows that grant it - never the person's other teams
 * (UserPermission.scope).
 */
const getOwnedScopeTeamIds: () => Array<string> = (): Array<string> => {
  const updatePermissions: Array<Permission> =
    PermissionGate.getModelPermissions(new StatusPage(), ModelAction.Update);
  const teamIds: Array<string> = [];

  for (const row of PermissionUtil.getProjectPermissions()?.permissions || []) {
    const teamId: string = idText(row?.teamId);

    if (
      row &&
      HeldPermissionsUtil.isAllowRow(row) &&
      row.scope === PermissionScope.Owned &&
      (updatePermissions.includes(row.permission) ||
        row.permission === Permission.EditAllOperationalResources) &&
      teamId &&
      !teamIds.includes(teamId)
    ) {
      teamIds.push(teamId);
    }
  }

  return teamIds;
};

export default class StatusPageSetupApi {
  // The project's monitors, by name, with their current status and labels.
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
        labels: {
          _id: true,
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
          labels: labelsOf(monitor.labels),
        };
      });
  }

  /*
   * The project's monitor groups, by name, with their labels (#7147): each
   * is put on the page as one row. A read the person may not make throws,
   * and the step lists monitors alone.
   */
  public static async loadMonitorGroups(): Promise<
    Array<StatusPageSetupMonitorGroup>
  > {
    const result: ListResult<MonitorGroup> =
      await ModelAPI.getList<MonitorGroup>({
        modelType: MonitorGroup,
        query: {
          projectId: getProjectId(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          labels: {
            _id: true,
            name: true,
            color: true,
          },
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    return result.data
      .filter((group: MonitorGroup): boolean => {
        return Boolean(group._id);
      })
      .map((group: MonitorGroup): StatusPageSetupMonitorGroup => {
        return {
          id: group._id!.toString(),
          name: group.name || "",
          labels: labelsOf(group.labels),
        };
      });
  }

  /*
   * THE PROJECT'S STATUS PAGES THIS PERSON MAY CHANGE (#7517), newest
   * first, archived ones left out: the pages step 1 offers before it makes
   * a new one. A page a teammate made is offered too - it is the project's
   * page - but never one the person may only read (getStatusPageEditReach):
   * the monitors would not be added. Someone who may change none reads
   * nothing here.
   */
  public static async loadEditableStatusPages(): Promise<
    Array<StatusPageSetupPage>
  > {
    const reach: StatusPageEditReach = getStatusPageEditReach();

    if (
      !reach.isProjectWide &&
      reach.labelIds.length === 0 &&
      !reach.reachesOwned
    ) {
      return [];
    }

    const pages: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>({
      modelType: StatusPage,
      query: {
        projectId: getProjectId(),
      },
      limit: PROJECT_STATUS_PAGES_READ_LIMIT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        pageTitle: true,
        isArchived: true,
        labels: {
          _id: true,
        },
      },
      sort: { createdAt: SortOrder.Descending },
    });

    const live: Array<StatusPage> = pages.data.filter(
      (page: StatusPage): boolean => {
        return Boolean(page._id) && !page.isArchived;
      },
    );

    const ownedIds: Array<string> =
      reach.reachesOwned && !reach.isProjectWide && live.length > 0
        ? await StatusPageSetupApi.loadOwnedStatusPageIds(
            live.map((page: StatusPage): string => {
              return page._id!.toString();
            }),
          )
        : [];

    return live
      .map((page: StatusPage): StatusPageSetupPage => {
        return {
          id: page._id!.toString(),
          name: page.name || "",
          pageTitle: pageTitleOf(page),
          labelIds: (page.labels || [])
            .map((label: Label): string => {
              return idText(label._id);
            })
            .filter(Boolean),
        };
      })
      .filter((page: StatusPageSetupPage): boolean => {
        return mayEditStatusPage({
          reach: reach,
          labelIds: page.labelIds || [],
          isOwned: ownedIds.includes(page.id.toLowerCase()),
        });
      });
  }

  /*
   * Which of `statusPageIds` this person owns, or a team of the rows that
   * grant them a change limited to owned records owns.
   */
  public static async loadOwnedStatusPageIds(
    statusPageIds: Array<string>,
  ): Promise<Array<string>> {
    const userId: string = UserUtil.getUserId()?.toString() || "";
    const teamIds: Array<string> = getOwnedScopeTeamIds();
    const pageIds: Array<ObjectID> = statusPageIds.map(
      (pageId: string): ObjectID => {
        return new ObjectID(pageId);
      },
    );

    const [byUser, byTeam]: [
      ListResult<StatusPageOwnerUser>,
      ListResult<StatusPageOwnerTeam>,
    ] = await Promise.all([
      userId
        ? ModelAPI.getList<StatusPageOwnerUser>({
            modelType: StatusPageOwnerUser,
            query: {
              projectId: getProjectId(),
              userId: new ObjectID(userId),
              statusPageId: new Includes(pageIds),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { _id: true, statusPageId: true },
            sort: {},
          })
        : Promise.resolve({
            data: [],
            count: 0,
            skip: 0,
            limit: 0,
          } as ListResult<StatusPageOwnerUser>),
      teamIds.length > 0
        ? ModelAPI.getList<StatusPageOwnerTeam>({
            modelType: StatusPageOwnerTeam,
            query: {
              projectId: getProjectId(),
              teamId: new Includes(
                teamIds.map((teamId: string): ObjectID => {
                  return new ObjectID(teamId);
                }),
              ),
              statusPageId: new Includes(pageIds),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { _id: true, statusPageId: true },
            sort: {},
          })
        : Promise.resolve({
            data: [],
            count: 0,
            skip: 0,
            limit: 0,
          } as ListResult<StatusPageOwnerTeam>),
    ]);

    return [...byUser.data, ...byTeam.data]
      .map((owner: StatusPageOwnerUser | StatusPageOwnerTeam): string => {
        return idText(owner.statusPageId);
      })
      .filter(Boolean);
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
      select: { _id: true, name: true, pageTitle: true, isArchived: true },
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

    return {
      id: found._id.toString(),
      name: found.name || "",
      pageTitle: pageTitleOf(found),
    };
  }

  /*
   * The monitors picked, put on the page as Add Multiple Monitors puts them
   * (each a resource named after its monitor, with its current status and
   * its uptime), and the monitor groups picked as Add Multiple Monitor
   * Groups puts them (one row each, #7147), skipping any the page lists
   * already. Throws when nothing could be added, so the step never reads
   * as done on an empty page.
   */
  public static async addMonitors(data: {
    statusPageId: string;
    monitors: Array<StatusPageSetupMonitor>;
    monitorGroups?: Array<StatusPageSetupMonitorGroup> | undefined;
  }): Promise<BulkAddStatusPageMonitorsResult> {
    const groups: Array<StatusPageSetupMonitorGroup> = data.monitorGroups || [];
    const existing: ListResult<StatusPageResource> =
      await ModelAPI.getList<StatusPageResource>({
        modelType: StatusPageResource,
        query: {
          statusPageId: new ObjectID(data.statusPageId),
          projectId: getProjectId(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, monitorId: true, monitorGroupId: true },
        sort: {},
      });

    /*
     * The groups first, as the list draws them: the server orders a page's
     * rows in the order they are made.
     */
    const groupResult: BulkAddStatusPageMonitorGroupsResult | null =
      groups.length > 0
        ? await bulkAddStatusPageMonitorGroups({
            projectId: getProjectId(),
            statusPageId: new ObjectID(data.statusPageId),
            monitorGroups: groups.map(
              (picked: StatusPageSetupMonitorGroup): MonitorGroup => {
                const group: MonitorGroup = new MonitorGroup();
                group._id = picked.id;
                group.name = picked.name;
                return group;
              },
            ),
            existingMonitorGroupIds: existing.data
              .map((resource: StatusPageResource): string => {
                return resource.monitorGroupId?.toString() || "";
              })
              .filter(Boolean),
            resourceOptions: GUIDED_SETUP_RESOURCE_OPTIONS,
          })
        : null;

    const result: BulkAddStatusPageMonitorsResult =
      data.monitors.length > 0
        ? await bulkAddStatusPageMonitors({
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
          })
        : { succeeded: [], skipped: [], failed: [] };

    const added: number =
      result.succeeded.length +
      result.skipped.length +
      (groupResult
        ? groupResult.succeeded.length + groupResult.skipped.length
        : 0);

    if (added === 0) {
      throw (
        result.failed[0]?.error ||
        groupResult?.failed[0]?.error ||
        new Error("No monitor was added.")
      );
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
      select: { _id: true, name: true, pageTitle: true },
    });

    if (!statusPage?._id) {
      return null;
    }

    return {
      id: statusPage._id.toString(),
      name: statusPage.name || "",
      pageTitle: pageTitleOf(statusPage),
    };
  }

  /*
   * What the page shows: its monitors' and monitor groups' names, in the
   * page's order, and which monitors and groups they are - what step 1
   * marks as on the page already (#7517).
   */
  public static async loadShownMonitors(statusPageId: string): Promise<{
    count: number;
    names: Array<string>;
    monitorIds: Array<string>;
    monitorGroupIds: Array<string>;
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
        select: {
          _id: true,
          displayName: true,
          order: true,
          monitorId: true,
          monitorGroupId: true,
        },
        sort: { order: SortOrder.Ascending },
      });

    const idsOf: (key: "monitorId" | "monitorGroupId") => Array<string> = (
      key: "monitorId" | "monitorGroupId",
    ): Array<string> => {
      return result.data
        .map((resource: StatusPageResource): string => {
          return resource[key]?.toString() || "";
        })
        .filter(Boolean);
    };

    return {
      count: result.count ?? result.data.length,
      names: result.data
        .map((resource: StatusPageResource): string => {
          return resource.displayName || "";
        })
        .filter(Boolean),
      monitorIds: idsOf("monitorId"),
      monitorGroupIds: idsOf("monitorGroupId"),
    };
  }
}
