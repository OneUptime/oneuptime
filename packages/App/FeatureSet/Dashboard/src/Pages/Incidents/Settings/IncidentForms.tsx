import IncidentFormCopy from "../../../Components/IncidentForm/IncidentFormCopy";
import {
  getIncidentFormDescriptionField,
  getIncidentFormNameField,
  getIncidentFormSeverityField,
  getIncidentFormTemplateField,
  INCIDENT_FORM_DETAILS_STEP_ID,
  INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID,
} from "../../../Components/IncidentForm/IncidentFormFields";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import Route from "Common/Types/API/Route";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Incidents > Settings > Forms: the project's incident forms, pages anyone
 * with a form's link can fill in to report an incident without a OneUptime
 * account.
 *
 * Creating a form asks only what a form cannot do without - a name and the
 * severity of the incidents it declares - and, optionally, a description and
 * an incident template. Everything else (the questions, the link, who may
 * open it) has a card of its own on the form's page, with a safe default
 * until then; nobody can reach a new form before its link is shared.
 */
const IncidentForms: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentForm>
        modelType={IncidentForm}
        id="incident-forms-table"
        userPreferencesKey="incident-forms-table"
        name="Settings > Incident Forms"
        saveFilterProps={{
          tableId: "incident-forms-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: IncidentFormCopy.listTitle,
          description: IncidentFormCopy.listDescription,
        }}
        documentationLink={new Route("/docs/incidents/forms")}
        noItemsMessage={IncidentFormCopy.listEmpty}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: IncidentFormCopy.formDetailsTitle,
            id: INCIDENT_FORM_DETAILS_STEP_ID,
          },
          {
            title: "Incident Settings",
            id: INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID,
          },
        ]}
        formFields={[
          getIncidentFormNameField(INCIDENT_FORM_DETAILS_STEP_ID),
          getIncidentFormDescriptionField(INCIDENT_FORM_DETAILS_STEP_ID),
          getIncidentFormSeverityField(INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID),
          getIncidentFormTemplateField(INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID),
        ]}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
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
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
            noValueMessage: "-",
            wrapContent: true,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentForms;
