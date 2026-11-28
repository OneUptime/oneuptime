import {
  PROJECT_CALL_VOICES_COPY,
  PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID,
  PROJECT_CALL_VOICES_LOADING_TEST_ID,
  PROJECT_CALL_VOICES_PROBLEM_TEST_ID,
  PROJECT_CALL_VOICES_SWITCH_TEST_ID,
} from "./ProjectCallVoicesCardCopy";
import { UseServerTwilioEnvironmentResult } from "./ServerTwilioEnvironmentCard";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ProjectCallVoice from "Common/Types/Call/ProjectCallVoice";
import { ServerTwilioEnvironmentAnswer } from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import { CALL_VOICE_COST_SENTENCE } from "Common/UI/Components/CallVoice/CallVoiceSample";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import Toggle from "Common/UI/Components/Toggle/Toggle";
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
 * Once GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE is set (#11462), the
 * switch is the one it sets: the card says so, by the variable's name, in
 * place of its description, and draws the switch locked where the
 * variable puts it - the server refuses a write to the saved one. A value
 * that is neither true nor false is said above it, by the variable's name,
 * and leaves the switch off. Until the server says whether the variable is
 * set, the card draws no switch that may not apply.
 *
 * Not on OneUptime Cloud, whose account OneUptime pays for: there the card
 * is not drawn, and the server refuses the switch.
 */

export interface ComponentProps {
  // Drawn as on OneUptime Cloud, for a test; the page's own build otherwise.
  isBillingEnabled?: boolean | undefined;
  /*
   * What the server says of the GLOBAL_TWILIO_ variables, the page's one
   * reading (useServerTwilioEnvironment). Left out - or from a server that
   * cannot say - the switch is the saved one, and the server still refuses
   * a write a variable must make.
   */
  environment?: UseServerTwilioEnvironmentResult | undefined;
}

// What the voices cost the account, as the voice pickers say it: the most a page's call costs.
const CostLine: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      data-testid={`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-cost`}
      className="text-sm text-gray-600"
    >
      {translator.translateTemplate(CALL_VOICE_COST_SENTENCE, {
        cents: translator.formatNumber(ProjectCallVoice.getMostCentsOfAPage()),
      })}
    </p>
  );
};

/*
 * The switch GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE sets: the same
 * card, title, switch and lines, the switch locked where the variable puts
 * it, as the account's fields are when the variables set the account.
 */
const EnvironmentProjectCallVoices: FunctionComponent<{
  answer: ServerTwilioEnvironmentAnswer;
}> = (props: { answer: ServerTwilioEnvironmentAnswer }): ReactElement => {
  const ruledBodyClassName: string = useCardRuledBodyClassName();
  const isOn: boolean = props.answer.letProjectsChooseCallVoice;
  const problem: string | null = props.answer.letProjectsChooseCallVoiceProblem;

  return (
    <div data-testid={PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID}>
      <Card
        title={PROJECT_CALL_VOICES_COPY.cardTitle}
        description={PROJECT_CALL_VOICES_COPY.environmentDescription}
      >
        <div data-testid={`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-card`}>
          <div className={ruledBodyClassName}>
            <div className="px-5 py-4 md:px-6">
              {problem ? (
                <Alert
                  type={AlertType.WARNING}
                  className="mb-4"
                  dataTestId={PROJECT_CALL_VOICES_PROBLEM_TEST_ID}
                  strongTitle={PROJECT_CALL_VOICES_COPY.environmentProblemTitle}
                  /*
                   * The server's line, in English, by the variable's name:
                   * it keeps its own direction in a right-to-left page
                   * (#7804).
                   */
                  title={<bdi>{problem}</bdi>}
                />
              ) : (
                <></>
              )}
              <Toggle
                title={PROJECT_CALL_VOICES_COPY.switchTitle}
                description={
                  isOn
                    ? PROJECT_CALL_VOICES_COPY.switchOnDescription
                    : PROJECT_CALL_VOICES_COPY.switchOffDescription
                }
                value={isOn}
                // Locked where the variable puts it: the server refuses a write.
                disabled={true}
                tooltip={PROJECT_CALL_VOICES_COPY.environmentLockedReason}
                dataTestId={PROJECT_CALL_VOICES_SWITCH_TEST_ID}
                onChange={(): void => {
                  // Nothing to save: the variable is the switch.
                }}
              />
            </div>
            <div
              className="border-t border-gray-200 px-5 py-4 md:px-6"
              data-testid={`${PROJECT_CALL_VOICES_SWITCH_TEST_ID}-details`}
            >
              <CostLine />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

const ProjectCallVoicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isBillingEnabled: boolean =
    props.isBillingEnabled === undefined
      ? BILLING_ENABLED
      : props.isBillingEnabled;

  if (isBillingEnabled) {
    return <></>;
  }

  // Until the server says whether a variable sets the switch: no switch that may not apply.
  if (props.environment?.isLoading) {
    return (
      <div data-testid={PROJECT_CALL_VOICES_LOADING_TEST_ID}>
        <Card
          title={PROJECT_CALL_VOICES_COPY.cardTitle}
          description={PROJECT_CALL_VOICES_COPY.cardDescription}
        >
          <DetailListSkeleton fields={1} columns={1} />
        </Card>
      </div>
    );
  }

  const answer: ServerTwilioEnvironmentAnswer | null | undefined =
    props.environment?.answer;

  if (answer?.isLetProjectsChooseCallVoiceSetByEnvironment) {
    return <EnvironmentProjectCallVoices answer={answer} />;
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
        return <CostLine />;
      }}
      dataTestId={PROJECT_CALL_VOICES_SWITCH_TEST_ID}
    />
  );
};

export default ProjectCallVoicesCard;
