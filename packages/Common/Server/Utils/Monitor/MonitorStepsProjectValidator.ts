import AlertSeverityService from "../../Services/AlertSeverityService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import LabelService from "../../Services/LabelService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ProbeService from "../../Services/ProbeService";
import ServiceService from "../../Services/ServiceService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../Database/ProjectScopedReferenceValidator";
import ArchivedValueCheck, {
  ArchivedValueNamed,
} from "../Database/ArchivedValueCheck";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueDefinition,
  ArchivableValueType,
} from "../../../Utils/ArchivableValues";
import MonitorStepsReferenceExtractor, {
  MonitorStepsReference,
  MonitorStepsReferenceModel,
} from "./MonitorStepsReferenceExtractor";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";

/*
 * `monitorSteps` is a JSON blob that embeds ids of other records — the default
 * monitor status, the status each criteria switches to, the severities used to
 * open incidents and alerts, and the on-call policies, labels, teams and users
 * stamped on what those incidents and alerts create.
 *
 * Two things can be wrong with one of those ids, and both used to be accepted:
 *
 * 1. It belongs to ANOTHER project. That silently ties two projects together
 *    and leaves the referenced project undeletable, because the row the id ends
 *    up on (a MonitorStatusTimeline, an Incident) has an ON DELETE NO ACTION
 *    foreign key pointing back at it.
 *
 * 2. It exists nowhere at all (issue #3039). The monitor saved fine and then
 *    failed every time it ran, deep inside the probe worker, with
 *      insert or update on table "MonitorStatusTimeline" violates foreign key
 *      constraint
 *    and nothing surfaced to whoever supplied the id — which is easy to do over
 *    the REST API or Terraform, where these are just uuids in a JSON body.
 *
 * Telling a real reference apart from the many uuids in monitorSteps that are
 * NOT references (step ids, criteria ids, incident/alert template ids) is what
 * makes check 2 possible, and that is MonitorStepsReferenceExtractor's job: it
 * walks the structure instead of scraping the text, so every id it hands back
 * is known to point at a specific model.
 */

/*
 * Every entry is a getter, not a direct reference.
 *
 * The services import each other in a cycle, and this module is part of it:
 * UserService -> ... -> MonitorService -> ... -> NetworkDeviceService ->
 * NetworkAlertPolicyEngineService -> MonitorTemplateService -> this module.
 * Loaded from the API server's entry point, this module runs while UserService
 * and NetworkDeviceService are still loading. A plain object literal captured
 * both as `undefined`, and kept them that way for the life of the process. Any
 * monitorSteps that named an owner user, an incident member or a monitored
 * network device then failed inside ProjectScopedReferenceValidator with
 *   TypeError: Cannot read properties of undefined (reading 'getModel')
 * which the API reports as a bare 500 "Server Error". Monitor creates and
 * updates, and monitor template saves, all failed this way.
 *
 * Which entries a cycle leaves half initialized depends on the whole app's
 * import graph, so every entry is lazy, not only the two that broke. A getter
 * defers the lookup to the first property access, by which time every module
 * has finished initializing. See SerializableObjectDictionary for the same fix.
 */
const SERVICE_BY_MODEL: Record<
  MonitorStepsReferenceModel,
  DatabaseService<DatabaseBaseModel>
> = {
  get [MonitorStepsReferenceModel.MonitorStatus](): DatabaseService<DatabaseBaseModel> {
    return MonitorStatusService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.IncidentSeverity](): DatabaseService<DatabaseBaseModel> {
    return IncidentSeverityService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.AlertSeverity](): DatabaseService<DatabaseBaseModel> {
    return AlertSeverityService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.OnCallDutyPolicy](): DatabaseService<DatabaseBaseModel> {
    return OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.Label](): DatabaseService<DatabaseBaseModel> {
    return LabelService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.Team](): DatabaseService<DatabaseBaseModel> {
    return TeamService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.User](): DatabaseService<DatabaseBaseModel> {
    return UserService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.IncidentRole](): DatabaseService<DatabaseBaseModel> {
    return IncidentRoleService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.TelemetryService](): DatabaseService<DatabaseBaseModel> {
    return ServiceService as unknown as DatabaseService<DatabaseBaseModel>;
  },
  get [MonitorStepsReferenceModel.NetworkDevice](): DatabaseService<DatabaseBaseModel> {
    return NetworkDeviceService as unknown as DatabaseService<DatabaseBaseModel>;
  },
};

/*
 * The references in monitorSteps that name a value that can be archived
 * (Common/Utils/ArchivableValues), by the kind of value.
 */
const ARCHIVABLE_REFERENCE_MODELS: Partial<
  Record<MonitorStepsReferenceModel, ArchivableValueType>
