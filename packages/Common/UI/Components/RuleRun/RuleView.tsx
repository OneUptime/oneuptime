import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import Select from "../../../Types/BaseDatabase/Select";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  RuleRunResourceNouns,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import RuleCriteriaSubject from "../../../Types/Rules/RuleCriteriaSubject";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Navigation from "../../Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import type { ModelField } from "../Forms/ModelForm";
import { FormStep } from "../Forms/Types/FormStep";
import { ModalWidth } from "../Modal/Modal";
import ModelDelete from "../ModelDelete/ModelDelete";
import CardModelDetail from "../ModelDetail/CardModelDetail";
import Field from "../ModelDetail/Field";
import FieldType from "../Types/FieldType";
import {
  doesRuleAddNothing,
  getRuleActionColumns,
  RuleActionColumns,
} from "./RuleAction";
import RuleAddsNothingPill from "./RuleAddsNothingPill";
import { getRuleDetailFields, RuleDetailFields } from "./RuleDetailFields";
import RunRuleNowModal from "./RunRuleNowModal";
import React, { Fragment, ReactElement, useMemo, useState } from "react";
import {
  translateNamedAction,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * What a page says about each rule of a model it shares with another
 * product, from the rule as it was read with `select`. A cloud rule made
 * before Cloud and App Platforms split wears a pill beside its actions on
 * its own page ("Also in Cloud"), as it does on each product's list, and
 * Run Now says it runs over the records of both products.
 */
export interface RuleWording<TBaseModel extends BaseModel> {
  select: Select<TBaseModel>;
  getBadge?: ((rule: TBaseModel) => ReactElement | null) | undefined;
  getRunNouns?:
    | ((rule: TBaseModel) => RuleRunResourceNouns | undefined)
    | undefined;
}

/*
 * WHO MAY CHANGE A RULE TEAMS CAN OWN, ON ITS OWN PAGE
 * (Types/TeamOwnedRule/TeamOwnedRuleKinds): a rule some teams own is
 * changed and deleted only with the permissions of those teams, and by the
 * project's owners and admins. Its page reads which teams own it, as its
 * list does for its row, and hands RuleView this: its Edit and Delete
 * locked as its row's are, saying which teams own it, and its details
 * naming them, as the list's column does.
 */
export interface RuleOwnership<TBaseModel extends BaseModel> {
  /*
   * The locks of its Edit and Delete beyond the permissions of its kind
   * (PermissionGate.checkTeamOwnedRule): allowed, or refused with the
   * reason its row gives, or - while who owns it is read - refused with
   * nothing to say yet, which holds them back for that moment.
   */
  editLock: PermissionGateResult;
  deleteLock: PermissionGateResult;
  // The teams that own it, last among its details.
  owningTeamsField?: Field<TBaseModel> | undefined;
  // Its Edit saved, which may have changed who owns it: read them again.
  onRuleSaved?: (() => void) | undefined;
}

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  ruleId: ObjectID;
  // The same fields the rule table creates and edits the rule with.
  formFields: Array<ModelField<TBaseModel>>;
  formSteps?: Array<FormStep<TBaseModel>> | undefined;
  // Where to go once the rule is deleted: the table it is listed in.
  listRoute: Route;
  createEditModalWidth?: ModalWidth | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  /*
   * What the page calls a rule and its records, where that is not the
   * model's: App Platforms' rules are Cloud Environment Owner Rules, about
   * cloud environments, in a table whose model says Cloud Resource. The
   * edit and delete buttons say the rule's name, its conditions and the
   * edit form say the records, and Run Now says what it runs over.
   */
  singularName?: string | undefined;
  ruleCriteriaSubject?: RuleCriteriaSubject | undefined;
  ruleRunNouns?: RuleRunResourceNouns | undefined;
  ruleWording?: RuleWording<TBaseModel> | undefined;
  // The Edit form's fields that are no columns, filled in (ModelForm's onItemFetched).
  onEditFormItemFetched?:
    | ((item: TBaseModel) => Promise<TBaseModel>)
    | undefined;
  // Who may change it, for a rule of a kind teams can own (RuleOwnership).
  ownership?: RuleOwnership<TBaseModel> | undefined;
}

/*
 * A rule's own page: its details (editable with the same form as the table),
 * "Run Now", and delete - Edit and Delete locked, on a rule teams own, for
 * whoever those teams' permissions do not let change it (RuleOwnership).
 */
