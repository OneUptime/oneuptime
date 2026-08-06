import AlertSeverityService from "../../Services/AlertSeverityService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import LabelService from "../../Services/LabelService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ServiceService from "../../Services/ServiceService";
import TeamService from "../../Services/TeamService";
import UserService from "../../Services/UserService";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../Database/ProjectScopedReferenceValidator";
import MonitorStepsReferenceExtractor, {
  MonitorStepsReference,
  MonitorStepsReferenceModel,
} from "./MonitorStepsReferenceExtractor";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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

const SERVICE_BY_MODEL: Record<
  MonitorStepsReferenceModel,
  DatabaseService<DatabaseBaseModel>
> = {
  [MonitorStepsReferenceModel.MonitorStatus]:
    MonitorStatusService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.IncidentSeverity]:
    IncidentSeverityService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.AlertSeverity]:
    AlertSeverityService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.OnCallDutyPolicy]:
    OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.Label]:
    LabelService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.Team]:
    TeamService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.User]:
    UserService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.IncidentRole]:
    IncidentRoleService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.TelemetryService]:
    ServiceService as unknown as DatabaseService<DatabaseBaseModel>,
  [MonitorStepsReferenceModel.NetworkDevice]:
    NetworkDeviceService as unknown as DatabaseService<DatabaseBaseModel>,
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
  }): Promise<void> {
    if (!data.monitorSteps || !data.projectId) {
      return;
    }

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
  }
}
