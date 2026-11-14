import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import Card from "Common/UI/Components/Card/Card";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "Common/Utils/OpenStack/OpenStackLogs";
import { OpenStackEventAttribute } from "Common/Utils/OpenStack/OpenStackNotifications";
import {
  OpenStackPartLogFacts,
  getOpenStackPartAuditAttributes,
  getOpenStackPartChangeAttributes,
  isOpenStackAuditReadAction,
} from "Common/Utils/OpenStack/OpenStackPartLogFacts";
import { OpenStackAuditAttribute } from "Common/Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import { ChangeEventAttribute } from "Common/Utils/Telemetry/ChangeEventFields";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { getOpenStackPartLogFacts } from "./OpenStackPartLogs";
import { OpenStackPart } from "./UseOpenStackPart";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * What happened to a part, from what its cloud's notifications said, and who did it, from
 * its audit trail. The cloud's own Feed page holds everything; a part's reads its own
 * change events, so its Feed and the markers on its charts say the same things.
 *
 * Who changed this reads around the moment the part's state last changed, because that is
 * what a person looking at a part in a strange state is asking about. It is drawn only when
 * there is someone to name: a cloud without an audit trail has no card that says nothing.
 */

const FEED_ROWS: number = 100;
const FEED_WINDOW_IN_DAYS: number = 30;

// How far around a change of state the audit trail is read.
const WHO_MINUTES_BEFORE: number = 15;
const WHO_MINUTES_AFTER: number = 5;
const WHO_ROWS: number = 10;

/*
 * What the audit filter calls each thing a person does to a part, as a person would say it.
 * Anything else is written as the filter wrote it, without the update/ it starts with.
 */
const AUDIT_ACTION_WORDS: Readonly<Record<string, string>> = {
  create: translationKey("created it"),
  update: translationKey("changed it"),
  delete: translationKey("deleted it"),
  "update/os-start": translationKey("started it"),
  "update/os-stop": translationKey("stopped it"),
  "update/reboot": translationKey("rebooted it"),
  "update/rebuild": translationKey("rebuilt it"),
  "update/pause": translationKey("paused it"),
  "update/unpause": translationKey("unpaused it"),
  "update/suspend": translationKey("suspended it"),
  "update/resume": translationKey("resumed it"),
  "update/lock": translationKey("locked it"),
  "update/unlock": translationKey("unlocked it"),
  "update/shelve": translationKey("shelved it"),
  "update/unshelve": translationKey("unshelved it"),
  "update/rescue": translationKey("rescued it"),
  "update/unrescue": translationKey("took it out of rescue"),
  "update/resize": translationKey("resized it"),
  "update/confirmResize": translationKey("confirmed its resize"),
  "update/revertResize": translationKey("reverted its resize"),
  "update/migrate": translationKey("migrated it"),
  "update/os-migrateLive": translationKey("live migrated it"),
  "update/os-resetState": translationKey("reset its state"),
  "update/createImage": translationKey("made an image of it"),
};

function getAuditActionWords(action: string, translator: Translator): string {
  const words: string | undefined = AUDIT_ACTION_WORDS[action];

  if (words) {
    return translator.translateText(words) || words;
  }

  return action.startsWith("update/") ? action.slice("update/".length) : action;
}

function readText(attributes: unknown, key: string): string {
  const value: unknown =
    attributes && typeof attributes === "object"
      ? (attributes as JSONObject)[key]
      : undefined;

  return typeof value === "string" ? value : "";
}

export function hasOpenStackPartFeed(
  part: OpenStackPart,
  row: OpenStackResource,
): boolean {
  return (
    getOpenStackPartChangeAttributes(getOpenStackPartLogFacts(part, row)) !==
    null
  );
}

export interface ComponentProps {
  part: OpenStackPart;
  row: OpenStackResource;
}

