import { ADMIN_EMAIL_SETTINGS_ROUTE } from "../../../Utils/ServerEmail";
import RelativeTime from "../../EpisodeView/RelativeTime";
import FireDrillButton from "../../OnCallTestPage/FireDrillButton";
import LastFireDrill from "../../OnCallTestPage/LastFireDrill";
import { hasOnCallFireDrill } from "Common/Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  getNotPagedLines,
  getReachedThroughWords,
} from "../../OnCallTestPage/OnCallTestPageWords";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import WhoIsToldApi, {
  getWhoIsToldDraftBody,
  WhoIsToldDraftInput,
} from "./WhoIsToldApi";
import {
  ADMIN_DASHBOARD_FIX_WORDS,
  FALLBACK_CHANNELS_NOTE,
  LABEL_RULES_NOTE,
  OWNER_NOT_EMAILED_WORDS,
  PRIVATE_WORDS,
  WhoIsToldFixLink,
  WhoIsToldOwnerFixLink,
  WhoIsToldOwnerNotEmailed,
  getBreakSentence,
  getChannelName,
  getDeclaresSentence,
  getFixLink,
  getOwnerMatchSentence,
  getOwnerNotEmailedFixLink,
  getOwnerNotEmailedSentences,
  getOwnersNotEmailed,
  getPagedOwnersSentence,
  getPrivateSentences,
  getStatusPageText,
  getWhoIsToldSeverityValue,
  getWhoIsToldSummary,
  OPENS_CHAIN_LINES,
} from "./WhoIsToldWords";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import OneUptimeDate from "Common/Types/Date";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwnerMatch,
  WhoIsToldOwners,
  WhoIsToldPerson,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldStatusPage,
} from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Card from "Common/UI/Components/Card/Card";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import Link from "Common/UI/Components/Link/Link";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import {
  formatList,
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/*
 * "WHEN THIS GOES DOWN" (#6810): what happens when this monitor fails, and
 * who is told - in words first, with every break in the chain named and a
 * link to the page that puts it right. "Show the chain" opens it link by
 * link: each criteria, what it opens, its owners, the on-call rules and
 * policies it runs, and who each policy reaches right now, by what.
 *
 * One request (WhoIsToldApi), answered from a minute-old cache on the
 * server; Recheck works it out again. A Recheck that fails keeps the last
 * answer on the card and says so under it (#7308).
 *
 * The same card stands wherever the question is asked (#7055): a monitor's
 * overview and its Criteria page (monitorId), Create Monitor's criteria,
 * read for the monitor the form holds before it exists (draft), and the
 * website guided setup. In a form or a summary it is embedded - no card of
 * its own, no Checked line - and its fix links open in a new tab, so the
 * form is never left behind.
 */

// Where the card stands, as the analytics name it (#7079).
export enum WhoIsToldPlace {
  MonitorOverview = "monitor_overview",
  MonitorCriteria = "monitor_criteria",
  CreateMonitor = "create_monitor",
  GuidedSetup = "guided_setup",
}

export interface ComponentProps {
  // A saved monitor.
  monitorId?: ObjectID | undefined;
  /*
   * A monitor being set up, worked out as it is (#7055): read again a
   * moment after it last changes, the last answer kept on the card while it
   * is.
   */
  draft?: WhoIsToldDraftInput | undefined;
  // Changes when the monitor is edited or refreshed: read again then.
  refreshToken?: number | string | undefined;
  place?: WhoIsToldPlace | undefined;
  variant?: WhoIsToldCardVariant | undefined;
}

/*
 * How the card is drawn: a card of its own, with Checked and Recheck (a
 * monitor's pages); a section of a form or a step, with its title over it
 * and no Checked line (Create Monitor, the guided setup's Who step); or
 * only what it says, under a summary's own label (the guided summary).
 */
export enum WhoIsToldCardVariant {
  Card = "Card",
  Section = "Section",
  Plain = "Plain",
}

// How long a draft rests before it is read again.
export const WHO_IS_TOLD_DRAFT_WAIT_IN_MS: number = 700;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      result: WhoIsToldResult;
      // Why the last Recheck failed, while this answer is kept (#7308).
      recheckError?: string | undefined;
    };

/*
 * THE CHAIN IS LAID OUT BY THE ROOM THE CARD HAS, not by the window's
 * width. The card sits in the overview's side column, a third of the page
 * from 1280 px up: there, and on a phone, each row's name sits over what it
 * says, so the value has the card's whole width. With room for both - the
 * card as wide as the page, from about 1024 px - they sit side by side.
 * (Side by side from a 640 px window, a value in the side column had some
 * 100 px: "Operational" ran out of its box and names broke word by word.)
 * A name with no space in it, such as a status page's address, breaks
 * where it must rather than run out of the card.
 */
