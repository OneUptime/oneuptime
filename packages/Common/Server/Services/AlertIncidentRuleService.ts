import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AlertIncidentRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import {
  ALERT_INCIDENT_RULE_WAIT_COLUMN,
  getAlertIncidentRuleWaitInMinutes,
  getAlertIncidentRuleWaitProblem,
} from "../../Types/Alert/AlertIncidentRuleWait";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * Alert incident rules: which alerts have an incident declared from them,
 * and how (AlertIncidentRuleEngineService reads them).
 *
 * Every monitor, severity and label a rule names, and the incident severity
 * it declares with, must be the project's own (ProjectReferencesService).
 * Its wait - "Declare After (Minutes)" - is a whole number of minutes from 0
 * to a week (Types/Alert/AlertIncidentRuleWait), for every caller: the
 * Dashboard's form, the API, Terraform, MCP and workflows. A wait sent as
 * nothing is the column's default, 0 - declare right away - and one sent as
 * text is the number it spells. Both are refused or settled before anything
 * the rule names is looked up: they need no lookup.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    this.settleWait(createBy.data as unknown as Record<string, unknown>);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    // An edit that leaves the wait alone is not judged on it.
    if (data[ALERT_INCIDENT_RULE_WAIT_COLUMN] === undefined) {
      return;
    }

    this.settleWait(data);
  }

  /*
   * Refuses a wait that is not a whole number of minutes from 0 to a week,
   * and writes one that is as the number it is: nothing as 0.
   */
  private settleWait(data: Record<string, unknown>): void {
    const value: unknown = data[ALERT_INCIDENT_RULE_WAIT_COLUMN];

    const problem: string | null = getAlertIncidentRuleWaitProblem(value);

    if (problem) {
      throw new BadDataException(problem);
    }

    if (value === undefined) {
      return;
    }

    data[ALERT_INCIDENT_RULE_WAIT_COLUMN] =
      getAlertIncidentRuleWaitInMinutes(value);
  }
}

export default new Service();
