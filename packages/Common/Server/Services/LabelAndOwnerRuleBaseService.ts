import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  doesNewRuleAddSomething,
  getRuleActionColumns,
  getRuleAddsNothingMessage,
  RuleActionColumns,
} from "../../Utils/Rules/RuleAction";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * THE SERVICE OF EVERY LABEL RULE AND EVERY OWNER RULE.
 *
 * A label rule attaches labels to every new resource it matches, an owner
 * rule adds owners to it (Common/Utils/Rules/RuleAction says which columns
 * those are). A rule that adds nothing matches and does nothing: it sits in
 * the list looking like it works. The Dashboard's form never makes one, but
 * the API, Terraform, a workflow and a label rule import all create through
 * this service, so it refuses a NEW rule that adds nothing - no label, no
 * person or team, and on an incident, alert or scheduled maintenance rule
 * no Inherit switch on - with one plain answer naming the fields to fill.
 * Whoever creates it, OneUptime's own writes included.
 *
 * An update is not held to it: an Edit may empty a working rule, and a rule
 * saved before this check existed may add nothing. Either can still be
 * renamed, switched off or deleted, and its table marks it "Adds nothing"
 * (Common/UI/Components/RuleRun/RuleTable).
 *
 * Every rule is still a ProjectReferencesService: the labels, people and
 * teams it names must be the project's own. The check here reads nothing,
 * so it comes first: a rule that adds nothing is refused before anything is
 * looked up. Common/Tests/Server/Services/LabelAndOwnerRuleServicesRefuseEmptyRules
 * holds every label and owner rule service to it.
 */
export default class LabelAndOwnerRuleBaseService<
  TBaseModel extends BaseModel,
> extends ProjectReferencesService<TBaseModel> {
  private readonly ruleModelType: { new (): TBaseModel };
  private ruleAction: RuleActionColumns | undefined = undefined;

  public constructor(modelType: { new (): TBaseModel }) {
    super(modelType);
    this.ruleModelType = modelType;
  }

  /*
   * What this rule adds, read from the model on first use, not when the
   * service is built: services are built at import, and suites that stub
   * DatabaseService or the model would otherwise fail to load every one.
   */
  public getRuleAction(): RuleActionColumns {
    if (!this.ruleAction) {
      const ruleAction: RuleActionColumns | null = getRuleActionColumns(
        new this.ruleModelType(),
      );

      // A label or owner rule model only: anything else adds nothing to check.
      if (!ruleAction) {
        throw new Error(
          `${this.ruleModelType.name} is not a label or owner rule: it has no labels or owners to add.`,
        );
      }

      this.ruleAction = ruleAction;
    }

    return this.ruleAction;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    const ruleAction: RuleActionColumns = this.getRuleAction();

    if (!doesNewRuleAddSomething(createBy.data, ruleAction)) {
      throw new BadDataException(getRuleAddsNothingMessage(ruleAction));
    }

    return await super.onBeforeCreate(createBy);
  }
}
