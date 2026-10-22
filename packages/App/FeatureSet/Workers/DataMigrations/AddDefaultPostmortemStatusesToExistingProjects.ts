import DataMigrationBase from "./DataMigrationBase";
import { LIMIT_INFINITY } from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import IncidentPostmortemStatusService from "Common/Server/Services/IncidentPostmortemStatusService";
import Project from "Common/Models/DatabaseModels/Project";
import logger from "Common/Server/Utils/Logger";

/*
 * Postmortem statuses arrived with the Postmortems list (Incidents >
 * Postmortems): every incident's postmortem is in one of its project's
 * statuses (IncidentPostmortemStatus). New projects get theirs when they are
 * created; this gives every project from before them the same four - Not
 * Started, Draft, Completed and Not Needed - and then every incident from
 * before them the status its postmortem is in by its fields: Completed when
 * it is published on a status page, Draft when it has a note, Not Started
 * otherwise (IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses).
 * No incident is given Not Needed: whether an old incident needed a
 * postmortem is the team's to say, from the list.
 *
 * Postgres-only. Idempotent: a project's statuses are added only where it
 * has none of the kind, and only incidents with no status are given one.
 */
export default class AddDefaultPostmortemStatusesToExistingProjects extends DataMigrationBase {
  public constructor() {
    super("AddDefaultPostmortemStatusesToExistingProjects");
  }

  public override async migrate(): Promise<void> {
    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_INFINITY,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      await ProjectService.addDefaultIncidentPostmortemStatuses(project);
    }

    const incidentsGivenAStatus: number =
      await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses();

    logger.info(
      `AddDefaultPostmortemStatusesToExistingProjects: added the default postmortem statuses to ${projects.length} project(s), and gave ${incidentsGivenAStatus} incident(s) the status their postmortem is in.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the statuses are the project's to rename, reorder or
     * archive from here on, and every incident keeps its status.
     */
    return;
  }
}
