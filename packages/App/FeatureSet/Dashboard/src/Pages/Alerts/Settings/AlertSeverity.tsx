import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AlertSeverityPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertSeverity>
        modelType={AlertSeverity}
        id="alert-state-table"
        userPreferencesKey="alert-severity-table"
        name="Settings > Alert Severity"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Alert Severity",
          description:
            "Alerts and alerts will be categorised according to their severity level using the following classifications: ",
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          color: true,
          order: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: AlertSeverity): ReactElement => {
              return (
                <Pill
                  isMinimal={true}
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
            type: FieldType.LongText,

            getElement: (item: AlertSeverity): ReactElement => {
              return (
                <div>
                  <p>{`${item["description"]}`}</p>
                  <p className="text-xs text-gray-400">
                    ID: {`${item["_id"]}`}
                  </p>
                </div>
              );
            },
          },
        ]}
        noItemsMessage={"No alert severity found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Investigating",
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
            required: false,
            placeholder:
              "This alert state happens when the alert is investigated",
          },
          {
            field: {
              color: true,
            },
            title: "Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this alert state.",
          },
        ]}
        showRefreshButton={true}
        showAs={ShowAs.OrderedStatesList}
        orderedStatesListProps={{
          titleField: "name",
          descriptionField: "description",
          orderField: "order",
          shouldAddItemInTheEnd: true,
        }}
      />
    </Fragment>
  );
};

export default AlertSeverityPage;
