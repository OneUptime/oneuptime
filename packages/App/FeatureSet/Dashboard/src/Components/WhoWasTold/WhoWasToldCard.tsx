import RelativeTime from "../EpisodeView/RelativeTime";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import WhoWasToldApi from "./WhoWasToldApi";
// Read where it is kept, so ErrorSentenceGuard sees its {{error}} drawn.
import { WHO_WAS_TOLD_COPY } from "./WhoWasToldCopy";
import {
  DELIVERY_CHIPS,
  PAGE_CHIPS,
  STATUS_CHIPS,
  SUBSCRIBER_CHIPS,
  WHO_WAS_TOLD_PEOPLE_SHOWN,
  WHO_WAS_TOLD_PLURALS,
  WhoWasToldChip,
  WhoWasToldSections,
  getChannelName,
  getChannelsOf,
  getNotificationReason,
  getPageReason,
  getPageThroughWords,
  getRunChip,
  getRunReason,
  getTargetReason,
  getWhoWasToldHiddenSentences,
  getWhoWasToldSections,
  getWhoWasToldSentences,
} from "./WhoWasToldWords";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WHO_WAS_TOLD_REFRESH_INTERVAL_IN_MS,
  WhoWasToldChannelGroup,
  WhoWasToldNotification,
  WhoWasToldPage,
  WhoWasToldPerson,
  WhoWasToldResult,
  WhoWasToldRun,
  WhoWasToldStatus,
  WhoWasToldSubscribers,
  WhoWasToldTarget,
} from "Common/Types/Notification/WhoWasTold";
import ObjectID from "Common/Types/ObjectID";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Card from "Common/UI/Components/Card/Card";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  formatInline,
  formatList,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useLiveRefresh from "Common/UI/Utils/UseLiveRefresh";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * "WHO WAS TOLD" (#7075, part 2 of #6810): who OneUptime told about an
 * incident or an alert, by what, and what failed - as it happened, read
 * from its on-call runs and notification logs (WhoWasToldService), never
 * worked out. A monitor's "When this goes down" says who WOULD be told; this
 * says who WAS.
 *
 * Calm on a busy incident: one line per person, then what was not paged,
 * the channels posted to and the status page subscribers, each with one
 * status chip, in order of time; the pages and notifications under each
 * folded away until asked for (Show details). A person's line says how the
 * page reached them (the policy, the level, the team or schedule) and by
 * what; a failure says why, as its log says it.
 *
 * Live: while the record is open it is read again every few seconds and
 * whenever the record changes (its live updates), never while the tab is
 * hidden. What the reader may not read is counted, never named.
 */

export interface ComponentProps {
  recordKind: OnCallTestPageRecordKind;
  recordId: ObjectID;
  // Read again while it is open: pages go out and are answered over minutes.
  isLive: boolean;
  // Changes when the page did something that tells people: read again then.
  refreshToken?: number | string | undefined;
  // For tests: how often to read again while it is open.
  refreshIntervalInMs?: number | undefined;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: WhoWasToldResult };

// The icon a status draws, and its colour.
const STATUS_ICONS: Readonly<
  Record<WhoWasToldStatus, { icon: IconProp; className: string }>
> = {
  [WhoWasToldStatus.Acknowledged]: {
    icon: IconProp.CheckCircle,
    className: "text-emerald-600",
  },
  [WhoWasToldStatus.Told]: {
    icon: IconProp.CheckCircle,
    className: "text-indigo-600",
  },
  [WhoWasToldStatus.Sending]: {
    icon: IconProp.Clock,
    className: "text-gray-500",
  },
  [WhoWasToldStatus.Failed]: {
    icon: IconProp.Alert,
    className: "text-red-600",
  },
  [WhoWasToldStatus.Skipped]: {
    icon: IconProp.Alert,
    className: "text-amber-600",
  },
};

const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

const ROW_CLASS_NAME: string = "flex items-start gap-2 py-2";

const LINK_CLASS_NAME: string =
  "text-sm font-medium text-indigo-700 hover:underline";

// A time of the chain: its day and time, on the reader's clock.
function writeTime(iso: string): string {
  if (!iso) {
    return "";
  }

  return OneUptimeDate.getDateAsLocalShortDateTimeString(
    OneUptimeDate.fromString(iso),
  );
}

const Chip: FunctionComponent<{
  chip: WhoWasToldChip;
  isPulsing?: boolean | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  chip: WhoWasToldChip;
  isPulsing?: boolean | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  return (
    <Pill
      text={props.chip.text}
      tone={props.chip.tone}
      size={PillSize.Small}
      isPulsing={props.isPulsing}
      dataTestId={props.dataTestId}
    />
  );
};

// The fold under a line: Show details, Hide details.
const DetailsToggle: FunctionComponent<{
  isOpen: boolean;
  onToggle: () => void;
}> = (props: { isOpen: boolean; onToggle: () => void }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <button
      type="button"
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
      aria-expanded={props.isOpen}
      data-testid="who-was-told-details-toggle"
      onClick={props.onToggle}
    >
      <Icon
        icon={props.isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
        className="h-3 w-3"
      />
      {props.isOpen
        ? translator.translateText(WHO_WAS_TOLD_COPY.hideDetails)
        : translator.translateText(WHO_WAS_TOLD_COPY.showDetails)}
    </button>
  );
};

// One notification, folded under its person or channel.
const NotificationLine: FunctionComponent<{
  notification: WhoWasToldNotification;
}> = (props: { notification: WhoWasToldNotification }): ReactElement => {
  const translator: Translator = useTranslator();
  const notification: WhoWasToldNotification = props.notification;
  const reason: string | null = getNotificationReason(notification);

  return (
    <li
      className="py-1"
      data-testid="who-was-told-notification"
      data-status={notification.status}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-gray-500">
          {writeTime(notification.sentAt)}
        </span>
        <span className="text-sm text-gray-900">
          {getChannelName(notification.channel, translator)}
        </span>
        <Chip chip={DELIVERY_CHIPS[notification.status]} />
      </div>
      {reason ? (
        <IsolatedLine
          as="p"
          text={reason}
          className="mt-0.5 text-xs text-gray-600 break-words"
          dataTestId="who-was-told-reason"
        />
      ) : (
        <></>
      )}
    </li>
  );
};

// One page of a person, folded under them.
const PageLine: FunctionComponent<{
  page: WhoWasToldPage;
  personName: string;
}> = (props: { page: WhoWasToldPage; personName: string }): ReactElement => {
  const translator: Translator = useTranslator();
  const page: WhoWasToldPage = props.page;
  const reason: string | null = getPageReason(
    translator,
    page,
    props.personName,
  );
  const through: Array<string> = getPageThroughWords(translator, page);

  return (
    <li
      className="py-1"
      data-testid="who-was-told-page"
      data-status={page.status}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-gray-500">{writeTime(page.pagedAt)}</span>
        <span className="text-sm text-gray-900" dir="auto">
          {formatInline(through, translator)}
        </span>
        <Chip chip={PAGE_CHIPS[page.status]} />
      </div>
      {reason ? (
        <IsolatedLine
          as="p"
          text={reason}
          className="mt-0.5 text-xs text-gray-600 break-words"
          dataTestId="who-was-told-reason"
        />
      ) : (
        <></>
      )}
    </li>
  );
};

// What happened to a person or a channel, in order of time.
const Details: FunctionComponent<{
  pages: Array<WhoWasToldPage>;
  notifications: Array<WhoWasToldNotification>;
  personName: string;
}> = (props: {
  pages: Array<WhoWasToldPage>;
  notifications: Array<WhoWasToldNotification>;
  personName: string;
}): ReactElement => {
  const items: Array<
    | { at: string; page: WhoWasToldPage }
    | { at: string; notification: WhoWasToldNotification }
  > = [
    ...props.pages.map((page: WhoWasToldPage) => {
      return { at: page.pagedAt, page: page };
    }),
    ...props.notifications.map((notification: WhoWasToldNotification) => {
      return { at: notification.sentAt, notification: notification };
    }),
  ].sort((a: { at: string }, b: { at: string }): number => {
    return new Date(a.at).getTime() - new Date(b.at).getTime() || 0;
  });

  return (
    <ul
      className="mt-1 border-s border-gray-200 ps-3"
      data-testid="who-was-told-details"
    >
      {items.map(
        (
          item:
            | { at: string; page: WhoWasToldPage }
            | { at: string; notification: WhoWasToldNotification },
        ): ReactElement => {
          if ("page" in item) {
            return (
              <PageLine
                key={`page-${item.page.id}`}
                page={item.page}
                personName={props.personName}
              />
            );
          }

          return (
            <NotificationLine
              key={`notification-${item.notification.id}`}
              notification={item.notification}
            />
          );
        },
      )}
    </ul>
  );
};

/*
 * A person: their name and where they stand, how the page reached them and
 * by what - or why it did not - with each page and notification folded
 * under it.
 */
const PersonRow: FunctionComponent<{ person: WhoWasToldPerson }> = (props: {
  person: WhoWasToldPerson;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const person: WhoWasToldPerson = props.person;
  const name: string =
    person.name || translator.translateText(WHO_WAS_TOLD_COPY.someone) || "";
  const firstPage: WhoWasToldPage | undefined = person.pages[0];
  const through: Array<string> = firstPage
    ? getPageThroughWords(translator, firstPage)
    : [];
  const channels: Array<OnCallPageChannel> = getChannelsOf(
    person.notifications,
    person.pages,
  );
  const facts: Array<string> = [];

  if (channels.length > 0) {
    facts.push(
      formatList(
        channels.map((channel: OnCallPageChannel): string => {
          return getChannelName(channel, translator);
        }),
        translator,
      ),
    );
  }

  if (person.failedCount > 0) {
    facts.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.failedCount,
        person.failedCount,
      ),
    );
  }

  facts.push(writeTime(person.acknowledgedAt || person.firstAt));

  // Nothing went out: why, from their page's own line.
  const reason: string | null =
    person.status === WhoWasToldStatus.Skipped ||
    (person.status === WhoWasToldStatus.Failed && firstPage)
      ? getPageReason(translator, firstPage!, person.name)
      : null;
  const hasDetails: boolean =
    person.notifications.length > 0 || person.pages.length > 1;

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="who-was-told-person"
      data-status={person.status}
    >
      <Icon
        icon={STATUS_ICONS[person.status].icon}
        className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_ICONS[person.status].className}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            dir="auto"
          >
            {name}
          </span>
          <Chip
            chip={STATUS_CHIPS[person.status]}
            isPulsing={person.status === WhoWasToldStatus.Sending}
          />
        </div>
        {through.length > 0 ? (
          <p className="text-xs text-gray-500" dir="auto">
            {formatInline(through, translator)}
          </p>
        ) : (
          <></>
        )}
        <p className="text-xs text-gray-500">
          {formatInline(facts.filter(Boolean), translator)}
        </p>
        {reason ? (
          <IsolatedLine
            as="p"
            text={reason}
            className="mt-0.5 text-xs text-gray-600 break-words"
            dataTestId="who-was-told-reason"
          />
        ) : (
          <></>
        )}
        {hasDetails ? (
          <DetailsToggle
            isOpen={isOpen}
            onToggle={() => {
              setIsOpen(!isOpen);
            }}
          />
        ) : (
          <></>
        )}
        {isOpen ? (
          <Details
            pages={person.pages}
            notifications={person.notifications}
            personName={person.name}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

// A target of an on-call level that reached nobody, and why.
const TargetRow: FunctionComponent<{ target: WhoWasToldTarget }> = (props: {
  target: WhoWasToldTarget;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const target: WhoWasToldTarget = props.target;
  const through: Array<string> = getPageThroughWords(translator, target);

  return (
    <li className={ROW_CLASS_NAME} data-testid="who-was-told-not-paged">
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <IsolatedLine
            as="p"
            text={getTargetReason(translator, target)}
            className="min-w-0 text-sm text-gray-900 break-words"
            dataTestId="who-was-told-reason"
          />
          <Chip chip={PAGE_CHIPS.Skipped} />
        </div>
        <p className="text-xs text-gray-500" dir="auto">
          {formatInline([...through, writeTime(target.at)], translator)}
        </p>
      </div>
    </li>
  );
};

/*
 * A run that paged nobody and says why on its own: one that waits for
 * working hours or for OneUptime AI, or failed before it paged.
 */
const RunRow: FunctionComponent<{ run: WhoWasToldRun }> = (props: {
  run: WhoWasToldRun;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const run: WhoWasToldRun = props.run;
  const reason: string = getRunReason(translator, run);

  return (
    <li className={ROW_CLASS_NAME} data-testid="who-was-told-run">
      <Icon
        icon={IconProp.Clock}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-500"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            dir="auto"
          >
            {run.isDirectPage || !run.policyName
              ? translator.translateText("Direct page")
              : run.policyName}
          </span>
          <Chip chip={getRunChip(run.status)} />
        </div>
        {reason ? (
          <IsolatedLine
            as="p"
            text={reason}
            className="text-xs text-gray-600 break-words"
            dataTestId="who-was-told-reason"
          />
        ) : (
          <></>
        )}
        <p className="text-xs text-gray-500">{writeTime(run.startedAt)}</p>
      </div>
    </li>
  );
};

// A channel posted to: a workspace channel, a webhook, an address.
const ChannelRow: FunctionComponent<{
  group: WhoWasToldChannelGroup;
}> = (props: { group: WhoWasToldChannelGroup }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const group: WhoWasToldChannelGroup = props.group;
  const facts: Array<string> = [getChannelName(group.channel, translator)];

  if (group.failedCount > 0) {
    facts.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.failedCount,
        group.failedCount,
      ),
    );
  }

  facts.push(writeTime(group.lastAt));

  // The last failure's reason, while nothing went out.
  const lastFailed: WhoWasToldNotification | undefined =
    group.status === WhoWasToldStatus.Failed
      ? group.notifications[group.notifications.length - 1]
      : undefined;
  const reason: string | null = lastFailed
    ? getNotificationReason(lastFailed)
    : null;

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="who-was-told-channel"
      data-status={group.status}
    >
      <Icon
        icon={STATUS_ICONS[group.status].icon}
        className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_ICONS[group.status].className}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            dir="auto"
          >
            {group.name || getChannelName(group.channel, translator)}
          </span>
          <Chip chip={STATUS_CHIPS[group.status]} />
        </div>
        <p className="text-xs text-gray-500">
          {formatInline(facts.filter(Boolean), translator)}
        </p>
        {reason ? (
          <IsolatedLine
            as="p"
            text={reason}
            className="mt-0.5 text-xs text-gray-600 break-words"
            dataTestId="who-was-told-reason"
          />
        ) : (
          <></>
        )}
        <DetailsToggle
          isOpen={isOpen}
          onToggle={() => {
            setIsOpen(!isOpen);
          }}
        />
        {isOpen ? (
          <Details
            pages={[]}
            notifications={group.notifications}
            personName=""
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

// The incident's status page subscribers: counted, never listed.
const SubscribersRow: FunctionComponent<{
  subscribers: WhoWasToldSubscribers;
}> = (props: { subscribers: WhoWasToldSubscribers }): ReactElement => {
  const translator: Translator = useTranslator();
  const subscribers: WhoWasToldSubscribers = props.subscribers;
  const status: StatusPageSubscriberNotificationStatus =
    subscribers.status || StatusPageSubscriberNotificationStatus.Pending;
  const facts: Array<string> = [];

  if (subscribers.areCountsReadable && subscribers.sentCount > 0) {
    facts.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.subscribersSent,
        subscribers.sentCount,
      ),
    );
  }

  if (subscribers.areCountsReadable && subscribers.failedCount > 0) {
    facts.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.failedCount,
        subscribers.failedCount,
      ),
    );
  }

  // Why they were not told, or what failed: the incident's own line.
  const reason: string | undefined =
    status === StatusPageSubscriberNotificationStatus.Skipped ||
    status === StatusPageSubscriberNotificationStatus.Failed
      ? subscribers.statusMessage
      : undefined;

  return (
    <li
      className={ROW_CLASS_NAME}
      data-testid="who-was-told-subscribers"
      data-status={status}
    >
      <Icon
        icon={IconProp.Public}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-500"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900">
            {translator.translateText(WHO_WAS_TOLD_COPY.subscribers)}
          </span>
          <Chip
            chip={SUBSCRIBER_CHIPS[status]}
            isPulsing={
              status === StatusPageSubscriberNotificationStatus.InProgress
            }
          />
        </div>
        {facts.length > 0 ? (
          <p className="text-xs text-gray-500">
            {formatInline(facts, translator)}
          </p>
        ) : (
          <></>
        )}
        {reason ? (
          <IsolatedLine
            as="p"
            text={reason}
            className="mt-0.5 text-xs text-gray-600 break-words"
            dataTestId="who-was-told-reason"
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const Section: FunctionComponent<{
  title: string;
  testId: string;
  children: ReactElement | Array<ReactElement>;
}> = (props: {
  title: string;
  testId: string;
  children: ReactElement | Array<ReactElement>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section className="mt-3" data-testid={props.testId}>
      <h3 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(props.title)}
      </h3>
      <ul className="divide-y divide-gray-100">{props.children}</ul>
    </section>
  );
};

// The answer, drawn: its first words, then each section, folded where busy.
export const WhoWasToldView: FunctionComponent<{
  result: WhoWasToldResult;
}> = (props: { result: WhoWasToldResult }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isAllPeopleShown, setIsAllPeopleShown] = useState<boolean>(false);
  const result: WhoWasToldResult = props.result;
  const sections: WhoWasToldSections = getWhoWasToldSections(result);
  const hiddenSentences: Array<string> = getWhoWasToldHiddenSentences(
    result,
    translator,
  );
  const shownPeople: Array<WhoWasToldPerson> = isAllPeopleShown
    ? sections.people
    : sections.people.slice(0, WHO_WAS_TOLD_PEOPLE_SHOWN);
  const morePeople: number = sections.people.length - shownPeople.length;
  const isNotPagedShown: boolean =
    sections.notPaged.length > 0 || sections.runsThatPagedNobody.length > 0;

  return (
    <div data-testid="who-was-told">
      <p className="text-sm text-gray-900" data-testid="who-was-told-summary">
        {joinSentences(getWhoWasToldSentences(result, translator))}
      </p>

      {sections.people.length > 0 ? (
        <Section title={WHO_WAS_TOLD_COPY.people} testId="who-was-told-people">
          {shownPeople.map((person: WhoWasToldPerson): ReactElement => {
            return <PersonRow key={person.userId} person={person} />;
          })}
        </Section>
      ) : (
        <></>
      )}

      {sections.people.length > WHO_WAS_TOLD_PEOPLE_SHOWN ? (
        <button
          type="button"
          className="mt-1 text-sm font-medium text-indigo-700 hover:underline"
          aria-expanded={isAllPeopleShown}
          data-testid="who-was-told-show-more"
          onClick={() => {
            setIsAllPeopleShown(!isAllPeopleShown);
          }}
        >
          {isAllPeopleShown
            ? translator.translateText(WHO_WAS_TOLD_COPY.showFewer)
            : translator.translatePlural(
                WHO_WAS_TOLD_PLURALS.showMore,
                morePeople,
              )}
        </button>
      ) : (
        <></>
      )}

      {isNotPagedShown ? (
        <Section
          title={WHO_WAS_TOLD_COPY.notPaged}
          testId="who-was-told-not-paged-section"
        >
          {[
            ...sections.notPaged.map(
              (target: WhoWasToldTarget): ReactElement => {
                return <TargetRow key={target.id} target={target} />;
              },
            ),
            ...sections.runsThatPagedNobody.map(
              (run: WhoWasToldRun): ReactElement => {
                return <RunRow key={run.id} run={run} />;
              },
            ),
          ]}
        </Section>
      ) : (
        <></>
      )}

      {sections.channels.length > 0 ? (
        <Section
          title={WHO_WAS_TOLD_COPY.channels}
          testId="who-was-told-channels"
        >
          {sections.channels.map(
            (group: WhoWasToldChannelGroup): ReactElement => {
              return <ChannelRow key={group.key} group={group} />;
            },
          )}
        </Section>
      ) : (
        <></>
      )}

      {result.subscribers ? (
        <ul className="mt-3 border-t border-gray-100">
          <SubscribersRow subscribers={result.subscribers} />
        </ul>
      ) : (
        <></>
      )}

      {hiddenSentences.length > 0 ? (
        <p
          className="mt-3 text-xs text-gray-500"
          data-testid="who-was-told-hidden"
        >
          {joinSentences(hiddenSentences)}
        </p>
      ) : (
        <></>
      )}

      {result.isTruncated ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="who-was-told-truncated"
        >
          {translator.translateText(WHO_WAS_TOLD_COPY.truncated)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const isTabHidden: () => boolean = (): boolean => {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
};

const WhoWasToldCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  const recordIdText: string = props.recordId.toString();
  const isAlert: boolean = props.recordKind === OnCallTestPageRecordKind.Alert;

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const request: number = ++requestRef.current;

    try {
      const result: WhoWasToldResult = await WhoWasToldApi.get({
        recordKind: props.recordKind,
        recordId: new ObjectID(recordIdText),
      });

      if (request === requestRef.current) {
        setState({ status: "loaded", result: result });
      }
    } catch (err) {
      if (request === requestRef.current) {
        /*
         * A read again that fails keeps what is on show: a moment's
         * gateway error never wipes a list somebody is reading.
         */
        setState((current: LoadState): LoadState => {
          return current.status === "loaded"
            ? current
            : {
                status: "error",
                message: err instanceof Error ? err.message : String(err),
              };
        });
      }
    }
  }, [recordIdText, props.recordKind]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToken]);

  // The record changed - its state, its owners: read again.
  useLiveRefresh({
    modelTypes: isAlert ? [Alert] : [Incident],
    isEnabled: props.isLive,
    getTenantId: () => {
      return ProjectUtil.getCurrentProjectId();
    },
    refresh: load,
  });

  /*
   * While it is open, read again every few seconds: a page goes out, an SMS
   * is delivered, a call rings out and is answered over the first minutes,
   * and none of those announces itself. Never while the tab is hidden: it
   * reads once when it is looked at again.
   */
  useEffect(() => {
    if (!props.isLive) {
      return undefined;
    }

    let hasMissedTick: boolean = false;

    const interval: ReturnType<typeof setInterval> = setInterval((): void => {
      if (isTabHidden()) {
        hasMissedTick = true;
        return;
      }

      void load();
    }, props.refreshIntervalInMs || WHO_WAS_TOLD_REFRESH_INTERVAL_IN_MS);

    const onVisibilityChange: () => void = (): void => {
      if (!isTabHidden() && hasMissedTick) {
        hasMissedTick = false;
        void load();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      clearInterval(interval);

      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [props.isLive, load, props.refreshIntervalInMs]);

  const tryAgain: () => void = (): void => {
    setState({ status: "loading" });
    void load();
  };

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      isAlert
        ? PageMap.ALERT_VIEW_NOTIFICATION_LOGS
        : PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS
    ] as Route,
    { modelId: new ObjectID(recordIdText) },
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (state.status === "loading") {
      // The rows' shape, with the hairlines between them.
      return (
        <div data-testid="who-was-told-loading">
          <DetailListSkeleton fields={3} isCompact={true} />
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div>
          <p className="text-sm text-gray-600" data-testid="who-was-told-error">
            <ErrorSentence
              template={WHO_WAS_TOLD_COPY.error}
              error={state.message}
            />
          </p>
          <button
            type="button"
            className={`mt-2 ${LINK_CLASS_NAME}`}
            data-testid="who-was-told-try-again"
            onClick={() => {
              tryAgain();
            }}
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      );
    }

    return (
      <div>
        <WhoWasToldView result={state.result} />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <span>
            <TranslatedSentence
              template={WHO_WAS_TOLD_COPY.updated}
              slots={{
                time: (
                  <RelativeTime
                    date={OneUptimeDate.fromString(state.result.checkedAt)}
                  />
                ),
              }}
            />
          </span>
          <AppLink
            to={logsRoute}
            className="font-medium text-indigo-700 hover:underline"
            dataTestId="who-was-told-logs-link"
          >
            {translator.translateText(WHO_WAS_TOLD_COPY.notificationLogs) || ""}
          </AppLink>
        </div>
      </div>
    );
  };

  return (
    <Card
      title={WHO_WAS_TOLD_COPY.title}
      description={
        isAlert
          ? WHO_WAS_TOLD_COPY.alertDescription
          : WHO_WAS_TOLD_COPY.incidentDescription
      }
      headerLayout="stacked"
    >
      <div data-testid="who-was-told-card">{getBody()}</div>
    </Card>
  );
};

export default WhoWasToldCard;
