import PageComponentProps from "../PageComponentProps";
import ProjectUtil from "Common/UI/Utils/Project";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";

const Runbooks: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<Runbook>
        modelType={Runbook}
        id="runbooks-table"
        userPreferencesKey="runbooks-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        name="Runbooks"
        isViewable={true}
        showViewIdButton={true}
        cardProps={{
          title: "Runbooks",
          description:
            "Reusable response procedures: ordered checklists of manual or automated steps.",
        }}
        noItemsMessage={"No runbooks created yet."}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Database failover runbook",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "What this runbook is for and when it should be triggered.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: { labels: true },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            title: "Name",
            type: FieldType.Text,
            field: { name: true },
          },
          {
            title: "Description",
            type: FieldType.Text,
            field: { description: true },
          },
          {
            title: "Enabled",
            type: FieldType.Boolean,
            field: { isEnabled: true },
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Element,
            getElement: (item: Runbook): ReactElement => {
              if (item.isEnabled) {
                return (
                  <Pill text="Enabled" color={Green500} isMinimal={true} />
                );
              }
              return <Pill text="Disabled" color={Red500} isMinimal={true} />;
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            getElement: (item: Runbook): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Runbooks;