> = {
  [MonitorStepsReferenceModel.MonitorStatus]: ArchivableValueType.MonitorStatus,
  [MonitorStepsReferenceModel.IncidentSeverity]:
    ArchivableValueType.IncidentSeverity,
  [MonitorStepsReferenceModel.AlertSeverity]: ArchivableValueType.AlertSeverity,
  [MonitorStepsReferenceModel.Label]: ArchivableValueType.Label,
  [MonitorStepsReferenceModel.IncidentRole]: ArchivableValueType.IncidentRole,
};

export default class MonitorStepsProjectValidator {
  public static async validateMonitorStepsBelongToProject(data: {
    monitorSteps: MonitorSteps | JSONObject | undefined;
    projectId: ObjectID | undefined;
    /*
     * What is stored on the record RIGHT NOW, on an update. Any reference id
     * that is already in there is not required to exist — see
     * `grandfatheredIds` below. Omit on create: a create introduces every id it
     * carries, so all of them must exist.
     */
    alreadyStoredMonitorSteps?: MonitorSteps | JSONObject | undefined | null;
    /*
     * Who is writing. A person's or an API key's write may not introduce an
     * archived value the monitor would use (refuseIntroducedArchivedValues);
     * OneUptime's own writes and a workflow's keep what they were set up with.
     * Omitted, nothing is checked for being archived.
     */
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    if (!data.monitorSteps || !data.projectId) {
      return;
    }

    await MonitorStepsProjectValidator.validateWatchedProbesBelongToProject({
      monitorSteps: data.monitorSteps,
      projectId: data.projectId,
      alreadyStoredMonitorSteps: data.alreadyStoredMonitorSteps,
    });

    const references: Array<MonitorStepsReference> =
      MonitorStepsReferenceExtractor.extract(data.monitorSteps);

    if (references.length === 0) {
      return;
    }

    /*
     * An id the record ALREADY holds is this write's inheritance, not its
     * doing, and is left alone entirely — neither checked for existence nor for
     * belonging to another project.
     *
     * None of these ids has a foreign key behind it, so one really can end up
     * wrong through no fault of the person now saving: deleting a monitor
     * status, label, team or on-call policy does not rewrite the criteria that
     * name it, and the 1785240000000 repair migration deliberately left behind
     * the cross-project ids it could not map to a local equivalent. The
     * dashboard re-submits the whole blob on every save and renders an
     * unresolvable id as an empty dropdown, so checking them would refuse EVERY
     * edit of such a monitor — including renaming it — over a field the user
     * never touched and cannot see is wrong, with no migration to get them out.
     *
     * Letting a stale id ride costs less than it used to. The status and
     * severity ids — the ones that reach a foreign-key column and made the
     * referenced project undeletable — are now screened where they are written:
     * MonitorStatusTimelineService rejects a status that does not resolve, and
     * the probe worker skips one it cannot use rather than writing it, as
     * MonitorIncident and MonitorAlert already did for severities.
     *
     * That screening does NOT extend to the ids that land on join rows
     * (IncidentLabel, IncidentOnCallDutyPolicy and friends). A stale label or
     * on-call policy carried forward here can still fail when the criteria
     * fires. That is a pre-existing gap in MonitorIncident/MonitorAlert rather
     * than something this exemption opens up — those ids were not validated at
     * all before — and refusing the SAVE would not close it, because the
     * monitor that never gets edited again fails just the same.
     *
     * What this write INTRODUCES is checked in full. That is issue #3039.
     *
     * Compared case-insensitively: ObjectID keeps whatever case it was given,
     * so the same id can be stored as Postgres rendered it (lower) and re-sent
     * by a caller in upper.
     */
    const grandfatheredIds: Set<string> = new Set(
      MonitorStepsReferenceExtractor.extract(
        data.alreadyStoredMonitorSteps,
      ).map((reference: MonitorStepsReference) => {
        return reference.id.toLowerCase();
      }),
    );

    const introduced: Array<MonitorStepsReference> = references.filter(
      (reference: MonitorStepsReference) => {
        return !grandfatheredIds.has(reference.id.toLowerCase());
      },
    );

    if (introduced.length === 0) {
      return;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: data.projectId,
      subject: "monitor's criteria",
      references: introduced.map(
        (reference: MonitorStepsReference): ProjectScopedReference => {
          return {
            /*
             * The path — `criteria "Monitor is offline" incident severity` —
             * rather than the bare model name, so the message points at the
             * field to fix. monitorSteps can hold a dozen of these.
             */
            modelName: `${reference.model} (${reference.path})`,
            id: reference.id,
            service: SERVICE_BY_MODEL[reference.model],
            /*
             * Only ids the monitor actually reads at run time are required to
             * exist — see MonitorStepsReference.isOperative. The rest are still
             * checked for belonging to this project.
             */
            mustExist: reference.isOperative,
          };
        },
      ),
    });

    if (data.props && ArchivedValueCheck.isCheckedWrite(data.props)) {
      await MonitorStepsProjectValidator.refuseIntroducedArchivedValues({
        projectId: data.projectId,
        references: introduced,
      });
    }
  }