const CHAIN_CLASS_NAME: string =
  "mt-3 space-y-4 [container-type:inline-size] [overflow-wrap:anywhere]";

// A row: its name over its value, side by side once the chain is 28rem wide.
const CHAIN_ROW_CLASS_NAME: string =
  "flex flex-col gap-0.5 py-1.5 [@container(min-width:28rem)]:flex-row [@container(min-width:28rem)]:gap-3";

/*
 * A row's name, in capitals as every name of the chain is - "On-call
 * policy" too, a defined term's button, which a browser would draw as
 * written. Side by side, its column fits each language's names but the
 * longest single words; such a word - German's "Bereitschaftsrichtlinie" -
 * is hyphenated in the page's language, or else broken at the column's
 * edge: never drawn over the row's value.
 */
const ROW_LABEL_CLASS: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500 hyphens-auto [overflow-wrap:anywhere] [&_button]:uppercase [@container(min-width:28rem)]:w-40 [@container(min-width:28rem)]:shrink-0";

const FIX_LINK_CLASS_NAME: string =
  "text-sm font-medium text-indigo-700 hover:underline";

// What the card's fix links do, as each place needs.
interface FixContext {
  // A monitor not created yet has no Criteria page.
  monitorId: ObjectID | null;
  // On a form: a fix opens in a new tab, so the form stays.
  opensInNewTab: boolean;
  onOpen: (data: { kind: string; fix: string }) => void;
}

// One line of the chain: what it is, then what it says.
const ChainRow: FunctionComponent<{
  label: ReactElement | string;
  children: ReactElement | Array<ReactElement> | string;
  testId?: string | undefined;
}> = (props: {
  label: ReactElement | string;
  children: ReactElement | Array<ReactElement> | string;
  testId?: string | undefined;
}): ReactElement => {
  return (
    <div className={CHAIN_ROW_CLASS_NAME} data-testid={props.testId}>
      <span className={ROW_LABEL_CLASS}>{props.label}</span>
      <div className="min-w-0 text-sm text-gray-900">{props.children}</div>
    </div>
  );
};

/*
 * "Ana Lopez · SMS, Phone call", or why a page won't reach them: the
 * person's name, how the policy reaches them when it is through a team or
 * a schedule, and by what - each set off from the next as the reader's
 * language does. The mark keeps to the fact before it, so a line that
 * wraps never starts with one. The icon has a column of its own, never a
 * line of its own over the name.
 *
 * How the policy reaches them is worded in the reader's language from its
 * code, as the test page's dialog words it ("Team Platform", "Schedule
 * Primary (next in rotation)"), the name set apart from the words around
 * it; a server that sends no code has its English shown (#7261).
 *
 * Somebody no rule of theirs covers the severity for is reached by what the
 * project's fallback picks (#7528): often their email alone, though they
 * verified a number too. The line says so after the channels, so "Email"
 * never reads as a gap in their own rules.
 */
