import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
import AuditLogChangesModal, {
  AUDIT_LOG_FIELDS_CHANGED,
  AUDIT_LOG_HIDDEN_WORDS,
  getChangedFieldLabels,
  getShownResourceName,
} from "./AuditLogChangesModal";
import { isAuditLogNameHidden } from "Common/Types/AuditLog/AuditLogHiddenValues";
import {
  AuditLogsStoppedCopy,
  getAuditLogsStoppedCopy,
} from "./AuditLogsLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import {
  AUDIT_LOG_WORKFLOW_RAN_AS_FILTER_OPTIONS,
  ResourceLink,
  ResourceMeta,
  getActorCredentialLabel,
  getActorInitials,
  getActorTypeLabel,
  getAuditLogWorkflowRanAs,
  getAuditLogsQuery,
  getResourceLink,
  getResourceMeta,
  getResourceTypeFilterOptions,
  getResourceTypeLabel,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import {
  WorkflowRunRanAs,
  describeWorkflowRunRanAs,
} from "Common/UI/Components/Workflow/WorkflowRunRanAs";
import { AuditLogsTableProps } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_ACTION_LABELS,
  getAuditLogActionLabel,
} from "Common/Types/AuditLog/AuditLogActionLabel";
import {
  getSessionEntrySummary,
  isSessionAuditLogAction,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

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

/*
 * The words the table draws itself - its notices, empty states, actor lines
 * and field counts - as keys of the Dashboard's locales, looked up in the
 * reader's language (#8319). They were JSX text and template literals no
 * locale had, so they read English beside the translated Action and
 * Resource columns.
 */
export const AUDIT_LOGS_TABLE_WORDS: Readonly<{
  notRecordingNotIncluded: string;
  notRecordingLicenseRequired: string;
  loggingOff: string;
  loggingOffHint: string;
  turnOn: string;
  turnedOffTitle: string;
  turnedOffDescription: string;
  openSettings: string;
  noEntriesTitle: string;
  noEntriesDescription: string;
  unnamed: string;
  apiKey: string;
  apiRequest: string;
  workflow: string;
  system: string;
  automatedChange: string;
  unknownUser: string;
  noFieldsRecorded: string;
  viewSessionDetails: string;
  viewSignInAttemptDetails: string;
}> = {
  notRecordingNotIncluded: translationKey(
    "Audit logging is not recording: not included in your Enterprise license",
  ),
  notRecordingLicenseRequired: translationKey(
    "Audit logging is not recording: Enterprise license required",
  ),
  loggingOff: translationKey("Audit logging is off"),
  loggingOffHint: translationKey(
    "New changes to this project are not being recorded until audit logging is turned on in Settings.",
  ),
  turnOn: translationKey("Turn on"),
  turnedOffTitle: translationKey("Audit logging is turned off"),
  turnedOffDescription: translationKey(
    "Changes to this project are not being recorded. Turn on audit logging to start keeping a history of who changed what, and who signed in.",
  ),
  openSettings: translationKey("Open Audit Logs settings"),
  noEntriesTitle: translationKey("No audit entries yet"),
  noEntriesDescription: translationKey(
    "Changes made to resources in this project, and every time its members sign in or out, will appear here automatically. Create, update, or delete a resource to see an entry.",
  ),
  unnamed: translationKey("Unnamed"),
  apiKey: translationKey("API Key"),
  apiRequest: translationKey("API request"),
  workflow: translationKey("Workflow"),
  system: translationKey("System"),
  automatedChange: translationKey("Automated change"),
  unknownUser: translationKey("Unknown user"),
  noFieldsRecorded: translationKey("No fields recorded"),
  viewSessionDetails: translationKey("{{summary}} - view session details"),
  // A failed sign-in made no session: its details are the attempt's.
  viewSignInAttemptDetails: translationKey(
    "{{summary}} - view sign-in attempt details",
  ),
};

/*
 * How many fields an entry that is no update kept (a created or deleted
 * record's snapshot), in the reader's plural forms and digits. An update's
 * count is the changes dialog's own (AUDIT_LOG_FIELDS_CHANGED).
 */
export const AUDIT_LOG_FIELDS_CAPTURED: PluralTemplate = {
  one: "{{count}} field captured",
  other: "{{count}} fields captured",
};

/*
 * What the Changes column's button says of an entry's fields: how many an
 * update changed, or how many any other entry kept.
 */
export const getAuditLogFieldCountLabel: (data: {
  action: string | undefined;
  count: number;
  translator: Translator;
}) => string = (data: {
  action: string | undefined;
  count: number;
  translator: Translator;
}): string => {
  return data.translator.translatePlural(
    data.action === "Update"
      ? AUDIT_LOG_FIELDS_CHANGED
      : AUDIT_LOG_FIELDS_CAPTURED,
    data.count,
  );
};

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
  // A copy of something sensitive left OneUptime: a packet capture's file.
  Download: {
    label: "Download",
    icon: IconProp.Download,
    className: "border-violet-200 bg-violet-50 text-violet-700",
    iconColor: "text-violet-600",
  },
  /*
   * A person's sessions (issue #6762): who signed in, signed out, and whose
   * session OneUptime ended - on time, or because something changed.
   */
  SignIn: {
    label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignIn],
    icon: IconProp.SignIn,
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
    iconColor: "text-indigo-600",
  },
  // A sign-in to an existing account that failed (issue #6788).
  SignInFailed: {
    label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignInFailed],
    icon: IconProp.ShieldExclamation,
    className: "border-orange-200 bg-orange-50 text-orange-800",
    iconColor: "text-orange-600",
  },
  SignOut: {
    label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignOut],
    icon: IconProp.SignOut,
    className: "border-slate-200 bg-slate-50 text-slate-700",
    iconColor: "text-slate-500",
  },
  SessionTimeout: {
    label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.SessionTimeout],
    icon: IconProp.Clock,
    className: "border-amber-200 bg-amber-50 text-amber-800",
    iconColor: "text-amber-600",
  },
  SessionRevoked: {
    label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.SessionRevoked],
    icon: IconProp.NoSymbol,
    className: "border-rose-200 bg-rose-50 text-rose-700",
    iconColor: "text-rose-600",
  },
};

