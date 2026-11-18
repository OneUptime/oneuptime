import FireDrillModal from "./FireDrillModal";
import { FIRE_DRILL_WORDS } from "./OnCallTestPageWords";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * RUN FIRE DRILL (#7012): a monitor's failure rehearsed as a test, in the
 * dialog it opens (FireDrillModal). Shown on the monitor's "When this goes
 * down" card, beside what it says the failure pages - and only where the
 * failure pages an on-call policy, as there is nothing to drill otherwise.
 * The beaker every test page's button carries: it is a test.
 */

export interface ComponentProps {
  monitorId: string;
  /*
   * Told when a drill is started, and when its dialog closes: the card's
   * Last fire drill line reads the drill again then (#9386).
   */
  onStarted?: (() => void) | undefined;
  onClosed?: (() => void) | undefined;
}

const FireDrillButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <Button
        title={FIRE_DRILL_WORDS.button}
        icon={IconProp.Beaker}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        dataTestId="run-fire-drill"
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <FireDrillModal
          monitorId={props.monitorId}
          onStarted={() => {
            props.onStarted?.();
          }}
          onClose={() => {
            setIsOpen(false);
            props.onClosed?.();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default FireDrillButton;
