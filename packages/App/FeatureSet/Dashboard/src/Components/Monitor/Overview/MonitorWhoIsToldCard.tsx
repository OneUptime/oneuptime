import { ADMIN_EMAIL_SETTINGS_ROUTE } from "../../../Utils/ServerEmail";
import RelativeTime from "../../EpisodeView/RelativeTime";
import {
  getNotPagedLines,
  getReachedThroughWords,
} from "../../OnCallTestPage/OnCallTestPageWords";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import WhoIsToldApi from "./WhoIsToldApi";
import {
  ADMIN_DASHBOARD_FIX_WORDS,
  WhoIsToldFixLink,
  getBreakSentence,
  getChannelName,
  getFixLink,
  getWhoIsToldSummary,
} from "./WhoIsToldWords";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WhoIsToldBreak,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwners,
  WhoIsToldPerson,
  WhoIsToldPolicy,
  WhoIsToldResult,
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
import {
  formatList,
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
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
 * "WHEN THIS GOES DOWN" (#6810): what happens when this monitor fails, and
 * who is told - in words first, with every break in the chain named and a
 * link to the page that puts it right. "Show the chain" opens it link by
 * link: each criteria, what it opens, its owners, the on-call rules and
 * policies it runs, and who each policy reaches right now, by what.
 *
 * One request (WhoIsToldApi), answered from a minute-old cache on the
 * server; Recheck works it out again.
 */

export interface ComponentProps {
  monitorId: ObjectID;
  // Changes when the monitor is edited or refreshed: read again then.
  refreshToken?: number | string | undefined;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: WhoIsToldResult };

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
          <span className="text-gray-600">
            {formatList(
              person.channels.map((channel: OnCallPageChannel): string => {
                return getChannelName(channel, translator);
              }),
              translator,
            )}
          </span>
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

  const policyLabel: ReactElement = props.isFirstPolicyLabel ? (
    <DefinedTerm term={GlossaryTerm.OnCallPolicy}>
      {translator.translateText("On-call policy")}
    </DefinedTerm>
  ) : (
    <>{translator.translateText("On-call policy")}</>
  );

  return (
    <div
      className="mt-1"
      data-testid="who-is-told-event"
      data-kind={event.kind}
    >
      <ChainRow label={translator.translateText("Opens") || "Opens"}>
        <span>
          {translator.translateTemplate(
            isAlert ? "A {{severity}} alert" : "A {{severity}} incident",
            { severity: event.severityName },
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
      <ChainRow label={translator.translateText("Emails") || "Emails"}>
        <span dir="auto">{ownersText(event.owners, translator)}</span>
      </ChainRow>
      {event.ownerRules.length > 0 ? (
        <ChainRow
          label={translator.translateText("Owner Rules") || "Owner Rules"}
          testId="who-is-told-owner-rules"
        >
          <span dir="auto">
            {namesText({
              items: event.ownerRules,
              hiddenName:
                translator.translateText("A rule you can't see") || "",
              translator: translator,
            })}
          </span>
        </ChainRow>
      ) : (
        <></>
      )}
      <ChainRow
        label={translator.translateText("On-call rules") || "On-call rules"}
        testId="who-is-told-rules"
      >
        {event.rules.length > 0
          ? namesText({
              items: event.rules,
              hiddenName:
                translator.translateText("A rule you can't see") || "",
              translator: translator,
            })
          : translator.translateText("None match") || ""}
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
          <span dir="auto">
            {namesText({
              items: event.statusPages,
              hiddenName:
                translator.translateText("A status page you can't see") || "",
              translator: translator,
            })}
          </span>
        </ChainRow>
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
                  <span dir="auto">{item.statusName}</span>
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
  monitorId: ObjectID;
}> = (props: { brk: WhoIsToldBreak; monitorId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();
  const fix: WhoIsToldFixLink | null = getFixLink({
    brk: props.brk,
    monitorId: props.monitorId,
    translator: translator,
  });
  const isServer: boolean = props.brk.fix === WhoIsToldFix.ServerSettings;

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
            className="text-sm font-medium text-indigo-700 hover:underline"
            dataTestId="who-is-told-fix"
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
            className="text-sm font-medium text-indigo-700 hover:underline"
            dataTestId="who-is-told-fix"
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

const MonitorWhoIsToldCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isChainOpen, setIsChainOpen] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  const monitorIdText: string = props.monitorId.toString();

  const load: (refresh: boolean) => Promise<void> = useCallback(
    async (refresh: boolean): Promise<void> => {
      const request: number = ++requestRef.current;

      try {
        const result: WhoIsToldResult = await WhoIsToldApi.getForMonitor({
          monitorId: new ObjectID(monitorIdText),
          refresh: refresh,
        });

        if (request === requestRef.current) {
          setState({ status: "loaded", result: result });
        }
      } catch (err) {
        if (request === requestRef.current) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [monitorIdText],
  );

  useEffect(() => {
    void load(false);
  }, [load, props.refreshToken]);

  const recheck: () => Promise<void> = async (): Promise<void> => {
    setIsRechecking(true);
    await load(true);
    setIsRechecking(false);
  };

  // After a failed read: read it again, looking as it does while it loads.
  const tryAgain: () => void = (): void => {
    setState({ status: "loading" });
    void load(false);
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

    return (
      <div>
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
                    monitorId={props.monitorId}
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

        {result.criteria.length > 0 ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline"
              aria-expanded={isChainOpen}
              data-testid="who-is-told-chain-toggle"
              onClick={() => {
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
      </div>
    );
  };

  return (
    <Card
      title="When this goes down"
      description="Who is told when this monitor fails, and what would stop it."
      headerLayout="stacked"
    >
      <div data-testid="monitor-who-is-told-card">{getBody()}</div>
    </Card>
  );
};

export default MonitorWhoIsToldCard;
