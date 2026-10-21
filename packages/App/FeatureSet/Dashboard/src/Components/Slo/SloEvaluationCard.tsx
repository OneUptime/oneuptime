import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import SloEvaluationSwitchCopy, {
  SLO_EVALUATION_DETAILS_ID,
  SLO_EVALUATION_SWITCH_COLUMN,
  SLO_EVALUATION_SWITCH_TEST_ID,
} from "./SloEvaluationSwitchCopy";

/*
 * "Evaluation", on an SLO's Settings page: one switch, "Evaluate this SLO",
 * that saves the moment it is flipped, with when OneUptime last evaluated
 * the SLO as a read-only line under it.
 *
 * Turning evaluation off asks first: it also resolves every burn rate alert
 * and incident the SLO has open. Turning it on saves at once. The banner at
 * the top of the page hears the switch (ModelSwitchEvents) and reads the SLO
 * again, so it never says "This SLO is disabled" over a switch that is on.
 *
 * See SloEvaluationSwitchCopy for what it replaced.
 */

export interface ComponentProps {
  sloId: ObjectID;
}

export const getTurnOffSloEvaluationConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: SloEvaluationSwitchCopy.turnOffConfirmTitle,
    description: SloEvaluationSwitchCopy.turnOffConfirmDescription,
    submitButtonText: SloEvaluationSwitchCopy.turnOffConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

interface LastEvaluatedProps {
  slo: ServiceLevelObjective;
}

const LastEvaluated: FunctionComponent<LastEvaluatedProps> = (
  props: LastEvaluatedProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Detail<ServiceLevelObjective>
      id={SLO_EVALUATION_DETAILS_ID}
      item={props.slo}
      showDetailsInNumberOfColumns={1}
      fields={[
        {
          key: "lastEvaluatedAt",
          title: SloEvaluationSwitchCopy.lastEvaluatedTitle,
          fieldType: FieldType.Element,
          getElement: (item: ServiceLevelObjective): ReactElement => {
            if (!item.lastEvaluatedAt) {
              return (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900">
                    {translator.translateText(
                      SloEvaluationSwitchCopy.notEvaluatedYet,
                    )}
                  </p>
                  <p className="text-gray-500">
                    {translator.translateText(
                      SloEvaluationSwitchCopy.notEvaluatedYetDescription,
                    )}
                  </p>
                </div>
              );
            }

            const lastEvaluatedAt: Date = OneUptimeDate.fromString(
              item.lastEvaluatedAt,
            );

            return (
              <span
                className="font-medium text-gray-900"
                title={OneUptimeDate.getDateAsLocalFormattedString(
                  lastEvaluatedAt,
                )}
              >
                {OneUptimeDate.fromNow(lastEvaluatedAt)}
              </span>
            );
          },
        },
      ]}
    />
  );
};

const SloEvaluationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<ServiceLevelObjective>
      modelType={ServiceLevelObjective}
      modelId={props.sloId}
      column={SLO_EVALUATION_SWITCH_COLUMN}
      cardTitle={SloEvaluationSwitchCopy.cardTitle}
      cardDescription={SloEvaluationSwitchCopy.cardDescription}
      title={SloEvaluationSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? SloEvaluationSwitchCopy.switchOnDescription
          : SloEvaluationSwitchCopy.switchOffDescription;
      }}
      getConfirmation={getTurnOffSloEvaluationConfirmation}
      select={{
        lastEvaluatedAt: true,
      }}
      getDetails={(item: ServiceLevelObjective): ReactElement => {
        return <LastEvaluated slo={item} />;
      }}
      dataTestId={SLO_EVALUATION_SWITCH_TEST_ID}
    />
  );
};

export default SloEvaluationCard;
