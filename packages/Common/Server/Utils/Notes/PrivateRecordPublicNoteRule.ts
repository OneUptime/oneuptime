import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PrivateRecordPublicNotes, {
  PrivateRecordKind,
} from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import { StatusPageVisibilitySwitches } from "../../../Types/StatusPage/StatusPageVisibility";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import Query from "../../Types/Database/Query";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE ONE RULE: A PRIVATE INCIDENT OR EPISODE TAKES NO NEW PUBLIC NOTES
 * (Types/StatusPage/PrivateRecordPublicNotes says why).
 *
 * Every way a public note is made ends in its service's create, and the
 * services ask here:
 *
 *  - IncidentPublicNoteService and IncidentEpisodePublicNoteService refuse a
 *    new public note on a private record in their onBeforeCreate - the API,
 *    workflows, the AI's status update, Slack and Microsoft Teams and an
 *    SLA's reminders all create through them;
 *  - IncidentStateTimelineService refuses a state change that comes with a
 *    public note on a private incident, whole, before anything of the change
 *    is written, as it refuses one whose note its sender may not post
 *    (StateChangePublicNote): a change is never saved with a note that is
 *    then refused.
 *
 * The record is read as OneUptime: the rule is about the record, whoever
 * asks, and by then the create has made sure its caller may read it
 * (DatabaseService.checkCreateParents), so the answer tells nobody anything
 * they could not see. A record that is not found is not refused here - the
 * create's own checks answer for it.
 */
export default class PrivateRecordPublicNoteRule {
  /*
   * Refuses a public note on `record`, already read, when it is private.
   * Nothing is refused for a record that was not found (null).
   */
  public static assertRecordTakesPublicNotes(data: {
    kind: PrivateRecordKind;
    record: StatusPageVisibilitySwitches | null | undefined;
  }): void {
    if (!data.record) {
      return;
    }

    if (!PrivateRecordPublicNotes.takesPublicNotes(data.record)) {
      throw new BadDataException(
        PrivateRecordPublicNotes.getRefusalMessage(data.kind),
      );
    }
  }

  /*
   * Whether the record is private now. False for a record that is not
   * found, in this project when one is named.
   */
  @CaptureSpan()
  public static async isPrivate(data: {
    kind: PrivateRecordKind;
    recordId: ObjectID;
    projectId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    const record: StatusPageVisibilitySwitches | null =
      await PrivateRecordPublicNoteRule.readPrivacy(data);

    return (
      Boolean(record) && !PrivateRecordPublicNotes.takesPublicNotes(record)
    );
  }

  /*
   * Refuses a state change that comes with a public note when its record is
   * private: the change is refused whole, with what to do instead.
   */
  @CaptureSpan()
  public static async assertStateChangeMayPostPublicNote(data: {
    kind: PrivateRecordKind;
    recordId: ObjectID;
    projectId?: ObjectID | null | undefined;
  }): Promise<void> {
    if (await PrivateRecordPublicNoteRule.isPrivate(data)) {
      throw new BadDataException(
        PrivateRecordPublicNotes.getStateChangeRefusalMessage(data.kind),
      );
    }
  }

  // The record's Private switch, read as OneUptime; null when not found.
  private static async readPrivacy(data: {
    kind: PrivateRecordKind;
    recordId: ObjectID;
    projectId?: ObjectID | null | undefined;
  }): Promise<StatusPageVisibilitySwitches | null> {
    switch (data.kind) {
      case PrivateRecordKind.Incident: {
        const query: Query<Incident> = {
          _id: data.recordId.toString(),
        };

        if (data.projectId) {
          query.projectId = data.projectId;
        }

        return await IncidentService.findOneBy({
          query: query,
          select: {
            _id: true,
            isPrivate: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
      case PrivateRecordKind.IncidentEpisode: {
        const query: Query<IncidentEpisode> = {
          _id: data.recordId.toString(),
        };

        if (data.projectId) {
          query.projectId = data.projectId;
        }

        return await IncidentEpisodeService.findOneBy({
          query: query,
          select: {
            _id: true,
            isPrivate: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }
}