const PersonLine: FunctionComponent<{ person: WhoIsToldPerson }> = (props: {
  person: WhoIsToldPerson;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const person: WhoIsToldPerson = props.person;
  const separator: string = `\u00a0${getInlineSeparator(
    translator.language,
  ).trim()} `;
  const reachedThrough: string = getReachedThroughWords(translator, person);

  return (
    <li
      className="flex items-start gap-2"
      data-testid="who-is-told-person"
      data-reachable={person.isReachable ? "true" : "false"}
    >
      <Icon
        icon={person.isReachable ? IconProp.CheckCircle : IconProp.Alert}
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          person.isReachable ? "text-emerald-600" : "text-amber-600"
        }`}
      />
      <p className="min-w-0 text-xs text-gray-500">
        <span className="text-sm font-medium text-gray-900" dir="auto">
          {person.name || translator.translateText("Someone")}
        </span>
        {reachedThrough ? (
          <>
            {separator}
            <span dir="auto" data-testid="who-is-told-reached-through">
              {reachedThrough}
            </span>
          </>
        ) : (
          <></>
        )}
        {separator}
        {person.isReachable ? (
          <>
            <span className="text-gray-600">
              {formatList(
                person.channels.map((channel: OnCallPageChannel): string => {
                  return getChannelName(channel, translator);
                }),
                translator,
              )}
            </span>
            {person.isFallback ? (
              <>
                {separator}
                <span data-testid="who-is-told-fallback">
                  {translator.translateText(FALLBACK_CHANNELS_NOTE)}
                </span>
              </>
            ) : (
              <></>
            )}
          </>
        ) : (
          <span className="text-amber-700">
            {translator.translateText("Can't be paged")}
          </span>
        )}
      </p>
    </li>
  );
};

/*
 * A target of a policy's first level that reaches nobody, and why ("Team
 * Night Shift has no members."): a row of the policy's list, as a person
 * who can't be paged is - the warning in the icon column, the sentence
 * where the names are - so it reads as a gap in who is paged, never as a
 * note about the person above it. Worded in the reader's language from the
 * server's code, as the test page's dialog words it; the server's English
 * when it sends none (#7261). The sentence takes the direction of its own
 * words: an older server's English reads left to right on a right-to-left
 * page, each of its lines from its own start.
 */
const NotPagedLine: FunctionComponent<{ line: string }> = (props: {
  line: string;
}): ReactElement => {
  return (
    <li
      className="flex items-start gap-2"
      data-testid="who-is-told-not-paged-row"
    >
      <Icon icon={IconProp.Alert} className="h-4 w-4 shrink-0 text-amber-600" />
      <IsolatedLine
        as="p"
        text={props.line}
        className="min-w-0 text-xs text-gray-600 break-words"
        dataTestId="who-is-told-not-paged"
      />
    </li>
  );
};

/*
 * A policy: its name, then one list of its first level's targets - who it
 * reaches and by what, then each target it can't reach and why.
 */
const PolicyBlock: FunctionComponent<{ policy: WhoIsToldPolicy }> = (props: {
  policy: WhoIsToldPolicy;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const policy: WhoIsToldPolicy = props.policy;

  if (policy.isHidden) {
    return (
      <p
        className="text-sm text-gray-600"
        data-testid="who-is-told-hidden-policy"
      >
        {translator.translateText(
          "An on-call policy you can't see pages the people on call.",
        )}
      </p>
    );
  }

  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
    { modelId: new ObjectID(policy.id) },
  );
  const notPaged: Array<string> = getNotPagedLines(translator, policy);

  return (
    <div data-testid="who-is-told-policy">
      <Link
        to={route}
        className="text-sm font-medium text-indigo-700 hover:underline"
      >
        {policy.name}
      </Link>
      {policy.people.length > 0 || notPaged.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {policy.people.map((person: WhoIsToldPerson): ReactElement => {
            return <PersonLine key={person.userId} person={person} />;
          })}
          {notPaged.map((line: string, index: number): ReactElement => {
            return <NotPagedLine key={`not-paged-${index}`} line={line} />;
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

function ownersText(owners: WhoIsToldOwners, translator: Translator): string {
  const names: Array<string> = [...owners.userNames, ...owners.teamNames];

  if (names.length > 0) {
    return formatList(names, translator);
  }

  return translator.translateText("Nobody") || "Nobody";
}

// Rules or status pages by name; one the reader can't see, as hiddenName says.
function namesText(data: {
  items: ReadonlyArray<{ name: string }>;
  hiddenName: string;
  translator: Translator;
}): string {
  return formatList(
    data.items.map((item: { name: string }): string => {
      return item.name || data.hiddenName;
    }),
    data.translator,
  );
}

// A row's sentences, each a line of its own in its own reading direction.
const SentenceLines: FunctionComponent<{
  lines: Array<string>;
  testId?: string | undefined;
}> = (props: {
  lines: Array<string>;
  testId?: string | undefined;
}): ReactElement => {
  return (
    <div data-testid={props.testId}>
      {props.lines.map((line: string, index: number): ReactElement => {
        return (
          <IsolatedLine
            key={`line-${index}`}
            as="p"
            text={line}
            className={index === 0 ? "" : "mt-0.5 text-xs text-gray-500"}
          />
        );
      })}
    </div>
  );
};

const EventBlock: FunctionComponent<{
  event: WhoIsToldEvent;
  isFirstPolicyLabel: boolean;
}> = (props: {
  event: WhoIsToldEvent;
  isFirstPolicyLabel: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const event: WhoIsToldEvent = props.event;
  const isAlert: boolean = event.kind === OnCallTestPageRecordKind.Alert;
  // Owners the page reaches first, whom the Created email leaves out (#8860).
  const pagedOwnersLine: string | null = getPagedOwnersSentence(
    event.owners,
    translator,
  );
  const hiddenRuleName: string =
    translator.translateText("A rule you can't see") || "";

  const policyLabel: ReactElement = props.isFirstPolicyLabel ? (
    <DefinedTerm term={GlossaryTerm.OnCallPolicy}>
      {translator.translateText("On-call policy")}
    </DefinedTerm>
  ) : (
    <>{translator.translateText("On-call policy")}</>
  );

  const opensRow: ReactElement = (
    <ChainRow label={translator.translateText("Opens") || "Opens"}>
      <span>
        {/*
         * Its severity in brackets, by its list: "An incident (Critical
         * Incident)", never "A Critical Incident incident" (#7368).
         */}
        {translator.translateTemplate(
          isAlert ? OPENS_CHAIN_LINES.alert : OPENS_CHAIN_LINES.incident,
          { severity: getWhoIsToldSeverityValue(event) },
          { setsValuesApart: true },
        )}
      </span>
      {event.title ? (
        <IsolatedLine
          as="p"
          text={event.title}
          className="mt-0.5 text-xs text-gray-500 break-words"
          dataTestId="who-is-told-title"
        />
      ) : (
        <></>
      )}
    </ChainRow>
  );

  const privateRow: ReactElement = event.isPrivate ? (
    <ChainRow
      label={translator.translateText("Private") || "Private"}
      testId="who-is-told-private"
    >
      <SentenceLines lines={getPrivateSentences(event, translator)} />
    </ChainRow>
  ) : (
    <></>
  );

  /*
   * A private record the reader won't be able to see once it exists
   * (#7213): what opens, and that it is private - nothing of whom it tells.
   */
  if (event.isHidden) {
    return (
      <div
        className="mt-1"
        data-testid="who-is-told-event"
        data-kind={event.kind}
        data-hidden="true"
      >
        {opensRow}
        {privateRow}
      </div>
    );
  }

  return (
    <div
      className="mt-1"
      data-testid="who-is-told-event"
      data-kind={event.kind}
    >
      {opensRow}
      <ChainRow label={translator.translateText("Emails") || "Emails"}>
        <span dir="auto">{ownersText(event.owners, translator)}</span>
        {/*
         * An owner the page reaches first is not emailed as an owner too
         * (#8860): said under whom the email reaches, so "Nobody" there
         * never reads as nobody being told.
         */}
        {pagedOwnersLine ? (
          <p
            className="mt-0.5 text-xs text-gray-500"
            data-testid="who-is-told-paged-owners"
          >
            {pagedOwnersLine}
          </p>
        ) : (
          <></>
        )}
      </ChainRow>
      {event.ownerRules.length > 0 ? (
        <ChainRow
          label={translator.translateText("Owner Rules") || "Owner Rules"}
          testId="who-is-told-owner-rules"
        >
          <span dir="auto">
            {namesText({
              items: event.ownerRules,
              hiddenName: hiddenRuleName,
              translator: translator,
            })}
          </span>
        </ChainRow>
      ) : (
        <></>
      )}
      {privateRow}
      {/*
       * Label rules run before on-call rules: named when a label one adds
       * changes which on-call rules page it (#7212).
       */}
      {event.labelRules && event.labelRules.length > 0 ? (
        <ChainRow
          label={translator.translateText("Label Rules") || "Label Rules"}
          testId="who-is-told-label-rules"
        >
          <span dir="auto">
            {namesText({
              items: event.labelRules,
              hiddenName: hiddenRuleName,
              translator: translator,
            })}
          </span>
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateText(LABEL_RULES_NOTE)}
          </p>
        </ChainRow>
      ) : (
        <></>
      )}
      <ChainRow
        label={translator.translateText("On-call rules") || "On-call rules"}
        testId="who-is-told-rules"
      >
        <>
          {event.rules.length > 0
            ? namesText({
                items: event.rules,
                hiddenName: hiddenRuleName,
                translator: translator,
              })
            : translator.translateText("None match") || ""}
          {/*
           * An Alert Owner rule matches on who owns the alert (#9407):
           * which owner made it match, a line each, as the label rules'
           * note says why theirs did.
           */}
          {(event.ownerMatches || []).map(
            (match: WhoIsToldOwnerMatch): ReactElement => {
              return (
                <IsolatedLine
                  key={`owner-match-${match.ruleId}`}
                  as="p"
                  text={getOwnerMatchSentence({
                    match: match,
                    rules: event.rules,
                    translator: translator,
                  })}
                  className="mt-0.5 text-xs text-gray-500"
                  dataTestId="who-is-told-owner-match"
                />
              );
            },
          )}
        </>
      </ChainRow>
      <ChainRow label={policyLabel}>
        {event.policies.length > 0 ? (
          <div className="space-y-2">
            {event.policies.map((policy: WhoIsToldPolicy): ReactElement => {
              return <PolicyBlock key={policy.id} policy={policy} />;
            })}
          </div>
        ) : (
          <span className="text-amber-700">
            {translator.translateText("None: nobody is paged")}
          </span>
        )}
      </ChainRow>
      {event.statusPages.length > 0 ? (
        <ChainRow
          label={translator.translateText("Status pages") || ""}
          testId="who-is-told-status-pages"
        >
          {/*
           * One wrapping line, each page with the group it shows the
           * monitor through named after it (#7214).
           */}
          <IsolatedLine
            as="span"
            text={formatList(
              event.statusPages.map((page: WhoIsToldStatusPage): string => {
                return getStatusPageText(page, translator);
              }),
              translator,
            )}
          />
        </ChainRow>
      ) : event.isPrivateOffStatusPages ? (
        <ChainRow
          label={translator.translateText("Status pages") || ""}
          testId="who-is-told-status-pages"
        >
          <span className="text-gray-600">
            {translator.translateText(PRIVATE_WORDS.offStatusPages)}
          </span>
        </ChainRow>
      ) : (
        <></>
      )}
      {/*
       * The incident an alert incident rule declares from it (#7216), told
       * as any incident is, under the alert.
       */}
      {event.declares ? (
        <div data-testid="who-is-told-declares">
          <ChainRow
            label={translator.translateText("Incident Rule") || "Incident Rule"}
          >
            <IsolatedLine
              as="p"
              text={getDeclaresSentence(event.declares, translator)}
              dataTestId="who-is-told-declares-sentence"
            />
          </ChainRow>
          <div className="ms-3 border-s-2 border-gray-100 ps-3">
            <EventBlock
              event={event.declares.incident}
              isFirstPolicyLabel={false}
            />
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const Chain: FunctionComponent<{ result: WhoIsToldResult }> = (props: {
  result: WhoIsToldResult;
}): ReactElement => {
  const translator: Translator = useTranslator();
  let isFirstPolicyLabel: boolean = true;

  return (
    <ol className={CHAIN_CLASS_NAME} data-testid="who-is-told-chain">
      {props.result.criteria.map((item: WhoIsToldCriteria): ReactElement => {
        return (
          <li
            key={item.id || item.name}
            className="rounded-lg border border-gray-200 px-3 py-2"
            data-testid="who-is-told-criteria"
          >
            <p className="text-sm font-semibold text-gray-900" dir="auto">
              {translator.translateTemplate("When {{criteria}} matches", {
                criteria: item.name,
              })}
            </p>
            {item.statusName ? (
              <ChainRow label={translator.translateText("Status") || "Status"}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.statusColor || "#9ca3af" }}
                  />
                  {/*
                   * By its list: the default "Offline" in the reader's
                   * words, a status the project named itself as written.
                   */}
                  <span dir="auto">
                    {translateRecordName(
                      translator,
                      StateListType.MonitorStatus,
                      item.statusName,
                    )}
                  </span>
                </span>
              </ChainRow>
            ) : (
              <></>
            )}
            {item.events.map(
              (event: WhoIsToldEvent, index: number): ReactElement => {
                // The word is marked where the reader first meets it.
                const isFirst: boolean = isFirstPolicyLabel;
                isFirstPolicyLabel = false;
                return (
                  <EventBlock
                    key={`${event.kind}-${index}`}
                    event={event}
                    isFirstPolicyLabel={isFirst}
                  />
                );
              },
            )}
          </li>
        );
      })}
    </ol>
  );
};

const BreakLine: FunctionComponent<{
  brk: WhoIsToldBreak;
  context: FixContext;
}> = (props: { brk: WhoIsToldBreak; context: FixContext }): ReactElement => {
  const translator: Translator = useTranslator();
  const fix: WhoIsToldFixLink | null = getFixLink({
    brk: props.brk,
    monitorId: props.context.monitorId,
    translator: translator,
  });
  const isServer: boolean = props.brk.fix === WhoIsToldFix.ServerSettings;

  const onOpen: () => void = (): void => {
    props.context.onOpen({ kind: props.brk.kind, fix: props.brk.fix });
  };

  return (
    <li
      className="flex items-start gap-2 py-2"
      data-testid="who-is-told-break"
      data-kind={props.brk.kind}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
      />
      <div className="min-w-0">
        <p className="text-sm text-gray-900">
          {getBreakSentence(props.brk, translator)}
        </p>
        {fix ? (
          <Link
            to={fix.route}
            className={FIX_LINK_CLASS_NAME}
            dataTestId="who-is-told-fix"
            openInNewTab={props.context.opensInNewTab}
            onClick={onOpen}
          >
            {fix.text}
          </Link>
        ) : (
          <></>
        )}
        {isServer && User.isMasterAdmin() ? (
          <Link
            to={URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
              ADMIN_EMAIL_SETTINGS_ROUTE,
            )}
            openInNewTab={true}
            className={FIX_LINK_CLASS_NAME}
            dataTestId="who-is-told-fix"
            onClick={onOpen}
          >
            {translator.translateText(ADMIN_DASHBOARD_FIX_WORDS)}
          </Link>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

/*
 * AN OWNER NO CREATED EMAIL REACHES (#7572): why, where they are named, and
 * the page that puts it right. Not a break - the email still goes out, to
 * the owners it reaches or to the Project Owners - so it is said after the
 * breaks, each once however many criteria name them.
 */
const OwnerNotEmailedLine: FunctionComponent<{
  item: WhoIsToldOwnerNotEmailed;
  context: FixContext;
}> = (props: {
  item: WhoIsToldOwnerNotEmailed;
  context: FixContext;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [why, where] = getOwnerNotEmailedSentences(props.item, translator);
  const fix: WhoIsToldOwnerFixLink | null = getOwnerNotEmailedFixLink({
    item: props.item,
    monitorId: props.context.monitorId,
    translator: translator,
  });

  return (
    <li
      className="flex items-start gap-2 py-2"
      data-testid="who-is-told-owner-not-emailed"
      data-problem={props.item.owner.problem}
      data-added-by={props.item.owner.addedBy}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
      />
      <div className="min-w-0">
        <IsolatedLine
          as="p"
          text={why || ""}
          className="text-sm text-gray-900"
        />
        <IsolatedLine
          as="p"
          text={where || ""}
          className="text-xs text-gray-500"
        />
        {fix ? (
          <Link
            to={fix.route}
            className={FIX_LINK_CLASS_NAME}
            dataTestId="who-is-told-owner-fix"
            openInNewTab={props.context.opensInNewTab}
            onClick={() => {
              props.context.onOpen({
                kind: "owner_not_emailed",
                fix: fix.fix,
              });
            }}
          >
            {fix.text}
          </Link>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

// The kinds of break a chain names, each once, for the analytics (#7079).
function getBreakKinds(breaks: ReadonlyArray<WhoIsToldBreak>): string {
  const kinds: Array<WhoIsToldBreakKind> = [];

  for (const brk of breaks) {
    if (!kinds.includes(brk.kind)) {
      kinds.push(brk.kind);
    }
  }

  return kinds.join(".");
}

const MonitorWhoIsToldCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isChainOpen, setIsChainOpen] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  // A changed draft being read: the last answer stays, marked busy.
  const [isReadingDraft, setIsReadingDraft] = useState<boolean>(false);
  /*
   * Changes when a fire drill starts, its dialog closes or the card is
   * checked again: the Last fire drill line reads the drill again (#9386).
   */
  const [fireDrillReads, setFireDrillReads] = useState<number>(0);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  // Whether a draft has been read: its first read waits for nothing.
  const hasReadDraftRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const monitorIdText: string = props.monitorId?.toString() || "";
  const place: WhoIsToldPlace = props.place || WhoIsToldPlace.MonitorOverview;
  const variant: WhoIsToldCardVariant =
    props.variant || WhoIsToldCardVariant.Card;
  const isCard: boolean = variant === WhoIsToldCardVariant.Card;
  const titleId: string = useId();

  /*
   * The draft as the server reads it, so a change of anything the answer
   * depends on - and nothing else - reads it again.
   */
  const draftKey: string = props.draft
    ? JSON.stringify(getWhoIsToldDraftBody(props.draft))
    : "";
  const draftRef: React.MutableRefObject<WhoIsToldDraftInput | undefined> =
    useRef<WhoIsToldDraftInput | undefined>(props.draft);
  draftRef.current = props.draft;

  /*
   * Read the answer. keepsAnswer: a Recheck, which keeps the answer on the
   * card when it fails and says why under it (#7308); anything else that
   * fails says so in place of the answer, with Try again.
   */
  const load: (options: {
    refresh: boolean;
    keepsAnswer: boolean;
  }) => Promise<void> = useCallback(
    async (options: { refresh: boolean; keepsAnswer: boolean }) => {
      const request: number = ++requestRef.current;

      try {
        const draft: WhoIsToldDraftInput | undefined = draftRef.current;
        const result: WhoIsToldResult = draft
          ? await WhoIsToldApi.getForDraft({ draft: draft })
          : await WhoIsToldApi.getForMonitor({
              monitorId: new ObjectID(monitorIdText),
              refresh: options.refresh,
            });

        if (request === requestRef.current) {
          setState({ status: "loaded", result: result });
        }
      } catch (err) {
        if (request !== requestRef.current) {
          return;
        }

        const message: string =
          err instanceof Error ? err.message : String(err);

        setState((current: LoadState): LoadState => {
          if (options.keepsAnswer && current.status === "loaded") {
            return {
              status: "loaded",
              result: current.result,
              recheckError: message,
            };
          }

          return { status: "error", message: message };
        });
      }
    },
    [monitorIdText],
  );

  // A saved monitor: read now, and again when it changes.
  useEffect(() => {
    if (draftRef.current) {
      return;
    }

    // What a Recheck said is about the monitor as it was.
    setState((current: LoadState): LoadState => {
      return current.status === "loaded" && current.recheckError
        ? { status: "loaded", result: current.result }
        : current;
    });
    void load({ refresh: false, keepsAnswer: false });
  }, [load, props.refreshToken]);

  /*
   * A draft: read a moment after it last changed, keeping the last answer
   * on the card meanwhile. Its first read shows the card loading.
   */
  useEffect(() => {
    if (!draftKey) {
      return;
    }

    let isActive: boolean = true;
    const wait: number = hasReadDraftRef.current
      ? WHO_IS_TOLD_DRAFT_WAIT_IN_MS
      : 0;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      hasReadDraftRef.current = true;
      setIsReadingDraft(true);
      void load({ refresh: false, keepsAnswer: false }).finally(() => {
        if (isActive) {
          setIsReadingDraft(false);
        }
      });
    }, wait);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [load, draftKey]);

  const readFireDrillAgain: () => void = (): void => {
    setFireDrillReads((count: number): number => {
      return count + 1;
    });
  };

  const recheck: () => Promise<void> = async (): Promise<void> => {
    setIsRechecking(true);
    readFireDrillAgain();
    await load({ refresh: true, keepsAnswer: true });
    setIsRechecking(false);
  };

  // After a failed read: read it again, looking as it does while it loads.
  const tryAgain: () => void = (): void => {
    setState({ status: "loading" });
    void load({ refresh: false, keepsAnswer: false });
  };

  const fixContext: FixContext = {
    monitorId: props.draft
      ? props.draft.monitorId || null
      : props.monitorId || null,
    opensInNewTab: Boolean(props.draft) || !isCard,
    onOpen: (data: { kind: string; fix: string }): void => {
      ProductEvents.send(ProductEventName.WhoIsToldFixOpened, {
        place: place,
        kind: data.kind,
        fix: data.fix,
      });
    },
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (state.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText("Loading who is told")}
          className="space-y-2 animate-pulse"
          data-testid="who-is-told-loading"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    /*
     * What failed, and the one thing to do about it here: read it again. An
     * error nobody explained (a gateway's 502, a server failure with its
     * reference) says why and what to do next in the reader's language, the
     * reference with its copy button (#7307).
     */
    if (state.status === "error") {
      return (
        <div>
          <p className="text-sm text-gray-600" data-testid="who-is-told-error">
            <ErrorSentence
              template="Couldn't work out who is told. {{error}}"
              error={state.message}
            />
          </p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-indigo-700 hover:underline"
            data-testid="who-is-told-try-again"
            onClick={() => {
              tryAgain();
            }}
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      );
    }

    const result: WhoIsToldResult = state.result;
    const summary: string = getWhoIsToldSummary(result, translator);
    const ownersNotEmailed: Array<WhoIsToldOwnerNotEmailed> =
      getOwnersNotEmailed(result);

    return (
      <div
        aria-busy={isReadingDraft}
        className={isReadingDraft ? "opacity-60 transition-opacity" : ""}
      >
        {summary ? (
          <p
            className="text-sm text-gray-900"
            data-testid="who-is-told-summary"
          >
            {summary}
          </p>
        ) : (
          <></>
        )}

        {result.breaks.length > 0 ? (
          <ul
            className="mt-2 divide-y divide-gray-100"
            aria-label={translator.translateText(
              "What stops people being told",
            )}
          >
            {result.breaks.map(
              (brk: WhoIsToldBreak, index: number): ReactElement => {
                return (
                  <BreakLine
                    key={`${brk.kind}-${index}`}
                    brk={brk}
                    context={fixContext}
                  />
                );
              },
            )}
          </ul>
        ) : (
          // A div: the Icon draws a div of its own, which a <p> can't hold.
          <div
            className="mt-2 flex items-center gap-2 text-sm text-emerald-700"
            data-testid="who-is-told-no-breaks"
          >
            <Icon icon={IconProp.CheckCircle} className="h-4 w-4 shrink-0" />
            <span>{translator.translateText("Nothing stops the chain.")}</span>
          </div>
        )}

        {ownersNotEmailed.length > 0 ? (
          <ul
            className="mt-2 divide-y divide-gray-100 border-t border-gray-100"
            aria-label={translator.translateText(
              OWNER_NOT_EMAILED_WORDS.listLabel,
            )}
            data-testid="who-is-told-owners-not-emailed"
          >
            {ownersNotEmailed.map(
              (item: WhoIsToldOwnerNotEmailed, index: number): ReactElement => {
                return (
                  <OwnerNotEmailedLine
                    key={`${item.owner.kind}-${item.owner.id}-${index}`}
                    item={item}
                    context={fixContext}
                  />
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {result.criteria.length > 0 ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline"
              aria-expanded={isChainOpen}
              data-testid="who-is-told-chain-toggle"
              onClick={() => {
                if (!isChainOpen) {
                  const event: JSONObject = {
                    place: place,
                    break_count: result.breaks.length,
                    break_kinds: getBreakKinds(result.breaks),
                    owners_not_emailed_count: ownersNotEmailed.length,
                  };
                  ProductEvents.send(
                    ProductEventName.WhoIsToldChainOpened,
                    event,
                  );
                }

                setIsChainOpen(!isChainOpen);
              }}
            >
              <Icon
                icon={
                  isChainOpen ? IconProp.ChevronDown : IconProp.ChevronRight
                }
                className="h-4 w-4"
              />
              {isChainOpen
                ? translator.translateText("Hide the chain")
                : translator.translateText("Show the chain")}
            </button>
            {isChainOpen ? <Chain result={result} /> : <></>}
          </div>
        ) : (
          <></>
        )}

        {!isCard ? (
          <></>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
            <span>
              <TranslatedSentence
                template="Checked {{time}}"
                slots={{
                  time: (
                    <RelativeTime
                      date={OneUptimeDate.fromString(result.checkedAt)}
                    />
                  ),
                }}
              />
            </span>
            <button
              type="button"
              className={`font-medium text-indigo-700 ${getHandDrawnButtonStateClassName(
                {
                  isBusy: isRechecking,
                  hoverClassName: "hover:underline",
                },
              )}`}
              disabled={isRechecking}
              aria-busy={isRechecking}
              data-testid="who-is-told-recheck"
              onClick={() => {
                void recheck();
              }}
            >
              {isRechecking
                ? translator.translateText("Checking...")
                : translator.translateText("Recheck")}
            </button>
          </div>
        )}

        {/*
         * A Recheck that failed (#7308): the answer above is the last one
         * that worked, as Checked says, and why checking again failed is
         * said under it until a read works or the monitor changes.
         */}
        {state.recheckError ? (
          <p
            className="mt-2 text-xs text-gray-600"
            role="status"
            data-testid="who-is-told-recheck-error"
          >
            <ErrorSentence
              template="Couldn't check again. {{error}}"
              error={state.recheckError}
            />
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  if (variant === WhoIsToldCardVariant.Plain) {
    return <div data-testid="monitor-who-is-told-card">{getBody()}</div>;
  }

  // In a form or a step: its title over it, in a box of its own.
  if (variant === WhoIsToldCardVariant.Section) {
    return (
      <section
        className="rounded-lg border border-gray-200 p-4"
        aria-labelledby={titleId}
        data-testid="monitor-who-is-told-card"
      >
        <h3 id={titleId} className="text-sm font-semibold text-gray-900">
          {translator.translateText("When this goes down")}
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          {translator.translateText(
            "Who is told when this monitor fails, and what would stop it.",
          )}
        </p>
        {getBody()}
      </section>
    );
  }

  return (
    <Card
      title="When this goes down"
      description="Who is told when this monitor fails, and what would stop it."
      headerLayout="stacked"
      /*
       * Run Fire Drill (#7012): rehearse a failure the card says pages an
       * on-call policy, as a test of each policy it pages - of a saved
       * monitor only: a drill reads the monitor as it is saved, never a
       * draft the card is showing (#7055).
       */
      buttons={
        !props.draft &&
        monitorIdText &&
        state.status === "loaded" &&
        hasOnCallFireDrill(state.result)
          ? [
              <FireDrillButton
                key="fire-drill"
                monitorId={monitorIdText}
                onStarted={readFireDrillAgain}
                onClosed={readFireDrillAgain}
              />,
            ]
          : undefined
      }
    >
      <div data-testid="monitor-who-is-told-card">
        {getBody()}
        {/*
         * Its last fire drill (#9386), once the card's answer is in: at the
         * card's end, so nothing above moves when it comes. Of a saved
         * monitor only, as Run Fire Drill is.
         */}
        {!props.draft && monitorIdText && state.status === "loaded" ? (
          <LastFireDrill
            monitorId={monitorIdText}
            refreshToken={`${props.refreshToken ?? ""}|${fireDrillReads}`}
          />
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default MonitorWhoIsToldCard;
