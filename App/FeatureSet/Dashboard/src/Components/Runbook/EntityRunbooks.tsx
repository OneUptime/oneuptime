import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Slate500,
  Yellow500,
} from "Common/Types/BrandColors";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export interface ComponentProps {
  incidentId?: ObjectID;
  alertId?: ObjectID;
  scheduledMaintenanceId?: ObjectID;
}

function statusPill(status: RunbookExecutionStatus): ReactElement {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return <Pill text="Completed" color={Green500} isMinimal={true} />;
    case RunbookExecutionStatus.Failed:
      return <Pill text="Failed" color={Red500} isMinimal={true} />;
    case RunbookExecutionStatus.Running:
      return <Pill text="Running" color={Blue500} isMinimal={true} />;
    case RunbookExecutionStatus.WaitingForManualStep:
      return <Pill text="Waiting" color={Yellow500} isMinimal={true} />;
    case RunbookExecutionStatus.Cancelled:
      return <Pill text="Cancelled" color={Gray500} isMinimal={true} />;
    case RunbookExecutionStatus.Scheduled:
    default:
      return (
        <Pill text={status || "Scheduled"} color={Slate500} isMinimal={true} />
      );
  }
}

const EntityRunbooks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showPickerModal, setShowPickerModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [refresher, setRefresher] = useState<boolean>(false);

  const query: Record<string, ObjectID> = {};
  if (props.incidentId) {
    query["incidentId"] = props.incidentId;
  }
  if (props.alertId) {
    query["alertId"] = props.alertId;
  }
  if (props.scheduledMaintenanceId) {
    query["scheduledMaintenanceId"] = props.scheduledMaintenanceId;
  }

  const linkagePayload: Record<string, string> = {};
  if (props.incidentId) {
    linkagePayload["incidentId"] = props.incidentId.toString();
  }
  if (props.alertId) {
    linkagePayload["alertId"] = props.alertId.toString();
  }
  if (props.scheduledMaintenanceId) {
    linkagePayload["scheduledMaintenanceId"] =
      props.scheduledMaintenanceId.toString();
  }

  const fetchRunbookOptions: () => Promise<
    Array<{ label: string; value: string }>
  > = async (): Promise<Array<{ label: string; value: string }>> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return [];
    }
    const result: ListResult<Runbook> = await ModelAPI.getList<Runbook>({
      modelType: Runbook,
      query: { projectId, isEnabled: true },
      limit: 200,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: "asc" as any },
    });
    return result.data.map((rb: Runbook) => {
      return {
        label: rb.name || "Unnamed runbook",
        value: rb._id?.toString() || "",
      };
    });
  };

  const startRunbook: (runbookId: string) => Promise<void> = async (
    runbookId: string,
  ): Promise<void> => {
    setIsStarting(true);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + runbookId,
          ),
          data: linkagePayload,
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      setShowPickerModal(false);
      setRefresher(!refresher);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Fragment>
      <ModelTable<RunbookExecution>
        modelType={RunbookExecution}
        id="entity-runbook-executions-table"
        userPreferencesKey="entity-runbook-executions-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        name="Runbooks"
        query={query}
        refreshToggle={refresher.toString()}
        cardProps={{
          title: "Runbooks",
          description:
            "Runbooks attached to this event — auto-triggered by rules or manually started below.",
          buttons: [
            {
              title: "Run Runbook",
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Play,
              onClick: () => {
                setShowPickerModal(true);
              },
              disabled: isStarting,
            },
          ],
        }}
        actionButtons={[
          {
            title: "View",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: RunbookExecution,
              onCompleteAction: VoidFunction,
            ) => {
              if (item.runbookId && item._id) {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                    {
                      modelId: item.runbookId,
                      subModelId: item._id as unknown as string,
                    },
                  ),
                );
              }
              onCompleteAction();
            },
          },
        ]}
        noItemsMessage={
          'No runbook executions on this event yet. Click "Run Runbook" to start one.'
        }
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: { runbookNameSnapshot: true },
            title: "Runbook",
            type: FieldType.Text,
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: RunbookExecution): ReactElement => {
              return statusPill(item.status as RunbookExecutionStatus);
            },
          },
          {
            field: { startedAt: true },
            title: "Started At",
            type: FieldType.DateTime,
          },
          {
            field: { completedAt: true },
            title: "Completed At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      {showPickerModal && (
        <BasicFormModal<{ runbookId: string }>
          title="Run a Runbook"
          description="Pick a runbook to run. It will be attached to this event."
          submitButtonText={isStarting ? "Starting..." : "Run"}
          onClose={() => {
            setShowPickerModal(false);
          }}
          onSubmit={async (values: { runbookId: string }) => {
            if (values.runbookId) {
              await startRunbook(values.runbookId);
            }
          }}
          formProps={{
            initialValues: { runbookId: "" },
            fields: [
              {
                field: { runbookId: true },
                title: "Runbook",
                required: true,
                fieldType: FormFieldSchemaType.Dropdown,
                fetchDropdownOptions: fetchRunbookOptions,
                placeholder: "Pick a runbook",
              },
            ],
          }}
        />
      )}

      {error ? (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default EntityRunbooks;
