import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AIInvestigationRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  AI_INVESTIGATION_RULE_CRITERIA_FIELDS,
  getAIInvestigationRuleCriteriaProblem,
} from "../../Types/AI/AIInvestigationRuleCriteria";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * One table holds incident and alert investigation rules, and each can
   * only match on its own kind of signal's criteria: a condition on alert
   * severities can never be true for an incident. Such a rule is refused
   * instead of being saved as one that silently never matches - which,
   * since rules narrow what is investigated, would quietly stop
   * investigations.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeCreate(createBy);

    this.assertCriteriaFitTrigger({
      triggerEntityType: createBy.data.triggerEntityType,
      data: createBy.data as unknown as Record<string, unknown>,
    });

    return { createBy, carryForward: null };
  }

  /*
   * The trigger cannot change after a rule is created, so an edit is judged
   * against the trigger of every rule it touches. Edits that change no
   * criteria are not read back at all.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;
    const changesCriteria: boolean =
      (data["criteria"] !== undefined && data["criteria"] !== null) ||
      AI_INVESTIGATION_RULE_CRITERIA_FIELDS.some((field: string): boolean => {
        const value: unknown = data[field];
        return Array.isArray(value) && value.length > 0;
      });

    if (!changesCriteria) {
      return { updateBy, carryForward: null };
    }

    // The rules the update writes, and the update held to them.
    const rules: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        triggerEntityType: true,
      },
    );

    for (const rule of rules) {
      this.assertCriteriaFitTrigger({
        triggerEntityType: rule.triggerEntityType,
        data: data,
      });
    }

    return { updateBy, carryForward: null };
  }

  private assertCriteriaFitTrigger(data: {
    triggerEntityType: unknown;
    data: Record<string, unknown>;
  }): void {
    const problem: string | null = getAIInvestigationRuleCriteriaProblem({
      triggerEntityType: data.triggerEntityType,
      criteria: data.data["criteria"],
      values: data.data,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }
}

export default new Service();
