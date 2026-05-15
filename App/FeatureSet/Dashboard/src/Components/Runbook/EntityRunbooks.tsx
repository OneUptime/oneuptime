import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RunbookPicker from "./RunbookPicker";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  incidentId?: ObjectID;
  alertId?: ObjectID;
  scheduledMaintenanceId?: ObjectID;
  hideIfEmpty?: boolean | undefined;
}

interface StatusVisual {
  label: string;
  badge: string;
  dot: string;
}

const STATUS_VISUAL: Record<RunbookExecutionStatus, StatusVisual> = {
  [RunbookExecutionStatus.Scheduled]: {
    label: "Scheduled",
    badge: "bg-slate-50 text-slate-700 ring-slate-200",
    dot: "bg-slate-300",
  },
  [RunbookExecutionStatus.Running]: {
    label: "Running",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [RunbookExecutionStatus.WaitingForManualStep]: {
    label: "Waiting",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [RunbookExecutionStatus.Completed]: {
    label: "Completed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [RunbookExecutionStatus.Failed]: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [RunbookExecutionStatus.Cancelled]: {
    label: "Cancelled",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function StatusPill({
  status,
}: {
  status: RunbookExecutionStatus;
}): ReactElement {
  const v: StatusVisual =
    STATUS_VISUAL[status] || STATUS_VISUAL[RunbookExecutionStatus.Scheduled]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {v.label}
    </span>
  );
}

const EntityRunbooks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showPickerModal, setShowPickerModal] = useState<boolean>(false);
  const [refresher, setRefresher] = useState<boolean>(false);
  const [hasExecutions, setHasExecutions] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (!props.hideIfEmpty) {
      return;
    }
    let cancelled: boolean = false;
    (async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query,
        });
        if (!cancelled) {
          setHasExecutions(count > 0);
        }
      } catch {
        if (!cancelled) {
          setHasExecutions(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    props.hideIfEmpty,
    props.incidentId?.toString(),
    props.alertId?.toString(),
    props.scheduledMaintenanceId?.toString(),
  ]);

  if (props.hideIfEmpty && hasExecutions !== true) {
    return <Fragment />;
  }

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
            "Response procedures attached to this event. Auto-triggered runbooks land here; you can also start one manually.",
          buttons: [
            {
              title: "Run Runbook",
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Play,
              onClick: () => {
                setShowPickerModal(true);
              },
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
          'No runbook executions yet. Click "Run Runbook" to start one.'
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
              return (
                <StatusPill status={item.status as RunbookExecutionStatus} />
              );
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

      <RunbookPicker
        isOpen={showPickerModal}
        onClose={() => {
          setShowPickerModal(false);
        }}
        onStarted={() => {
          setRefresher(!refresher);
          setHasExecutions(true);
        }}
        incidentId={props.incidentId}
        alertId={props.alertId}
        scheduledMaintenanceId={props.scheduledMaintenanceId}
      />
    </Fragment>
  );
};

export default EntityRunbooks;
