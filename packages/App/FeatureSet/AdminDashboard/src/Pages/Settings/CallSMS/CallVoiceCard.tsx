import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  CALL_VOICE_DEFAULT_LABEL,
  getCallVoiceOptions,
  getCallVoiceSummary,
} from "Common/UI/Components/CallVoice/CallVoiceOptions";
import CallVoiceSample from "Common/UI/Components/CallVoice/CallVoiceSample";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { translationKey } from "Common/Types/Translator";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 */

export const CALL_VOICE_CARD_TEST_ID: string = "call-voice-card";

export const CALL_VOICE_CARD_COPY: {
  title: string;
  description: string;
  button: string;
  fieldTitle: string;
} = {
  title: translationKey("Call Voice"),
  description: translationKey(
    "The voice OneUptime's phone calls speak with when they go out through this server's Twilio account.",
  ),
  button: translationKey("Choose Voice"),
  fieldTitle: translationKey("Voice"),
};

export interface ComponentProps {
  // The voice was saved: the page reads again where SMS and calls stand.
  onSaveSuccess?: (() => void) | undefined;
}

const CallVoiceCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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
