import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { BILLING_ENABLED } from "Common/UI/Config";
import DataResidencyUtil from "Common/Utils/Project/DataResidency";
import CustomerSupportAccessCard from "../../Components/Project/CustomerSupportAccessCard";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      {/* Project Settings View  */}
      <CardModelDetail
        name="Project Details"
        cardProps={{
          title: "Project Details",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Project Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Project Name",
            validation: {
              minLength: 2,
            },
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Project ID",
              fieldType: FieldType.ObjectID,
              /*
               * A card whose point is the ID: people come here to copy the
               * project ID - for the CLI's resource files, API requests,
               * support. Other cards put their record's ID on the small line
               * at their foot.
               */
              showIdAsField: true,
            },
            {
              field: {
                name: true,
              },
              title: "Project Name",
            },
            {
              field: {
                dataResidency: true,
              },
              title: "Data Residency",
              fieldType: FieldType.Text,
              /*
               * Set by OneUptime staff from the Admin Dashboard, never here -
               * which is why it is not in the edit form above. A project with
               * none shows no row rather than an empty one.
               */
              showIf: (project: Project): boolean => {
                return DataResidencyUtil.shouldShowInProjectSettings({
                  isBillingEnabled: BILLING_ENABLED,
                  dataResidency: project.dataResidency,
                });
              },
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/*
       * Whether OneUptime's support team may open the project: one switch
       * that saves when flipped, and asks before it lets support in. Only
       * where OneUptime bills - a self-hosted install has no OneUptime
       * support team to let in.
       */}
      {BILLING_ENABLED && (
        <CustomerSupportAccessCard
          projectId={ProjectUtil.getCurrentProjectId()!}
        />
      )}
    </Fragment>
  );
};

export default Settings;
