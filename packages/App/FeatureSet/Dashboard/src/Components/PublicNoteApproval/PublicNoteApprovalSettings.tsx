import Project from "Common/Models/DatabaseModels/Project";
import PublicNoteApprovalStep from "Common/Models/DatabaseModels/PublicNoteApprovalStep";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { PublicNoteApprovalEventType } from "Common/Types/StatusPage/PublicNoteApproval";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelSwitchesCard from "Common/UI/Components/ModelSwitch/ModelSwitchesCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getOwnersFormField } from "Common/UI/Components/PeoplePicker/OwnersFormField";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TeamsElement from "../Team/TeamsElement";
import UsersElement from "../User/Users";
import {
  PUBLIC_NOTE_APPROVAL_SETTINGS_COPY,
  PublicNoteApprovalSettingsCopy,
  getPublicNoteApprovalSwitchColumn,
} from "./PublicNoteApprovalSettingsCopy";

export interface ComponentProps {
  eventType: PublicNoteApprovalEventType;
}

// The data-testids of the switch's card, the switch and the steps table.
export const PUBLIC_NOTE_APPROVAL_SWITCHES_TEST_ID: string =
  "public-note-approval-switches";
export const PUBLIC_NOTE_APPROVAL_SWITCH_TEST_ID: string =
  "public-note-approval-switch";

/*
 * Settings > Public Note Approval, under Incidents (an incident's and an
 * episode's public notes) and under Scheduled Maintenance: whether public
 * notes wait for approval before they are published, and who approves them
 * (Common/Types/StatusPage/PublicNoteApproval).
 *
 * The switch is off for every project until somebody turns it on, and it
 * saves the moment it is flipped (the shared ModelSwitchesCard), as the
 * other switches of how a project's incidents behave do; Project Owner or
 * Project Admin, as they are. It turns on only once somebody is set up to
 * approve - the server says so if not.
 *
 * Who approves is a list of steps. Most projects need one: the people and
 * teams any one of whom approves a note. A note that needs a second
 * approval - legal after support - gets another step, below the first;
 * steps are gone through in their order, which is dragged into place.
 */
const PublicNoteApprovalSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const copy: PublicNoteApprovalSettingsCopy =
    PUBLIC_NOTE_APPROVAL_SETTINGS_COPY[props.eventType];

  if (!projectId) {
    return <></>;
  }

  return (
    <Fragment>
      <ModelSwitchesCard<Project>
        modelType={Project}
        modelId={projectId}
        cardTitle={translationKey("Public Note Approval")}
        cardDescription={copy.cardDescription}
        switches={[
          {
            column: getPublicNoteApprovalSwitchColumn(props.eventType),
            title: "Require approval before public notes are published",
            getDescription: (): string => {
              return copy.switchDescription;
            },
            dataTestId: PUBLIC_NOTE_APPROVAL_SWITCH_TEST_ID,
          },
        ]}
        dataTestId={PUBLIC_NOTE_APPROVAL_SWITCHES_TEST_ID}
      />

      <ModelTable<PublicNoteApprovalStep>
        modelType={PublicNoteApprovalStep}
        id={`public-note-approval-steps-${props.eventType}`}
        name={copy.tableName}
        userPreferencesKey={`public-note-approval-steps-${props.eventType}`}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        query={{
          projectId: projectId,
          eventType: props.eventType,
        }}
        onBeforeCreate={async (
          item: PublicNoteApprovalStep,
        ): Promise<PublicNoteApprovalStep> => {
          item.eventType = props.eventType;
          return item;
        }}
        singularName="Approval Step"
        pluralName="Approval Steps"
        createVerb="Add"
        cardProps={{
          title: translationKey("Who Approves"),
          description: translationKey(
            "Anyone listed in a step can approve a note for that step. Add another step when a note needs a second approval, such as legal after support. Steps are approved in order; drag them to reorder.",
          ),
        }}
        noItemsMessage={translationKey(
          "Nobody approves public notes yet. Add the people or teams who approve them, then turn on approval above.",
        )}
        // A handful of steps at most: nothing to filter.
        filters={[]}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        selectMoreFields={{
          approverUsers: {
            _id: true,
            name: true,
            email: true,
          },
          approverTeams: {
            _id: true,
            name: true,
          },
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              approverUsers: {
                _id: true,
                name: true,
                email: true,
              },
            },
            title: "People",
            type: FieldType.EntityArray,
            getElement: (item: PublicNoteApprovalStep): ReactElement => {
              return (
                <UsersElement
                  users={(item.approverUsers || []) as Array<User>}
                />
              );
            },
          },
          {
            field: {
              approverTeams: {
                _id: true,
                name: true,
              },
            },
            title: "Teams",
            type: FieldType.EntityArray,
            getElement: (item: PublicNoteApprovalStep): ReactElement => {
              return (
                <TeamsElement
                  teams={(item.approverTeams || []) as Array<Team>}
                />
              );
            },
          },
        ]}
        formFields={[
          getOwnersFormField<PublicNoteApprovalStep>({
            fieldKey: "approvers",
            usersKey: "approverUsers",
            teamsKey: "approverTeams",
            title: "Approvers",
            description: translationKey(
              "Any one of these people, or of the members of these teams, can approve a note for this step. Nobody approves a note they sent for approval.",
            ),
            required: true,
          }),
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "e.g. Legal",
            description: translationKey(
              "Optional. Shown to approvers and authors when a note waits for this step.",
            ),
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
      />
    </Fragment>
  );
};

export default PublicNoteApprovalSettings;
