import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IncidentElement from "../../../Components/Incident/Incident";
import AlertElement from "../../../Components/Alert/Alert";
import TeamElement from "../../../Components/Team/Team";
import UserElement from "../../../Components/User/User";
import AppLink from "../../../Components/AppLink/AppLink";
import ProjectUser from "../../../Utils/ProjectUser";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Navigation from "Common/UI/Utils/Navigation";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { RUNBOOK_URL } from "Common/UI/Config";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Label from "Common/Models/DatabaseModels/Label";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookOwnerTeam from "Common/Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "Common/Models/DatabaseModels/RunbookOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ProjectUtil from "Common/UI/Utils/Project";
import { JSONObject } from "Common/Types/JSON";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Card from "Common/UI/Components/Card/Card";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";

function statusPill(status: RunbookExecutionStatus | undefined): ReactElement {
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
      return <Pill text="Scheduled" color={Gray500} isMinimal={true} />;
    default:
      return <Pill text="—" color={Gray500} isMinimal={true} />;
  }
}

function triggerSourceElement(execution: RunbookExecution): ReactElement {
  if (execution.incident) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">Incident:</span>
        <IncidentElement incident={execution.incident as Incident} />
      </span>
    );
  }
  if (execution.alert) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">Alert:</span>
        <AlertElement alert={execution.alert as Alert} />
      </span>
    );
  }
  if (execution.scheduledMaintenance) {
    const sm: ScheduledMaintenance =
      execution.scheduledMaintenance as ScheduledMaintenance;
    if (sm._id) {
      return (
        <span className="inline-flex items-center gap-1 text-sm text-gray-700">
          <span className="text-gray-500">Maintenance:</span>
          <AppLink
            className="hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
              { modelId: new ObjectID(sm._id as string) },
            )}
          >
            <span>{sm.title || "View"}</span>
          </AppLink>
        </span>
      );
    }
    return (
      <span className="text-sm text-gray-700">
        Maintenance: {sm.title || "—"}
      </span>
    );
  }
  if (execution.triggeredByUser) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-700">
        <span className="text-gray-500">Manual run by</span>
        <UserElement user={execution.triggeredByUser as User} />
      </span>
    );
  }
  return <span className="text-sm text-gray-500">Manual / unknown</span>;
}

interface OverviewStats {
  isLoaded: boolean;
  lastExecution: RunbookExecution | null;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
}

