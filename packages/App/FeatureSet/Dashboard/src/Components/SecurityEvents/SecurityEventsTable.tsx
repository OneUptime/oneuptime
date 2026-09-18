import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { VoidFunction } from "Common/Types/FunctionTypes";
import SecurityEventDetail from "./SecurityEventDetail";
import securityEventColumns from "./SecurityEventsTableColumns";
import SecurityEventAttributeUtil from "./SecurityEventAttributeUtil";
import SecurityEventsEmptyState from "./SecurityEventsEmptyState";
import { SECURITY_EVENTS_TABLE_ID } from "./SecurityEventsTimeRange";

const severityDropdownOptions: Array<DropdownOption> = Object.values(
  OcsfSeverity,
).map((severity: string): DropdownOption => {
  return {
    label: severity,
    value: severity,
  };
});

export interface ComponentProps {
  /*
   * The page's scope: the project and the time window its range picker is on.
   * Time is set here rather than being one of the table's own filters so the
   * volume chart above and this list are always on the same window.
   */
  query: Query<SecurityEvent>;
  /*
   * Handed the query the rows are fetched with - this scope plus whatever the
   * table's filters add - whenever it changes. The volume chart counts
   * exactly this.
   */
  onQueryChange?: ((query: Query<SecurityEvent>) => void) | undefined;
  /*
   * Changing it refetches the rows without the query changing (a Refresh on a
   * fixed, custom window).
   */
  refreshToggle?: string | undefined;
  /*
   * An empty table here means "nothing is sending yet" far more often than
   * "nothing happened", so the default is the setup empty state; the page
   * swaps in a no-results message once it knows events exist.
   */
  noItemsMessage?: ReactElement | undefined;
}

const SecurityEventsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [detailEvent, setDetailEvent] = useState<SecurityEvent | null>(null);

  /*
   * Attribute keys for the advanced attributes filter. Fetched lazily on
   * the first advanced-filters toggle (the TraceTable discipline) — the
   * common list-and-scan visit never pays for the keys query.
   */
  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [attributeKeysFetched, setAttributeKeysFetched] =
    useState<boolean>(false);

  const handleAdvancedFiltersToggle: (show: boolean) => void = (
    show: boolean,
  ): void => {
    if (!show || attributeKeysFetched) {
      return;
    }

    setAttributeKeysFetched(true);

    SecurityEventAttributeUtil.getAttributeKeys()
      .then((keys: Array<string>) => {
        setAttributeKeys(keys);
      })
      .catch(() => {
        // Recoverable: the filter still accepts hand-typed keys.
      });
  };

  /*
   * The detail side-over renders straight off the row it was handed, so every
   * field it shows has to be on the wire whether or not a column for it is on
   * screen.
   */
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
        id={SECURITY_EVENTS_TABLE_ID}
        name="Security Events"
        singularName="Security Event"
        pluralName="Security Events"
        userPreferencesKey={SECURITY_EVENTS_TABLE_ID}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        cardProps={{
          title: "Security Events",
          description:
            "SIEM signals normalized to OCSF and stored beside your observability data. Click an event for its full detail, including every source attribute.",
        }}
        query={props.query}
        onQueryChange={props.onQueryChange}
        refreshToggle={props.refreshToggle}
        sortBy="time"
        sortOrder={SortOrder.Descending}
        selectMoreFields={extraSelect}
        /*
         * The keys inside `attributes` are whatever the source sent, so they
         * cannot ship as columns. The picker offers them through a search box
         * instead, and whatever is added from it becomes an ordinary column -
         * hideable, re-orderable, exported, and remembered for next time.
         */
        attributeColumnsProps={{
          columnKey: "attributes",
          title: "Add Attribute Column",
          description:
            "Source fields that OCSF has no column for. These differ per event class, so search for the one you want.",
          placeholder: "Search attributes...",
          emptyMessage:
            "No attributes seen on recent events. Attribute columns become available once events carrying them are ingested.",
          fetchAttributeKeys: (): Promise<Array<string>> => {
            return SecurityEventAttributeUtil.getAttributeKeys();
          },
        }}
        noItemsMessage={props.noItemsMessage || <SecurityEventsEmptyState />}
        /*
         * The page's Refresh re-reads "Past 1 Day" from now and recounts the
         * chart too; this one could only re-list the window it already had.
         */
        showRefreshButton={false}
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
          /*
           * Substring match over the bloom-indexed observables array —
           * "every event that mentions this host/user/IP", the same
           * vocabulary the Correlate tab pivots on.
           */
          {
            field: { observables: true },
            type: FieldType.Text,
            title: "Observable",
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
          /*
           * Arbitrary flattened source attributes — including the
           * threat.* keys the threat-intel enricher stamps on matched
           * events, so "show me everything threat intel flagged" is
           * `threat.matched = true` right here.
           */
          {
            field: {
              attributes: true,
            },
            type: FieldType.JSON,
            title: "Attributes",
            jsonKeys: attributeKeys,
            isAdvancedFilter: true,
          },
        ]}
        onAdvancedFiltersToggle={handleAdvancedFiltersToggle}
        columns={securityEventColumns}
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
