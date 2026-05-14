import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
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
        ]}
      />
    </Fragment>
  );
};

export default Runbooks;
