import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import SecurityPipeline from "./SecurityPipeline";
import {
  ATTENTION_LIST_LABEL,
  OVERVIEW_READ_FAILED_TITLE,
  SET_UP_SECURITY,
  SIEM_DESTINATIONS,
  STATUS_READ_FAILED,
  SecurityAttentionItem,
  SecurityHeadline,
  SecurityHeadlineAction,
  SecurityOverviewQueue,
  SecurityStatusTone,
  getSecurityHeadline,
  translateSecurityOverviewText,
} from "./SecurityOverviewStatusModel";
import { SETUP_TEST_FAILED_TITLE } from "./SecurityGettingStarted";
import { SecuritySetupStatus } from "./SecuritySetupModel";
import {
  SecuritySetupTestButton,
  SecuritySetupTestResultLine,
  SecuritySetupTestState,
  useSecuritySetupTest,
} from "./SecuritySetupTest";
import SecurityTurnOnProblems from "./SecurityTurnOnProblems";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_OVERVIEW_STATUS_ID: string = "security-overview-status";
export const SECURITY_STATUS_HEADLINE_ID: string = "security-status-headline";

interface ToneClassNames {
  // The band behind the headline.
  band: string;
  // The disc behind its icon, and the icon's colour.
  disc: string;
}

/*
 * Home's tones (ProjectHealthCard): a tinted band and a solid disc with a
 * white icon; the grey of "nothing watched yet" is a soft disc, since a
 * grey fill has no colour of its own in the dark theme.
 */
const TONE_CLASS_NAMES: Record<SecurityStatusTone, ToneClassNames> = {
  [SecurityStatusTone.Danger]: {
    band: "bg-red-50",
    disc: "bg-red-600 text-white",
  },
  [SecurityStatusTone.Warning]: {
    band: "bg-amber-50",
    disc: "bg-amber-500 text-white",
  },
  [SecurityStatusTone.Info]: {
    band: "bg-indigo-50",
    disc: "bg-indigo-600 text-white",
  },
  [SecurityStatusTone.Success]: {
    band: "bg-emerald-50",
    disc: "bg-emerald-500 text-white",
  },
  [SecurityStatusTone.Neutral]: {
    band: "bg-gray-50",
    disc: "bg-gray-200 text-gray-600",
  },
};

const ATTENTION_ICON_CLASS_NAMES: Record<SecurityStatusTone, string> = {
  [SecurityStatusTone.Danger]: "text-red-600",
  [SecurityStatusTone.Warning]: "text-amber-600",
  [SecurityStatusTone.Info]: "text-indigo-600",
  [SecurityStatusTone.Success]: "text-emerald-600",
  [SecurityStatusTone.Neutral]: "text-gray-500",
};

function route(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

/*
 * One thing that waits for a person: its count and what it counts, as a
 * link to the page that lists exactly those - Assigned to Me, Unassigned,
 * Waiting for Approval. The words agree with the number ("1 open case").
 * A short list, one line each, read like a to-do list under its heading.
 */
const AttentionLink: FunctionComponent<{
  item: SecurityAttentionItem;
}> = (props: { item: SecurityAttentionItem }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li data-testid={`security-attention-${props.item.key}`}>
      <AppLink
        to={route(props.item.page)}
        className="group inline-flex max-w-full items-start gap-2 rounded text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <>
          <Icon
            icon={props.item.icon}
            className={`mt-0.5 h-4 w-4 flex-none ${ATTENTION_ICON_CLASS_NAMES[props.item.tone]}`}
          />
          {/* Pretty: a label that wraps never leaves "up" alone on its last line. */}
          <span className="min-w-0 text-pretty text-gray-700 group-hover:underline">
            <span className="font-semibold tabular-nums text-gray-900">
              {translator.formatNumber(props.item.count)}
            </span>{" "}
            {translator.translatePlural(props.item.label, props.item.count)}
          </span>
          {/* Forward in the reading direction: left in a right-to-left page. */}
          <Icon
            icon={IconProp.ChevronRight}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400 rtl:rotate-180"
          />
        </>
      </AppLink>
    </li>
  );
};

