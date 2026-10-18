import {
  INCOMING_CALL_ANSWER_CALLS_COLUMN,
  INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
  INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID,
  INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID,
  IncomingCallAnswerCallsCopy,
} from "./IncomingCallPolicySettingsCopy";
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
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  policyId: ObjectID;
  // Told once calls are answered again.
  onStartedAnswering: () => void;
}

/*
 * At the top of an incoming call policy's Overview while its Answer Calls
 * switch is off: what callers hear, and a button that turns calls back on
 * right there - what Answer Calls on Settings does, gated the same way.
 * It used to be one line in a card's description, "Set up, but not
 * answering calls. Turn on Answer Calls under Settings.", a trip to another
 * page for a one-press fix.
 *
 * A quiet banner with a pause icon, like a turned-off monitor's: a line
 * someone switched off is a choice, not an outage. Drawn only while calls
 * are off; the Overview leaves it out otherwise.
 */
const IncomingCallAnswerCallsOffBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const startAnswering: SaveModelSwitch =
    useSaveModelSwitch<IncomingCallPolicy>({
      modelType: IncomingCallPolicy,
      modelId: props.policyId,
      column: INCOMING_CALL_ANSWER_CALLS_COLUMN,
      value: true,
      onSaved: props.onStartedAnswering,
    });

  /*
   * Hidden only while there is nothing honest to say about it: the
   * permission snapshot has not arrived yet. Someone who may not turn calls
   * on sees it locked, with why.
   */
  const showButton: boolean =
    startAnswering.gate.isAllowed ||
    Boolean(startAnswering.gate.disabledReason);

  return (
    <AlertBanner
      type={AlertBannerType.Info}
      icon={IconProp.PauseCircle}
      title={IncomingCallAnswerCallsCopy.offBannerTitle}
      dataTestId={INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID}
      className="mb-5"
      rightElement={
        showButton ? (
          <Button
            title={IncomingCallAnswerCallsCopy.startAnsweringButton}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID}
            isLoading={startAnswering.isSaving}
            disabled={!startAnswering.gate.isAllowed}
            tooltip={startAnswering.gate.disabledReason}
            onClick={startAnswering.save}
          />
        ) : undefined
      }
    >
      <>
        <p>
          {translator.translateText(
            IncomingCallAnswerCallsCopy.switchOffDescription,
          )}
        </p>
        {startAnswering.error ? (
          <p
            className="mt-1 text-sm text-red-600"
            role="alert"
            data-testid={INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID}
          >
            {startAnswering.error}
          </p>
        ) : (
          <></>
        )}
      </>
    </AlertBanner>
  );
};

export default IncomingCallAnswerCallsOffBanner;
