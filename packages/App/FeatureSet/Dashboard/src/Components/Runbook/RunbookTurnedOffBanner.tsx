import {
  RUNBOOK_TURNED_OFF_BANNER_TEST_ID,
  RUNBOOK_TURN_ON_BUTTON_TEST_ID,
  RUNBOOK_TURN_ON_ERROR_TEST_ID,
  RunbookOverviewCopy,
} from "./RunbookOverviewState";
import RunbookSwitchCopy, { RUNBOOK_SWITCH_COLUMN } from "./RunbookSwitchCopy";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import useSaveModelSwitch, {
  SaveModelSwitch,
} from "Common/UI/Components/ModelSwitch/useSaveModelSwitch";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  runbookId: ObjectID;
  // Told once the runbook is on again.
  onTurnedOn: () => void;
}

/*
 * At the top of a runbook's Overview while its Run this runbook switch is
 * off: that it does not run, and a button that turns it on right there -
 * what the switch on the runbook's Settings page saves, gated the same way
 * (useSaveModelSwitch). Run Now, rules, the schedule and the webhook are all
 * refused while it is off, and the Overview used to say nothing of it.
 *
 * A quiet banner with a pause icon, like a turned-off monitor's or an
 * incoming call policy's: a runbook someone switched off is a choice, not
 * an outage. Drawn only while the runbook is off.
 */
const RunbookTurnedOffBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const turnOn: SaveModelSwitch = useSaveModelSwitch<Runbook>({
    modelType: Runbook,
    modelId: props.runbookId,
    column: RUNBOOK_SWITCH_COLUMN,
    value: true,
    onSaved: props.onTurnedOn,
  });

  /*
   * Hidden only while there is nothing honest to say about it: the
   * permission snapshot has not arrived yet. Someone who may not turn the
   * runbook on sees it locked, with why.
   */
  const showButton: boolean =
    turnOn.gate.isAllowed || Boolean(turnOn.gate.disabledReason);

  return (
    <AlertBanner
      type={AlertBannerType.Info}
      icon={IconProp.PauseCircle}
      title={RunbookOverviewCopy.turnedOffTitle}
      dataTestId={RUNBOOK_TURNED_OFF_BANNER_TEST_ID}
      className="mb-5"
      rightElement={
        showButton ? (
          <Button
            title={RunbookOverviewCopy.turnOnButton}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={RUNBOOK_TURN_ON_BUTTON_TEST_ID}
            isLoading={turnOn.isSaving}
            disabled={!turnOn.gate.isAllowed}
            tooltip={turnOn.gate.disabledReason}
            onClick={turnOn.save}
          />
        ) : undefined
      }
    >
      <>
        <p>
          {translator.translateText(RunbookSwitchCopy.switchOffDescription)}
        </p>
        {turnOn.error ? (
          <p
            className="mt-1 text-sm text-red-600"
            role="alert"
            data-testid={RUNBOOK_TURN_ON_ERROR_TEST_ID}
          >
            {turnOn.error}
          </p>
        ) : (
          <></>
        )}
      </>
    </AlertBanner>
  );
};

export default RunbookTurnedOffBanner;