  /*
   * NOBODY PICKS AN ARCHIVED VALUE FOR A MONITOR'S CRITERIA
   * (ArchivedValueCheck): a status, severity, label or incident role this
   * write introduces that the monitor would use - an operative reference -
   * is refused when it is archived. What the monitor already holds is not
   * introduced, so a monitor keeps an archived value through every later
   * edit and keeps opening incidents with it; a reference the monitor does
   * not use (a status kept while "change status" is off) is left alone.
   */
  public static async refuseIntroducedArchivedValues(data: {
    projectId: ObjectID;
    references: Array<MonitorStepsReference>;
  }): Promise<void> {
    const idsByType: Map<ArchivableValueType, Set<string>> = new Map();

    for (const reference of data.references) {
      const type: ArchivableValueType | undefined =
        ARCHIVABLE_REFERENCE_MODELS[reference.model];

      if (
        !type ||
        !reference.isOperative ||
        !ObjectID.isValidUUID(reference.id)
      ) {
        continue;
      }

      const ids: Set<string> = idsByType.get(type) || new Set<string>();
      ids.add(reference.id.trim().toLowerCase());
      idsByType.set(type, ids);
    }

    const archived: Array<ArchivedValueNamed> = [];

    for (const [type, ids] of idsByType) {
      const definition: ArchivableValueDefinition = ARCHIVABLE_VALUES[type];
      const model: MonitorStepsReferenceModel | undefined = (
        Object.keys(ARCHIVABLE_REFERENCE_MODELS) as Array<MonitorStepsReferenceModel>
      ).find((candidate: MonitorStepsReferenceModel): boolean => {
        return ARCHIVABLE_REFERENCE_MODELS[candidate] === type;
      });

      if (!model) {
        continue;
      }

      const rows: Array<DatabaseBaseModel> = await SERVICE_BY_MODEL[
        model
      ].findBy({
        query: {
          _id: QueryHelper.any(Array.from(ids)),
          projectId: data.projectId,
          isArchived: true,
        } as unknown as Query<DatabaseBaseModel>,
        select: {
          _id: true,
          name: true,
        } as unknown as Select<DatabaseBaseModel>,
        skip: 0,
        limit: ids.size,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        archived.push({
          definition: definition,
          name: (row.getColumnValue("name") || "").toString(),
        });
      }
    }

    ArchivedValueCheck.refuseValues(archived);
  }

  /*
   * The probes a Probe Status monitor watches. A monitor may watch exactly
   * the probes it could run on: this project's own and the global ones
   * (ProbeService.getProbesAttachableToProject). The ids come from the
   * browser, the API and Terraform alike, and a probe of another project
   * must not be watchable from here: the monitor would read its name and
   * whether it is up.
   *
   * As with the references above, a probe the monitor already watches is
   * left alone: a probe deleted since must not refuse every later edit of
   * the monitor. The evaluator no longer counts it either way.
   */
  public static async validateWatchedProbesBelongToProject(data: {
    monitorSteps: MonitorSteps | JSONObject | undefined;
    projectId: ObjectID;
    alreadyStoredMonitorSteps?: MonitorSteps | JSONObject | undefined | null;
  }): Promise<void> {
    const watched: Array<string> =
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(data.monitorSteps);

    if (watched.length === 0) {
      return;
    }

    const alreadyWatched: Set<string> = new Set(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(
        data.alreadyStoredMonitorSteps,
      ).map((probeId: string): string => {
        return probeId.toLowerCase();
      }),
    );

    const introduced: Array<string> = watched.filter(
      (probeId: string): boolean => {
        return !alreadyWatched.has(probeId.toLowerCase());
      },
    );

    if (introduced.length === 0) {
      return;
    }

    const notAnId: string | undefined = introduced.find(
      (probeId: string): boolean => {
        return !ObjectID.isValidUUID(probeId);
      },
    );

    if (notAnId) {
      throw new BadDataException(
        `"${notAnId}" is not a probe ID. A Probe Status monitor watches probes by their ID.`,
      );
    }

    const watchable: Array<Probe> =
      await ProbeService.getProbesAttachableToProject({
        probeIds: introduced.map((probeId: string): ObjectID => {
          return new ObjectID(probeId);
        }),
        projectId: data.projectId,
      });

    const watchableIds: Set<string> = new Set(
      watchable.map((probe: Probe): string => {
        return probe.id?.toString().toLowerCase() || "";
      }),
    );

    const refused: Array<string> = introduced.filter(
      (probeId: string): boolean => {
        return !watchableIds.has(probeId.toLowerCase());
      },
    );

    if (refused.length > 0) {
      throw new BadDataException(
        `A Probe Status monitor can watch this project's own probes and the global probes. This project has no probe with the ID ${refused.join(", ")}.`,
      );
    }
  }
}
