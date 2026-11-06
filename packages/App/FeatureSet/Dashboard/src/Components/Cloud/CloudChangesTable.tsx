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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ChangeTitleDirection,
  CloudChangeTitleFacts,
  getChangeTitleDirection,
  getChangeTitleForReader,
  getCloudChangeTitleSentence,
  readCloudChangeTitleFacts,
  readCloudHealthTitleFacts,
} from "Common/Utils/Telemetry/CloudChangeTitle";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { getChangeEventTypeLabel } from "../Metrics/Utils/UseEventTimeReferenceLines";
import {
  CLOUD_CHANGES_BY_COLUMN_ID,
  CloudChangeAiActor,
  CloudChangeAiLine,
} from "./CloudChangeAi";
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
 * event's title - shown as written, in a title worded in the reader's
 * language from what the change keeps: "DeleteLoadBalancer on web-alb" is
 * "DeleteLoadBalancer für web-alb" in German (CloudChangeTitle), for rows
 * written before the resource's name was kept too.
 *
 * A change OneUptime AI made, through the account's Cloud AI agent, says
 * so (CloudChangeAi): OneUptime AI and who approved it in its By column,
 * and under what changed, the incident or alert it fixed and its AI Logs
 * entry - read from its fix, as the reader, once the page of changes is in
 * (an AutoRemediationSuggestion read, so a fix the reader may not read
 * names no record number and no approver).
 */

// A change's time takes the room it needs (TableLayout's min-w- floor).
export const CLOUD_CHANGE_TIME_CONTENT_CLASS_NAME: string = "min-w-max";

/*
 * Who made a change gives way before the table scrolls: a name, OneUptime
 * AI and who approved it wrap or cut on their own, so the column's floor is
 * 7rem, not a wrapping column's 10rem (TableLayout). At 1280 pixels in
 * German, beside a 12-hour time and "Konfigurationsänderung", the 10rem
 * floor held the table 16 pixels past its card, and the Region scrolled.
 */
export const CLOUD_CHANGE_BY_CONTENT_CLASS_NAME: string = "min-w-[7rem]";

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
 * event with its frame and state worded, the provider's event as written;
 * any other change by its own title.
 */
export function getCloudChangeTitleText(
  change: ChangeEvent,
  translator: Translator,
): string {
  const stored: {
    title: string | undefined;
    attributes: JSONObject | undefined;
  } = {
    title: change.title,
    attributes: change.attributes as JSONObject | undefined,
  };

  return getChangeTitleForReader({
    title: change.title,
    eventType: change.eventType,
    facts: readCloudChangeTitleFacts(stored),
    health: readCloudHealthTitleFacts(stored),
    translator,
    options: { setsValuesApart: true },
  });
}

/*
 * Which way a change's title line reads (getChangeTitleDirection): a title
 * worded in the reader's language reads their way - a Persian health event
 * right to left, though its first words are "AWS Health:" - and any other
 * title its own way.
 */
export function getCloudChangeTitleDirection(
  change: ChangeEvent,
  translator: Translator,
): ChangeTitleDirection {
  const stored: {
    title: string | undefined;
    attributes: JSONObject | undefined;
  } = {
    title: change.title,
    attributes: change.attributes as JSONObject | undefined,
  };

  return getChangeTitleDirection({
    facts: readCloudChangeTitleFacts(stored),
    health: readCloudHealthTitleFacts(stored),
    translator,
  });
}

/*
 * A value of a change's title - its operation, its resource - is set apart
 * (bdi), so a Latin name keeps its place in a Persian sentence, and flows
 * with the sentence's words. Each of its pieces is a box of its own
 * (CloudChangeTitlePiece): it moves to the next line whole rather than
 * breaking at its hyphen ("nightly-" / "export", "sg-" / "0f1e2d3c..." on
 * a phone), and only a piece longer than the line is broken, inside its
 * box. A resource is one piece; an operation is as many as its name has
 * (getCloudOperationPieces), so it breaks between them -
 * "elasticloadbalancing:" / "ModifyLoadBalancerAttributes" - where the line
 * runs out, and the words after it go on beside its last piece.
 *
 * The pieces, not the whole value, are the boxes: an operation held in one
 * box that broke inside it took the column's whole width, so "on web-alb"
 * went to a line of its own, a failed one stood four lines tall in German
 * ("Fehlgeschlagen:" / "elasticloadbalancing:" / "DeleteLoadBalancer" /
 * "für web-alb"), and on a Persian page the box's first line stood at the
 * left, away from the sentence it is part of.
 *
 * break-words, never overflow-wrap:anywhere: anywhere lowers what the
 * table's column must hold, and the table then narrowed "What changed"
 * until an operation broke inside ("UpdateFunctionCode20150331v" / "2").
 */
