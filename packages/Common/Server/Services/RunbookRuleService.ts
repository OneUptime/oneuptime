import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/RunbookRule";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import {
  getRunbookRuleCriteriaProblem,
  RUNBOOK_RULE_CRITERIA_FIELDS,
} from "../../Types/Runbook/RunbookRuleCriteria";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * One table holds incident, alert and scheduled maintenance runbook rules,
   * and each can only match on its own trigger's criteria: a condition on
   * alert severities can never be true for an incident. Such a rule is
   * refused instead of being saved as one that silently never runs.
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
      RUNBOOK_RULE_CRITERIA_FIELDS.some((field: string): boolean => {
        const value: unknown = data[field];
        return Array.isArray(value) && value.length > 0;
      });

    if (!changesCriteria) {
      return { updateBy, carryForward: null };
    }

    /*
     * onBeforeUpdate runs before the framework scopes the query to the
     * caller's project, so scope the read here.
     */
    const rules: Array<Model> = await this.findBy({
      query: {
        ...updateBy.query,
        ...(updateBy.props.tenantId
          ? { projectId: updateBy.props.tenantId }
          : {}),
      },
      select: {
        _id: true,
        triggerEntityType: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

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
    const problem: string | null = getRunbookRuleCriteriaProblem({
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
