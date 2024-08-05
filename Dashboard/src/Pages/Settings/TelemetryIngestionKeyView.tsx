import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "CommonUI/src/Components/ResetObjectID/ResetObjectID";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import TelemetryIngestionKey from "Common/AppModels/Models/TelemetryIngestionKey";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const TelemetryIngestionKeyView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refresher, setRefresher] = React.useState<boolean>(false);

  return (
    <Fragment>
      {/* Telemetry Ingestion Key View  */}
      <CardModelDetail<TelemetryIngestionKey>
        name="Telemetry Ingestion Key Details"
        cardProps={{
          title: "Telemetry Ingestion Key Details",
          description:
            "Here are more details for this Telemetry Ingestion Key.",
        }}
        refresher={refresher}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Telemetry Ingestion Key Name",
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
            placeholder: "Telemetry Ingestion Key Description",
          },
        ]}
        modelDetailProps={{
          modelType: TelemetryIngestionKey,
          id: "model-detail-api-key",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                secretKey: true,
              },
              title: "Secret Key",
              fieldType: FieldType.HiddenText,
              opts: {
                isCopyable: true,
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ResetObjectID<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        fieldName={"secretKey"}
        title={"Reset Secret Key"}
        description={"Reset the Secret Key to a new value."}
        modelId={modelId}
        onUpdateComplete={() => {
          setRefresher(!refresher);
        }}
      />

      {/* Delete Telemetry Ingestion Key */}

      <ModelDelete
        modelType={TelemetryIngestionKey}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TelemetryIngestionKeyView;
