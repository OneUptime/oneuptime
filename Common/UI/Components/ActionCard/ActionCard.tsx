import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ConfirmModal from "../Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
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

const ActionCard: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
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
            buttonStyle: action.actionButtonStyle || ButtonStyleType.NORMAL,
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
          description={`Are you sure you want to ${currentAction.actionName}?`}
          title={`Confirm ${currentAction.actionName}`}
          onSubmit={() => {
            currentAction.onConfirmAction();
            setCurrentAction(undefined);
          }}
          submitButtonText={`Confirm`}
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
