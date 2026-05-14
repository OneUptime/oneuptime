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
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
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
    STATUS_VISUAL[status] ||
    STATUS_VISUAL[RunbookExecutionStatus.Scheduled]!;
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
  const [error, setError] = useState<string>("");
  const [startingRunbookId, setStartingRunbookId] = useState<string | null>(
    null,
  );
  const [refresher, setRefresher] = useState<boolean>(false);
  const [availableRunbooks, setAvailableRunbooks] = useState<Runbook[]>([]);
  const [isLoadingRunbooks, setIsLoadingRunbooks] = useState<boolean>(false);
  const [pickerSearch, setPickerSearch] = useState<string>("");

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

  const openPicker: () => Promise<void> = async (): Promise<void> => {
    setShowPickerModal(true);
    setIsLoadingRunbooks(true);
    setPickerSearch("");
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setAvailableRunbooks([]);
        return;
      }
      const result: ListResult<Runbook> = await ModelAPI.getList<Runbook>({
        modelType: Runbook,
        query: { projectId, isEnabled: true },
        limit: 200,
        skip: 0,
        select: { _id: true, name: true, description: true },
        sort: { name: "asc" as any },
      });
      setAvailableRunbooks(result.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoadingRunbooks(false);
    }
  };

  const startRunbook: (runbookId: string) => Promise<void> = async (
    runbookId: string,
  ): Promise<void> => {
    setStartingRunbookId(runbookId);
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
      setStartingRunbookId(null);
    }
  };

  const filteredRunbooks: Runbook[] = pickerSearch.trim()
    ? availableRunbooks.filter((rb: Runbook) => {
        return (rb.name || "")
          .toLowerCase()
          .includes(pickerSearch.toLowerCase().trim());
      })
    : availableRunbooks;

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
                void openPicker();
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

      {showPickerModal && (
        <Modal
          title="Run a Runbook"
          description="Pick a runbook to run. It will be attached to this event so you can track it from here."
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShowPickerModal(false);
          }}
          submitButtonText="Cancel"
          submitButtonStyleType={ButtonStyleType.OUTLINE}
          onSubmit={() => {
            setShowPickerModal(false);
          }}
        >
          <div className="space-y-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Icon
                  icon={IconProp.Search}
                  size={SizeProp.Regular}
                  className="text-gray-400"
                />
              </span>
              <input
                type="text"
                placeholder="Search runbooks..."
                value={pickerSearch}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setPickerSearch(e.target.value);
                }}
                className="block w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {isLoadingRunbooks ? (
              <div className="flex justify-center py-6">
                <PageLoader isVisible={true} />
              </div>
            ) : filteredRunbooks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
                <div className="mx-auto h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-3">
                  <Icon
                    icon={IconProp.BookOpen}
                    size={SizeProp.Regular}
                    className="text-gray-400"
                  />
                </div>
                <p className="text-sm font-medium text-gray-900">
                  {availableRunbooks.length === 0
                    ? "No runbooks yet"
                    : "No matches"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {availableRunbooks.length === 0
                    ? "Create a runbook first, then come back to attach one."
                    : "Try a different search term."}
                </p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {filteredRunbooks.map((rb: Runbook) => {
                  const rbId: string = rb._id?.toString() || "";
                  const isStarting: boolean = startingRunbookId === rbId;
                  return (
                    <li key={rbId}>
                      <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Icon
                              icon={IconProp.BookOpen}
                              size={SizeProp.Regular}
                              className="text-indigo-500 shrink-0"
                            />
                            <span className="text-sm font-semibold text-gray-900 truncate">
                              {rb.name || "Untitled runbook"}
                            </span>
                          </div>
                          {rb.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {rb.description}
                            </p>
                          )}
                        </div>
                        <Button
                          title={isStarting ? "Starting..." : "Run"}
                          buttonStyle={ButtonStyleType.PRIMARY}
                          buttonSize={ButtonSize.Small}
                          icon={IconProp.Play}
                          onClick={() => {
                            void startRunbook(rbId);
                          }}
                          disabled={startingRunbookId !== null}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Modal>
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
