import LabelsElement from "../Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertElement from "./Alert";
import { Black } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement, useState } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "../Monitor/Monitor";

export interface ComponentProps {
  query?: Query<Alert> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  createInitialValues?: FormValues<Alert> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const AlertsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [initialValuesForAlert, setInitialValuesForAlert] =
    useState<JSONObject>({});

  return (
    <>
      <ModelTable<Alert>
        name="Alerts"
        userPreferencesKey="alerts-table"
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
        }}
        onCreateEditModalClose={(): void => {
          setInitialValuesForAlert({});
        }}
        modelType={Alert}
        id="alerts-table"
        isDeleteable={false}
        showCreateForm={Object.keys(initialValuesForAlert).length > 0}
        query={props.query || {}}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        createInitialValues={
          Object.keys(initialValuesForAlert).length > 0
            ? initialValuesForAlert
            : props.createInitialValues
        }
        cardProps={{
          title: props.title || "Alerts",
          description:
            props.description || "Here is a list of alerts for this project.",
        }}
        noItemsMessage={props.noItemsMessage || "No alerts found."}
        showRefreshButton={true}
        showViewIdButton={true}
        saveFilterProps={props.saveFilterProps}
        viewPageRoute={RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS]!)}
        filters={[
          {
            title: "Alert ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Alert Number",
            type: FieldType.Number,
            field: {
              alertNumber: true,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              alertSeverity: {
                name: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,

            filterEntityType: AlertSeverity,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              currentAlertState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            filterEntityType: AlertState,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              monitor: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitor Affected",
            type: FieldType.EntityArray,

            filterEntityType: Monitor,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
          {
            field: {
              labels: {
                name: true,
              },
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
            field: {
              alertNumber: true,
            },
            title: "Alert Number",
            type: FieldType.Text,
            getElement: (item: Alert): ReactElement => {
              if (!item.alertNumber) {
                return <>-</>;
              }

              return <>#{item.alertNumber}</>;
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Element,
            getElement: (item: Alert): ReactElement => {
              return <AlertElement alert={item} />;
            },
          },
          {
            field: {
              currentAlertState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,

            getElement: (item: Alert): ReactElement => {
              if (item["currentAlertState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertSeverity: {
                name: true,
                color: true,
              },
            },

            title: "Severity",
            type: FieldType.Entity,

            getElement: (item: Alert): ReactElement => {
              if (item["alertSeverity"]) {
                return (
                  <Pill
                    isMinimal={false}
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              monitor: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitor Affected",
            type: FieldType.EntityArray,

            getElement: (item: Alert): ReactElement => {
              if (item["monitor"]) {
                return <MonitorElement monitor={item["monitor"]!} />;
              }
              return <span>-</span>;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
            hideOnMobile: true,
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
            hideOnMobile: true,

            getElement: (item: Alert): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}
    </>
  );
};

export default AlertsTable;