export const CLOUD_CHANGE_TITLE_PIECE_CLASS_NAME: string =
  "inline-block max-w-full break-words";

// Where an operation's name may move to the next line: after one of these.
export const CLOUD_OPERATION_BREAK_AFTER: ReadonlyArray<string> = [
  ":",
  "/",
  ".",
];

/*
 * An operation's name in the pieces it may break between: its service and
 * its action ("elasticloadbalancing:" "ModifyLoadBalancerAttributes"), an
 * Azure operation's provider, type and verb
 * ("Microsoft.Network/" "networkSecurityGroups/" "write"), a Google Cloud
 * method's names ("v1." "compute." "instances." "stop"). The cloud writes
 * them as one word, often longer than the column or a phone's card holds
 * whole: held whole, the longest held the table past its card at 1280 in
 * German, and broke inside a word on a phone. Each piece stays whole.
 */
export function getCloudOperationPieces(operation: string): Array<string> {
  const pieces: Array<string> = [];
  let piece: string = "";

  for (const character of operation) {
    piece += character;

    if (CLOUD_OPERATION_BREAK_AFTER.includes(character)) {
      pieces.push(piece);
      piece = "";
    }
  }

  if (piece) {
    pieces.push(piece);
  }

  return pieces;
}

const TitleValue: FunctionComponent<{
  text: string;
  // An operation's name, which may break between its pieces.
  isOperation?: boolean | undefined;
}> = (props: {
  text: string;
  isOperation?: boolean | undefined;
}): ReactElement => {
  const pieces: Array<string> = props.isOperation
    ? getCloudOperationPieces(props.text)
    : [props.text];

  return (
    <bdi data-testid="cloud-change-title-value">
      {pieces.map((piece: string, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {index > 0 ? <wbr /> : <></>}
            <span
              className={CLOUD_CHANGE_TITLE_PIECE_CLASS_NAME}
              data-testid="cloud-change-title-piece"
            >
              {piece}
            </span>
          </React.Fragment>
        );
      })}
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
    return <TitleValue text={operation} isOperation={true} />;
  }

  return (
    <TranslatedSentence
      template={sentence}
      slots={{
        operation: <TitleValue text={operation} isOperation={true} />,
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
  // The reader's: a title worded in their language reads their way.
  const translator: Translator = useTranslator();
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
  /*
   * Each fix is asked for once, whichever page or refresh first shows it -
   * once it was read: one whose read failed is asked for again by the next
   * page or refresh that shows it.
   */
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
       * OneUptime AI made, and their AI Logs. A read that failed is not
       * one that answered: the next page or refresh asks again.
       */
      for (const id of ids) {
        askedFixIdsRef.current.delete(id);
      }
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

            /*
             * Each line in its own direction: a title worded in the
             * reader's language reads their way - a Persian one right to
             * left, a health event's too, though it starts with "AWS
             * Health:" (getCloudChangeTitleDirection) - and a title as
             * written, or the provider's words under it, its own way
             * (dir="auto"), so an English line on a Persian page keeps its
             * start, and its cut, at the end it is read to.
             */
            return (
              <div className="min-w-0">
                <div
                  className="text-sm font-medium text-gray-900 break-words"
                  dir={getCloudChangeTitleDirection(change, translator)}
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
          id: CLOUD_CHANGES_BY_COLUMN_ID,
          title: "By",
          type: FieldType.Element,
          hideOnMobile: true,
          disableSort: true,
          wrapContent: true,
          contentClassName: CLOUD_CHANGE_BY_CONTENT_CLASS_NAME,
          getElement: (change: ChangeEvent): ReactElement => {
            const actor: string = readAttribute(
              change,
              ChangeEventAttribute.CloudActor,
            );

            /*
             * OneUptime AI made it, under the agent's role: said so, with
             * who approved it.
             */
            const ai: CloudAiChange | null = readCloudAiChange({
              attributes: change.attributes as JSONObject | undefined,
            });

            if (ai) {
              return (
                <CloudChangeAiActor
                  actor={actor}
                  change={ai}
                  fix={
                    ai.suggestionId ? fixes.get(ai.suggestionId) || null : null
                  }
                />
              );
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
