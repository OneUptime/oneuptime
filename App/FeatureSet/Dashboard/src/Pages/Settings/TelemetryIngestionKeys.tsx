import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
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

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="api-keys-table"
        name="Settings > Telemetry Ingestion Keys"
        saveFilterProps={{
          tableId: "settings-telemetry-ingestion-keys-table",
        }}
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        singularName="Ingestion Key"
        userPreferencesKey="telemetry-ingestion-keys-table"
        cardProps={{
          title: "Telemetry Ingestion Keys",
          description:
            "These keys are used to ingest telemetry data like Logs, Traces and Metrics for your project.",
        }}
        noItemsMessage={"No telemetry ingestion keys found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Ingestion Key Name",
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
            placeholder: "Ingestion Key Description",
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
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
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
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              iotFleetNames: true,
            },
            title: "IoT Fleet Scope",
            type: FieldType.Text,
            getElement: (item: TelemetryIngestionKey): ReactElement => {
              const fleetNames: Array<string> | undefined = item.iotFleetNames;
              if (!fleetNames || fleetNames.length === 0) {
                return <span>Unscoped (all fleets and services)</span>;
              }
              return <span>{fleetNames.join(", ")}</span>;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default APIKeys;
