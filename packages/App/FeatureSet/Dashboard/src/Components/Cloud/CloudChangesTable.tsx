import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Indigo500, Red500 } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import {
  ChangeEventAttribute,
  ChangeEventStatus,
  ChangeEventType,
} from "Common/Utils/Telemetry/ChangeEventFields";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { getChangeEventTypeLabel } from "../Metrics/Utils/UseEventTimeReferenceLines";
import {
  CloudChangesScope,
  getCloudChangesAttributeFilter,
  isCloudHealthChange,
} from "./CloudChangesScope";

/*
 * What changed in a cloud resource or a cloud account: the operations its
 * activity log recorded (AWS CloudTrail, the Azure Activity Log, Google
 * Cloud's Admin Activity audit log) and the health events its provider
 * published, newest first - the change events a cloud connection writes
 * (CloudChangeRecorder), read by the row they are tied to
 * (CloudChangesScope).
 *
 * The words are the cloud's - an operation's name, a principal, a health
 * event's title - shown as written.
 */

// A change's time takes the room it needs (TableLayout's min-w- floor).
export const CLOUD_CHANGE_TIME_CONTENT_CLASS_NAME: string = "min-w-max";

// The kinds of change a cloud records, for the Type filter.
export const CLOUD_CHANGE_TYPE_OPTIONS: Array<DropdownOption> = [
  ChangeEventType.ConfigChange,
  ChangeEventType.Deployment,
  ChangeEventType.Scaling,
  ChangeEventType.Rollback,
  ChangeEventType.ProviderEvent,
].map((type: ChangeEventType): DropdownOption => {
  return { label: getChangeEventTypeLabel(type), value: type };
});

function readAttribute(change: ChangeEvent, key: string): string {
  const attributes: JSONObject | undefined = change.attributes as
    | JSONObject
    | undefined;
  const value: unknown = attributes ? attributes[key] : undefined;

  return typeof value === "string" ? value.trim() : "";
}

export interface ComponentProps {
  scope: CloudChangesScope;
  id: string;
  description: string;
  noItemsMessage: string;
  // An account's list says where each change was; a resource's is in one place.
  showRegion?: boolean | undefined;
}

const CloudChangesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const scopeKey: string = JSON.stringify(
    getCloudChangesAttributeFilter(props.scope),
  );

  const query: Query<ChangeEvent> = useMemo((): Query<ChangeEvent> => {
    return {
      projectId: ProjectUtil.getCurrentProjectId()!,
      attributes: getCloudChangesAttributeFilter(props.scope),
    } as Query<ChangeEvent>;
  }, [scopeKey]);

  return (
    <AnalyticsModelTable<ChangeEvent>
      modelType={ChangeEvent}
      id={props.id}
      userPreferencesKey={props.id}
      name="Changes"
      singularName="Change"
      pluralName="Changes"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      query={query}
      sortBy="time"
      sortOrder={SortOrder.Descending}
      selectMoreFields={{
        description: true,
        attributes: true,
      }}
      cardProps={{
        title: "Changes",
        description: props.description,
      }}
      noItemsMessage={props.noItemsMessage}
      filters={[
        {
          field: {
            time: true,
          },
          title: "Time",
          type: FieldType.Date,
        },
        {
          field: {
            eventType: true,
          },
          title: "Type",
          type: FieldType.Dropdown,
          filterDropdownOptions: CLOUD_CHANGE_TYPE_OPTIONS,
        },
        {
          field: {
            title: true,
          },
          // A noun in every language ("Change" reads as a verb in some).
          title: "What changed",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: {
            time: true,
          },
          title: "Time",
          type: FieldType.DateTime,
          /*
           * Whole, never cut: the row's first column is otherwise read as
           * its name, which the table may shorten to fit its card - and a
           * time cut to "Oct 26 2026, 21:58 G..." says less than the
           * change beside it, which wraps instead.
           */
          contentClassName: CLOUD_CHANGE_TIME_CONTENT_CLASS_NAME,
        },
        {
          field: {
            title: true,
          },
          // A noun in every language ("Change" reads as a verb in some).
          title: "What changed",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-2xl",
          getElement: (change: ChangeEvent): ReactElement => {
            /*
             * The provider's own words under a health event's title; an
             * operation's description only repeats its row (who, where).
             */
            const detail: string = isCloudHealthChange({
              eventType: change.eventType,
              attributes: change.attributes as JSONObject | undefined,
            })
              ? (change.description || "").trim()
              : "";

            return (
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 break-words">
                  {change.title || "—"}
                </div>
                {detail ? (
                  <div
                    className="mt-0.5 text-xs text-gray-500 line-clamp-2 break-words"
                    title={detail}
                    data-testid="cloud-change-detail"
                  >
                    {detail}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: {
            eventType: true,
          },
          title: "Type",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (change: ChangeEvent): ReactElement => {
            const failed: boolean =
              readAttribute(change, ChangeEventAttribute.Status) ===
              ChangeEventStatus.Failed;

            return (
              <div className="flex flex-wrap items-center gap-1">
                <Pill
                  text={getChangeEventTypeLabel(change.eventType)}
                  color={
                    change.eventType === ChangeEventType.ProviderEvent
                      ? Indigo500
                      : Gray500
                  }
                />
                {failed ? <Pill text="Failed" color={Red500} /> : <></>}
              </div>
            );
          },
        },
        {
          field: {
            attributes: true,
          },
          id: "by",
          title: "By",
          type: FieldType.Element,
          hideOnMobile: true,
          disableSort: true,
          wrapContent: true,
          getElement: (change: ChangeEvent): ReactElement => {
            const actor: string = readAttribute(
              change,
              ChangeEventAttribute.CloudActor,
            );

            /*
             * One line, the whole name on hover: a service account's
             * address or an app's id would otherwise stand four lines tall
             * and push the Region out of the card.
             */
            return actor ? (
              <div
                className="max-w-[14rem] truncate text-sm text-gray-700"
                title={actor}
                data-testid="cloud-change-actor"
              >
                {actor}
              </div>
            ) : (
              <span className="text-sm text-gray-400">—</span>
            );
          },
        },
        ...(props.showRegion
          ? [
              {
                field: {
                  attributes: true,
                },
                id: "region",
                title: "Region",
                type: FieldType.Element,
                hideOnMobile: true,
                disableSort: true,
                getElement: (change: ChangeEvent): ReactElement => {
                  const region: string = readAttribute(
                    change,
                    ChangeEventAttribute.CloudRegion,
                  );

                  return region ? (
                    <span className="text-sm text-gray-700">{region}</span>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  );
                },
              },
            ]
          : []),
      ]}
    />
  );
};

export default CloudChangesTable;
