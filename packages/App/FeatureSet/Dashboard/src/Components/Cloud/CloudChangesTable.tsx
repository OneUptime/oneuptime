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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  CloudChangeTitleFacts,
  getChangeTitleForReader,
  getCloudChangeTitleSentence,
  readCloudChangeTitleFacts,
} from "Common/Utils/Telemetry/CloudChangeTitle";
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
 * event's title - shown as written, in a title worded in the reader's
 * language from what the change keeps: "DeleteLoadBalancer on web-alb" is
 * "DeleteLoadBalancer für web-alb" in German (CloudChangeTitle), for rows
 * written before the resource's name was kept too.
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

/*
 * What changed, in the reader's language: an operation the activity log
 * recorded worded from its operation, resource and outcome; a health
 * event, or any other change, by its own title.
 */
export function getCloudChangeTitleText(
  change: ChangeEvent,
  translator: Translator,
): string {
  return getChangeTitleForReader({
    title: change.title,
    eventType: change.eventType,
    facts: readCloudChangeTitleFacts({
      title: change.title,
      attributes: change.attributes as JSONObject | undefined,
    }),
    translator,
    options: { setsValuesApart: true },
  });
}

/*
 * A value of a change's title - its operation, its resource - as a box of
 * its own: it moves to the next line whole rather than breaking at its
 * hyphen ("nightly-" / "export", "sg-" / "0f1e2d3c..." on a phone), and only
 * a value longer than the line is broken, inside its box. Set apart (bdi),
 * so a Latin name keeps its place in a Persian sentence.
 *
 * break-words, never overflow-wrap:anywhere: anywhere lowers what the
 * table's column must hold, and the table then narrowed "What changed"
 * until an operation broke inside ("UpdateFunctionCode20150331v" / "2").
 */
export const CLOUD_CHANGE_TITLE_VALUE_CLASS_NAME: string =
  "inline-block max-w-full break-words";

const TitleValue: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <bdi
      className={CLOUD_CHANGE_TITLE_VALUE_CLASS_NAME}
      data-testid="cloud-change-title-value"
    >
      {props.text}
    </bdi>
  );
};

/*
 * What changed, drawn: an operation the activity log recorded as the
 * sentence getCloudChangeTitleText words, with its operation and resource
 * each a box of their own (TitleValue); any other change by its title.
 */
export const CloudChangeTitle: FunctionComponent<{
  change: ChangeEvent;
}> = (props: { change: ChangeEvent }): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: CloudChangeTitleFacts | null = readCloudChangeTitleFacts({
    title: props.change.title,
    attributes: props.change.attributes as JSONObject | undefined,
  });

  if (!facts) {
    return <>{getCloudChangeTitleText(props.change, translator) || "—"}</>;
  }

  const operation: string = facts.operation.trim();
  const resource: string = facts.resource.trim();
  const sentence: string | null = getCloudChangeTitleSentence(facts);

  if (!sentence) {
    return <TitleValue text={operation} />;
  }

  return (
    <TranslatedSentence
      template={sentence}
      slots={{
        operation: <TitleValue text={operation} />,
        ...(resource ? { resource: <TitleValue text={resource} /> } : {}),
      }}
    />
  );
};

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

            /*
             * Each line in its own direction (dir="auto"): a change worded
             * in Persian reads right to left, a health event's English
             * title and its provider's words left to right, so an English
             * line on a Persian page keeps its start, and its cut, at the
             * end it is read to. The values a title sets apart are not
             * counted.
             */
            return (
              <div className="min-w-0">
                <div
                  className="text-sm font-medium text-gray-900 break-words"
                  dir="auto"
                  data-testid="cloud-change-title"
                >
                  <CloudChangeTitle change={change} />
                </div>
                {detail ? (
                  <div
                    className="mt-0.5 text-xs text-gray-500 line-clamp-2 break-words"
                    title={detail}
                    dir="auto"
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