const Overview: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState<OverviewStats>({
    isLoaded: false,
    lastExecution: null,
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
  });

  const loadStats: () => Promise<void> = async (): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    try {
      const baseQuery: { runbookId: ObjectID; projectId: ObjectID } = {
        runbookId: modelId,
        projectId,
      };

      const [lastExec, total, success, failed]: [
        ListResult<RunbookExecution>,
        number,
        number,
        number,
      ] = await Promise.all([
        ModelAPI.getList<RunbookExecution>({
          modelType: RunbookExecution,
          query: baseQuery,
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            failureReason: true,
            incident: { _id: true, title: true },
            alert: { _id: true, title: true },
            scheduledMaintenance: { _id: true, title: true },
            triggeredByUser: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: baseQuery,
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: {
            ...baseQuery,
            status: RunbookExecutionStatus.Completed,
          },
        }),
        ModelAPI.count<RunbookExecution>({
          modelType: RunbookExecution,
          query: {
            ...baseQuery,
            status: RunbookExecutionStatus.Failed,
          },
        }),
      ]);

      setStats({
        isLoaded: true,
        lastExecution: lastExec.data[0] ?? null,
        totalRuns: total,
        successRuns: success,
        failedRuns: failed,
      });
    } catch {
      setStats((prev: OverviewStats) => {
        return { ...prev, isLoaded: true };
      });
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  const runNow: () => Promise<void> = async (): Promise<void> => {
    setIsRunning(true);
    setError("");
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            "/run/" + modelId.toString(),
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders({}),
        });

      if (result instanceof HTTPErrorResponse) {
        throw result;
      }

      const runbookExecutionId: string | undefined = (
        result.data as JSONObject
      )?.["runbookExecutionId"] as string | undefined;

      if (runbookExecutionId) {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
            {
              modelId,
              subModelId: runbookExecutionId,
            },
          ),
        );
      } else {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
            { modelId },
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsRunning(false);
    }
  };

  const lastExec: RunbookExecution | null = stats.lastExecution;
  const lastStartedAt: Date | undefined =
    lastExec?.startedAt || lastExec?.createdAt;

  const goToExecution: (executionId: string) => void = (
    executionId: string,
  ) => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
        { modelId, subModelId: executionId },
      ),
    );
  };

  const goToExecutionsList: () => void = () => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
        { modelId },
      ),
    );
  };

  return (
    <Fragment>
      <CardModelDetail<Runbook>
        name="Runbook > Overview"
        cardProps={{
          title: "Runbook",
          description: "Overview of this runbook.",
          buttons: [
            {
              title: isRunning ? "Starting..." : "Run Now",
              buttonStyle: ButtonStyleType.PRIMARY,
              icon: IconProp.Play,
              onClick: () => {
                void runNow();
              },
              disabled: isRunning,
            },
          ],
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Database failover runbook",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "What this runbook is for and when it should be triggered.",
          },
          {
            field: { labels: true },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Runbook,
          id: "model-detail-runbook-overview",
          fields: [
            { field: { name: true }, title: "Name" },
            { field: { description: true }, title: "Description" },
            {
              field: { isEnabled: true },
              title: "Enabled",
              fieldType: FieldType.Element,
              getElement: (item: Runbook): ReactElement => {
                if (item.isEnabled) {
                  return (
                    <Pill text="Enabled" color={Green500} isMinimal={true} />
                  );
                }
                return <Pill text="Disabled" color={Red500} isMinimal={true} />;
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: Runbook): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId,
        }}
      />

      <Card
        title="Activity"
        description="Recent execution history for this runbook."
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            className={`rounded-xl border border-gray-200 bg-white p-4 ${lastExec?._id ? "cursor-pointer hover:border-indigo-300 hover:shadow-sm transition" : ""}`}
            onClick={() => {
              if (lastExec?._id) {
                goToExecution(lastExec._id as unknown as string);
              }
            }}
          >
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Last Run
            </div>
            {!stats.isLoaded ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : lastExec ? (
              <div className="flex flex-col gap-1">
                <div>
                  {statusPill(lastExec.status as RunbookExecutionStatus)}
                </div>
                <div className="text-sm text-gray-700">
                  {lastStartedAt ? OneUptimeDate.fromNow(lastStartedAt) : "—"}
                </div>
                <div className="text-xs text-gray-500">
                  {lastStartedAt
                    ? OneUptimeDate.getDateAsLocalFormattedString(lastStartedAt)
                    : null}
                </div>
                <div className="mt-1">{triggerSourceElement(lastExec)}</div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                Never run yet. Click{" "}
                <span className="font-medium text-gray-700">Run Now</span> to
                start one.
              </div>
            )}
          </div>

          <div
            className="rounded-xl border border-gray-200 bg-white p-4 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition"
            onClick={goToExecutionsList}
          >
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Total Runs
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {stats.isLoaded ? stats.totalRuns : "—"}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              All executions on record
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Outcomes
            </div>
            <div className="flex items-baseline gap-3 text-sm">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                <span className="font-semibold text-gray-900">
                  {stats.isLoaded ? stats.successRuns : "—"}
                </span>
                <span className="text-gray-500">completed</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                <span className="font-semibold text-gray-900">
                  {stats.isLoaded ? stats.failedRuns : "—"}
                </span>
                <span className="text-gray-500">failed</span>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Across all recorded executions
            </div>
          </div>
        </div>
      </Card>

      <ModelTable<RunbookOwnerTeam>
        modelType={RunbookOwnerTeam}
        id="table-runbook-owner-team"
        name="Runbook > Owner Team"
        userPreferencesKey="runbook-owner-team-table"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          runbookId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: RunbookOwnerTeam): Promise<RunbookOwnerTeam> => {
          item.runbookId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Teams that own this runbook. They are notified about changes.",
        }}
        noItemsMessage={"No teams associated with this runbook so far."}
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Team",
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              team: true,
            },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
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
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Entity,

            getElement: (item: RunbookOwnerTeam): ReactElement => {
              if (!item["team"]) {
                throw new BadDataException("Team not found");
              }

              return <TeamElement team={item["team"] as Team} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<RunbookOwnerUser>
        modelType={RunbookOwnerUser}
        id="table-runbook-owner-user"
        name="Runbook > Owner User"
        userPreferencesKey="runbook-owner-user-table"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          runbookId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: RunbookOwnerUser): Promise<RunbookOwnerUser> => {
          item.runbookId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Users that own this runbook. They are notified about changes.",
        }}
        noItemsMessage={"No users associated with this runbook so far."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select User",
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              user: true,
            },
            title: "User",
            type: FieldType.Entity,
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
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
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Entity,

            getElement: (item: RunbookOwnerUser): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }

              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      {error && (
        <ConfirmModal
          title="Could not start runbook"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default Overview;
