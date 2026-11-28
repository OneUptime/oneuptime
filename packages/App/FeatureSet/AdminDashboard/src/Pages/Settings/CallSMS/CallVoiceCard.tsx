import ObjectID from "Common/Types/ObjectID";
import {
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  ServerTwilioEnvironmentAnswer,
} from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail, {
  CARD_MODEL_DETAIL_BODY_CLASS_NAME,
} from "Common/UI/Components/ModelDetail/CardModelDetail";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  CALL_VOICE_DEFAULT_LABEL,
  getCallVoiceOptions,
  getCallVoiceSummary,
} from "Common/UI/Components/CallVoice/CallVoiceOptions";
import CallVoiceSample from "Common/UI/Components/CallVoice/CallVoiceSample";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  CALL_VOICE_CARD_COPY,
  CALL_VOICE_CARD_LOADING_TEST_ID,
  CALL_VOICE_CARD_PROBLEM_TEST_ID,
  CALL_VOICE_CARD_TEST_ID,
} from "./CallVoiceCardCopy";
import { UseServerTwilioEnvironmentResult } from "./ServerTwilioEnvironmentCard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE VOICE THE SERVER'S CALLS SPEAK WITH (#10948), on Settings > Call and
 * SMS, after the Twilio account it is for.
 *
 * Calls that name no voice speak with the Twilio account's default voice:
 * Twilio's Basic voice, unless its owner picked another in the Twilio
 * Console. Twilio says Basic voices are not meant for production, so an
 * admin can choose one of a short list of neural Amazon Polly and Google
 * voices instead (Common/Types/Call/CallVoice), and calls then spell a
 * record's number with SSML. The picker shows, under it, the voice chosen
 * and the first lines a page's call says, what it costs, and that a test
 * call - the card at the top of the page - says them in it once saved
 * (CallVoiceSample).
 *
 * A card of its own, not a field of the account's form: the voice is the
 * server's to choose even while the GLOBAL_TWILIO_ environment variables
 * set the account, and then the account's card is read-only. A project's
 * own Twilio config has a voice of its own.
 *
 * Once GLOBAL_TWILIO_CALL_VOICE is set (#11064), the voice is the one it
 * names, whoever sets the account: the card says so, with the variable's
 * name beside the voice, what the voice says and costs, and no Choose
 * Voice button - the server refuses a write to the saved voice. A value
 * that names no voice OneUptime offers is said above it, by the variable's
 * name, and the voice it leaves is the account's default.
 */

export interface ComponentProps {
  // The voice was saved: the page reads again where SMS and calls stand.
  onSaveSuccess?: (() => void) | undefined;
  /*
   * What the server says of the GLOBAL_TWILIO_ variables, the page's one
   * reading (useServerTwilioEnvironment). A server that cannot say leaves
   * the voice to choose here, and refuses the write if a variable sets it.
   */
  environment: UseServerTwilioEnvironmentResult;
}

// The voice as the variable's card reads it.
interface EnvironmentVoiceItem {
  voice: string;
}

/*
 * The voice GLOBAL_TWILIO_CALL_VOICE sets: read-only, by the variable's
 * name, as the account's fields are when the variables set the account.
 */
const EnvironmentCallVoice: FunctionComponent<{
  answer: ServerTwilioEnvironmentAnswer;
}> = (props: { answer: ServerTwilioEnvironmentAnswer }): ReactElement => {
  const translator: Translator = useTranslator();
  const answer: ServerTwilioEnvironmentAnswer = props.answer;

  return (
    <Card
      title={CALL_VOICE_CARD_COPY.title}
      description={CALL_VOICE_CARD_COPY.environmentDescription}
    >
      <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
        {answer.callVoiceProblem ? (
          <Alert
            type={AlertType.WARNING}
            className="mb-5"
            dataTestId={CALL_VOICE_CARD_PROBLEM_TEST_ID}
            strongTitle={CALL_VOICE_CARD_COPY.environmentProblemTitle}
            /*
             * The server's line, in English, by the variable's name: it
             * keeps its own direction in a right-to-left page (#7804).
             */
            title={<bdi>{answer.callVoiceProblem}</bdi>}
          />
        ) : (
          <></>
        )}
        <Detail<EnvironmentVoiceItem>
          id="call-voice-environment-detail"
          item={{ voice: answer.callVoice || "" }}
          fields={[
            {
              key: "voice",
              title: CALL_VOICE_CARD_COPY.fieldTitle,
              description: SERVER_TWILIO_CALL_VOICE_VARIABLE,
              fieldType: FieldType.Element,
              getElement: (item: EnvironmentVoiceItem): ReactElement => {
                return (
                  <span data-testid="call-voice-summary">
                    {getCallVoiceSummary(item.voice, translator)}
                  </span>
                );
              },
            },
          ]}
        />
        {/*
         * What the voice says and costs, as the picker shows it: nothing
         * here opens the picker.
         */}
        <CallVoiceSample value={answer.callVoice} isInEffect={true} />
      </div>
    </Card>
  );
};

const CallVoiceCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Until the server says whether a variable sets the voice: no button that may not apply.
  if (props.environment.isLoading) {
    return (
      <div data-testid={CALL_VOICE_CARD_TEST_ID}>
        <div data-testid={CALL_VOICE_CARD_LOADING_TEST_ID}>
          <Card
            title={CALL_VOICE_CARD_COPY.title}
            description={CALL_VOICE_CARD_COPY.description}
          >
            <DetailListSkeleton fields={1} />
          </Card>
        </div>
      </div>
    );
  }

  if (props.environment.answer?.isCallVoiceSetByEnvironment) {
    return (
      <div data-testid={CALL_VOICE_CARD_TEST_ID}>
        <EnvironmentCallVoice answer={props.environment.answer} />
      </div>
    );
  }

  return (
    <div data-testid={CALL_VOICE_CARD_TEST_ID}>
      <CardModelDetail<GlobalConfig>
        name="Call Voice"
        cardProps={{
          title: CALL_VOICE_CARD_COPY.title,
          description: CALL_VOICE_CARD_COPY.description,
        }}
        isEditable={true}
        editButtonText={CALL_VOICE_CARD_COPY.button}
        // Titled like the button that opens it.
        editModalTitle={CALL_VOICE_CARD_COPY.button}
        onSaveSuccess={() => {
          props.onSaveSuccess?.();
        }}
        formFields={[
          {
            field: {
              twilioCallVoice: true,
            },
            title: CALL_VOICE_CARD_COPY.fieldTitle,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getCallVoiceOptions(translator),
            // Optional: cleared, calls speak with the account's default voice.
            required: false,
            placeholder: CALL_VOICE_DEFAULT_LABEL,
            // The sample under it says what the choice means.
            hideColumnDescription: true,
            getFooterElement: (
              values: FormValues<GlobalConfig>,
            ): ReactElement => {
              return <CallVoiceSample value={values.twilioCallVoice} />;
            },
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-call-voice",
          fields: [
            {
              field: {
                twilioCallVoice: true,
              },
              title: CALL_VOICE_CARD_COPY.fieldTitle,
              fieldType: FieldType.Element,
              getElement: (item: GlobalConfig): ReactElement => {
                return (
                  <span data-testid="call-voice-summary">
                    {getCallVoiceSummary(item.twilioCallVoice, translator)}
                  </span>
                );
              },
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </div>
  );
};

export default CallVoiceCard;
