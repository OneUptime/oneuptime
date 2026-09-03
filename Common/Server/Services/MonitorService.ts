import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedActiveMonitorCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import { UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { ActiveMonitoringMeteredPlan } from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import MonitorLabelRuleEngineService from "./MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "./MonitorOwnerRuleEngineService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorProbeService from "./MonitorProbeService";
import MonitorStatusService from "./MonitorStatusService";
import ServiceLevelObjectiveMonitorRuleEngineService from "./ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "./StatusPageMonitorRuleEngineService";
import NetworkSiteService from "./NetworkSiteService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "./MonitorStatusTimelineService";
import ServerException from "../../Types/Exception/ServerException";
import Sleep from "../../Types/Sleep";
import ProbeService from "./ProbeService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Typeof from "../../Types/Typeof";
import Model from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "../../Models/DatabaseModels/Probe";
import User from "../../Models/DatabaseModels/User";
import Select from "../Types/Database/Select";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import Dictionary from "../../Types/Dictionary";
import { SMSMessage } from "../../Types/SMS/SMS";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import Query from "../Types/Database/Query";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import StatusPageResourceService from "./StatusPageResourceService";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import MonitorStepsProjectValidator from "../Utils/Monitor/MonitorStepsProjectValidator";
import ProjectScopedReferenceValidator, {
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import MonitorWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Monitor";
import MonitorFeedService from "./MonitorFeedService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Gray500, Green500 } from "../../Types/BrandColors";
import LabelService from "./LabelService";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import Project from "../../Models/DatabaseModels/Project";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import MonitorTemplateService from "./MonitorTemplateService";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";

const MONITOR_TEMPLATE_RELATION_KEYS: Array<string> = [
  "monitorTemplateId",
  "monitorTemplate",
];

export interface MonitorDestinationInfo {
  monitorDestination: string;
  requestType: string;
  monitorType: string;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  private async validateMonitorTemplateReference(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID | undefined;
    monitorType: MonitorType | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException(
        "Project ID is required when linking a monitor template.",
      );
    }

    const monitorTemplate: MonitorTemplate | null =
      await MonitorTemplateService.findOneById({
        id: data.monitorTemplateId,
        select: {
          _id: true,
          projectId: true,
          monitorType: true,
        },
        /*
         * Linking is also a read of the template. Keep the caller's tenant,
         * ownership and label scopes so a generic Monitor write cannot attach
         * a hidden template and expose its configuration through a later sync.
         * Internal callers already use root props and retain that behavior.
         */
        props: data.props,
      });

    if (!monitorTemplate) {
      throw new BadDataException("Monitor template not found.");
    }

    if (
      !monitorTemplate.projectId ||
      monitorTemplate.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "Monitor template must belong to the same project as the monitor.",
      );
    }

    if (!data.monitorType || monitorTemplate.monitorType !== data.monitorType) {
      throw new BadDataException(
        "Monitor template type must match the monitor type.",
      );
    }
  }

  public getMonitorDestinationInfo(monitor: Model): MonitorDestinationInfo {
    let monitorDestination: string = "";
    let requestType: string = "";
    const monitorType: MonitorType | undefined = monitor.monitorType;

    if (monitor.monitorSteps) {
      const monitorSteps: MonitorSteps = monitor.monitorSteps;
      const stepsArray: Array<MonitorStep> =
        monitorSteps.data?.monitorStepsInstanceArray || [];

      if (stepsArray.length > 0) {
        const firstStep: MonitorStep | undefined = stepsArray[0];

        // Get monitor destination
        if (firstStep?.data?.monitorDestination) {
          monitorDestination =
            firstStep.data.monitorDestination.toString() || "";
        }

        // Get request type for API monitors
        if (monitorType === MonitorType.API && firstStep?.data?.requestType) {
          requestType = firstStep.data.requestType;
        }

        // For port monitors, append port to destination
        if (
          monitorType === MonitorType.Port &&
          firstStep?.data?.monitorDestinationPort
        ) {
          const port: string = firstStep.data.monitorDestinationPort.toString();
          if (monitorDestination && port) {
            monitorDestination = `${monitorDestination}:${port}`;
          }
        }

        // For SNMP monitors, use the hostname from snmpMonitor config
        if (
          monitorType === MonitorType.NetworkDevice &&
          firstStep?.data?.snmpMonitor
        ) {
          monitorDestination = firstStep.data.snmpMonitor.hostname || "";
          const port: number = firstStep.data.snmpMonitor.port || 161;
          if (monitorDestination && port) {
            monitorDestination = `${monitorDestination}:${port}`;
          }
        }

        // For DNS monitors, use the queryName from dnsMonitor config
        if (monitorType === MonitorType.DNS && firstStep?.data?.dnsMonitor) {
          monitorDestination = firstStep.data.dnsMonitor.queryName || "";
          if (firstStep.data.dnsMonitor.hostname) {
            monitorDestination = `${monitorDestination} @${firstStep.data.dnsMonitor.hostname}`;
          }
        }

        // For External Status Page monitors, use the statusPageUrl
        if (
          monitorType === MonitorType.ExternalStatusPage &&
          firstStep?.data?.externalStatusPageMonitor
        ) {
          monitorDestination =
            firstStep.data.externalStatusPageMonitor.statusPageUrl || "";
        }

        // For SQL monitors, show host:port/database (never the credentials).
        if (
          monitorType === MonitorType.SQLQuery &&
          firstStep?.data?.sqlMonitor
        ) {
          const sql: {
            host: string;
            port: number;
            databaseName: string;
          } = firstStep.data.sqlMonitor;
          if (sql.host) {
            monitorDestination = `${sql.host}:${sql.port}/${sql.databaseName}`;
          }
        }

        // For Database Health monitors, show host:port/database (never the credentials).
        if (
          monitorType === MonitorType.Database &&
          firstStep?.data?.databaseMonitor
        ) {
          const database: {
            host: string;
            port: number;
            databaseName: string;
          } = firstStep.data.databaseMonitor;
          if (database.host) {
            monitorDestination = `${database.host}:${database.port}/${database.databaseName}`;
          }
        }
      }
    }

    return {
      monitorDestination,
      requestType,
      monitorType: monitorType || "",
    };
  }

  public extractMonitorStepIds(
    monitorSteps: MonitorSteps | JSONObject,
  ): Array<string> {
    const stepIds: Array<string> = [];

    let stepsArray: Array<MonitorStep | JSONObject> = [];

    if (monitorSteps instanceof MonitorSteps) {
      stepsArray = monitorSteps.data?.monitorStepsInstanceArray || [];
    } else if (monitorSteps && typeof monitorSteps === "object") {
      const value: JSONObject | undefined = (monitorSteps as JSONObject)[
        "value"
      ] as JSONObject | undefined;
      const rawArray: unknown = value
        ? value["monitorStepsInstanceArray"]
        : (monitorSteps as JSONObject)["monitorStepsInstanceArray"];

      if (Array.isArray(rawArray)) {
        stepsArray = rawArray as Array<JSONObject>;
      }
    }

    for (const step of stepsArray) {
      let stepId: string | undefined;

      if (step instanceof MonitorStep) {
        stepId = step.data?.id;
      } else if (step && typeof step === "object") {
        const wrappedValue: JSONObject | undefined = (step as JSONObject)[
          "value"
        ] as JSONObject | undefined;
        stepId = (wrappedValue?.["id"] || (step as JSONObject)["id"]) as
          | string
          | undefined;
      }

      if (stepId) {
        stepIds.push(stepId.toString());
      }
    }

    return stepIds;
  }

  public async refreshMonitorCurrentStatus(monitorId: ObjectID): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        _id: true,
        currentMonitorStatusId: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const lastMonitorStatus: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: monitorId,
          endsAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!lastMonitorStatus) {
      return;
    }
    if (!lastMonitorStatus.monitorStatusId) {
      return;
    }

    if (!monitor) {
      return;
    }

    if (
      monitor.currentMonitorStatusId?.toString() !==
      lastMonitorStatus.monitorStatusId.toString()
    ) {
      await this.updateOneById({
        id: monitor.id!,
        data: {
          currentMonitorStatusId: lastMonitorStatus.monitorStatusId,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const monitorsPendingDeletion: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
      },
      props: deleteBy.props,
    });

    for (const monitor of monitorsPendingDeletion) {
      if (!monitor.id) {
        continue;
      }

      // delete all the status page resources for this monitor.
      await StatusPageResourceService.deleteBy({
        query: {
          monitorId: monitor.id,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = monitor.projectId as
        | ObjectID
        | undefined;

      if (!projectId) {
        continue;
      }

      try {
        await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
          projectId: projectId,
          notificationFor: {
            monitorId: monitor.id,
          },
          sendMessageBeforeArchiving: {
            _type: "WorkspacePayloadMarkdown",
            text: `🗑️ This monitor is deleted. The channel is being archived.`,
          },
        });
      } catch (error) {
        logger.error(
          `Error while archiving workspace channels for monitor ${monitor.id?.toString()}: ${error}`,
          {
            projectId: monitor.projectId?.toString(),
            monitorId: monitor.id?.toString(),
          } as LogAttributes,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        monitors: monitorsPendingDeletion,
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    /*
     * The monitor has already been deleted from the database at this point.
     * Any failure in the post-delete side effects below (e.g. billing
     * reporting) must NOT propagate up to the caller as a 500 — otherwise the
     * client sees "500 Internal Server Error" even though the delete actually
     * succeeded. Log and swallow instead.
     *
     * Note: we intentionally do NOT delete Metric rows for this monitor here.
     * The Metric table has a ClickHouse TTL on retentionDate (set at ingest
     * from GlobalConfig.monitorMetricRetentionInDays) that auto-drops rows.
     * A synchronous ALTER TABLE … DELETE on every monitor deletion is both
     * redundant and expensive.
     */
    if (onDelete.deleteBy.props.tenantId && IsBillingEnabled) {
      try {
        await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
          onDelete.deleteBy.props.tenantId,
        );
      } catch (error) {
        logger.error(
          `Error while reporting active monitor quantity to billing provider for project ${onDelete.deleteBy.props.tenantId?.toString()}: ${error}`,
        );
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * currentMonitorStatusId is writable by any project member and its FK is
     * ON DELETE NO ACTION, so an id from another project here leaves that
     * project undeletable — the same shape monitorSteps had. The
     * 1785240000000 migration repaired the rows that existed then; this stops
     * new ones. It stays NO ACTION on purpose: deleting a status monitors are
     * currently in should be blocked, not cascaded.
     */
    const currentMonitorStatusId: ObjectID | string | undefined =
      resolveReferenceId(updateBy.data.currentMonitorStatusId) ||
      resolveReferenceId(updateBy.data.currentMonitorStatus);

    const updateDataKeys: Array<string> = Object.keys(updateBy.data || {});
    const isMonitorStepsWritten: boolean =
      updateDataKeys.includes("monitorSteps");
    const isMonitorTemplateWritten: boolean = RelationIdUtil.isWritten(
      updateDataKeys,
      MONITOR_TEMPLATE_RELATION_KEYS,
    );

    if (isMonitorStepsWritten || isMonitorTemplateWritten) {
      /*
       * Validated per matched monitor rather than per distinct project, because
       * the check needs that monitor's CURRENT monitorSteps: a reference id it
       * already holds is exempt from the existence check, so an update never
       * refuses a monitor that was stored broken before the guard existed. See
       * MonitorStepsProjectValidator.
       */
      const monitors: Array<Model> = await this.findBy({
        query:
          !updateBy.props.isRoot && updateBy.props.tenantId
            ? { ...updateBy.query, projectId: updateBy.props.tenantId }
            : updateBy.query,
        select: {
          projectId: true,
          monitorType: true,
          monitorSteps: true,
          monitorTemplateId: true,
          autoProvisionedNetworkDeviceId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      const writtenMonitorTemplateId: ObjectID | null =
        RelationIdUtil.readConsistent(
          updateBy.data as unknown as Record<string, unknown>,
          MONITOR_TEMPLATE_RELATION_KEYS,
          "Monitor Template",
        );

      for (const monitor of monitors) {
        if (isMonitorStepsWritten) {
          if (updateBy.data.monitorSteps) {
            await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject(
              {
                monitorSteps: updateBy.data.monitorSteps as
                  | MonitorSteps
                  | JSONObject,
                /*
                 * Root/API updates do not always carry a tenantId, so fall back
                 * to the project of the monitor being updated.
                 */
                projectId: updateBy.props.tenantId || monitor.projectId,
                alreadyStoredMonitorSteps: monitor.monitorSteps,
              },
            );
          }

          if (monitor.autoProvisionedNetworkDeviceId) {
            NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice(
              {
                monitorSteps: updateBy.data.monitorSteps as
                  | MonitorSteps
                  | JSONObject,
                networkDeviceId: monitor.autoProvisionedNetworkDeviceId,
              },
            );
          }
        }

        if (isMonitorTemplateWritten) {
          if (monitor.autoProvisionedNetworkDeviceId) {
            const storedTemplateId: string =
              monitor.monitorTemplateId?.toString() || "";
            const writtenTemplateId: string =
              writtenMonitorTemplateId?.toString() || "";

            if (storedTemplateId !== writtenTemplateId) {
              throw new BadDataException(
                "An auto-provisioned monitor cannot be relinked or unlinked from its template. Delete it and let the intended rule recreate it, or create a manual monitor instead.",
              );
            }
          }

          if (writtenMonitorTemplateId) {
            await this.validateMonitorTemplateReference({
              monitorTemplateId: writtenMonitorTemplateId,
              projectId: updateBy.props.tenantId || monitor.projectId,
              monitorType: monitor.monitorType,
              props: updateBy.props,
            });
          }
        }
      }
    }

    if (currentMonitorStatusId) {
      const projectIds: Array<ObjectID> = updateBy.props.tenantId
        ? [updateBy.props.tenantId]
        : await this.getProjectIdsForUpdateQuery(updateBy);

      for (const projectId of projectIds) {
        await ProjectScopedReferenceValidator.validateReferencesBelongToProject(
          {
            projectId: projectId,
            subject: "monitor",
            references: [
              {
                modelName: "Monitor Status",
                id: currentMonitorStatusId,
                service: MonitorStatusService,
              },
            ],
          },
        );
      }
    }

    if (
      updateBy.data.dependsOnMonitors !== undefined ||
      updateBy.data.suppressAlertsWhenParentMonitorStatuses !== undefined
    ) {
      /*
       * The matched monitors' own ids (self/cycle checks) and projects
       * (parent scoping) are needed; root/API updates do not always carry
       * a tenantId. Validation itself is hoisted: the proposed lists are
       * identical for every matched monitor, so existence/project checks
       * run once per distinct project and the cycle walk runs once for
       * all targets — not once per monitor (a bulk update could match
       * thousands).
       */
      const monitorsToValidate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      await this.validateDependencyConfiguration({
        targets: monitorsToValidate.map((monitor: Model) => {
          return {
            monitorId: monitor.id || null,
            projectId: updateBy.props.tenantId || monitor.projectId || null,
          };
        }),
        proposedParents: updateBy.data.dependsOnMonitors,
        proposedSuppressionStatuses:
          updateBy.data.suppressAlertsWhenParentMonitorStatuses,
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Guards for the alert-dependency configuration. `undefined` means "not
   * part of this write" and validates nothing; null or an empty array
   * (clearing the config) is always valid. The proposed lists arrive in
   * whatever shape the API produced — relation objects, ObjectIDs, or
   * bare uuid strings (which DatabaseService.sanitizeCreateOrUpdate only
   * converts to entities AFTER this hook has run) — so extraction goes
   * through resolveReferenceId, and every id comparison is normalized to
   * lower case because Postgres matches uuids case-insensitively while
   * ObjectID preserves the caller's casing.
   */
  public async validateDependencyConfiguration(input: {
    /**
     * The monitors this write applies to. monitorId is null on create —
     * a new monitor cannot be part of a cycle yet.
     */
    targets: Array<{
      monitorId: ObjectID | null;
      projectId: ObjectID | null;
    }>;
    proposedParents: unknown;
    proposedSuppressionStatuses: unknown;
  }): Promise<void> {
    const distinctProjectIds: Array<ObjectID> = [];
    const seenProjectIds: Set<string> = new Set<string>();

    for (const target of input.targets) {
      const key: string | undefined = target.projectId
        ?.toString()
        .trim()
        .toLowerCase();

      if (key && !seenProjectIds.has(key)) {
        seenProjectIds.add(key);
        distinctProjectIds.push(target.projectId!);
      }
    }

    if (input.proposedParents !== undefined) {
      const parentIds: Array<ObjectID> = this.extractRelationIds(
        input.proposedParents,
      );

      if (parentIds.length > 0) {
        const parentIdSet: Set<string> = new Set<string>(
          parentIds.map((id: ObjectID) => {
            return id.toString();
          }),
        );

        for (const target of input.targets) {
          const targetKey: string | undefined = target.monitorId
            ?.toString()
            .trim()
            .toLowerCase();

          if (targetKey && parentIdSet.has(targetKey)) {
            throw new BadDataException("A monitor cannot depend on itself.");
          }
        }

        /*
         * Existence + same-project via the house validator (which owns
         * the case normalization and message wording). Once per distinct
         * project: parents must belong to every matched monitor's
         * project, so a cross-project bulk update correctly fails.
         */
        for (const projectId of distinctProjectIds) {
          await ProjectScopedReferenceValidator.validateReferencesBelongToProject(
            {
              projectId: projectId,
              subject: "monitor",
              references: parentIds.map((parentId: ObjectID) => {
                return {
                  modelName: "Monitor",
                  id: parentId,
                  service: this,
                };
              }),
            },
          );
        }

        const targetMonitorIds: Array<ObjectID> = input.targets
          .map((target: { monitorId: ObjectID | null }) => {
            return target.monitorId;
          })
          .filter((monitorId: ObjectID | null): monitorId is ObjectID => {
            return Boolean(monitorId);
          });

        if (targetMonitorIds.length > 0) {
          await this.throwIfDependencyCycle({
            targetMonitorIds,
            proposedParentIds: parentIds,
          });
        }
      }
    }

    if (input.proposedSuppressionStatuses !== undefined) {
      const statusIds: Array<ObjectID> = this.extractRelationIds(
        input.proposedSuppressionStatuses,
      );

      if (statusIds.length > 0) {
        for (const projectId of distinctProjectIds) {
          await ProjectScopedReferenceValidator.validateReferencesBelongToProject(
            {
              projectId: projectId,
              subject: "monitor",
              references: statusIds.map((statusId: ObjectID) => {
                return {
                  modelName: "Monitor Status",
                  id: statusId,
                  service: MonitorStatusService,
                };
              }),
            },
          );
        }
      }
    }
  }

  /*
   * Walk the dependency graph upward from the proposed parents; reaching
   * any monitor being updated means the write would close a cycle, which
   * would make suppression self-referential (A suppressed because of B,
   * B suppressed because of A) and must be rejected. One BFS covers every
   * target of a bulk update. The visited set bounds the walk even if a
   * cycle already exists among ancestors, and the depth cap keeps the
   * check cheap on degenerate graphs.
   *
   * This validates committed state, so two updates racing each other can
   * still jointly commit a cycle this walk could not see; the runtime
   * mutual-cycle guard in MonitorDependencySuppression fails open (pages
   * instead of suppressing) if that ever happens.
   */
  private async throwIfDependencyCycle(input: {
    targetMonitorIds: Array<ObjectID>;
    proposedParentIds: Array<ObjectID>;
  }): Promise<void> {
    const maxDepth: number = 32;

    const targetIdSet: Set<string> = new Set<string>(
      input.targetMonitorIds.map((monitorId: ObjectID) => {
        return monitorId.toString().trim().toLowerCase();
      }),
    );

    const visited: Set<string> = new Set<string>();
    let frontier: Array<ObjectID> = [...input.proposedParentIds];

    for (let depth: number = 0; depth < maxDepth; depth++) {
      if (frontier.length === 0) {
        return;
      }

      if (
        frontier.some((id: ObjectID) => {
          return targetIdSet.has(id.toString().trim().toLowerCase());
        })
      ) {
        throw new BadDataException(
          "This dependency would create a cycle: one of the selected monitors (or a monitor it depends on) already depends on this monitor.",
        );
      }

      for (const id of frontier) {
        visited.add(id.toString().trim().toLowerCase());
      }

      const rows: Array<Model> = await this.findBy({
        query: {
          _id: QueryHelper.any(frontier),
        },
        select: {
          _id: true,
          dependsOnMonitors: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      /*
       * Fail CLOSED on truncation: a frontier level wider than the query
       * limit means ancestors were dropped and a real cycle routed
       * through the remainder would be admitted. Refuse instead — the
       * sibling existence check fails closed the same way.
       */
      if (rows.length >= LIMIT_PER_PROJECT) {
        throw new BadDataException(
          "This dependency graph is too large to verify for cycles. Please reduce the number of monitors sharing one dependency level.",
        );
      }

      const next: Array<ObjectID> = [];

      for (const row of rows) {
        for (const grandParentId of this.extractRelationIds(
          row.dependsOnMonitors || [],
        )) {
          if (!visited.has(grandParentId.toString())) {
            next.push(grandParentId);
            visited.add(grandParentId.toString());
          }
        }
      }

      frontier = next;
    }

    if (frontier.length > 0) {
      throw new BadDataException(
        `Monitor dependency chains deeper than ${maxDepth} levels are not supported.`,
      );
    }
  }

  /*
   * Ids arrive as relation objects ({_id}), ObjectIDs, or bare uuid
   * strings depending on which API path produced the payload —
   * resolveReferenceId handles all three (reading only ._id/.id here
   * silently missed the bare-string shape, which DatabaseService
   * persists). Returned ids are normalized to lower case so every
   * comparison downstream matches the way Postgres matches uuids. null /
   * non-array input (explicit null is TypeORM's clear-all for relation
   * columns) yields an empty list: nothing to validate.
   */
  private extractRelationIds(relationArray: unknown): Array<ObjectID> {
    if (!Array.isArray(relationArray)) {
      return [];
    }

    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of relationArray) {
      const rawId: string | undefined = resolveReferenceId(item)
        ?.toString()
        .trim()
        .toLowerCase();

      if (rawId && !seen.has(rawId)) {
        seen.add(rawId);
        ids.push(new ObjectID(rawId));
      }
    }

    return ids;
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const monitors: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const monitor of monitors) {
      if (monitor.projectId) {
        projectIds[monitor.projectId.toString()] = monitor.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentMonitorStatusId &&
      onUpdate.updateBy.props.tenantId
    ) {
      await this.changeMonitorStatus(
        onUpdate.updateBy.props.tenantId as ObjectID,
        updatedItemIds as Array<ObjectID>,
        onUpdate.updateBy.data.currentMonitorStatusId as ObjectID,
        true, // notifyOwners = true
        "This status was changed when the monitor was updated.",
        undefined,
        {
          isRoot: true,
        },
      );
    }

    if (updatedItemIds.length > 0) {
      for (const monitorId of updatedItemIds) {
        const monitor: Model | null = await this.findOneById({
          id: monitorId,
          select: {
            projectId: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        const projectId: ObjectID = monitor!.projectId!;
        const monitorName: string = monitor!.name!;

        let shouldAddMonitorFeed: boolean = false;
        let feedInfoInMarkdown: string = `Monitor **[${monitorName}](${(await this.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) was updated.**`;

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (onUpdate.updateBy.data.monitoringInterval) {
          await MonitorProbeService.updateNextPingAtForMonitor({
            monitorId: monitorId,
          });
        }

        if (onUpdate.updateBy.data.monitorSteps) {
          const validMonitorStepIds: Array<string> = this.extractMonitorStepIds(
            onUpdate.updateBy.data.monitorSteps as MonitorSteps | JSONObject,
          );

          await MonitorProbeService.pruneStaleLastMonitoringLogEntries({
            monitorId: monitorId,
            validMonitorStepIds: validMonitorStepIds,
          });
        }

        if (onUpdate.updateBy.data.name) {
          // add monitor feed.

          feedInfoInMarkdown += `\n\n**Name**: 
    ${onUpdate.updateBy.data.name || "No name provided."}
    `;
          shouldAddMonitorFeed = true;
        }

        if (onUpdate.updateBy.data.description) {
          // add monitor feed.

          feedInfoInMarkdown += `\n\n**Monitor Description**: 
              ${onUpdate.updateBy.data.description || "No description provided."}
              `;
          shouldAddMonitorFeed = true;
        }

        if (
          onUpdate.updateBy.data.labels &&
          onUpdate.updateBy.data.labels.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.labels)
        ) {
          const labelIds: Array<ObjectID> = (
            onUpdate.updateBy.data.labels as any
          )
            .map((label: Label) => {
              if (label._id) {
                return new ObjectID(label._id?.toString());
              }

              return null;
            })
            .filter((labelId: ObjectID | null) => {
              return labelId !== null;
            });

          const labels: Array<Label> = await LabelService.findBy({
            query: {
              _id: QueryHelper.any(labelIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (labels.length > 0) {
            feedInfoInMarkdown += `\n\n**🏷️ Labels**:
    
    ${labels
      .map((label: Label) => {
        return `- ${label.name}`;
      })
      .join("\n")}
    `;

            shouldAddMonitorFeed = true;
          }
        }

        if (shouldAddMonitorFeed) {
          await MonitorFeedService.createMonitorFeedItem({
            monitorId: monitorId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          });
        }
      }
    }

    /*
     * Labels decide SLO membership, so a label added or removed here can pull
     * this monitor into an SLO's error budget or push it out of one. Keyed on
     * `!== undefined` rather than on a non-empty array: clearing every label
     * arrives as `[]`, and that is precisely the edit that should detach the
     * monitor from every rule-driven SLO.
     */
    if (
      onUpdate.updateBy.data.labels !== undefined &&
      updatedItemIds.length > 0
    ) {
      for (const monitorId of updatedItemIds) {
        try {
          await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor(
            {
              monitorId: monitorId,
              projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            },
          );
        } catch (error) {
          logger.error(
            "Syncing SLO label rules failed in MonitorService.onUpdateSuccess",
            {
              monitorId: monitorId?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
        }
      }
    }

    /*
     * Status page monitor rules match on labels, name and description, so an
     * edit to any of the three can pull this monitor onto a status page or
     * push it off one. Keyed on `!== undefined` for the same reason as the SLO
     * block above: clearing every label arrives as `[]`, and that is exactly
     * the edit that should detach the monitor from every label-driven rule.
     */
    if (
      (onUpdate.updateBy.data.labels !== undefined ||
        onUpdate.updateBy.data.name !== undefined ||
        onUpdate.updateBy.data.description !== undefined) &&
      updatedItemIds.length > 0
    ) {
      for (const monitorId of updatedItemIds) {
        try {
          await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
            monitorId: monitorId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          });
        } catch (error) {
          logger.error(
            "Syncing status page monitor rules failed in MonitorService.onUpdateSuccess",
            {
              monitorId: monitorId?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
        }
      }
    }

    return onUpdate;
  }

  public getEnabledMonitorQuery(): Query<Model> {
    return {
      disableActiveMonitoring: false, // do not fetch if disabled is true.
      disableActiveMonitoringBecauseOfManualIncident: false,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.monitorType) {
      throw new BadDataException("Monitor type required to create monitor.");
    }

    if (!Object.values(MonitorType).includes(createBy.data.monitorType)) {
      throw new BadDataException(
        `Invalid monitor type "${
          createBy.data.monitorType
        }". Valid monitor types are ${Object.values(MonitorType).join(", ")}.`,
      );
    }

    if (!createBy.props.tenantId) {
      throw new BadDataException("ProjectId required to create monitor.");
    }

    /*
     * Validate the request's shape before consulting billing. A conflicting
     * Monitor Template reference, or one hidden by the caller's read scope, is
     * a bad request regardless of the project's plan - and resolving it here,
     * ahead of the plan lookup, keeps the checks reachable without a database
     * (the billing lookup queries the DB) and mirrors onBeforeUpdate, which
     * validates the template before any other work.
     */
    const monitorTemplateId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      MONITOR_TEMPLATE_RELATION_KEYS,
      "Monitor Template",
    );

    if (monitorTemplateId) {
      await this.validateMonitorTemplateReference({
        monitorTemplateId: monitorTemplateId,
        projectId: createBy.props.tenantId,
        monitorType: createBy.data.monitorType,
        props: createBy.props,
      });
    }

    if (IsBillingEnabled && createBy.props.tenantId) {
      const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
        createBy.props.tenantId,
      );

      if (currentPlan.isSubscriptionUnpaid) {
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and pay all the outstanding invoices to add more monitors.",
        );
      }

      if (
        currentPlan.plan === PlanType.Free &&
        createBy.data.monitorType !== MonitorType.Manual
      ) {
        const monitorCount: PositiveNumber = await this.countBy({
          query: {
            projectId: createBy.props.tenantId,
            monitorType: QueryHelper.any(
              MonitorTypeHelper.getActiveMonitorTypes(),
            ),
          },
          props: {
            isRoot: true,
          },
        });

        if (monitorCount.toNumber() >= AllowedActiveMonitorCountInFreePlan) {
          throw new BadDataException(
            `You have reached the maximum allowed monitor limit for the free plan. Please upgrade your plan to add more monitors.`,
          );
        }
      }
    }

    if (createBy.data.monitorType === MonitorType.Server) {
      createBy.data.serverMonitorSecretKey = ObjectID.generate();
    }

    if (createBy.data.monitorType === MonitorType.IncomingRequest) {
      createBy.data.incomingRequestSecretKey = ObjectID.generate();
    }

    if (createBy.data.monitorType === MonitorType.IncomingEmail) {
      createBy.data.incomingEmailSecretKey = ObjectID.generate();
    }

    if (createBy.data.autoProvisionedNetworkDeviceId) {
      if (!monitorTemplateId) {
        throw new BadDataException(
          "An auto-provisioned Network Device monitor must be linked to a monitor template.",
        );
      }

      if (createBy.data.monitorType !== MonitorType.NetworkDevice) {
        throw new BadDataException(
          "Only Network Device monitors can carry auto-provisioning provenance.",
        );
      }

      NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice({
        monitorSteps: createBy.data.monitorSteps,
        networkDeviceId: createBy.data.autoProvisionedNetworkDeviceId,
      });
    }

    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: createBy.data.monitorSteps,
      projectId: createBy.props.tenantId,
    });

    await this.validateDependencyConfiguration({
      // A new monitor cannot be part of a cycle yet, hence monitorId null.
      targets: [
        {
          monitorId: null,
          projectId: createBy.props.tenantId,
        },
      ],
      proposedParents: createBy.data.dependsOnMonitors,
      proposedSuppressionStatuses:
        createBy.data.suppressAlertsWhenParentMonitorStatuses,
    });

    /*
     * A new monitor starts in the project's operational status. A project can
     * hold MORE than one operational state (a user - or an E2E fixture - can
     * add another `isOperationalState: true` status), so this lookup MUST be
     * deterministic. Without an explicit sort, findOneBy falls back to
     * `createdAt DESC` and hands back whichever operational status was created
     * most recently - so a monitor created right after a caller adds a custom
     * operational status silently adopts THAT status as its currentMonitorStatusId
     * instead of the project's default. When the custom status is later deleted
     * while the monitor still points at it, the currentMonitorStatusId foreign
     * key (ON DELETE NO ACTION) blocks the delete forever - the intermittent
     * "Monitor records still reference it" failure in the Terraform E2E suite,
     * where the monitors quietly latched onto the fixture's freshly-created
     * "TF Operational" instead of the seeded default.
     *
     * Order by priority ascending (the seeded default operational status is
     * priority 0 - the primary/highest-precedence operational state) and break
     * ties by the oldest row, so the choice is stable and always resolves to the
     * project's canonical operational status.
     */
    const monitorStatus: MonitorStatus | null =
      await MonitorStatusService.findOneBy({
        query: {
          projectId: createBy.props.tenantId,
          isOperationalState: true,
        },
        select: {
          _id: true,
        },
        sort: {
          priority: SortOrder.Ascending,
          createdAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    if (!monitorStatus || !monitorStatus.id) {
      throw new BadDataException(
        "Operational status not found for this project. Please add an operational status",
      );
    }

    createBy.data.currentMonitorStatusId = monitorStatus.id;

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    if (!createdItem.currentMonitorStatusId) {
      throw new BadDataException("currentMonitorStatusId is required");
    }

    /*
     * Activation event for marketing funnels. Only fires for human-created
     * monitors (captureForUser skips when there is no user).
     */
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId || createdItem.createdByUserId,
      event: "server/monitor_created",
      properties: {
        project_id: createdItem.projectId.toString(),
        monitor_type: createdItem.monitorType?.toString() || "",
      },
    });

    const monitor: Model | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: {
          name: true,
        },
        labels: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    let feedInfoInMarkdown: string = `#### 🌎 Monitor Created: 
          
**${createdItem.name?.trim() || "No name provided."}**:

${createdItem.description?.trim() || "No description provided."}
    
`;

    if (monitor?.currentMonitorStatus?.name) {
      feedInfoInMarkdown += `➡️ **Monitor Status**: ${monitor.currentMonitorStatus.name} \n\n`;
    }

    if (monitor?.monitorType) {
      feedInfoInMarkdown += `⚙️ **Monitor Type**: ${monitor.monitorType} \n\n`;
    }

    if (monitor?.labels && monitor.labels.length > 0) {
      feedInfoInMarkdown += `🏷️ **Labels**:\n`;

      for (const label of monitor.labels) {
        feedInfoInMarkdown += `- ${label.name}\n`;
      }

      feedInfoInMarkdown += `\n\n`;
    }

    /*
     * Probes are attached inline rather than on the detached chain below: the
     * create form redirects straight to the monitor, and a monitor that shows
     * no probes for a second or two reads as "the probe was never assigned".
     * Failures are logged, never thrown - a probe problem must not fail the
     * monitor create.
     */
    if (
      createdItem.monitorType &&
      MonitorTypeHelper.isProbableMonitor(createdItem.monitorType)
    ) {
      try {
        await this.addProbesToMonitor({
          projectId: createdItem.projectId,
          monitorId: createdItem.id,
          selectedProbeIds: this.getSelectedProbeIdsFromMiscDataProps(
            onCreate.createBy.miscDataProps,
          ),
        });
      } catch (error) {
        logger.error("Add probes failed in MonitorService.onCreateSuccess", {
          projectId: createdItem.projectId?.toString(),
          monitorId: createdItem.id?.toString(),
        } as LogAttributes);
        logger.error(error as Error);
      }
    }

    // Execute operations sequentially with error handling (workspace first)
    Promise.resolve()
      .then(async () => {
        try {
          return await this.handleWorkspaceOperationsAsync({
            projectId: createdItem.projectId!,
            monitorId: createdItem.id!,
            monitorName: createdItem.name!,
            feedInfoInMarkdown,
            createdByUserId,
          });
        } catch (error) {
          logger.error(
            "Workspace operations failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.changeMonitorStatus(
            createdItem.projectId!,
            [createdItem.id!],
            createdItem.currentMonitorStatusId!,
            false, // notifyOwners = false
            "This status was created when the monitor was created.",
            undefined,
            onCreate.createBy.props,
          );
        } catch (error) {
          logger.error(
            "Change monitor status failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (IsBillingEnabled) {
            return await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
              createdItem.projectId!,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            "Billing operations failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps[
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps[
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              false,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error("Add owners failed in MonitorService.onCreateSuccess", {
            projectId: createdItem.projectId?.toString(),
            monitorId: createdItem.id?.toString(),
          } as LogAttributes);
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        /*
         * Apply label rules first so rule-added labels are persisted before
         * owner rules run. Owner rules re-fetch labels from the DB, so this
         * lets owner rules key on rule-added labels.
         */
        try {
          await MonitorLabelRuleEngineService.applyRulesToMonitor(createdItem);
        } catch (error) {
          logger.error(
            "Apply monitor label rules failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
        return Promise.resolve();
      })
      .then(async () => {
        try {
          await MonitorOwnerRuleEngineService.applyRulesToMonitor(createdItem);
        } catch (error) {
          logger.error(
            "Apply monitor owner rules failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
        return Promise.resolve();
      })
      .then(async () => {
        /*
         * Runs after the label rules above so a monitor created with no labels
         * of its own, but given some by a MonitorLabelRule, still lands in the
         * SLOs those labels imply.
         */
        try {
          await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor(
            {
              monitorId: createdItem.id!,
              projectId: createdItem.projectId!,
            },
          );
        } catch (error) {
          logger.error(
            "Syncing SLO label rules failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
        }
        return Promise.resolve();
      })
      .then(async () => {
        /*
         * Also runs after the label rules above, so a monitor that only earns
         * its labels from a MonitorLabelRule still lands on the status pages
         * those labels imply.
         */
        try {
          await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
            monitorId: createdItem.id!,
            projectId: createdItem.projectId!,
          });
        } catch (error) {
          logger.error(
            "Syncing status page monitor rules failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
        }
        return Promise.resolve();
      })
      .then(async () => {
        try {
          return await this.refreshMonitorProbeStatus(createdItem.id!);
        } catch (error) {
          logger.error(
            "Refresh probe status failed in MonitorService.onCreateSuccess",
            {
              projectId: createdItem.projectId?.toString(),
              monitorId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in MonitorService sequential operations: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            monitorId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleWorkspaceOperationsAsync(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorName: string;
    feedInfoInMarkdown: string;
    createdByUserId: ObjectID | undefined | null;
  }): Promise<void> {
    // send message to workspaces - slack, teams, etc.
    const workspaceResult: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await MonitorWorkspaceMessages.createChannelsAndInviteUsersToChannels({
        projectId: data.projectId,
        monitorId: data.monitorId,
        monitorName: data.monitorName,
      });

    if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
      // update monitor with these channels.
      await this.updateOneById({
        id: data.monitorId,
        data: {
          postUpdatesToWorkspaceChannels: workspaceResult.channelsCreated || [],
        },
        props: {
          isRoot: true,
        },
      });
    }

    const monitorCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await MonitorWorkspaceMessages.getMonitorCreateMessageBlocks({
        monitorId: data.monitorId,
        projectId: data.projectId,
      });

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: data.monitorId,
      projectId: data.projectId,
      monitorFeedEventType: MonitorFeedEventType.MonitorCreated,
      displayColor: Green500,
      feedInfoInMarkdown: data.feedInfoInMarkdown,
      userId: data.createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: monitorCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });
  }

  @CaptureSpan()
  public async getMonitorLinkInDashboard(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/monitors/${monitorId.toString()}`,
    );
  }

  @CaptureSpan()
  public async findOwners(monitorId: ObjectID): Promise<Array<User>> {
    if (!monitorId) {
      throw new BadDataException("monitorId is required");
    }

    const ownerUsers: Array<MonitorOwnerUser> =
      await MonitorOwnerUserService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          } as Select<User>,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<MonitorOwnerTeam> =
      await MonitorOwnerTeamService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: MonitorOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: MonitorOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    monitorId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: MonitorOwnerTeam = new MonitorOwnerTeam();
      teamOwner.monitorId = monitorId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await MonitorOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: MonitorOwnerUser = new MonitorOwnerUser();
      teamOwner.monitorId = monitorId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await MonitorOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  /*
   * The monitor create form sends the probes the user picked through
   * miscDataProps (the same side channel the owner fields use). They arrive as
   * plain strings because miscDataProps is not run through the model
   * serializer, so normalise before anything else touches them.
   */
  public getSelectedProbeIdsFromMiscDataProps(
    miscDataProps: JSONObject | undefined,
  ): Array<ObjectID> | undefined {
    const rawProbeIds: JSONValue | undefined = miscDataProps?.["probes"];

    if (!Array.isArray(rawProbeIds)) {
      // Nothing was sent (API clients, templates) - fall back to the defaults.
      return undefined;
    }

    const probeIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const rawProbeId of rawProbeIds) {
      if (!rawProbeId) {
        continue;
      }

      const probeId: string =
        rawProbeId instanceof ObjectID
          ? rawProbeId.toString()
          : String(rawProbeId);

      if (!probeId || seen.has(probeId)) {
        continue;
      }

      seen.add(probeId);
      probeIds.push(new ObjectID(probeId));
    }

    return probeIds;
  }

  /*
   * Attaches the probes the user explicitly selected at create time, or the
   * project's auto-enable defaults when no selection was made. An explicit but
   * empty selection means "no probes" and is honoured as such.
   */
  @CaptureSpan()
  public async addProbesToMonitor(data: {
    projectId: ObjectID | undefined;
    monitorId: ObjectID | undefined | null;
    selectedProbeIds: Array<ObjectID> | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.monitorId) {
      throw new BadDataException("monitorId is required");
    }

    if (data.selectedProbeIds === undefined) {
      return await this.addDefaultProbesToMonitor(
        data.projectId,
        data.monitorId,
      );
    }

    return await this.addSelectedProbesToMonitor(
      data.projectId,
      data.monitorId,
      data.selectedProbeIds,
    );
  }

  /*
   * Only global probes and probes belonging to this project may be attached -
   * the id list comes from the browser, so it cannot be trusted to stay inside
   * the tenant. ProbeService.getProbesAttachableToProject owns that rule and
   * MonitorProbeService enforces the same one on the CRUD path.
   */
  @CaptureSpan()
  public async addSelectedProbesToMonitor(
    projectId: ObjectID,
    monitorId: ObjectID,
    probeIds: Array<ObjectID>,
  ): Promise<void> {
    const probes: Array<Probe> =
      await ProbeService.getProbesAttachableToProject({
        probeIds: probeIds,
        projectId: projectId,
      });

    await this.createMonitorProbes({
      projectId: projectId,
      monitorId: monitorId,
      probes: probes,
    });
  }

  @CaptureSpan()
  public async addDefaultProbesToMonitor(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<void> {
    // Fetch project to see if global probes should be added automatically.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        doNotAddGlobalProbesByDefaultOnNewMonitors: true,
      },
      props: {
        isRoot: true,
      },
    });

    const shouldSkipGlobalProbes: boolean =
      project?.doNotAddGlobalProbesByDefaultOnNewMonitors === true;

    let globalProbes: Array<Probe> = [];

    if (!shouldSkipGlobalProbes) {
      globalProbes = await ProbeService.findBy({
        query: {
          isGlobalProbe: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    const projectProbes: Array<Probe> = await ProbeService.findBy({
      query: {
        isGlobalProbe: false,
        shouldAutoEnableProbeOnNewMonitors: true,
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    await this.createMonitorProbes({
      projectId: projectId,
      monitorId: monitorId,
      probes: [...globalProbes, ...projectProbes],
    });
  }

  @CaptureSpan()
  public async createMonitorProbes(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    probes: Array<Probe>;
  }): Promise<void> {
    if (data.probes.length === 0) {
      return;
    }

    // Create all monitor probes in parallel for better performance
    const createPromises: Array<Promise<MonitorProbe>> = [];

    for (const probe of data.probes) {
      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.monitorId = data.monitorId;
      monitorProbe.probeId = probe.id!;
      monitorProbe.projectId = data.projectId;
      monitorProbe.isEnabled = true;

      createPromises.push(
        MonitorProbeService.create({
          data: monitorProbe,
          props: {
            isRoot: true,
          },
        }),
      );
    }

    // Execute all creates in parallel
    await Promise.all(createPromises);
  }

  @CaptureSpan()
  public async refreshMonitorProbeStatus(monitorId: ObjectID): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        _id: true,
        monitorType: true,
        isAllProbesDisconnectedFromThisMonitor: true,
        isNoProbeEnabledOnThisMonitor: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    const monitorType: MonitorType | undefined = monitor?.monitorType;

    if (!monitorType) {
      return;
    }

    const isProbeableMonitor: boolean =
      MonitorTypeHelper.isProbableMonitor(monitorType);

    if (!isProbeableMonitor) {
      return;
    }

    // get all the probes for this monitor.

    const probesForMonitor: Array<MonitorProbe> =
      await MonitorProbeService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          isEnabled: true,
          projectId: true,
          monitorId: true,
          probeId: true,
          probe: {
            connectionStatus: true,
            isGlobalProbe: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const enabledProbes: Array<MonitorProbe> = probesForMonitor.filter(
      (probe: MonitorProbe) => {
        return probe.isEnabled;
      },
    );

    if (probesForMonitor.length === 0 || enabledProbes.length === 0) {
      if (!monitor.isNoProbeEnabledOnThisMonitor) {
        // no probes for this monitor.
        await this.updateOneById({
          id: monitorId,
          data: {
            isNoProbeEnabledOnThisMonitor: true,
          },
          props: {
            isRoot: true,
          },
        });

        // notify owners that no probe is enabled.

        await this.notifyOwnersWhenNoProbeIsEnabled({
          monitorId: monitorId,
          isNoProbesEnabled: true,
        });
      }
    } else if (monitor.isNoProbeEnabledOnThisMonitor) {
      await this.updateOneById({
        id: monitorId,
        data: {
          isNoProbeEnabledOnThisMonitor: false,
        },
        props: {
          isRoot: true,
        },
      });

      // notify owners that probes are now enabled.

      await this.notifyOwnersWhenNoProbeIsEnabled({
        monitorId: monitorId,
        isNoProbesEnabled: false,
      });
    }

    const disconnectedProbes: Array<MonitorProbe> = probesForMonitor.filter(
      (monitorProbe: MonitorProbe) => {
        return (
          monitorProbe.probe?.connectionStatus ===
            ProbeConnectionStatus.Disconnected && monitorProbe.isEnabled
        );
      },
    );

    if (IsBillingEnabled) {
      // check if these probes are global probes.
      const anyGlobalProbe: boolean = enabledProbes.some(
        (monitorProbe: MonitorProbe) => {
          return monitorProbe.probe?.isGlobalProbe === true;
        },
      );

      if (anyGlobalProbe) {
        // do not notify if any global probe is disconnected.
        return;
      }
    }

    if (
      disconnectedProbes.length === enabledProbes.length &&
      enabledProbes.length > 0
    ) {
      if (!monitor.isAllProbesDisconnectedFromThisMonitor) {
        // all probes are disconnected.
        await this.updateOneById({
          id: monitorId,
          data: {
            isAllProbesDisconnectedFromThisMonitor: true,
          },
          props: {
            isRoot: true,
          },
        });

        await this.notifyOwnersProbesDisconnected({
          monitorId: monitorId,
          isProbeDisconnected: true,
        });
      }
    } else if (monitor.isAllProbesDisconnectedFromThisMonitor) {
      await this.updateOneById({
        id: monitorId,
        data: {
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        props: {
          isRoot: true,
        },
      });

      await this.notifyOwnersProbesDisconnected({
        monitorId: monitorId,
        isProbeDisconnected: false,
      });
    }
  }

  @CaptureSpan()
  public async getLabelsForMonitors(data: {
    monitorIds: Array<ObjectID>;
  }): Promise<Array<Label>> {
    if (data.monitorIds.length === 0) {
      return [];
    }

    const monitors: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(data.monitorIds),
      },
      select: {
        _id: true,
        name: true,
        labels: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    const labels: Array<Label> = [];

    for (const monitor of monitors) {
      if (monitor.labels) {
        for (const label of monitor.labels) {
          const isLabelAlreadyAdded: boolean = labels.some((l: Label) => {
            return l.id!.toString() === label.id!.toString();
          });

          if (!isLabelAlreadyAdded) {
            labels.push(label);
          }
        }
      }
    }

    return labels;
  }

  @CaptureSpan()
  public async notifyOwnersWhenNoProbeIsEnabled(data: {
    monitorId: ObjectID;
    isNoProbesEnabled: boolean;
  }): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        project: {
          name: true,
        },
        description: true,
        monitorType: true,
        monitorSteps: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    let doesResourceHasOwners: boolean = true;

    let owners: Array<User> = await this.findOwners(monitor.id!);

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(monitor.projectId!);
    }

    if (owners.length === 0) {
      return;
    }

    const title: string = data.isNoProbesEnabled
      ? "No Probes Enabled. This monitor is not being monitored"
      : "Probes Enabled. This monitor is now being monitored.";

    const enabledStatus: string = data.isNoProbesEnabled
      ? "Disabled"
      : "Enabled";

    // Get monitor destination info using the helper function
    const destinationInfo: MonitorDestinationInfo =
      this.getMonitorDestinationInfo(monitor);

    const vars: Dictionary<string> = {
      title: title,
      monitorName: monitor.name!,
      currentStatus: enabledStatus,
      projectName: monitor.project!.name!,
      monitorDescription: await Markdown.convertToHTML(
        monitor.description! || "",
        MarkdownContentType.Email,
      ),
      monitorViewLink: (
        await this.getMonitorLinkInDashboard(monitor.projectId!, monitor.id!)
      ).toString(),
      monitorDestination: destinationInfo.monitorDestination,
      requestType: destinationInfo.requestType,
      monitorType: destinationInfo.monitorType,
    };

    if (doesResourceHasOwners === true) {
      vars["isOwner"] = "true";
    }

    for (const owner of owners) {
      // send email to the owner.

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorProbesStatus,
        vars: vars,
        subject: `[${enabledStatus} Monitor Probes] ${monitor.name!}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${enabledStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${enabledStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            monitor_name: monitor.name!,
            probe_status: enabledStatus,
            monitor_link: vars["monitorViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage:
          PushNotificationUtil.createMonitorProbeStatusNotification({
            title: "OneUptime: Monitor Probe Status",
            body: `Probes for monitor ${monitor.name} is ${enabledStatus}`,
            tag: "monitor-probe-status",
            monitorId: monitor.id!.toString(),
            monitorName: monitor.name!,
          }),
        whatsAppMessage,
        eventType,
        monitorId: monitor.id!,
      });
    }
  }

  @CaptureSpan()
  public async notifyOwnersProbesDisconnected(data: {
    monitorId: ObjectID;
    isProbeDisconnected: boolean;
  }): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        project: {
          name: true,
        },
        description: true,
        monitorType: true,
        monitorSteps: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    let doesResourceHasOwners: boolean = true;

    let owners: Array<User> = await this.findOwners(monitor.id!);

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(monitor.projectId!);
    }

    if (owners.length === 0) {
      return;
    }

    const status: string = data.isProbeDisconnected
      ? "Disconnected"
      : "Connected";

    // Get monitor destination info using the helper function
    const destinationInfo: MonitorDestinationInfo =
      this.getMonitorDestinationInfo(monitor);

    const vars: Dictionary<string> = {
      title: `Probes for monitor ${monitor.name} is ${status}.`,
      monitorName: monitor.name!,
      currentStatus: status,
      projectName: monitor.project!.name!,
      monitorDescription: await Markdown.convertToHTML(
        monitor.description! || "",
        MarkdownContentType.Email,
      ),
      monitorViewLink: (
        await this.getMonitorLinkInDashboard(monitor.projectId!, monitor.id!)
      ).toString(),
      monitorDestination: destinationInfo.monitorDestination,
      requestType: destinationInfo.requestType,
      monitorType: destinationInfo.monitorType,
    };

    if (doesResourceHasOwners === true) {
      vars["isOwner"] = "true";
    }

    for (const owner of owners) {
      // send email to the owner.

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorProbesStatus,
        vars: vars,
        subject: `[${status} Monitor Probes] ${monitor.name!}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${status}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. New monitor was created ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            monitor_name: monitor.name!,
            probe_status: status,
            monitor_link: vars["monitorViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage:
          PushNotificationUtil.createMonitorCreatedNotification({
            monitorName: monitor.name!,
            monitorId: monitor.id!.toString(),
          }),
        whatsAppMessage,
        eventType,
        monitorId: monitor.id!,
      });
    }
  }

  @CaptureSpan()
  public async refreshProbeStatus(probeId: ObjectID): Promise<void> {
    // get all the monitors for this probe.

    const monitorProbes: Array<MonitorProbe> = await MonitorProbeService.findBy(
      {
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          isEnabled: true,
          projectId: true,
          monitorId: true,
          monitor: {
            monitorType: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      },
    );

    if (monitorProbes.length === 0) {
      return;
    }

    /*
     * Each monitor appears at most once for a given probeId (composite
     * unique on MonitorProbe), so concurrent refreshes operate on disjoint
     * rows and are safe to run in parallel. A global/shared probe can be
     * attached to thousands of monitors, though, so refresh in bounded
     * batches instead of firing every refresh at once — an unbounded
     * Promise.all here would exhaust the database connection pool.
     */
    const refreshConcurrency: number = 50;

    for (let i: number = 0; i < monitorProbes.length; i += refreshConcurrency) {
      const batch: Array<MonitorProbe> = monitorProbes.slice(
        i,
        i + refreshConcurrency,
      );

      await Promise.all(
        batch.map((monitorProbe: MonitorProbe) => {
          return this.refreshMonitorProbeStatus(monitorProbe.monitorId!);
        }),
      );
    }
  }

  @CaptureSpan()
  public async changeMonitorStatus(
    projectId: ObjectID,
    monitorIds: Array<ObjectID>,
    monitorStatusId: ObjectID,
    notifyOwners: boolean,
    rootCause: string | undefined,
    statusChangeLog: JSONObject | undefined,
    props: DatabaseCommonInteractionProps,
    startsAt?: Date | undefined,
  ): Promise<void> {
    for (const monitorId of monitorIds) {
      // get last monitor status timeline.
      const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
        await MonitorStatusTimelineService.findOneBy({
          query: {
            monitorId: monitorId,
            projectId: projectId,
          },
          select: {
            _id: true,
            monitorStatusId: true,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        continue;
      }

      const statusTimeline: MonitorStatusTimeline = new MonitorStatusTimeline();

      statusTimeline.monitorId = monitorId;
      statusTimeline.monitorStatusId = monitorStatusId;
      statusTimeline.projectId = projectId;
      statusTimeline.isOwnerNotified = !notifyOwners;

      if (statusChangeLog) {
        statusTimeline.statusChangeLog = statusChangeLog;
      }
      if (rootCause) {
        statusTimeline.rootCause = rootCause;
      }

      if (startsAt) {
        statusTimeline.startsAt = startsAt;
      }

      await this.createStatusTimelineWithRetry({
        statusTimeline: statusTimeline,
        props: props,
        projectId: projectId,
        monitorId: monitorId,
      });
    }

    /*
     * Bridge to the network-site rollup engine: stamp the NetworkDevices
     * these monitors poll and refresh their sites' worst-of status.
     * Resilient by contract - a rollup failure can never break a monitor
     * status change (onMonitorStatusChanged also catches internally).
     */
    try {
      await NetworkSiteService.onMonitorStatusChanged({
        projectId: projectId,
        monitorIds: monitorIds,
        monitorStatusId: monitorStatusId,
      });
    } catch (err) {
      logger.error(
        `changeMonitorStatus: failed to update network site rollups: ${err}`,
        {
          projectId: projectId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Creates one status timeline row, absorbing the two error classes that are
   * recoverable per monitor so one monitor cannot abort a caller's loop over
   * many (incident resolve, scheduled maintenance end, incident create with
   * changeMonitorStatusTo):
   *
   *   - "same as previous" from onBeforeCreate's dedupe check: a concurrent
   *     writer (or an earlier backfilled row at this startsAt) already put the
   *     monitor in this status, so the desired state holds. Idempotent no-op.
   *
   *   - the fail-closed lock error from MonitorStatusTimelineService.create():
   *     retried a few times with a short delay, because the common causes (a
   *     transient Redis blip, or a concurrent writer holding the per-monitor
   *     mutex) clear quickly. This retry is also what protects the INITIAL
   *     status row written from MonitorService.onCreateSuccess - without it a
   *     lock failure at monitor-create time leaves a Manual monitor with no
   *     timeline forever, since Manual monitors are never probed and so never
   *     self-heal. If all attempts fail, log and continue: for probed monitors
   *     the next probe result recreates the transition, and failing the caller
   *     outright would strand its remaining monitors instead.
   *
   * Every other error still propagates.
   */
  private async createStatusTimelineWithRetry(data: {
    statusTimeline: MonitorStatusTimeline;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<void> {
    const maxAttempts: number = 3;
    const retryDelayInMs: number = 2000;

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      monitorId: data.monitorId.toString(),
    } as LogAttributes;

    for (let attempt: number = 1; attempt <= maxAttempts; attempt++) {
      try {
        await MonitorStatusTimelineService.create({
          data: data.statusTimeline,
          props: data.props,
        });
        return;
      } catch (err) {
        if (
          err instanceof BadDataException &&
          err.message === MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE
        ) {
          logger.debug(
            `changeMonitorStatus: monitor ${data.monitorId.toString()} is already in the requested status; skipping duplicate status timeline.`,
          );
          return;
        }

        const isLockError: boolean =
          err instanceof ServerException &&
          err.message === MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE;

        if (isLockError && attempt < maxAttempts) {
          logger.warn(
            `changeMonitorStatus: could not acquire the status timeline lock for monitor ${data.monitorId.toString()} (attempt ${attempt} of ${maxAttempts}); retrying.`,
            logAttributes,
          );
          await Sleep.sleep(retryDelayInMs);
          continue;
        }

        if (isLockError) {
          logger.error(
            `changeMonitorStatus: could not acquire the status timeline lock for monitor ${data.monitorId.toString()} after ${maxAttempts} attempt(s); skipping this status change. The monitor keeps its current status.`,
            logAttributes,
          );
          return;
        }

        throw err;
      }
    }
  }

  @CaptureSpan()
  public async getWorkspaceChannelForMonitor(data: {
    monitorId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    return (monitor.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  // get monitor name
  @CaptureSpan()
  public async getMonitorName(data: { monitorId: ObjectID }): Promise<string> {
    const { monitorId } = data;

    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    return monitor.name || "";
  }

  /**
   * Repoints the currentMonitorStatusId of ALREADY SOFT-DELETED monitor rows
   * away from monitor statuses that are about to be hard-deleted.
   *
   * A soft-deleted monitor keeps its physical row - and therefore its
   * currentMonitorStatusId foreign key, which is ON DELETE NO ACTION - so a
   * status that a since-deleted monitor last pointed at cannot be removed
   * until that dangling reference is cleared. This surfaced as an intermittent
   * "Monitor records still reference it" failure when Terraform destroyed a
   * fixture that deleted its monitors and then the custom statuses those
   * monitors had adopted.
   *
   * Only soft-deleted rows are touched: deleting a status that a LIVE monitor
   * is currently in still surfaces the referential-integrity guard, so a user
   * is never silently robbed of a monitor's visible status. Returns the number
   * of dead rows repointed.
   */
  @CaptureSpan()
  public async repointDeletedMonitorsAwayFromStatuses(data: {
    fromMonitorStatusIds: Array<ObjectID>;
    toMonitorStatusId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    if (data.fromMonitorStatusIds.length === 0) {
      return 0;
    }

    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        currentMonitorStatusId: data.toMonitorStatusId.toString(),
      } as unknown as QueryDeepPartialEntity<Model>)
      .where('"projectId" = :projectId', {
        projectId: data.projectId.toString(),
      })
      .andWhere('"deletedAt" IS NOT NULL')
      .andWhere('"currentMonitorStatusId" IN (:...fromIds)', {
        fromIds: data.fromMonitorStatusIds.map((id: ObjectID) => {
          return id.toString();
        }),
      })
      .execute();

    return result.affected || 0;
  }
}
export default new Service();
