import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONArray } from "Common/Types/JSON";
import AppLink from "@oneuptime/dashboard/Components/AppLink/AppLink";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import AuditLogChangesModal from "./AuditLogChangesModal";
import {
  AuditLogsStoppedCopy,
  getAuditLogsStoppedCopy,
} from "./AuditLogsLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../SSO/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../SSO/License/UseEnterpriseLicenseMode";
import {
  ResourceLink,
  ResourceMeta,
  getActorInitials,
  getAuditLogsQuery,
  getResourceLink,
  getResourceMeta,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import { AuditLogsTableProps } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * The body of the shared audit log table (OneUptime Enterprise).
 *
 * Every resource page renders core's Components/AuditLogs/AuditLogsTable,
 * which renders THIS component through the Dashboard plugin (the
 * "AuditLogsTable" key) - or the audit log upsell card when the project is not
 * eligible or the build has no Enterprise plugin. The eligibility check
 * therefore lives in that shell, not here: by the time this renders, the
 * project may have audit logs.
 *
 * The props are the contract's AuditLogsTableProps, so the shell and the body
 * cannot drift apart.
 *
 * Eligibility is not the license, though: once the trial or grace period is
 * over without a valid Enterprise license (or with one that does not include
 * audit logs), nothing is recorded, whatever the project's switch says. The
 * table stays reachable so entries recorded so far can be read, and says in
 * its header and its empty state that it is not recording - the same copy as
 * Settings > Audit Logs (AuditLogsLicenseNotice). During the trial or grace
 * period, on OneUptime Cloud and while the license state is unknown the
 * server records as configured, so the table says nothing about the license.
 */
export type ComponentProps = AuditLogsTableProps;

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
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
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

const AuditLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [detailItem, setDetailItem] = useState<AuditLog | null>(null);

  /*
   * Whether this project records audit logs at all. Recording is off by
   * default and switched on only in Settings, so without saying so an empty
   * table reads as "nothing has changed" when the truth is "nothing is being
   * recorded". null until known - a failed or partial read shows nothing
   * rather than a guess.
   */
  const [isAuditLoggingEnabled, setIsAuditLoggingEnabled] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    let isUnmounted: boolean = false;

    const loadAuditLoggingSetting: PromiseVoidFunction =
      async (): Promise<void> => {
        try {
          const project: Project | null = await ModelAPI.getItem<Project>({
            modelType: Project,
            id: projectId,
            select: { enableAuditLogs: true },
          });

          if (!isUnmounted && typeof project?.enableAuditLogs === "boolean") {
            setIsAuditLoggingEnabled(project.enableAuditLogs);
          }
        } catch {
          // Advisory only: the table works without it.
        }
      };

    loadAuditLoggingSetting().catch(() => {
      // loadAuditLoggingSetting handles its own errors.
    });

    return () => {
      isUnmounted = true;
    };
  }, []);

  const computedQuery: Query<AuditLog> = useMemo(() => {
    return getAuditLogsQuery({
      projectId: ProjectUtil.getCurrentProjectId(),
      resourceType: props.resourceType,
      resourceId: props.resourceId,
      rootResourceId: props.rootResourceId,
    });
  }, [props.resourceType, props.resourceId, props.rootResourceId]);

  const extraSelect: Select<AuditLog> = {
    resourceName: true,
    resourceId: true,
    rootResourceType: true,
    rootResourceId: true,
    userId: true,
    userName: true,
    userType: true,
    apiKeyName: true,
    apiKeyId: true,
    changes: true,
  };

  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.AuditLogs,
  );

  // Set when the license has stopped recording; it wins over the switch.
  const licenseStoppedCopy: AuditLogsStoppedCopy | null =
    getAuditLogsStoppedCopy(licenseMode);

  const isAuditLoggingOff: boolean = isAuditLoggingEnabled === false;

  const auditLogSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_AUDIT_LOGS_SETTINGS] as Route,
  );

  /*
   * A small pill in the card header rather than a banner: the table below
   * stays the page, and rows recorded before logging was turned off stay in
   * view.
   */
  const licenseNotRecordingNotice: ReactElement | undefined =
    licenseStoppedCopy ? (
      <div
        data-testid="audit-logging-license-notice"
        role="status"
        title={`${licenseStoppedCopy.title} ${licenseStoppedCopy.description}`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-red-200 bg-red-50 py-1 pl-2 pr-3 text-xs text-red-800"
      >
        <Icon
          icon={IconProp.ExclaimationCircle}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
          className="h-3.5 w-3.5 flex-shrink-0 text-red-600"
        />
        <span className="truncate">
          {licenseMode === EnterpriseLicenseMode.NotIncluded
            ? "Audit logging is not recording: not included in your Enterprise license"
            : "Audit logging is not recording: Enterprise license required"}
        </span>
      </div>
    ) : undefined;

  const auditLoggingOffNotice: ReactElement | undefined = isAuditLoggingOff ? (
    <div
      data-testid="audit-logging-disabled-notice"
      role="status"
      title="New changes to this project are not being recorded until audit logging is turned on in Settings."
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 py-1 pl-2 pr-3 text-xs text-amber-800"
    >
      <Icon
        icon={IconProp.ExclaimationCircle}
        size={SizeProp.Small}
        thick={ThickProp.Thick}
        className="h-3.5 w-3.5 flex-shrink-0 text-amber-600"
      />
      <span className="truncate">Audit logging is off</span>
      <AppLink
        to={auditLogSettingsRoute}
        className="flex-shrink-0 font-semibold text-amber-900 underline-offset-2 hover:underline"
      >
        Turn on
      </AppLink>
    </div>
  ) : undefined;

  const licenseStoppedEmptyState: ReactElement | null = licenseStoppedCopy ? (
    <div
      data-testid="audit-logging-license-empty-state"
      className="flex flex-col items-center justify-center py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 mb-3">
        <Icon
          icon={IconProp.ClipboardDocumentList}
          size={SizeProp.Large}
          thick={ThickProp.Thick}
        />
      </div>
      <div className="text-sm font-medium text-gray-900">
        {licenseStoppedCopy.title}
      </div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        {licenseStoppedCopy.description}
      </div>
    </div>
  ) : null;

  const noItemsMessage: ReactElement = licenseStoppedEmptyState ? (
    licenseStoppedEmptyState
  ) : isAuditLoggingOff ? (
    <div
      data-testid="audit-logging-disabled-empty-state"
      className="flex flex-col items-center justify-center py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 mb-3">
        <Icon
          icon={IconProp.ClipboardDocumentList}
          size={SizeProp.Large}
          thick={ThickProp.Thick}
        />
      </div>
      <div className="text-sm font-medium text-gray-900">
        Audit logging is turned off
      </div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        Changes to this project are not being recorded. Turn on audit logging to
        start keeping a history of who changed what.
      </div>
      <AppLink
        to={auditLogSettingsRoute}
        className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
      >
        Open Audit Logs settings
      </AppLink>
    </div>
  ) : (
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
        automatically. Create, update, or delete a resource to see an entry.
      </div>
    </div>
  );

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
          rightElement: licenseNotRecordingNotice || auditLoggingOffNotice,
        }}
        query={computedQuery}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        selectMoreFields={extraSelect}
        noItemsMessage={noItemsMessage}
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
              const style: ActionStyle = ACTION_STYLES[action] || {
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
              const meta: ResourceMeta = getResourceMeta(type);

              const nameEl: ReactElement = (
                <span className="text-sm font-medium text-gray-900 truncate">
                  {name || (
                    <span className="italic text-gray-400">Unnamed</span>
                  )}
                </span>
              );

              const link: ResourceLink | null = getResourceLink({
                meta,
                action: item.action,
                resourceId: item.resourceId,
                rootResourceId: item.rootResourceId,
              });

              let linkedNameEl: ReactElement = nameEl;
              if (link && RouteMap[link.page]) {
                const route: Route = RouteUtil.populateRouteParams(
                  RouteMap[link.page] as Route,
                  { modelId: link.modelId, subModelId: link.subModelId },
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
