import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import Select from "../../../Types/BaseDatabase/Select";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  RuleRunAction,
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
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
import FieldType from "../Types/FieldType";
import { getRuleDetailFields, RuleDetailFields } from "./RuleDetailFields";
import RunRuleNowModal from "./RunRuleNowModal";
import React, { Fragment, ReactElement, useMemo, useState } from "react";

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
}

function runNowDescription(ruleType: RuleRunType): string {
  const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(ruleType);

  if (meta.action === RuleRunAction.SyncStatusPageMonitors) {
    return "Re-sync this status page with this rule now: add the monitors it matches and remove the ones it added that no longer match.";
  }

  return `This rule runs automatically only when a ${meta.resourceSingular} is created. Run it now to apply it to the ${meta.resourcePlural} that already exist in this project.`;
}

/*
 * A rule's own page: its details (editable with the same form as the table),
 * "Run Now", and delete.
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
    return getRuleDetailFields({ model: model, formFields: props.formFields });
  }, [model, props.formFields]);

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );

  const singularName: string = model.singularName || "Rule";
  const ruleValues: Record<string, unknown> = (rule || {}) as unknown as Record<
    string,
    unknown
  >;
  const ruleName: string | undefined =
    typeof ruleValues["name"] === "string" ? ruleValues["name"] : undefined;
  const isEnabled: boolean = ruleValues["isEnabled"] === true;

  const runNowTooltip: string | undefined =
    updateGate.disabledReason ||
    (rule && !isEnabled
      ? "This rule is disabled. Enable it before running it."
      : undefined);

  return (
    <Fragment>
      <CardModelDetail<TBaseModel>
        name={`${singularName} Details`}
        cardProps={{
          title: ruleName || `${singularName} Details`,
          description: `Here are the details of this ${singularName.toLowerCase()}.`,
        }}
        isEditable={true}
        formSteps={props.formSteps}
        formFields={props.formFields}
        createEditModalWidth={props.createEditModalWidth}
        modelAPI={props.modelAPI}
        modelDetailProps={{
          modelType: props.modelType,
          id: "rule-view-detail",
          modelId: props.ruleId,
          modelAPI: props.modelAPI,
          showDetailsInNumberOfColumns: 2,
          selectMoreFields: {
            ...detail.selectMoreFields,
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
          ],
        }}
      />

      {ruleType && (updateGate.isAllowed || updateGate.disabledReason) ? (
        <Card
          title="Run Now"
          description={runNowDescription(ruleType)}
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
        onDeleteSuccess={() => {
          Navigation.navigate(props.listRoute);
        }}
      />

      {ruleType && isRunModalOpen ? (
        <RunRuleNowModal
          ruleType={ruleType}
          ruleId={props.ruleId.toString()}
          ruleName={ruleName}
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
