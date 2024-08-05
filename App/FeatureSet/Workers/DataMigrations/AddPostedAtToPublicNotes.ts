import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import IncidentPublicNoteService from "CommonServer/Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "CommonServer/Services/ScheduledMaintenancePublicNoteService";
import IncidentPublicNote from "Common/AppModels/Models/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "Common/AppModels/Models/ScheduledMaintenancePublicNote";

export default class AddPostedAtToPublicNotes extends DataMigrationBase {
  public constructor() {
    super("AddPostedAtToPublicNotes");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const incidentPublicNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {},
        select: {
          _id: true,
          createdAt: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const publicNote of incidentPublicNotes) {
      await IncidentPublicNoteService.updateOneById({
        id: publicNote.id!,
        data: {
          postedAt: publicNote.createdAt!,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // do the same for scheduledeventpublic notes.

    const eventPublicNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findBy({
        query: {},
        select: {
          _id: true,
          createdAt: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const publicNote of eventPublicNotes) {
      await ScheduledMaintenancePublicNoteService.updateOneById({
        id: publicNote.id!,
        data: {
          postedAt: publicNote.createdAt!,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
