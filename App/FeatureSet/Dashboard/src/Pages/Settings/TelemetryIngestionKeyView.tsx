import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Fleet names double as the values of the `iot.fleet.name` resource
 * attribute, which is what fleet-scoped ingestion keys are checked
 * against at ingest time.
 */
async function fetchIotFleetDropdownOptions(): Promise<Array<DropdownOption>> {
  const fleets: ListResult<IoTFleet> = await ModelAPI.getList<IoTFleet>({
    modelType: IoTFleet,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      name: true,
    },
    sort: {
      name: SortOrder.Ascending,
    },
  });

  return fleets.data
    .filter((fleet: IoTFleet) => {
      return Boolean(fleet.name);
    })
    .map((fleet: IoTFleet) => {
      return {
        value: fleet.name!.toString(),
        label: fleet.name!.toString(),
      };
    });
}

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
            required: false,
            placeholder: "Telemetry Ingestion Key Description",
          },
          {
            field: {
              iotFleetNames: true,
            },
            title: "Restrict to IoT Fleets (Optional)",
            description:
              "Device-key hygiene: keys shipped on devices in the field are easy to extract, so scope each device key to the fleet(s) it belongs to. A scoped key can only push telemetry whose resources carry a matching iot.fleet.name attribute — everything else is rejected. Leave empty for a project-wide key.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            placeholder: "Unscoped — all fleets and services",
            fetchDropdownOptions: fetchIotFleetDropdownOptions,
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
                iotFleetNames: true,
              },
              title: "IoT Fleet Scope",
              fieldType: FieldType.Text,
              getElement: (item: TelemetryIngestionKey): ReactElement => {
                const fleetNames: Array<string> | undefined =
                  item.iotFleetNames;
                if (!fleetNames || fleetNames.length === 0) {
                  return <span>Unscoped (all fleets and services)</span>;
                }
                return <span>{fleetNames.join(", ")}</span>;
              },
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
