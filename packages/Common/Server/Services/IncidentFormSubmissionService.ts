import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentFormSubmission";
import { applyOptionalIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Incident form submissions are written by the form's submit route, as
 * root; nothing here creates them.
 *
 * A submission names its incident, so it must not show a private incident
 * to someone who cannot see it: every read, count and delete is narrowed to
 * submissions whose incident the caller can see, as incident notes are. The
 * null-tolerant variant of the filter is used because the incident link is
 * optional - it is cleared when the incident is deleted - and a submission
 * with no incident has nothing to hide. Project owners and admins, and root,
 * are not narrowed (see shouldBypassIncidentPrivacy).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
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
    updateBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
