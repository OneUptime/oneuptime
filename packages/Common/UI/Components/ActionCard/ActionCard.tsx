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
  /*
   * What the confirmation also asks, under its question - the repository a
   * fix is made in, when none was found for certain. Read from the card's
   * props of now while the confirmation is open, so it follows what the
   * person picks there.
   */
  confirmContent?: ReactElement | undefined;
  // The confirmation's button waits for that answer.
  isConfirmDisabled?: boolean | undefined;
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
  /*
   * Which action is being confirmed, by its place: the action itself is
   * read from the props of now, so what its confirmation asks follows the
   * answers given there (confirmContent, isConfirmDisabled).
   */
  const [currentActionIndex, setCurrentActionIndex] = useState<
    number | undefined
  >(undefined);
  const currentAction: ConfirmAction | undefined =
    currentActionIndex === undefined
      ? undefined
      : props.actions[currentActionIndex];
  const setCurrentAction: (action: ConfirmAction | undefined) => void = (
    action: ConfirmAction | undefined,
  ): void => {
    setCurrentActionIndex(
      action === undefined ? undefined : props.actions.indexOf(action),
    );
  };

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
          isTitleTranslated={true}
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
          disableSubmitButton={Boolean(currentAction.isConfirmDisabled)}
          onClose={() => {
            setCurrentAction(undefined);
          }}
        >
          {currentAction.confirmContent}
        </ConfirmModal>
      ) : (
        <></>
      )}
    </>
  );
};

export default ActionCard;
