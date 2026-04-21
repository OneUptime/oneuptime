import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import ObjectID from "Common/Types/ObjectID";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import { JSONArray } from "Common/Types/JSON";
import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AuditLogChangesModal from "./AuditLogChangesModal";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  title: string;
  description: string;
  resourceType?: string;
  resourceId?: ObjectID;
}

interface ActionStyle {
  label: string;
  icon: IconProp;
  className: string;
  iconColor: string;
}

const ACTION_STYLES: { [key: string]: ActionStyle } = {
  Create: {
    label: "Create",
    icon: IconProp.PlusCircle,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconColor: "text-emerald-600",
  },
  Update: {
    label: "Update",
    icon: IconProp.Pencil,
    className: "border-sky-200 bg-sky-50 text-sky-700",
    iconColor: "text-sky-600",
  },
  Delete: {
    label: "Delete",
    icon: IconProp.Trash,
    className: "border-red-200 bg-red-50 text-red-700",
    iconColor: "text-red-600",
  },
};

interface ResourceMeta {
  icon: IconProp;
  color: string;
  bgColor: string;
  viewRoute?: PageMap | undefined;
}

const RESOURCE_META: { [key: string]: ResourceMeta } = {
  Monitor: {
    icon: IconProp.AltGlobe,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-100",
    viewRoute: PageMap.MONITOR_VIEW,
  },
  Incident: {
    icon: IconProp.Alert,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-100",
    viewRoute: PageMap.INCIDENT_VIEW,
  },
  Alert: {
    icon: IconProp.Bell,
    color: "text-orange-600",
    bgColor: "bg-orange-50 border-orange-100",
    viewRoute: PageMap.ALERT_VIEW,
  },
  "Status Page": {
    icon: IconProp.Window,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50 border-indigo-100",
    viewRoute: PageMap.STATUS_PAGE_VIEW,
  },
  "Scheduled Maintenance Event": {
    icon: IconProp.Clock,
    color: "text-yellow-700",
    bgColor: "bg-yellow-50 border-yellow-100",
    viewRoute: PageMap.SCHEDULED_MAINTENANCE_VIEW,
  },
  "On-Call Policy": {
    icon: IconProp.Call,
    color: "text-purple-600",
    bgColor: "bg-purple-50 border-purple-100",
    viewRoute: PageMap.ON_CALL_DUTY_POLICY_VIEW,
  },
  "API Key": {
    icon: IconProp.Key,
    color: "text-violet-600",
    bgColor: "bg-violet-50 border-violet-100",
  },
  Label: {
    icon: IconProp.Label,
    color: "text-pink-600",
    bgColor: "bg-pink-50 border-pink-100",
  },
  Team: {
    icon: IconProp.Team,
    color: "text-cyan-700",
    bgColor: "bg-cyan-50 border-cyan-100",
    viewRoute: PageMap.SETTINGS_TEAM_VIEW,
  },
  Probe: {
    icon: IconProp.Signal,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SETTINGS_PROBE_VIEW,
  },
  Workflow: {
    icon: IconProp.Workflow,
    color: "text-slate-700",
    bgColor: "bg-slate-50 border-slate-200",
    viewRoute: PageMap.WORKFLOW_VIEW,
  },
};

const DEFAULT_RESOURCE_META: ResourceMeta = {
  icon: IconProp.Cube,
  color: "text-gray-600",
  bgColor: "bg-gray-50 border-gray-200",
};

const getResourceMeta: (type: string | undefined) => ResourceMeta = (
  type: string | undefined,
): ResourceMeta => {
  if (!type) {
    return DEFAULT_RESOURCE_META;
  }
  return RESOURCE_META[type] || DEFAULT_RESOURCE_META;
};

const getActorInitials: (name: string | undefined) => string = (
  name: string | undefined,
): string => {
  if (!name) {
    return "?";
  }
  const parts: Array<string> = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p: string) => {
      return p.charAt(0).toUpperCase();
    })
    .join("");
};

const AuditLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEnterpriseEligible: boolean = useMemo(() => {
    if (IS_ENTERPRISE_EDITION) {
      return true;
    }
    if (BILLING_ENABLED) {
      return ProjectUtil.getCurrentPlan() === PlanType.Enterprise;
    }
    return false;
  }, []);

  const [detailItem, setDetailItem] = useState<AuditLog | null>(null);

  const computedQuery: Query<AuditLog> = useMemo(() => {
    const query: Query<AuditLog> = {};

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      query.projectId = projectId;
    }

    if (props.resourceType) {
      query.resourceType = props.resourceType;
    }

    if (props.resourceId) {
      query.resourceId = props.resourceId;
    }

    return query;
  }, [props.resourceType, props.resourceId]);

  if (!isEnterpriseEligible) {
    return (
      <Card
        title={props.title}
        description={props.description}
        rightElement={
          BILLING_ENABLED ? (
            <Button
              title="Upgrade to Enterprise"
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.Billing}
              onClick={() => {
                window.open("https://oneuptime.com/pricing", "_blank");
              }}
            />
          ) : (
            <Button
              title="Learn about Enterprise Edition"
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.Info}
              onClick={() => {
                window.open("https://oneuptime.com/enterprise", "_blank");
              }}
            />
          )
        }
      >
        <div className="p-4 text-sm text-gray-600">
          {BILLING_ENABLED
            ? "Audit Logs are available on the Enterprise plan. Upgrade to record every change made to your project's resources and retain the history for compliance."
            : "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to record every change made to your project's resources."}
        </div>
      </Card>
    );
  }

  const extraSelect: Select<AuditLog> = {
    resourceId: true,
    userId: true,
    userName: true,
    apiKeyName: true,
    apiKeyId: true,
    changes: true,
  };

  return (
    <Fragment>
      <AnalyticsModelTable<AuditLog>
        modelType={AuditLog}
        id="audit-logs-table"
        name="Audit Logs"
        singularName="Audit Log"
        pluralName="Audit Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        userPreferencesKey="audit-logs-table"
        cardProps={{
          title: props.title,
          description: props.description,
        }}
        query={computedQuery}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        selectMoreFields={extraSelect}
        noItemsMessage={
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 mb-3">
              <Icon
                icon={IconProp.ClipboardDocumentList}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
              />
            </div>
            <div className="text-sm font-medium text-gray-900">
              No audit entries yet
            </div>
            <div className="text-xs text-gray-500 mt-1 max-w-sm">
              Changes made to resources in this project will appear here
              automatically. Create, update, or delete a resource to see an
              entry.
            </div>
          </div>
        }
        showRefreshButton={true}
        showViewIdButton={false}
        filters={[
          {
            field: { resourceType: true },
            type: FieldType.Text,
            title: "Resource Type",
          },
          {
            field: { resourceName: true },
            type: FieldType.Text,
            title: "Resource Name",
          },
          {
            field: { action: true },
            type: FieldType.Text,
            title: "Action",
          },
          {
            field: { userEmail: true },
            type: FieldType.Text,
            title: "User Email",
          },
          {
            field: { createdAt: true },
            type: FieldType.DateTime,
            title: "Time",
          },
        ]}
        columns={[
          {
            field: { createdAt: true },
            title: "When",
            type: FieldType.Element,
            getElement: (item: AuditLog): ReactElement => {
              const created: Date | undefined = item.createdAt;
              if (!created) {
                return <span className="text-gray-400">—</span>;
              }
              const createdDate: Date = new Date(created);
              return (
                <div
                  className="flex flex-col leading-tight"
                  title={OneUptimeDate.getDateAsLocalFormattedString(
                    createdDate,
                  )}
                >
                  <span className="text-sm font-medium text-gray-900">
                    {OneUptimeDate.fromNow(createdDate)}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {OneUptimeDate.getDateAsLocalFormattedString(createdDate)}
                  </span>
                </div>
              );
            },
          },
          {
            field: { action: true },
            title: "Action",
            type: FieldType.Element,
            getElement: (item: AuditLog): ReactElement => {
              const action: string = item.action || "Unknown";
              const style: ActionStyle =
                ACTION_STYLES[action] || {
                  label: action,
                  icon: IconProp.Info,
                  className: "border-gray-200 bg-gray-50 text-gray-700",
                  iconColor: "text-gray-500",
                };
              return (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${style.className}`}
                >
                  <Icon
                    icon={style.icon}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className={`h-3 w-3 ${style.iconColor}`}
                  />
                  {style.label}
                </span>
              );
            },
          },
          {
            field: { resourceType: true },
            title: "Resource",
            type: FieldType.Element,
            getElement: (item: AuditLog): ReactElement => {
              const type: string | undefined = item.resourceType;
              const name: string | undefined = item.resourceName;
              const resourceId: ObjectID | undefined = item.resourceId;
              const meta: ResourceMeta = getResourceMeta(type);

              const nameEl: ReactElement = (
                <span className="text-sm font-medium text-gray-900 truncate">
                  {name || (
                    <span className="italic text-gray-400">Unnamed</span>
                  )}
                </span>
              );

              let linkedNameEl: ReactElement = nameEl;
              if (
                meta.viewRoute &&
                resourceId &&
                item.action !== "Delete" &&
                RouteMap[meta.viewRoute]
              ) {
                const route: Route = RouteUtil.populateRouteParams(
                  RouteMap[meta.viewRoute] as Route,
                  { modelId: resourceId },
                );
                linkedNameEl = (
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline truncate"
                  >
                    {name || "Unnamed"}
                  </AppLink>
                );
              }

              return (
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border ${meta.bgColor}`}
                  >
                    <Icon
                      icon={meta.icon}
                      size={SizeProp.Small}
                      thick={ThickProp.Thick}
                      className={`h-4 w-4 ${meta.color}`}
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    {linkedNameEl}
                    <span className="text-[11px] text-gray-500">
                      {type || "Resource"}
                    </span>
                  </div>
                </div>
              );
            },
          },
          {
            field: { userEmail: true },
            title: "Actor",
            type: FieldType.Element,
            getElement: (item: AuditLog): ReactElement => {
              const userType: string = item.userType || "System";
              const isApi: boolean = userType === "API";
              const isSystem: boolean =
                userType === "System" &&
                !item.userEmail &&
                !item.userName &&
                !item.apiKeyName;

              if (isApi) {
                const apiName: string = item.apiKeyName || "API Key";
                return (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                      <Icon
                        icon={IconProp.Key}
                        size={SizeProp.Small}
                        thick={ThickProp.Thick}
                        className="h-4 w-4"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {apiName}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        API request
                      </span>
                    </div>
                  </div>
                );
              }

              if (isSystem) {
                return (
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <Icon
                        icon={IconProp.Cog6Tooth}
                        size={SizeProp.Small}
                        thick={ThickProp.Thick}
                        className="h-4 w-4"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-900">
                        System
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Automated change
                      </span>
                    </div>
                  </div>
                );
              }

              const displayName: string =
                item.userName || item.userEmail || "Unknown user";
              const initials: string = getActorInitials(
                item.userName || item.userEmail,
              );
              return (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
                    {initials}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {displayName}
                    </span>
                    {item.userEmail && item.userName ? (
                      <span className="text-[11px] text-gray-500 truncate">
                        {item.userEmail}
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-500">
                        {userType || "User"}
                      </span>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            field: { changes: true },
            title: "Changes",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: AuditLog): ReactElement => {
              const rawChanges: JSONArray | undefined = item.changes;
              const count: number = Array.isArray(rawChanges)
                ? rawChanges.length
                : 0;
              const action: string = item.action || "";
              const isUpdate: boolean = action === "Update";

              if (count === 0) {
                return (
                  <span className="text-xs text-gray-400 italic">
                    No fields recorded
                  </span>
                );
              }

              const label: string = isUpdate
                ? `${count} field${count === 1 ? "" : "s"} changed`
                : `${count} field${count === 1 ? "" : "s"} captured`;

              return (
                <button
                  type="button"
                  onClick={() => {
                    setDetailItem(item);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <Icon
                    icon={IconProp.List}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className="h-3 w-3 text-gray-500"
                  />
                  {label}
                </button>
              );
            },
          },
        ]}
      />

      <AuditLogChangesModal
        isOpen={detailItem !== null}
        onClose={() => {
          setDetailItem(null);
        }}
        action={detailItem?.action || ""}
        resourceType={detailItem?.resourceType}
        resourceName={detailItem?.resourceName}
        changes={detailItem?.changes}
      />
    </Fragment>
  );
};

export default AuditLogsTable;
