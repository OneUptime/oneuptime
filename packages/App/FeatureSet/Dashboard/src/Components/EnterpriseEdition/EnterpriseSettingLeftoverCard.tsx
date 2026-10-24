import EnterpriseSettingLeftover from "./EnterpriseSettingLeftover";
import {
  ENTERPRISE_SETTING_LEFTOVER_COLUMNS,
  EnterpriseSettingLeftoverKind,
  EnterpriseSettingLeftoverReason,
  getEnterpriseSettingLeftoverCopy,
  getEnterpriseSettingLeftoverTestId,
} from "./EnterpriseSettingLeftoverCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * One Enterprise setting's leftover card, in its own words
 * (EnterpriseSettingLeftoverCopy): what a shell hands EnterprisePluginPage
 * as `belowPlan` (reason Plan) and `communityLeftover` (reason Edition).
 */

export interface ComponentProps<TModel extends BaseModel> {
  kind: EnterpriseSettingLeftoverKind;
  reason: EnterpriseSettingLeftoverReason;
  // The plan that sells the setting on OneUptime Cloud.
  requiredPlan: PlanType;
  modelType: { new (): TModel };
  modelId: ObjectID;
  renderValue: (item: TModel) => ReactElement;
  onLoaded?: ((item: TModel | null) => void) | undefined;
  onRemoved?: (() => void) | undefined;
}

const EnterpriseSettingLeftoverCard: <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <EnterpriseSettingLeftover<TModel>
      modelType={props.modelType}
      modelId={props.modelId}
      columns={ENTERPRISE_SETTING_LEFTOVER_COLUMNS[props.kind]}
      copy={getEnterpriseSettingLeftoverCopy({
        kind: props.kind,
        reason: props.reason,
        planName: props.requiredPlan,
        translateTemplate: (
          template: string,
          values: Record<string, string>,
        ): string => {
          return translator.translateTemplate(template, values);
        },
      })}
      renderValue={props.renderValue}
      dataTestId={getEnterpriseSettingLeftoverTestId(props.kind)}
      onLoaded={props.onLoaded}
      onRemoved={props.onRemoved}
    />
  );
};

export default EnterpriseSettingLeftoverCard;
