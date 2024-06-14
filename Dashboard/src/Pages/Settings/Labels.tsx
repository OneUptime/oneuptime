import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import Color from "Common/Types/Color";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Label from "Model/Models/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Labels: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<Label>
        modelType={Label}
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        id="labels-table"
        name="Settings > Labels"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Labels",
          description:
            "Labels help you categorize resources in your project and give granular permissions to access those resources to team members.",
        }}
        noItemsMessage={"No labels found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "internal-service",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "This label is for all the internal services.",
          },
          {
            field: {
              color: true,
            },
            title: "Label Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this label.",
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={{
          color: true,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,

            getElement: (item: Label): ReactElement => {
              return (
                <Pill
                  color={item["color"] as Color}
                  text={item["name"] as string}
                />
              );
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default Labels;
