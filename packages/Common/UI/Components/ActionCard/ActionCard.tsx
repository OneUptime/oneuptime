import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ConfirmModal from "../Modal/ConfirmModal";
import IconProp from "../../../Types/Icon/IconProp";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement, useState } from "react";

export interface ConfirmAction {
  actionName: string;
  actionIcon: IconProp;
  onConfirmAction: () => void;
  actionButtonStyle?: ButtonStyleType;
  isLoading?: boolean;
}

export interface ComponentProps {
  title: string;
  description: string;
  actions: Array<ConfirmAction>;
}

const DESTRUCTIVE_ACTION_STYLES: Array<ButtonStyleType> = [
  ButtonStyleType.DANGER,
  ButtonStyleType.DANGER_OUTLINE,
  ButtonStyleType.HOVER_DANGER_OUTLINE,
];

const ActionCard: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [currentAction, setCurrentAction] = useState<ConfirmAction | undefined>(
    undefined,
  );

  return (
    <>
      <Card
        title={props.title}
        description={props.description}
        buttons={props.actions.map((action: ConfirmAction) => {
          return {
            title: action.actionName,
            /*
             * `??`: ButtonStyleType.PRIMARY is 0, and `||` turned an action
             * its author marked PRIMARY into a plain button.
             */
            buttonStyle: action.actionButtonStyle ?? ButtonStyleType.NORMAL,
            onClick: () => {
              setCurrentAction(action);
            },
            icon: action.actionIcon,
            isLoading: action.isLoading,
          };
        })}
      />

      {currentAction ? (
        <ConfirmModal
          description={translator.translateTemplate(
            "Are you sure you want to {{action}}?",
            {
              action: translatableTerm(currentAction.actionName, {
                inSentence: true,
              }),
            },
          )}
          title={translator.translateTemplate("Confirm {{action}}", {
            action: translatableTerm(currentAction.actionName),
          })}
          onSubmit={() => {
            currentAction.onConfirmAction();
            setCurrentAction(undefined);
          }}
          /*
           * The button says what it does, and is the dialog's one primary
           * action - red when the action it confirms destroys something.
           */
          submitButtonText={currentAction.actionName}
          submitButtonType={
            currentAction.actionButtonStyle !== undefined &&
            DESTRUCTIVE_ACTION_STYLES.includes(currentAction.actionButtonStyle)
              ? ButtonStyleType.DANGER
              : ButtonStyleType.PRIMARY
          }
          onClose={() => {
            setCurrentAction(undefined);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ActionCard;
