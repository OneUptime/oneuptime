import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import BadDataException from "Common/Types/Exception/BadDataException";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertState>
        modelType={AlertState}
        id="alert-state-table"
        name="Settings > Alert State"
        userPreferencesKey="alert-state-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Alert State",
          description:
            "Alerts have multiple states like - created, acknowledged and resolved. You can more states help you manage alerts here.",
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        onBeforeDelete={(item: AlertState): Promise<AlertState> => {
          if (item.isCreatedState) {
            throw new BadDataException(
              "This alert cannot be deleted because its the created alert state of for this project. Created, Acknowledged, Resolved alert states cannot be deleted.",
            );
          }

          if (item.isAcknowledgedState) {
            throw new BadDataException(
              "This alert cannot be deleted because its the acknowledged alert state of for this project. Created, Acknowledged, Resolved alert states cannot be deleted.",
            );
          }

          if (item.isResolvedState) {
            throw new BadDataException(
              "This alert cannot be deleted because its the resolved alert state of for this project. Created, Acknowledged, Resolved alert states cannot be deleted.",
            );
          }

          return Promise.resolve(item);
        }}
        selectMoreFields={{
          color: true,
          isCreatedState: true,
          isAcknowledgedState: true,
          isResolvedState: true,
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
            getElement: (item: AlertState): ReactElement => {
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

            getElement: (item: AlertState): ReactElement => {
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
        noItemsMessage={"No alert state found."}
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

export default AlertsPage;