/*
 * The Action filter's choices: every action, by its words, so nobody has
 * to know that a sign-in is recorded as "SignIn". The words are keys of the
 * locales, looked up in the reader's language in the filter's menu, its
 * chip and the Action column alike.
 */
export const AUDIT_LOG_ACTION_FILTER_OPTIONS: Array<DropdownOption> =
  Object.values(AuditLogAction).map(
    (action: AuditLogAction): DropdownOption => {
      return { label: AUDIT_LOG_ACTION_LABELS[action], value: action };
    },
  );

/*
 * The Resource Type filter's choices (#7580): the types the table's own
 * entries are about - one row per stored type, read when the filter opens
 * or a filtered link is restored - each by the name the product shows
 * today, valued by the name its entries are stored under, in the order the
 * reader reads their names (getResourceTypeFilterOptions). Asked of the
 * table's own query, so a resource's page offers its own types and those
 * of what belongs to it.
 */
export const fetchResourceTypeFilterOptions: (data: {
  query: Query<AuditLog>;
  translator: Translator;
}) => Promise<Array<DropdownOption>> = async (data: {
  query: Query<AuditLog>;
  translator: Translator;
}): Promise<Array<DropdownOption>> => {
  const result: ListResult<AuditLog> =
    await AnalyticsModelAPI.getList<AuditLog>({
      modelType: AuditLog,
      query: data.query,
      groupBy: { resourceType: true },
      select: { resourceType: true },
      sort: { resourceType: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  const shownLabelOf: (label: string) => string = (label: string): string => {
    return data.translator.translateText(label) || label;
  };

  return getResourceTypeFilterOptions(
    result.data.map((entry: AuditLog): string | undefined => {
      return entry.resourceType;
    }),
    (first: string, second: string): number => {
      return shownLabelOf(first).localeCompare(
        shownLabelOf(second),
        data.translator.language,
      );
    },
  );
};

const AuditLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
      resourceTypes: props.resourceTypes,
      resourceId: props.resourceId,
      rootResourceId: props.rootResourceId,
    });
  }, [
    props.resourceType,
    // A list handed in anew each draw: compared by what it holds.
    (props.resourceTypes || []).join("\n"),
    props.resourceId,
    props.rootResourceId,
  ]);

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
    mcpClientName: true,
    mcpOAuthGrantId: true,
    workflowName: true,
    workflowId: true,
    // What a workflow's step ran as, and with whose permissions (#9766).
    workflowRunAs: true,
    workflowRunAsCustomRoleName: true,
    workflowRunAsGiverName: true,
    workflowRunAsGiverApiKeyId: true,
    changes: true,
  };

  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.AuditLogs,
  );

  // Set when the license has stopped recording; it wins over the switch.
  const licenseStoppedCopy: AuditLogsStoppedCopy | null =
    getAuditLogsStoppedCopy(licenseMode);

  // A word of the table's own, in the reader's language.
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const words: typeof AUDIT_LOGS_TABLE_WORDS = AUDIT_LOGS_TABLE_WORDS;

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
        title={translate(licenseStoppedCopy.description)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-red-200 bg-red-50 py-1 pl-2 pr-3 text-xs text-red-800"
      >
        <Icon
          icon={IconProp.ExclaimationCircle}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
          className="h-3.5 w-3.5 flex-shrink-0 text-red-600"
        />
        <span className="truncate">
          {translate(
            licenseMode === EnterpriseLicenseMode.NotIncluded
              ? words.notRecordingNotIncluded
              : words.notRecordingLicenseRequired,
          )}
        </span>
      </div>
    ) : undefined;

  const auditLoggingOffNotice: ReactElement | undefined = isAuditLoggingOff ? (
    <div
      data-testid="audit-logging-disabled-notice"
      role="status"
      title={translate(words.loggingOffHint)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 py-1 pl-2 pr-3 text-xs text-amber-800"
    >
      <Icon
        icon={IconProp.ExclaimationCircle}
        size={SizeProp.Small}
        thick={ThickProp.Thick}
        className="h-3.5 w-3.5 flex-shrink-0 text-amber-600"
      />
      <span className="truncate">{translate(words.loggingOff)}</span>
      <AppLink
        to={auditLogSettingsRoute}
        className="flex-shrink-0 font-semibold text-amber-900 underline-offset-2 hover:underline"
      >
        {translate(words.turnOn)}
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
        {translate(licenseStoppedCopy.title)}
      </div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        {translate(licenseStoppedCopy.description)}
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
        {translate(words.turnedOffTitle)}
      </div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        {translate(words.turnedOffDescription)}
      </div>
      <AppLink
        to={auditLogSettingsRoute}
        className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
      >
        {translate(words.openSettings)}
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
        {translate(words.noEntriesTitle)}
      </div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        {translate(words.noEntriesDescription)}
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
            /*
             * The types the entries are about, by the names the rows show
             * them by: a free-text filter on the stored value found nothing
             * for "On-Call Schedule", which is stored as the name it kept
             * (#7580).
             */
            field: { resourceType: true },
            type: FieldType.Dropdown,
            title: "Resource Type",
            filterEntityType: AuditLog,
            filterDropdownField: {
              label: "resourceType",
              value: "resourceType",
            },
            fetchFilterDropdownOptions: (): Promise<Array<DropdownOption>> => {
              return fetchResourceTypeFilterOptions({
                query: computedQuery,
                translator: translator,
              });
            },
          },
          {
            field: { resourceName: true },
            type: FieldType.Text,
            title: "Resource Name",
          },
          {
            field: { action: true },
            type: FieldType.Dropdown,
            title: "Action",
            filterDropdownOptions: AUDIT_LOG_ACTION_FILTER_OPTIONS,
          },
          {
            field: { userEmail: true },
            type: FieldType.Text,
            title: "User Email",
          },
          {
            /*
             * What a workflow's step ran as (#9766): every change made with
             * Project Owner, say, whatever workflow made it.
             */
            field: { workflowRunAs: true },
            type: FieldType.Dropdown,
            title: "Workflow Ran As",
            filterDropdownOptions: AUDIT_LOG_WORKFLOW_RAN_AS_FILTER_OPTIONS,
          },
          {
            // Whose permissions it ran with: a person's or an API key's name.
            field: { workflowRunAsGiverName: true },
            type: FieldType.Text,
            title: "Workflow Permissions Given By",
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
                return <TableEmptyValue />;
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
                  <span className="text-xs text-gray-500">
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
                label: getAuditLogActionLabel(action),
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
                  {/* In the words the Action filter offers it in. */}
                  {translator.translateText(style.label) || style.label}
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
              /*
               * A record the reader may not read keeps its type and loses its
               * name (#10642): the row says so, and opens nothing.
               */
              const isNameHidden: boolean = isAuditLogNameHidden(
                item.resourceName,
              );
              const name: string | undefined = getShownResourceName(
                item.resourceName,
              );
              const meta: ResourceMeta = getResourceMeta(type);
              // In the words the Resource Type filter offers it in.
              const typeLabel: string = getResourceTypeLabel(type);

              const nameEl: ReactElement = (
                <span className="text-sm font-medium text-gray-900 truncate">
                  {name || (
                    <span
                      className="italic text-gray-500"
                      data-testid={
                        isNameHidden ? "audit-log-name-hidden" : undefined
                      }
                    >
                      {translate(
                        isNameHidden
                          ? AUDIT_LOG_HIDDEN_WORDS.nameHidden
                          : words.unnamed,
                      )}
                    </span>
                  )}
                </span>
              );

              /*
               * A row with no page of its own opens the resource it belongs
               * to: a queue's owner opens the queue.
               */
              const link: ResourceLink | null = isNameHidden
                ? null
                : getResourceLink({
                    meta,
                    action: item.action,
                    resourceId: item.resourceId,
                    rootResourceId: item.rootResourceId,
                    rootMeta: getResourceMeta(item.rootResourceType),
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
                    {name || translate(words.unnamed)}
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
                    <span className="text-xs text-gray-500">
                      {translator.translateText(typeLabel) || typeLabel}
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
                const apiName: string =
                  item.apiKeyName || translate(words.apiKey);
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
                      <span className="text-xs text-gray-500">
                        {translate(words.apiRequest)}
                      </span>
                    </div>
                  </div>
                );
              }

              /*
               * A step of one of the project's workflows: no person, so the
               * workflow itself is the actor, named as it was at the time,
               * with what it ran as and whose permissions those were
               * (#9766) - for an entry recorded once entries said it.
               */
              if (userType === "Workflow") {
                const workflowName: string =
                  item.workflowName || translate(words.workflow);
                const ranAs: WorkflowRunRanAs | null =
                  getAuditLogWorkflowRanAs(item);
                return (
                  <div
                    className="flex items-center gap-2.5 min-w-0"
                    data-testid="audit-log-workflow-actor"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                      <Icon
                        icon={IconProp.Workflow}
                        size={SizeProp.Small}
                        thick={ThickProp.Thick}
                        className="h-4 w-4"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {workflowName}
                      </span>
                      <span className="text-xs text-gray-500">
                        {translate(words.workflow)}
                      </span>
                      {ranAs ? (
                        <span
                          className="text-xs text-gray-600 break-words"
                          data-testid="audit-log-workflow-ran-as"
                        >
                          {describeWorkflowRunRanAs(translator, ranAs)}
                        </span>
                      ) : (
                        <Fragment />
                      )}
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
                        {translate(words.system)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {translate(words.automatedChange)}
                      </span>
                    </div>
                  </div>
                );
              }

              const displayName: string =
                item.userName || item.userEmail || translate(words.unknownUser);
              const initials: string = getActorInitials(
                item.userName || item.userEmail,
              );
              /*
               * A person's change that came through something other than the
               * dashboard: an MCP client they connected, or the master key.
               */
              const credentialLabel: string | null = getActorCredentialLabel(
                {
                  userType: item.userType,
                  apiKeyName: item.apiKeyName,
                  mcpClientName: item.mcpClientName,
                },
                translator,
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
                      <span className="text-xs text-gray-500 truncate">
                        {item.userEmail}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {translate(getActorTypeLabel(userType))}
                      </span>
                    )}
                    {credentialLabel ? (
                      <span
                        className="text-xs text-violet-700 truncate"
                        data-testid="audit-actor-credential"
                      >
                        {credentialLabel}
                      </span>
                    ) : (
                      <Fragment />
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
              /*
               * A session entry is no change: it says how someone signed
               * in, or why their session ended, in a few words, and opens
               * the rest - device, address, times.
               */
              if (isSessionAuditLogAction(item.action)) {
                const summary: string = getSessionEntrySummary({
                  action: item.action,
                  changes: item.changes,
                  translator: translator,
                });

                return (
                  <button
                    type="button"
                    data-testid="audit-log-session-summary"
                    title={translator.translateTemplate(
                      item.action === AuditLogAction.SignInFailed
                        ? words.viewSignInAttemptDetails
                        : words.viewSessionDetails,
                      { summary: summary },
                    )}
                    onClick={() => {
                      setDetailItem(item);
                    }}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    <Icon
                      icon={IconProp.InformationCircle}
                      size={SizeProp.Small}
                      thick={ThickProp.Thick}
                      className="h-3 w-3 flex-shrink-0 text-gray-500"
                    />
                    <span className="truncate">{summary}</span>
                  </button>
                );
              }

              const rawChanges: JSONArray | undefined = item.changes;
              const count: number = Array.isArray(rawChanges)
                ? rawChanges.length
                : 0;

              if (count === 0) {
                return (
                  <span className="text-xs text-gray-500 italic">
                    {translate(words.noFieldsRecorded)}
                  </span>
                );
              }

              const label: string = getAuditLogFieldCountLabel({
                action: item.action,
                count: count,
                translator: translator,
              });

              /*
               * What an update changed, by the fields' names, so a reader
               * scanning the log sees which fields each change was to
               * without opening every row (#10290). The values, before
               * and after, are behind the button.
               */
              const changedFields: Array<string> =
                item.action === AuditLogAction.Update
                  ? getChangedFieldLabels({
                      changes: rawChanges,
                      storedResourceType: item.resourceType,
                      translator: translator,
                    })
                  : [];

              return (
                <div className="flex min-w-0 flex-col items-start gap-1">
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
                  {changedFields.length > 0 ? (
                    <span
                      data-testid="audit-log-changed-fields"
                      className="max-w-full break-words text-xs text-gray-500"
                    >
                      {changedFields.join(" · ")}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
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
        resourceType={
          detailItem?.resourceType
            ? getResourceTypeLabel(detailItem.resourceType)
            : undefined
        }
        storedResourceType={detailItem?.resourceType}
        resourceName={detailItem?.resourceName}
        changes={detailItem?.changes}
      />
    </Fragment>
  );
};

export default AuditLogsTable;
