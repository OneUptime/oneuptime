import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AutoRemediationDecision";
import { applyOptionalAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import { applyOptionalIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A decision names the clusters, resources and rules that looked at an
   * incident or alert, so it is read with the subject's privacy, exactly
   * like the suggestions beside it (AutoRemediationSuggestionService). Both
   * link columns are nullable (a row links an incident OR an alert), so the
   * null-tolerant filter variants apply: a NULL link passes its own clause
   * and the sibling column's filter does the gating.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    findBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
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
    countBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    updateBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
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
    deleteBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }
}

export default new Service();
