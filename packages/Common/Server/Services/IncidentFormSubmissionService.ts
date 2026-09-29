import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentFormSubmission";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Incident form submissions are written by the form's submit route, as
 * root; nothing here creates them.
 *
 * A submission names its incident, so it must not show a private incident
 * to someone who cannot see it: every read, count and delete is narrowed to
 * submissions whose incident the caller can see, as incident notes are.
 * (The incident's labels and owners narrow them too - see the model's
 * CanAccessIfCanReadOn and OwnedThrough.)
 *
 * The strict filter, not the null-tolerant one, although the incident link
 * is cleared when the incident is deleted. A submission holds the reporter's
 * name and address - the same facts as the private note the incident takes
 * with it - and once the incident is gone nothing records whether it was
 * private. Letting such a row through would show a private report's
 * reporter to everyone in the project the moment the incident was deleted,
 * by any path (the API, a workflow, retention, raw SQL). So a submission
 * with no incident is listed only for callers who see every incident anyway:
 * project owners and admins, root and master admins, who are not narrowed
 * at all (see shouldBypassIncidentPrivacy).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );

    return super.countBy(countBy);
  }

  /*
   * Nobody but root may update a submission today (the update list is
   * empty), and root is never narrowed. Filtered anyway, so granting update
   * later cannot reach the submissions of hidden incidents.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = applyIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    return { updateBy, carryForward: null };
  }

  /*
   * An incident admin cannot delete what they cannot list, including a
   * submission whose incident is gone: a project owner or admin can, or the
   * submission can be deleted before its incident is.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