export interface ComponentProps {
  queue: SecurityOverviewQueue;
  // How Security is set up; null when it could not be read.
  status: SecuritySetupStatus | null;
  /*
   * Draw the pipeline under the band. Off while Get started is on the page:
   * the card's steps tell the same story.
   */
  showPipeline: boolean;
  // The set-up figures could not be read: the pipeline's place says so.
  hasStatusFailed: boolean;
  // A read is in flight (Try again spins).
  isReading: boolean;
  // What "Last event 3 days ago" counts from.
  now: Date;
  // After the test attack opened a case: the page reads its figures again.
  onChanged: () => void;
  // Try again, after the set-up figures could not be read.
  onTryAgain: () => void;
  // Set up Security: Get started again, after it was put away.
  onSetUp: () => void;
}

/*
 * THE TOP OF THE SECURITY OVERVIEW, in one card, drawn the way Home draws
 * the top of a project.
 *
 * The band says first what the reader should know: what waits for a person
 * (each count a link to the page that lists it), that every open case is
 * picked up, that nothing is being watched for threats yet (with Set up Security),
 * or that all is quiet (with Send a test attack, for whoever wants to see a
 * case open). Under it, the pipeline: sources, detections, cases and
 * playbooks, each with its figure and how it is doing. A SIEM the events go
 * to is named at the card's foot.
 *
 * The test attack's state lives here, not in the band's quiet branch: the
 * case it opens turns the band to Needs attention, and the line that links
 * to that case stays.
 */
const SecurityOverviewStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const test: SecuritySetupTestState = useSecuritySetupTest(props.onChanged);
  const headline: SecurityHeadline = getSecurityHeadline({
    queue: props.queue,
    status: props.status,
    now: props.now,
  });
  const tone: ToneClassNames = TONE_CLASS_NAMES[headline.tone];
  const titleId: string = `${SECURITY_OVERVIEW_STATUS_ID}-title`;

  return (
    <section
      id={SECURITY_OVERVIEW_STATUS_ID}
      data-testid={SECURITY_OVERVIEW_STATUS_ID}
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      {/*
       * Padded as the cells under it are - 20px from sm up, 16px across on
       * a phone, where two cells share the width: the disc lines up with
       * their names, and with the figures' card below.
       */}
      <div
        data-testid={SECURITY_STATUS_HEADLINE_ID}
        data-kind={headline.kind}
        data-tone={headline.tone}
        className={`px-4 py-5 sm:px-5 ${tone.band}`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {/*
             * On a phone the band's colour says it; the words take the
             * width, as Get started's do.
             */}
            <span
              data-testid="security-status-disc"
              className={`flex h-11 w-11 flex-none items-center justify-center rounded-full max-sm:hidden ${tone.disc}`}
              aria-hidden="true"
            >
              <Icon icon={headline.icon} className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              {/*
               * Balanced, so a title that wraps never leaves its last word
               * alone on the second line ("... threats / yet").
               */}
              <h2
                id={titleId}
                className="text-balance text-lg font-semibold text-gray-900 sm:text-xl"
              >
                {translator.translateText(headline.title)}
              </h2>
              {headline.summary ? (
                <p
                  data-testid="security-status-summary"
                  className="mt-1 max-w-2xl text-balance text-sm text-gray-600"
                >
                  {translateSecurityOverviewText(translator, headline.summary)}
                </p>
              ) : (
                <></>
              )}
              {headline.items.length > 0 ? (
                <ul
                  className="mt-2 space-y-1.5"
                  aria-label={translator.translateText(ATTENTION_LIST_LABEL)}
                >
                  {headline.items.map(
                    (item: SecurityAttentionItem): ReactElement => {
                      return <AttentionLink key={item.key} item={item} />;
                    },
                  )}
                </ul>
              ) : (
                <></>
              )}
            </div>
          </div>
          {/*
           * Each action sits at the right edge, as a card's do: beside the
           * words from lg up, under them below that - beside the side menu
           * at md, a button beside the words squeezed them into a column of
           * their own, five lines deep. Buttons carry a left margin from md
           * up (Button's own); here they sit on the content's edge.
           */}
          {headline.action === SecurityHeadlineAction.TestAttack ? (
            <div className="flex-shrink-0 self-end lg:self-auto [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
              <SecuritySetupTestButton test={test} />
            </div>
          ) : (
            <></>
          )}
          {headline.action === SecurityHeadlineAction.SetUp ? (
            <div className="flex-shrink-0 self-end lg:self-auto [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
              <Button
                title={SET_UP_SECURITY}
                icon={IconProp.ShieldCheck}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="security-status-set-up"
                onClick={props.onSetUp}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
        {test.error ? (
          <div className="mt-4">
            <SecurityTurnOnProblems
              problems={[]}
              error={test.error}
              title={
                translator.translateText(SETUP_TEST_FAILED_TITLE) ||
                SETUP_TEST_FAILED_TITLE
              }
              dataTestId="security-setup-test-error"
            />
          </div>
        ) : (
          <></>
        )}
        {test.result ? (
          <div className="mt-4">
            <SecuritySetupTestResultLine result={test.result} />
          </div>
        ) : (
          <></>
        )}
      </div>

      {props.showPipeline && props.status ? (
        <SecurityPipeline
          status={props.status}
          queue={props.queue}
          now={props.now}
        />
      ) : (
        <></>
      )}

      {props.showPipeline && !props.status && props.hasStatusFailed ? (
        <div
          data-testid="security-pipeline-error"
          className="flex flex-col gap-3 border-t border-gray-200 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <Icon
              icon={IconProp.Error}
              className="mt-0.5 h-4 w-4 flex-none text-gray-400"
            />
            <span>{translator.translateText(STATUS_READ_FAILED)}</span>
          </div>
          <div className="flex-shrink-0 self-end md:self-auto [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
            <Button
              title="Try again"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={props.isReading}
              disabled={props.isReading}
              dataTestId="security-pipeline-try-again"
              onClick={props.onTryAgain}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      {props.showPipeline && props.status && props.status.destinations > 0 ? (
        <div
          className="flex items-center gap-1.5 border-t border-gray-200 px-4 py-2.5 text-xs text-gray-500 sm:px-5"
          data-testid="security-pipeline-destinations"
        >
          <Icon icon={IconProp.Share} className="h-3.5 w-3.5 flex-none" />
          <AppLink
            to={route(PageMap.SECURITY_EVENTS_CONNECTIONS)}
            className="hover:text-gray-700 hover:underline"
          >
            {translator.translatePlural(
              SIEM_DESTINATIONS,
              props.status.destinations,
            )}
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

/*
 * The Overview's cards stand a card's gap apart (20px), as the cards of its
 * rows do (CardGrid) and as Home's do - its loading shape too, so nothing
 * moves when the figures land.
 */
export const SECURITY_OVERVIEW_SPACING_CLASS_NAME: string = "space-y-5";

/*
 * The Overview while its first reads are in flight: the card's shape - the
 * band, the four cells - and a block for what follows, so nothing jumps
 * when the figures land.
 */
export const SecurityOverviewLoading: FunctionComponent = (): ReactElement => {
  return (
    <div
      className={SECURITY_OVERVIEW_SPACING_CLASS_NAME}
      aria-busy="true"
      data-testid="security-overview-loading"
    >
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-start gap-4 bg-gray-50 px-4 py-5 sm:px-5">
          <span className="h-11 w-11 flex-none animate-pulse rounded-full bg-gray-200 max-sm:hidden" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-gray-200 bg-gray-200 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index: number): ReactElement => {
            return (
              <div
                key={index}
                className="space-y-2.5 bg-white px-4 py-4 sm:px-5"
              >
                <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
                <div className="h-6 w-24 animate-pulse rounded bg-gray-100" />
                <div className="h-4 w-32 max-w-full animate-pulse rounded bg-gray-100" />
              </div>
            );
          })}
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
};

/*
 * The Overview could not be read at all: say so in the card's place, with
 * why (a role's or a plan's sentence, or the product's own for a failure on
 * OneUptime's side) and Try again.
 */
export const SecurityOverviewFailed: FunctionComponent<{
  // Why, from describeSetupCallFailure; a translation key or the server's sentence.
  message: string;
  isReading: boolean;
  onTryAgain: () => void;
}> = (props: {
  message: string;
  isReading: boolean;
  onTryAgain: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      data-testid="security-overview-error"
      role="alert"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-4 bg-gray-50 px-4 py-5 sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gray-200 text-gray-600 max-sm:hidden"
            aria-hidden="true"
          >
            <Icon icon={IconProp.Error} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-balance text-lg font-semibold text-gray-900 sm:text-xl">
              {translator.translateText(OVERVIEW_READ_FAILED_TITLE)}
            </h2>
            <p
              data-testid="security-overview-error-message"
              className="mt-1 max-w-2xl break-words text-sm text-gray-600"
            >
              {translator.translateText(props.message) || props.message}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 self-end md:self-auto [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
          <Button
            title="Try again"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.NORMAL}
            isLoading={props.isReading}
            disabled={props.isReading}
            dataTestId="security-overview-try-again"
            onClick={props.onTryAgain}
          />
        </div>
      </div>
    </section>
  );
};

export default SecurityOverviewStatus;
