import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertEpisodeElement from "./AlertEpisode";
import { Black } from "Common/Types/BrandColors";
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
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import Label from "Common/Models/DatabaseModels/Label";
import React, { FunctionComponent, ReactElement, useState } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  query?: Query<AlertEpisode> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  createInitialValues?: FormValues<AlertEpisode> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const AlertEpisodesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");

  return (
    <>
      <ModelTable<AlertEpisode>
        name="Alert Episodes"
        userPreferencesKey="alert-episodes-table"
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
        }}
        modelType={AlertEpisode}
        id="alert-episodes-table"
        isDeleteable={false}
        query={props.query || {}}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Alert Episodes",
          description:
            props.description ||
            "Here is a list of alert episodes for this project.",
        }}
        noItemsMessage={props.noItemsMessage || "No episodes found."}
        showRefreshButton={true}
        showViewIdButton={true}
        saveFilterProps={props.saveFilterProps}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERT_EPISODES]!,
        )}
        filters={[
          {
            title: "Episode ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Episode Number",
            type: FieldType.Number,
            field: {
              episodeNumber: true,
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
              alertGroupingRule: {
                name: true,
              },
            },
            title: "Grouping Rule",
            type: FieldType.Entity,
            filterEntityType: AlertGroupingRule,
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
              episodeNumber: true,
            },
            title: "Episode #",
            type: FieldType.Text,
            getElement: (item: AlertEpisode): ReactElement => {
              if (!item.episodeNumber) {
                return <>-</>;
              }

              return <>#{item.episodeNumber}</>;
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Element,
            getElement: (item: AlertEpisode): ReactElement => {
              return <AlertEpisodeElement alertEpisode={item} />;
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
            getElement: (item: AlertEpisode): ReactElement => {
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
            getElement: (item: AlertEpisode): ReactElement => {
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
              alertCount: true,
            },
            title: "Alerts",
            type: FieldType.Number,
            getElement: (item: AlertEpisode): ReactElement => {
              return <>{item.alertCount || 0}</>;
            },
          },
          {
            field: {
              alertGroupingRule: {
                name: true,
              },
            },
            title: "Grouping Rule",
            type: FieldType.Entity,
            getElement: (item: AlertEpisode): ReactElement => {
              if (item["alertGroupingRule"]) {
                return <span>{item.alertGroupingRule.name || "-"}</span>;
              }
              return <span>Manual</span>;
            },
          },
          {
            field: {
              lastAlertAddedAt: true,
            },
            title: "Last Activity",
            type: FieldType.DateTime,
            hideOnMobile: true,
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
            getElement: (item: AlertEpisode): ReactElement => {
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

export default AlertEpisodesTable;
