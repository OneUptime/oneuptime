import ProjectReferencesService from "./ProjectReferencesService";
import DataAlert from "../../Models/DatabaseModels/DataAlert";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import {
  applyAlertRelatedRecordPrivacyFilter,
  getOptionalAlertRelatedRecordPrivacyRaw,
} from "../Utils/Alert/AlertPrivacyFilter";
import { combineWithPrivacyClause } from "../Utils/PrivacyFilterUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * What each data monitor's alert is about, and the alert it is a
 * consequence of. OneUptime writes them as the alert is created
 * (Utils/DataObservability/DataAlertCause); nobody else creates, edits or
 * deletes one.
 */
export class Service extends ProjectReferencesService<DataAlert> {
  public constructor() {
    super(DataAlert);
  }

  /*
   * Written as a monitor creates the alert, from the monitor's own project
   * and what it resolved there; checking each reference again would only
   * slow the alert down.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * A row shows its alert, and the alert it is a consequence of, through
   * relation joins (`select: { alert: { title } }`, as an alert's Data
   * card and its Downstream Impact read them), and a join runs neither
   * alert's own read rules: a private alert is seen only by its owners. So
   * a row is read only by someone who may see its alert and, when it has
   * one, its cause - the alert's privacy filter on alertId, and the same,
   * null-tolerant, on causeAlertId. Nobody but OneUptime writes a row
   * (create, update and delete: []), so reads are all there is to narrow.
   */
  private static applyPrivacyFilters<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    const filtered: T = applyAlertRelatedRecordPrivacyFilter(query, props);
    const causeClause: FindWhereProperty<any> | undefined =
      getOptionalAlertRelatedRecordPrivacyRaw(props);

    if (!causeClause) {
      return filtered;
    }

    (filtered as Record<string, unknown>)["causeAlertId"] =
      combineWithPrivacyClause(
        (filtered as Record<string, unknown>)["causeAlertId"],
        causeClause,
      );

    return filtered;
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<DataAlert>,
  ): Promise<OnFind<DataAlert>> {
    findBy.query = Service.applyPrivacyFilters(findBy.query, findBy.props);

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<DataAlert>,
  ): Promise<PositiveNumber> {
    countBy.query = Service.applyPrivacyFilters(countBy.query, countBy.props);

    return super.countBy(countBy);
  }
}

export default new Service();
