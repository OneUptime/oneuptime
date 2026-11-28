import {
  PROJECT_CALL_VOICE_COPY,
  PROJECT_CALL_VOICE_PLACE,
  PROJECT_CALL_VOICE_TEST_ID,
  PROJECT_CALL_VOICE_TITLE,
} from "./ProjectCallVoiceWords";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import { getCallVoice } from "Common/Types/Call/CallVoice";
import ObjectID from "Common/Types/ObjectID";
import {
  getCallVoiceOptions,
  getCallVoiceSummary,
} from "Common/UI/Components/CallVoice/CallVoiceOptions";
import CallVoiceSample from "Common/UI/Components/CallVoice/CallVoiceSample";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The voice the project's calls speak with through the server's Twilio
 * account (#11065, ProjectCallVoiceWords), in Project Settings >
 * Notification Channels' More settings - drawn only while the server lets
 * projects choose one.
 *
 * Chosen as a Twilio config's voice is (#10948): a short list of neural
 * voices, each with who makes it and how it sounds, and under the picker
 * the first lines a page's call says in it, with the project's name, the
 * voices it speaks other languages with and what they cost
 * (CallVoiceSample). Left empty, the calls speak with the server's voice.
 *
 * A card of its own module, with a default export, as every card folded
 * under a page's More settings is (#9464).
 */

export interface ProjectCallVoiceCardProps {
  projectId: ObjectID;
  // Told the voice, once read and after each save, for the folded header.
  onChange?: ((voice: string | null) => void) | undefined;
}

const ProjectCallVoiceCard: FunctionComponent<ProjectCallVoiceCardProps> = (
  props: ProjectCallVoiceCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Project Owner or Project Admin, the column's own update list: the
   * table's is wider, and would hand others a save the server refuses.
   */
  const editGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: ["callVoice"],
    buttonTitle: PROJECT_CALL_VOICE_COPY.button,
  });

  const getSummary: (value: unknown) => string = (value: unknown): string => {
    return getCallVoice(value)
      ? getCallVoiceSummary(value, translator)
      : translator.translateText(PROJECT_CALL_VOICE_COPY.serverVoice) ||
          PROJECT_CALL_VOICE_COPY.serverVoice;
  };

  return (
    <div data-testid={PROJECT_CALL_VOICE_TEST_ID}>
      <CardModelDetail<Project>
        name="Project Call Voice"
        cardProps={{
          title: PROJECT_CALL_VOICE_TITLE,
          description: PROJECT_CALL_VOICE_COPY.cardDescription,
          id: PROJECT_CALL_VOICE_PLACE,
          buttons: editGate.lockedButtons,
        }}
        isEditable={editGate.isEditable}
        editButtonText={PROJECT_CALL_VOICE_COPY.button}
        // Titled like the button that opens it.
        editModalTitle={PROJECT_CALL_VOICE_COPY.button}
        formFields={[
          {
            field: {
              callVoice: true,
            },
            title: PROJECT_CALL_VOICE_COPY.fieldTitle,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getCallVoiceOptions(translator),
            // Optional: cleared, the calls speak with the server's voice.
            required: false,
            placeholder: PROJECT_CALL_VOICE_COPY.serverVoice,
            // The sample under it says what the choice means.
            hideColumnDescription: true,
            getFooterElement: (values: FormValues<Project>): ReactElement => {
              if (!getCallVoice(values.callVoice)) {
                return (
                  <p
                    data-testid={`${PROJECT_CALL_VOICE_TEST_ID}-server-voice`}
                    className="mt-3 text-sm text-gray-600"
                  >
                    {translator.translateText(
                      PROJECT_CALL_VOICE_COPY.serverVoiceSentence,
                    )}
                  </p>
                );
              }

              return (
                <CallVoiceSample
                  value={values.callVoice}
                  projectName={ProjectUtil.getCurrentProject()?.name}
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-call-voice",
          fields: [
            {
              field: {
                callVoice: true,
              },
              title: PROJECT_CALL_VOICE_COPY.fieldTitle,
              fieldType: FieldType.Element,
              getElement: (item: Project): ReactElement => {
                return (
                  <span data-testid={`${PROJECT_CALL_VOICE_TEST_ID}-summary`}>
                    {getSummary(item.callVoice)}
                  </span>
                );
              },
            },
          ],
          modelId: props.projectId,
          onItemLoaded: (item: Project): void => {
            props.onChange?.(getCallVoice(item.callVoice)?.value || null);
          },
        }}
      />
    </div>
  );
};

export default ProjectCallVoiceCard;
