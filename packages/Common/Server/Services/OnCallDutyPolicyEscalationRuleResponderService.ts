import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import { getDefaultEscalationRuleName } from "../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { EscalationRuleNames } from "../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import PositiveNumber from "../../Types/PositiveNumber";
import CreateBy from "../Types/Database/CreateBy";
import Query from "../Types/Database/Query";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyChildService from "./OnCallDutyPolicyChildService";

/*
 * The responder a row of an escalation rule names: the rule, and the columns
 * that say who or what it pages there - the person's id, the team's, or the
 * schedule's with whether the next person in its rotation is paged. The
 * same columns, in the same order, as the table's unique index
 * (Types/OnCallDutyPolicy/EscalationRuleResponderOnce).
 */
export interface EscalationRuleResponder {
  ruleId: ObjectID;
  columns: Dictionary<ObjectID | boolean>;
}

/*
 * ONE ROW PER RESPONDER OF AN ESCALATION RULE (#10411): the services of the
 * rows an escalation rule pages through - OnCallDutyPolicyEscalationRuleUser,
 * ...Team and ...Schedule. The why is in EscalationRuleResponderOnce.
 *
 * A create naming a responder the rule has already is refused before it is
 * written (onBeforeCreateUniqueCheck), so it never reaches onCreateSuccess:
 * nobody is told again that they were added, and the feed and the channels
 * hear of nothing. Two creates at the same moment both pass that read, and
 * the table's partial unique index refuses the one that loses: it is refused
 * in the same words (create). Both are tagged as a unique violation
 * (PostgresErrorTranslator.createUniqueViolationException), so a caller that
 * takes "already there" as done - Ask AI's add_to_on_call_policy - tells it
 * from any other refusal with one check, whichever of the two refused it.
 * The refusal is a 400 with the sentence, to the Dashboard, the API, the
 * CLI and Terraform alike.
 *
 * Each service says which index holds its rows (getResponderIndexName),
 * reads the responder a write names (readResponder) and words the refusal,
 * naming the responder as the project knows it (getAlreadyOnRuleRefusal).
 */
export default abstract class OnCallDutyPolicyEscalationRuleResponderService<
  TBaseModel extends BaseModel,
> extends OnCallDutyPolicyChildService<TBaseModel> {
  // The partial unique index that holds one row per responder of a rule.
  protected abstract getResponderIndexName(): string;

  /*
   * The responder `data` names on its rule, its ids read under both of
   * their names (RelationIdUtil.readConsistent). Null when it names no rule
   * or no responder: the create's own checks answer that.
   */
  protected abstract readResponder(
    data: TBaseModel,
  ): EscalationRuleResponder | null;

  /*
   * The sentence that refuses a second row of `responder`, naming it as
   * `projectId` knows it and naming the rule (`rule`, null when it could
   * not be read).
   */
  protected abstract getAlreadyOnRuleRefusal(data: {
    responder: EscalationRuleResponder;
    rule: EscalationRuleNames | null;
    projectId: ObjectID | null;
  }): Promise<string>;

  /*
   * An add that lost a race to the index: the other add's row is there, and
   * this one is refused as the check before the write would have refused
   * it. Any other failure is thrown as it came.
   */
  @CaptureSpan()
  public override async create(
    createBy: CreateBy<TBaseModel>,
  ): Promise<TBaseModel> {
    try {
      return await super.create(createBy);
    } catch (error) {
      if (
        !PostgresErrorTranslator.isUniqueViolationOf(
          error,
          this.getResponderIndexName(),
        )
      ) {
        throw error;
      }

      /*
       * The create has read the ids into their columns by now (the policy
       * and the rule, and the rest before its hooks ran), and refused any
       * write whose two names of one id disagree, so the read cannot be
       * refused here. If it is anyway, the database's own words stand.
       */
      let responder: EscalationRuleResponder | null = null;

      try {
        responder = this.readResponder(createBy.data);
      } catch {
        responder = null;
      }

      if (!responder) {
        throw error;
      }

      logger.debug(
        `${this.getModel().tableName}: a second row of a responder of escalation rule ${responder.ruleId.toString()}, added at the moment another was, refused.`,
      );

      throw PostgresErrorTranslator.createUniqueViolationException(
        await this.getRefusal(responder, createBy),
      );
    }
  }

  /*
   * After the caller's permission checks, before the row is written: a
   * responder the rule has already is refused, naming it and the rule. The
   * rows read are the index's - those not deleted - and every caller's, so
   * the answer is the one the index would give. Skipped with ignoreHooks, as
   * every unique check of a service's own is: the index refuses such a
   * write, and create() words it.
   */
  @CaptureSpan()
  protected override async onBeforeCreateUniqueCheck(
    createBy: CreateBy<TBaseModel>,
  ): Promise<void> {
    await super.onBeforeCreateUniqueCheck(createBy);

    const responder: EscalationRuleResponder | null = this.readResponder(
      createBy.data,
    );

    if (!responder) {
      return;
    }

    const rowsOfResponder: PositiveNumber = await this.countBy({
      query: {
        onCallDutyPolicyEscalationRuleId: responder.ruleId,
        ...responder.columns,
      } as unknown as Query<TBaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (rowsOfResponder.toNumber() > 0) {
      throw PostgresErrorTranslator.createUniqueViolationException(
        await this.getRefusal(responder, createBy),
      );
    }
  }

  // The rule of a row, as `data` names it, under both of its names.
  protected readRuleId(data: TBaseModel): ObjectID | null {
    return RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["onCallDutyPolicyEscalationRuleId", "onCallDutyPolicyEscalationRule"],
      "Escalation rule",
    );
  }

  // The refusal, with the rule's names read for it.
  private async getRefusal(
    responder: EscalationRuleResponder,
    createBy: CreateBy<TBaseModel>,
  ): Promise<string> {
    const rule: OnCallDutyPolicyEscalationRule | null = await new DatabaseService(
      OnCallDutyPolicyEscalationRule,
    ).findOneBy({
      query: {
        _id: responder.ruleId.toString(),
      },
      select: {
        _id: true,
        name: true,
        order: true,
        projectId: true,
        onCallDutyPolicy: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const projectId: ObjectID | null =
      rule?.projectId ||
      createBy.props.tenantId ||
      createBy.data.getValue<ObjectID>("projectId") ||
      null;

    return await this.getAlreadyOnRuleRefusal({
      responder: responder,
      rule: rule
        ? {
            ruleName:
              rule.name?.toString().trim() ||
              getDefaultEscalationRuleName(rule.order || 1),
            policyName: rule.onCallDutyPolicy?.name?.toString() || "",
          }
        : null,
      projectId: projectId,
    });
  }
}
