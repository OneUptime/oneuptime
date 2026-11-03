import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import Includes from "Common/Types/BaseDatabase/Includes";
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
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { getChangeEventTypeLabel } from "../Metrics/Utils/UseEventTimeReferenceLines";
import { CloudChangeAiActor, CloudChangeAiLine } from "./CloudChangeAi";
import { CloudAiChangeFix, readCloudAiChangeFix } from "./CloudAiChangeWords";
import {
  CloudAiChange,
  CloudChangesScope,
  getCloudAiChangeSuggestionIds,
  getCloudChangesAttributeFilter,
  isCloudHealthChange,
  readCloudAiChange,
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
 *
 * A change OneUptime AI made, through the account's Cloud AI agent, says
 * so (CloudChangeAi): OneUptime AI in its By column, and under what
 * changed, the incident or alert it fixed, who approved it and its AI Logs
 * entry - read from its fix, as the reader, once the page of changes is in
 * (an AutoRemediationSuggestion read, so a fix the reader may not read
 * names no record number and no approver).
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

  // The fixes of the changes OneUptime AI made, as the reader read them, by id.
  const [fixes, setFixes] = useState<Map<string, CloudAiChangeFix>>(
    (): Map<string, CloudAiChangeFix> => {
      return new Map<string, CloudAiChangeFix>();
    },
  );
  // Each fix is asked for once, whichever page or refresh first shows it.
  const askedFixIdsRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const readFixes: (changes: Array<ChangeEvent>) => Promise<void> = async (
    changes: Array<ChangeEvent>,
  ): Promise<void> => {
    const ids: Array<string> = getCloudAiChangeSuggestionIds(
      changes.map((change: ChangeEvent) => {
        return { attributes: change.attributes as JSONObject | undefined };
      }),
    ).filter((id: string): boolean => {
      return !askedFixIdsRef.current.has(id);
    });

    if (ids.length === 0) {
      return;
    }

    for (const id of ids) {
      askedFixIdsRef.current.add(id);
    }

    try {
      const result: ListResult<AutoRemediationSuggestion> =
        await ModelAPI.getList<AutoRemediationSuggestion>({
          modelType: AutoRemediationSuggestion,
          query: { _id: new Includes(ids) },
          limit: ids.length,
          skip: 0,
          select: {
            _id: true,
            status: true,
            incidentId: true,
            alertId: true,
            approvedByUser: {
              _id: true,
              name: true,
              email: true,
            },
            incident: {
              _id: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
            alert: {
              _id: true,
              alertNumber: true,
              alertNumberWithPrefix: true,
            },
          },
          sort: {},
        });

      const read: Array<CloudAiChangeFix> = result.data
        .map(readCloudAiChangeFix)
        .filter((fix: CloudAiChangeFix | null): fix is CloudAiChangeFix => {
          return Boolean(fix);
        });

      if (read.length > 0) {
        setFixes((current: Map<string, CloudAiChangeFix>) => {
          const next: Map<string, CloudAiChangeFix> = new Map(current);

          for (const fix of read) {
            next.set(fix.id, fix);
          }

          return next;
        });
      }
    } catch {
      /*
       * A reader who may not read the fixes still sees which changes
       * OneUptime AI made, and their AI Logs.
       */
    }
  };

  // The account a change's AI Logs are on: the page's own, else the change's.
  const scopeAccountId: string | null =
    "cloudAccountId" in props.scope
      ? props.scope.cloudAccountId.toString()
      : null;

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
      onFetchSuccess={(changes: Array<ChangeEvent>) => {
        readFixes(changes).catch(() => {
          // handled inside readFixes
        });
      }}
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
            const ai: CloudAiChange | null = readCloudAiChange({
              attributes: change.attributes as JSONObject | undefined,
            });

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
                {ai ? (
                  <CloudChangeAiLine
                    change={ai}
                    fix={
                      ai.suggestionId
                        ? fixes.get(ai.suggestionId) || null
                        : null
                    }
                    cloudAccountId={scopeAccountId}
                  />
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

            // OneUptime AI made it, under the agent's role: said so first.
            if (
              readCloudAiChange({
                attributes: change.attributes as JSONObject | undefined,
              })
            ) {
              return <CloudChangeAiActor actor={actor} />;
            }

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
