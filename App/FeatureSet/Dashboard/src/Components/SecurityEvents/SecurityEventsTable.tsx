import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import SecurityEventDetail from "./SecurityEventDetail";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

const severityDropdownOptions: Array<DropdownOption> = Object.values(
  OcsfSeverity,
).map((severity: string): DropdownOption => {
  return {
    label: severity,
    value: severity,
  };
});

const SecurityEventsTable: FunctionComponent = (): ReactElement => {
  const [detailEvent, setDetailEvent] = useState<SecurityEvent | null>(null);

  const extraSelect: Select<SecurityEvent> = {
    eventUid: true,
    categoryName: true,
    activityName: true,
    statusName: true,
    productName: true,
    ruleId: true,
    ruleName: true,
    mitreTactics: true,
    mitreTechniques: true,
    principalIp: true,
    principalProcess: true,
    targetUser: true,
    targetHost: true,
    targetIp: true,
    targetPort: true,
    targetResource: true,
    observables: true,
    attributes: true,
  };

  return (
    <Fragment>
      <AnalyticsModelTable<SecurityEvent>
        modelType={SecurityEvent}
        id="security-events-table"
        name="Security Events"
        singularName="Security Event"
        pluralName="Security Events"
        userPreferencesKey="security-events-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: "Security Events",
          description:
            "SIEM signals normalized to OCSF and stored beside your observability data. Click an event for its full detail, including every source attribute.",
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="time"
        sortOrder={SortOrder.Descending}
        selectMoreFields={extraSelect}
        /*
         * An empty table here means "nothing is sending yet" far more often
         * than "nothing happened", and the answer to that is a page away.
         * Sentence plus a way to act on it, rather than a sentence alone.
         */
        noItemsMessage={
          <EmptyState
            id="security-events-empty-state"
            icon={IconProp.ShieldCheck}
            title="No security events yet"
            description="Any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — can feed this table. Events are normalized to OCSF whatever dialect they arrive in."
            footer={
              <Button
                title="Read the setup guide"
                icon={IconProp.Book}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route,
                    ),
                  );
                }}
              />
            }
          />
        }
        showRefreshButton={true}
        showViewIdButton={false}
        filters={[
          {
            field: { severityName: true },
            type: FieldType.MultiSelectDropdown,
            filterDropdownOptions: severityDropdownOptions,
            title: "Severity",
          },
          {
            field: { className: true },
            type: FieldType.Text,
            title: "Event Class",
          },
          {
            field: { message: true },
            type: FieldType.Text,
            title: "Message",
          },
          {
            field: { principalUser: true },
            type: FieldType.Text,
            title: "Principal User",
          },
          {
            field: { principalHost: true },
            type: FieldType.Text,
            title: "Principal Host",
          },
          {
            field: { time: true },
            type: FieldType.DateTime,
            title: "Time",
          },
        ]}
        columns={[
          {
            field: { time: true },
            title: "Time",
            type: FieldType.Element,
            getElement: (item: SecurityEvent): ReactElement => {
              const time: Date | undefined = item.time;
              if (!time) {
                return <span className="text-gray-400">-</span>;
              }
              const timeDate: Date = new Date(time);
              return (
                <div
                  className="flex flex-col leading-tight"
                  title={OneUptimeDate.getDateAsLocalFormattedString(timeDate)}
                >
                  <span className="text-sm font-medium text-gray-900">
                    {OneUptimeDate.fromNow(timeDate)}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {OneUptimeDate.getDateAsLocalFormattedString(timeDate)}
                  </span>
                </div>
              );
            },
          },
          {
            field: { severityName: true },
            title: "Severity",
            type: FieldType.Element,
            getElement: (item: SecurityEvent): ReactElement => {
              return (
                <SecurityEventSeverityPill severityName={item.severityName} />
              );
            },
          },
          {
            field: { className: true },
            title: "Event Class",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: { message: true },
            title: "Message",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
          {
            field: { principalUser: true },
            title: "Principal User",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: { principalHost: true },
            title: "Principal Host",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: { vendorName: true },
            title: "Vendor",
            type: FieldType.Text,
            noValueMessage: "-",
          },
        ]}
        actionButtons={[
          {
            title: "View Details",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: (
              item: SecurityEvent,
              onCompleteAction: VoidFunction,
            ): void => {
              setDetailEvent(item);
              onCompleteAction();
            },
          },
        ]}
      />

      {detailEvent && (
        <SecurityEventDetail
          securityEvent={detailEvent}
          onClose={() => {
            setDetailEvent(null);
          }}
        />
      )}
    </Fragment>
  );
};

export default SecurityEventsTable;
