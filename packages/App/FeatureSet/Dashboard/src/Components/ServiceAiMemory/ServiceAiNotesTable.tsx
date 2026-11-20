import {
  ADDED_BY_PERSON,
  ADDED_THROUGH_API,
  NOTES_EMPTY_DESCRIPTION,
  NOTES_EMPTY_TITLE,
  NOTES_TABLE_DESCRIPTION,
  NOTES_TABLE_TITLE,
  NOTE_FIELD_DESCRIPTION,
  NOTE_FIELD_PLACEHOLDER,
  NOTE_FIELD_TITLE,
  NOTE_PLURAL,
  NOTE_SINGULAR,
  SERVICE_AI_MEMORY_TEST_IDS,
} from "./ServiceAiMemoryCopy";
import ServiceAINote, {
  MAX_SERVICE_AI_NOTE_LENGTH,
} from "Common/Models/DatabaseModels/ServiceAINote";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * NOTES FOR ONEUPTIME AI, on a service's overview (#7672): what the team
 * knows about the service that no incident recorded - "its database
 * failover takes five minutes; don't page for it". Every investigation of an
 * incident or an alert on the service reads them, as the team's notes,
 * never as instructions (ServiceKnowledge.buildNotesSection).
 *
 * A list of the service's notes, the newest first, each with who added it
 * and when; Add, Edit and Delete as the reader may (the notes' own
 * permissions), every change in the service's audit log.
 */

export interface ComponentProps {
  serviceId: ObjectID;
}

// Who added a note: the person's name, else their email; none for an API key.
function addedByOf(note: ServiceAINote): string | undefined {
  return (
    note.createdByUser?.name?.toString() ||
    note.createdByUser?.email?.toString() ||
    undefined
  );
}

// A note in its list: its words, and who added it and when under them.
export const ServiceAiNoteCell: FunctionComponent<{
  note: ServiceAINote;
}> = (props: { note: ServiceAINote }): ReactElement => {
  const addedBy: string | undefined = addedByOf(props.note);
  const time: ReactElement = (
    <span className="whitespace-nowrap">
      {props.note.createdAt ? OneUptimeDate.fromNow(props.note.createdAt) : ""}
    </span>
  );

  return (
    <div data-testid={SERVICE_AI_MEMORY_TEST_IDS.noteCell}>
      <span className="block whitespace-pre-line break-words text-sm text-gray-900">
        <IsolatedText text={props.note.note || ""} />
      </span>
      {props.note.createdAt ? (
        <span
          className="mt-0.5 block text-xs text-gray-500"
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            props.note.createdAt,
          )}
        >
          {addedBy ? (
            <TranslatedSentence
              template={ADDED_BY_PERSON}
              slots={{ name: <IsolatedText text={addedBy} />, time }}
            />
          ) : (
            <TranslatedSentence template={ADDED_THROUGH_API} slots={{ time }} />
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

const ServiceAiNotesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<ServiceAINote>
      modelType={ServiceAINote}
      id={SERVICE_AI_MEMORY_TEST_IDS.notesTable}
      name="Service > Notes for OneUptime AI"
      userPreferencesKey={SERVICE_AI_MEMORY_TEST_IDS.notesTable}
      singularName={NOTE_SINGULAR}
      pluralName={NOTE_PLURAL}
      createVerb="Add"
      // A note is named by its first words: Delete asks about it by them.
      getItemName={(item: ServiceAINote): string => {
        const words: string = (item.note || "").trim();

        return words.length > 60 ? `${words.slice(0, 60).trimEnd()}…` : words;
      }}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        serviceId: props.serviceId,
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      cardProps={{
        title: NOTES_TABLE_TITLE,
        description: NOTES_TABLE_DESCRIPTION,
      }}
      noItemsMessage={NOTES_EMPTY_TITLE}
      emptyState={{
        title: NOTES_EMPTY_TITLE,
        description: NOTES_EMPTY_DESCRIPTION,
        icon: IconProp.Sparkles,
      }}
      createInitialValues={
        {
          serviceId: props.serviceId,
        } as FormValues<ServiceAINote>
      }
      onBeforeCreate={(item: ServiceAINote): Promise<ServiceAINote> => {
        item.serviceId = props.serviceId;
        return Promise.resolve(item);
      }}
      formFields={[
        {
          field: { note: true },
          title: NOTE_FIELD_TITLE,
          description: NOTE_FIELD_DESCRIPTION,
          placeholder: NOTE_FIELD_PLACEHOLDER,
          fieldType: FormFieldSchemaType.LongText,
          required: true,
          validation: {
            maxLength: MAX_SERVICE_AI_NOTE_LENGTH,
          },
          dataTestId: "service-ai-note-field",
        },
      ]}
      showRefreshButton={false}
      selectMoreFields={{
        createdAt: true,
        createdByUser: { name: true, email: true },
      }}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      filters={[]}
      columns={[
        {
          field: { note: true },
          title: NOTE_FIELD_TITLE,
          type: FieldType.Element,
          disableSort: true,
          hideTitleOnMobile: true,
          wrapContent: true,
          getExportValue: (item: ServiceAINote): string => {
            return (item.note || "").trim();
          },
          getElement: (item: ServiceAINote): ReactElement => {
            return <ServiceAiNoteCell note={item} />;
          },
        },
      ]}
    />
  );
};

export default ServiceAiNotesTable;