const RuleView: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = useMemo((): TBaseModel => {
    return new props.modelType();
  }, [props.modelType]);

  const ruleType: RuleRunType | null = RuleRunTypeUtil.fromTableName(
    model.tableName,
  );

  const [rule, setRule] = useState<TBaseModel | null>(null);
  const [isRunModalOpen, setIsRunModalOpen] = useState<boolean>(false);

  const detail: RuleDetailFields<TBaseModel> = useMemo(() => {
    return getRuleDetailFields({
      model: model,
      formFields: props.formFields,
      subject: props.ruleCriteriaSubject,
    });
  }, [model, props.formFields, props.ruleCriteriaSubject]);

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );

  const translator: Translator = useTranslator();
  const singularName: string =
    props.singularName?.trim() || model.singularName || translationKey("Rule");
  const ruleValues: Record<string, unknown> = (rule || {}) as unknown as Record<
    string,
    unknown
  >;
  const ruleName: string | undefined =
    typeof ruleValues["name"] === "string" ? ruleValues["name"] : undefined;
  const isEnabled: boolean = ruleValues["isEnabled"] === true;

  /*
   * A label or owner rule that adds nothing says so on its own page too, as
   * it does in its table (RuleAction): its card reads what the rule adds
   * already, as the details it shows.
   */
  const ruleAction: RuleActionColumns | null = useMemo(() => {
    return getRuleActionColumns(model);
  }, [model]);

  const addsNothing: boolean = Boolean(
    rule && ruleAction && doesRuleAddNothing(rule, ruleAction),
  );

  const badge: ReactElement | null =
    rule && props.ruleWording?.getBadge
      ? props.ruleWording.getBadge(rule)
      : null;

  // The rule's own nouns once it is read, the page's until then.
  const runNouns: RuleRunResourceNouns | undefined =
    (rule && props.ruleWording?.getRunNouns
      ? props.ruleWording.getRunNouns(rule)
      : undefined) || props.ruleRunNouns;

  const rightElement: ReactElement | undefined =
    badge && addsNothing ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {badge}
        <RuleAddsNothingPill />
      </span>
    ) : badge ? (
      badge
    ) : addsNothing ? (
      <RuleAddsNothingPill />
    ) : undefined;

  const runNowTooltip: string | undefined =
    updateGate.disabledReason ||
    (rule && !isEnabled
      ? translator.translateText(
          "This rule is disabled. Enable it before running it.",
        )
      : undefined);

  return (
    <Fragment>
      <CardModelDetail<TBaseModel>
        name={`${singularName} Details`}
        cardProps={{
          title:
            ruleName ||
            translateNamedAction(translator, {
              template: "{{itemName}} Details",
              itemName: singularName,
            }),
          description:
            "What this rule matches, and what it does to each match.",
          rightElement: rightElement,
        }}
        singularName={props.singularName}
        ruleCriteriaSubject={props.ruleCriteriaSubject}
        isEditable={true}
        formSteps={props.formSteps}
        formFields={props.formFields}
        createEditModalWidth={props.createEditModalWidth}
        modelAPI={props.modelAPI}
        onEditFormItemFetched={props.onEditFormItemFetched}
        editLock={props.ownership?.editLock}
        onSaveSuccess={() => {
          props.ownership?.onRuleSaved?.();
        }}
        modelDetailProps={{
          modelType: props.modelType,
          id: "rule-view-detail",
          modelId: props.ruleId,
          modelAPI: props.modelAPI,
          showDetailsInNumberOfColumns: 2,
          selectMoreFields: {
            ...detail.selectMoreFields,
            ...(props.ruleWording?.select || {}),
            name: true,
            isEnabled: true,
          } as Select<TBaseModel>,
          onItemLoaded: (item: TBaseModel) => {
            setRule(item);
          },
          fields: [
            {
              field: { _id: true } as Select<TBaseModel>,
              title: "Rule ID",
              fieldType: FieldType.ObjectID,
            },
            ...detail.fields,
            ...(props.ownership?.owningTeamsField
              ? [props.ownership.owningTeamsField]
              : []),
          ],
        }}
      />

      {ruleType && (updateGate.isAllowed || updateGate.disabledReason) ? (
        <Card
          title="Run Now"
          description={RuleRunSummary.describeRunNowCard(ruleType, runNouns)}
          buttons={[
            {
              title: "Run Now",
              icon: IconProp.Play,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !updateGate.isAllowed || !isEnabled,
              tooltip: runNowTooltip,
              onClick: () => {
                if (!updateGate.isAllowed || !isEnabled) {
                  return;
                }

                setIsRunModalOpen(true);
              },
            },
          ]}
        />
      ) : (
        <></>
      )}

      <ModelDelete<TBaseModel>
        modelType={props.modelType}
        modelId={props.ruleId}
        modelAPI={props.modelAPI}
        singularName={props.singularName}
        deleteLock={props.ownership?.deleteLock}
        onDeleteSuccess={() => {
          Navigation.navigate(props.listRoute);
        }}
      />

      {ruleType && isRunModalOpen ? (
        <RunRuleNowModal
          ruleType={ruleType}
          ruleId={props.ruleId.toString()}
          ruleName={ruleName}
          nouns={runNouns}
          onClose={() => {
            setIsRunModalOpen(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RuleView;