export const OpenStackPartFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const [changes, setChanges] = useState<Array<ChangeEvent> | null>(null);
  const [error, setError] = useState<boolean>(false);
  const facts: OpenStackPartLogFacts = getOpenStackPartLogFacts(part, row);
  const own: Record<string, string> | null =
    getOpenStackPartChangeAttributes(facts);

  useEffect(() => {
    if (!own) {
      return;
    }

    let isCurrent: boolean = true;
    const now: Date = OneUptimeDate.getCurrentDate();

    AnalyticsModelAPI.getList<ChangeEvent>({
      modelType: ChangeEvent,
      query: {
        attributes: {
          [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: part.cloudName,
          ...own,
        },
        time: new InBetween<Date>(
          OneUptimeDate.addRemoveDays(now, -FEED_WINDOW_IN_DAYS),
          now,
        ),
      } as unknown as Query<ChangeEvent>,
      select: {
        _id: true,
        time: true,
        title: true,
        attributes: true,
        description: true,
      },
      sort: { time: SortOrder.Descending },
      limit: FEED_ROWS,
      skip: 0,
    })
      .then((result: ListResult<ChangeEvent>): void => {
        if (isCurrent) {
          setChanges(result.data);
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setError(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [part.externalId, part.cloudName, part.refreshToken]);

  return (
    <Card
      title="Feed"
      description="What the cloud said happened to this part, and what OneUptime AI changed on it and who approved that, newest first. The cloud's side needs notifications in the logs, or a probe: the OpenStack guide says how."
    >
      <div className="text-sm" data-testid="openstack-part-feed">
        {error ? (
          <p className="text-gray-500">
            {translator.translateText("The feed could not be read.")}
          </p>
        ) : changes && changes.length === 0 ? (
          <p className="text-gray-500">
            {translator.translateText("Nothing has been said about this yet.")}
          </p>
        ) : (
          <ul>
            {(changes || []).map((change: ChangeEvent): ReactElement => {
              const failed: boolean =
                readText(change.attributes, OpenStackEventAttribute.Outcome) ===
                "failed";
              const who: string = readText(
                change.attributes,
                ChangeEventAttribute.CloudActor,
              );

              return (
                <li
                  key={change._id?.toString()}
                  className="border-b border-gray-100 py-2 last:border-b-0"
                >
                  <div className={failed ? "text-red-700" : "text-gray-800"}>
                    <bdi>{change.title}</bdi>
                  </div>
                  <div className="text-xs text-gray-500">
                    {change.time
                      ? OneUptimeDate.getDateAsLocalFormattedString(
                          new Date(change.time),
                        )
                      : ""}
                    {who ? (
                      <Fragment>
                        <InlineSeparator />
                        <bdi className="font-mono">{who}</bdi>
                      </Fragment>
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
};

interface WhoRow {
  key: string;
  time: Date | null;
  who: string;
  what: string;
  failed: boolean;
}

export const OpenStackWhoChangedThis: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const [rows, setRows] = useState<Array<WhoRow>>([]);
  const facts: OpenStackPartLogFacts = getOpenStackPartLogFacts(part, row);
  const changedAt: Date | null = row.stateChangedAt
    ? new Date(row.stateChangedAt)
    : null;
  const stateTime: number = changedAt ? changedAt.getTime() : 0;

  useEffect(() => {
    if (!changedAt || Number.isNaN(stateTime)) {
      return;
    }

    let isCurrent: boolean = true;
    const around: InBetween<Date> = new InBetween<Date>(
      OneUptimeDate.addRemoveMinutes(changedAt, -WHO_MINUTES_BEFORE),
      OneUptimeDate.addRemoveMinutes(changedAt, WHO_MINUTES_AFTER),
    );

    const read: () => Promise<void> = async (): Promise<void> => {
      const found: Array<WhoRow> = [];
      const audit: Record<string, string> | null =
        getOpenStackPartAuditAttributes(facts);
      const gate: PermissionGateResult = PermissionGate.check(
        new SecurityEvent(),
        ModelAction.Read,
      );

      if (audit && gate.isAllowed) {
        const events: ListResult<SecurityEvent> =
          await AnalyticsModelAPI.getList<SecurityEvent>({
            modelType: SecurityEvent,
            query: {
              attributes: {
                [OpenStackAuditAttribute.Cloud]: part.cloudName,
                ...audit,
              },
              time: around,
            } as unknown as Query<SecurityEvent>,
            select: {
              _id: true,
              time: true,
              message: true,
              principalUser: true,
              statusName: true,
              attributes: true,
            },
            sort: { time: SortOrder.Descending },
            limit: WHO_ROWS,
            skip: 0,
          });

        for (const event of events.data) {
          const action: string = readText(
            event.attributes,
            OpenStackAuditAttribute.Action,
          );

          if (isOpenStackAuditReadAction(action)) {
            continue;
          }

          found.push({
            key: `audit-${event._id?.toString()}`,
            time: event.time ? new Date(event.time) : null,
            who:
              event.principalUser ||
              readText(event.attributes, OpenStackAuditAttribute.InitiatorId),
            what: action
              ? getAuditActionWords(action, translator)
              : event.message || "",
            failed: event.statusName === "Failure",
          });
        }
      }

      /*
       * With no audit filter on the API, a notification's own actor still says who: Nova
       * writes it into an instance's, and a line's context holds the rest.
       */
      if (found.length === 0) {
        const own: Record<string, string> | null =
          getOpenStackPartChangeAttributes(facts);

        if (own) {
          const changes: ListResult<ChangeEvent> =
            await AnalyticsModelAPI.getList<ChangeEvent>({
              modelType: ChangeEvent,
              query: {
                attributes: {
                  [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: part.cloudName,
                  ...own,
                },
                time: around,
              } as unknown as Query<ChangeEvent>,
              select: { _id: true, time: true, title: true, attributes: true },
              sort: { time: SortOrder.Descending },
              limit: WHO_ROWS,
              skip: 0,
            });

          for (const change of changes.data) {
            const who: string = readText(
              change.attributes,
              ChangeEventAttribute.CloudActor,
            );

            if (who) {
              found.push({
                key: `change-${change._id?.toString()}`,
                time: change.time ? new Date(change.time) : null,
                who,
                what: change.title || "",
                failed:
                  readText(
                    change.attributes,
                    OpenStackEventAttribute.Outcome,
                  ) === "failed",
              });
            }
          }
        }
      }

      if (isCurrent) {
        setRows(found);
      }
    };

    read().catch((): void => {
      // This only adds to the page: a read that fails leaves the rest of it as it is.
    });

    return () => {
      isCurrent = false;
    };
  }, [part.externalId, part.cloudName, stateTime]);

  if (rows.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Who changed this"
      description="Who did what to this part around the moment its state last changed, from the cloud's audit trail and notifications."
    >
      <ul className="text-sm" data-testid="openstack-who-changed-this">
        {rows.map((who: WhoRow): ReactElement => {
          return (
            <li key={who.key} className="py-1">
              <bdi className="font-medium text-gray-800">{who.who}</bdi>
              <span className={who.failed ? "text-red-700" : "text-gray-600"}>
                {" "}
                <bdi>{who.what}</bdi>
              </span>
              {who.time ? (
                <span className="ms-2 text-xs text-gray-500">
                  {OneUptimeDate.getDateAsLocalFormattedString(who.time)}
                </span>
              ) : (
                <></>
              )}
              {who.failed ? (
                <span className="ms-2 text-red-700">
                  {translator.translateText("Failed")}
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
