import {
  PAGED_PEOPLE_INCIDENT_ROLE_TEST_ID,
  PagedPeopleIncidentRoleCopy,
  getPagedPeopleIncidentRoleName,
} from "./PagedPeopleIncidentRole";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Incident Role card of a policy's Escalation Rules page, under More
 * settings, and the dialog that changes it: which incident role everybody
 * the policy pages is given on the incident or episode, or none
 * (PagedPeopleIncidentRole.ts). Drawn on the shared detail card, so it
 * looks, locks and opens its dialog like the Acknowledgement Timeout card
 * beside it.
 */

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  /*
   * The name of the role the policy gives, or null while it gives none -
   * each time the card reads or saves it: what More settings says while it
   * is folded.
   */
  onLoaded?: ((roleName: string | null) => void) | undefined;
}

const PagedPeopleIncidentRoleCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardModelDetail<OnCallDutyPolicy>
      name="On-Call Policy > Incident Role"
      editButtonText="Edit"
      editModalTitle={PagedPeopleIncidentRoleCopy.dialogTitle}
      cardProps={{
        title: PagedPeopleIncidentRoleCopy.cardTitle,
        description: PagedPeopleIncidentRoleCopy.cardDescription,
      }}
      isEditable={true}
      formFields={[
        {
          field: {
            incidentRole: true,
          },
          title: PagedPeopleIncidentRoleCopy.fieldTitle,
          description: PagedPeopleIncidentRoleCopy.fieldDescription,
          fieldType: FormFieldSchemaType.Dropdown,
          // Archived roles are left out by the dropdown (ArchivedValuePicker).
          dropdownModal: {
            type: IncidentRole,
            labelField: "name",
            valueField: "_id",
            sort: {
              name: SortOrder.Ascending,
            },
          },
          required: false,
          placeholder: PagedPeopleIncidentRoleCopy.noRole,
          dataTestId: `${PAGED_PEOPLE_INCIDENT_ROLE_TEST_ID}-field`,
        },
      ]}
      modelDetailProps={{
        modelType: OnCallDutyPolicy,
        id: `${PAGED_PEOPLE_INCIDENT_ROLE_TEST_ID}-detail`,
        modelId: props.onCallDutyPolicyId,
        showDetailsInNumberOfColumns: 1,
        selectMoreFields: {
          incidentRoleId: true,
        },
        onItemLoaded: (item: OnCallDutyPolicy): void => {
          props.onLoaded?.(getPagedPeopleIncidentRoleName(item));
        },
        fields: [
          {
            field: {
              incidentRole: {
                name: true,
                color: true,
              },
            },
            title: PagedPeopleIncidentRoleCopy.rowTitle,
            placeholder: PagedPeopleIncidentRoleCopy.noRole,
            fieldType: FieldType.Entity,
          },
        ],
      }}
    />
  );
};

export default PagedPeopleIncidentRoleCard;
