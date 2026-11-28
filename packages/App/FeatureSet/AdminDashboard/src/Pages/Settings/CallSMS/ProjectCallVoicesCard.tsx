import {
  PROJECT_CALL_VOICES_COPY,
  PROJECT_CALL_VOICES_SWITCH_TEST_ID,
} from "./ProjectCallVoicesCardCopy";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ProjectCallVoice from "Common/Types/Call/ProjectCallVoice";
import ObjectID from "Common/Types/ObjectID";
import { CALL_VOICE_COST_SENTENCE } from "Common/UI/Components/CallVoice/CallVoiceSample";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHETHER PROJECTS CHOOSE THE VOICE OF THEIR CALLS THROUGH THIS SERVER'S
 * TWILIO ACCOUNT (#11065), on Settings > Call and SMS, under the server's
 * own Call Voice: one switch, saved when flipped, off as every server
 * starts (GlobalConfig.letProjectsChooseCallVoice).
 *
 * Twilio charges the account that places a call for its voice, so a
 * project's voice is the server owner's to pay for: the switch is the
 * owner's consent, and says what the voices cost under it. Turned off
 * again, every project speaks with the server's voice at once, whatever it
 * chose (Common/Types/Call/ProjectCallVoice).
 *
 * Not on OneUptime Cloud, whose account OneUptime pays for: there the card
 * is not drawn, and the server refuses the switch.
 */

export interface ComponentProps {
  // Drawn as on OneUptime Cloud, for a test; the page's own build otherwise.
  isBillingEnabled?: boolean | undefined;
}

const ProjectCallVoicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isBillingEnabled: boolean =
    props.isBillingEnabled === undefined
      ? BILLING_ENABLED
      : props.isBillingEnabled;

  if (isBillingEnabled) {
    return <></>;
  }

  return (
    <ModelSwitchCard<GlobalConfig>
      modelType={GlobalConfig}
      modelId={ObjectID.getZeroObjectID()}
      column="letProjectsChooseCallVoice"
      cardTitle={PROJECT_CALL_VOICES_COPY.cardTitle}
      cardDescription={PROJECT_CALL_VOICES_COPY.cardDescription}
      title={PROJECT_CALL_VOICES_COPY.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? PROJECT_CALL_VOICES_COPY.switchOnDescription
          : PROJECT_CALL_VOICES_COPY.switchOffDescription;
      }}
      /*
       * What the voices cost the account, as the voice pickers say it:
       * the most a page's call costs, in any language.
       */
      getDetails={(): ReactElement => {
        return (
          <p
            data-testid={`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-cost`}
            className="text-sm text-gray-600"
          >
            {translator.translateTemplate(CALL_VOICE_COST_SENTENCE, {
              cents: translator.formatNumber(
                ProjectCallVoice.getMostCentsOfAPage(),
              ),
            })}
          </p>
        );
      }}
      dataTestId={PROJECT_CALL_VOICES_SWITCH_TEST_ID}
    />
  );
};

export default ProjectCallVoicesCard;
