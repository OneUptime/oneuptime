import React, { FunctionComponent, ReactElement } from "react";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunType from "Common/Types/AI/AIRunType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeFixRunStatusPill, {
  getCodeFixRunStatusDropdownOptions,
  getCodeFixTaskTypeDropdownOptions,
  getCodeFixTaskTypeLabel,
} from "./CodeFixRunStatus";
import CodeFixRunDuration from "./CodeFixRunDuration";

const TABLE_ID: string = "code-fix-runs-table";

/*
 * The AI Agent Tasks list: the project's code tasks (CodeFix AIRuns — fixes,
 * regression tests, instrumentation improvements and performance fixes).
 *
 * This reads through the standard /ai-run CRUD, so filtering, sorting, paging
 * and per-column permissions all come from ModelTable. Code-fix runs are
 * visible to the whole project because AIRunService forces
 * `runType = CodeFix OR userId = <caller>` onto every read (see
 * Utils/AI/AIRunPrivacyFilter) — chat runs stay private to their author, and
 * the `runType` query below can only narrow that clause, never widen it.
 */
const CodeFixRunsTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<AIRun>
      modelType={AIRun}
      id={TABLE_ID}
      userPreferencesKey={TABLE_ID}
      saveFilterProps={{
        tableId: TABLE_ID,
      }}
      name="AI Tasks"
      /*
       * The model is called "AI Run" because it also covers chat and
       * investigation runs. This page only ever shows code-fix runs, and the
       * product calls those tasks — so override the labels the pagination
       * count and the row action inherit from the model metadata.
       */
      singularName="Task"
      pluralName="Tasks"
      /*
       * Runs are system-managed audit records: the AIRun model grants no
       * create/update/delete permissions to anyone.
       */
      isCreateable={false}
      isEditable={false}
      isDeleteable={false}
      isViewable={true}
      showViewIdButton={false}
      query={{
        runType: AIRunType.CodeFix,
      }}
      /*
       * Read by the Duration and Task columns but not columns of their own —
       * BaseModelTable only selects keys a column declares.
       */
      selectMoreFields={{
        startedAt: true,
        completedAt: true,
      }}
      onViewPage={(item: AIRun) => {
        return Promise.resolve(
          RouteUtil.populateRouteParams(RouteMap[PageMap.AI_AGENT_TASK_VIEW]!, {
            modelId: item.id!,
          }),
        );
      }}
      viewPageRoute={Navigation.getCurrentRoute()}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "AI Tasks",
        description:
          "Code tasks executed by AI — fixes and regression tests. Open a task to watch what AI did step by step.",
      }}
      noItemsMessage="No AI agent tasks yet. New tasks appear here when you start a fix or a regression test from an exception page (Telemetry > Exceptions)."
      showRefreshButton={true}
      filters={[
        {
          field: {
            codeFixTaskType: true,
          },
          title: "Task",
          type: FieldType.Dropdown,
          filterDropdownOptions: getCodeFixTaskTypeDropdownOptions(),
        },
        {
          field: {
            status: true,
          },
          title: "Status",
          type: FieldType.Dropdown,
          filterDropdownOptions: getCodeFixRunStatusDropdownOptions(),
        },
        {
          field: {
            createdAt: true,
          },
          title: "Created At",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: {
            codeFixTaskType: true,
          },
          title: "Task",
          type: FieldType.Text,
          getElement: (item: AIRun): ReactElement => {
            return (
              <span className="font-medium text-gray-900">
                {getCodeFixTaskTypeLabel(item.codeFixTaskType)}
              </span>
            );
          },
        },
        {
          field: {
            status: true,
          },
          title: "Status",
          type: FieldType.Text,
          getElement: (item: AIRun): ReactElement => {
            return <CodeFixRunStatusPill status={item.status} />;
          },
        },
        {
          field: {
            createdAt: true,
          },
          title: "Created At",
          type: FieldType.DateTime,
        },
        {
          field: {
            completedAt: true,
          },
          title: "Duration",
          type: FieldType.Text,
          disableSort: true,
          getElement: (item: AIRun): ReactElement => {
            return (
              <CodeFixRunDuration
                status={item.status}
                startedAt={item.startedAt}
                completedAt={item.completedAt}
              />
            );
          },
        },
        {
          field: {
            errorMessage: true,
          },
          title: "Error",
          type: FieldType.Text,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: AIRun): ReactElement => {
            if (!item.errorMessage) {
              return <span className="text-gray-400">-</span>;
            }

            return (
              <span
                className="text-sm text-gray-600 line-clamp-2"
                title={item.errorMessage}
              >
                {item.errorMessage}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default CodeFixRunsTable;
