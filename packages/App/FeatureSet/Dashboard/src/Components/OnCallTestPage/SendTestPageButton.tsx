import { OnCallTestPageTarget } from "./OnCallTestPageApi";
import SendTestPageModal from "./SendTestPageModal";
import IconProp from "Common/Types/Icon/IconProp";
import { OnCallTestPageResult } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A BUTTON THAT SENDS A TEST PAGE (OnCallTestPage) and shows what becomes of
 * it, in the dialog it opens. Any page or guided setup can put one where a
 * test belongs: to the person themselves, to a member, or to a policy.
 */

export interface ComponentProps {
  target: OnCallTestPageTarget;
  // English, translated by the button.
  title?: string | undefined;
  buttonStyle?: ButtonStyleType | undefined;
  buttonSize?: ButtonSize | undefined;
  icon?: IconProp | undefined;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  dataTestId?: string | undefined;
  onSent?: ((executionLogId: string) => void) | undefined;
  onResult?: ((result: OnCallTestPageResult) => void) | undefined;
}

export function getDefaultButtonTitle(target: OnCallTestPageTarget): string {
  if (target.kind === "policy") {
    return "Test this policy";
  }

  if (target.kind === "member") {
    return "Send test page";
  }

  return "Send me a test page";
}

const SendTestPageButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <Button
        title={props.title || getDefaultButtonTitle(props.target)}
        icon={props.icon || IconProp.Beaker}
        buttonStyle={props.buttonStyle || ButtonStyleType.NORMAL}
        buttonSize={props.buttonSize}
        disabled={props.disabled}
        tooltip={props.tooltip}
        dataTestId={props.dataTestId || "send-test-page"}
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <SendTestPageModal
          target={props.target}
          onClose={() => {
            setIsOpen(false);
          }}
          onSent={props.onSent}
          onResult={props.onResult}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SendTestPageButton;
