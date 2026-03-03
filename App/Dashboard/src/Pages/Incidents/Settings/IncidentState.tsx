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
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentState>
        modelType={IncidentState}
        id="incident-state-table"
        userPreferencesKey="incident-state-table"
        name="Settings > Incident State"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Incident State",
          description:
            "Incidents have multiple states like - created, acknowledged and resolved. You can more states help you manage incidents here.",
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        onBeforeDelete={(item: IncidentState): Promise<IncidentState> => {
          if (item.isCreatedState) {
            throw new BadDataException(
              "This incident cannot be deleted because its the created incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.",
            );
          }

          if (item.isAcknowledgedState) {
            throw new BadDataException(
              "This incident cannot be deleted because its the acknowledged incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.",
            );
          }

          if (item.isResolvedState) {
            throw new BadDataException(
              "This incident cannot be deleted because its the resolved incident state of for this project. Created, Acknowledged, Resolved incident states cannot be deleted.",
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
            getElement: (item: IncidentState): ReactElement => {
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
            hideOnMobile: true,

            getElement: (item: IncidentState): ReactElement => {
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
        noItemsMessage={"No incident state found."}
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
              "This incident state happens when the incident is investigated",
          },
          {
            field: {
              color: true,
            },
            title: "Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this incident state.",
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

export default IncidentsPage;
