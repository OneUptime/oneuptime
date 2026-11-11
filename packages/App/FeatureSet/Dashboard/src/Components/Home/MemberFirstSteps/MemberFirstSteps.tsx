import {
  MEMBER_FIRST_STEPS_COPY,
  MemberFirstSteps as MemberFirstStepsData,
  MemberStep,
  MemberStepTile,
  buildMemberFirstSteps,
} from "./MemberFirstStepsModel";
import { WELCOME_CHECKLIST_COPY } from "../WelcomeChecklist/WelcomeChecklistCatalog";
import CalendarFeedAPI from "../../OnCallPolicy/CalendarFeed/CalendarFeedAPI";
import { MyShiftsResponse } from "../../OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  UpcomingShiftsWindow,
  getUpcomingShiftsWindow,
} from "../../OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import {
  UpcomingShiftSpan,
  buildUpcomingShiftSpans,
} from "../../OnCallPolicy/CalendarFeed/UpcomingShiftSpans";
import SendTestPageModal from "../../OnCallTestPage/SendTestPageModal";
import useSetupChecklist, {
  SetupChecklistState,
} from "../../UserSettings/SetupChecklist/useSetupChecklist";
import {
  APP_STORE_NAME,
  GOOGLE_PLAY_NAME,
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../Utils/MobileAppStoreLinks";
import { getMobileAppServerUrl } from "../../../Utils/MobileAppServerUrl";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { WelcomeChecklistAnswer } from "Common/Types/WelcomeChecklist/WelcomeChecklistAnswer";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { FeedClock, getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import QR from "Common/UI/Components/QR/QR";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * AN INVITED MEMBER'S FIRST STEPS ON HOME (issue #6807): the Welcome card
 * for somebody who did not set the project up. The rules - what each tile
 * says, when it is done, when the card is done - are in
 * MemberFirstStepsModel; this draws them, with the owner's card's look
 * (GettingStarted): the same tiles, the same Hide and the same line left
 * behind to show it again.
 *
 * It reads what the person's own pages read, so it never disagrees with
 * them: the setup checklist (useSetupChecklist, as User Settings > Setup
 * Checklist), and their shifts (/on-call-calendar/my-shifts, as User
 * Settings > On-Call Calendar). Whether a test page has reached them, and
 * whether the server can send email, come with the Welcome answer.
 */

export const MEMBER_FIRST_STEPS_TEST_ID: string = "member-first-steps";

export interface ComponentProps {
  answer: WelcomeChecklistAnswer;
  projectId: ObjectID;
  className?: string | undefined;
  isSaving: boolean;
  error: string;
  onHide: () => void;
  onShow: () => void;
}

interface ShiftsRead {
  response: MyShiftsResponse;
  window: UpcomingShiftsWindow;
}

const MemberFirstStepsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const userId: ObjectID | null = useMemo((): ObjectID | null => {
    return UserUtil.getUserId();
  }, []);

  const checklistState: SetupChecklistState = useSetupChecklist({
    userId: userId,
    projectId: props.projectId,
  });

  const [shifts, setShifts] = useState<ShiftsRead | null>(null);
  const [isShiftsLoading, setIsShiftsLoading] = useState<boolean>(true);
  const [isTestPageOpen, setIsTestPageOpen] = useState<boolean>(false);
  const [isAcknowledgedHere, setIsAcknowledgedHere] = useState<boolean>(false);
  const [isMobileAppOpen, setIsMobileAppOpen] = useState<boolean>(false);

  const projectIdString: string = props.projectId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;
    const askedWindow: UpcomingShiftsWindow = getUpcomingShiftsWindow(
      OneUptimeDate.getCurrentDate(),
    );

    setIsShiftsLoading(true);

    CalendarFeedAPI.getMyShifts(askedWindow)
      .then((response: MyShiftsResponse): void => {
        if (isCurrent) {
          setShifts({ response: response, window: askedWindow });
        }
      })
      .catch((): void => {
        // No shifts read: the card draws no on-call tile, and claims nothing.
        if (isCurrent) {
          setShifts(null);
        }
      })
      .finally((): void => {
        if (isCurrent) {
          setIsShiftsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [projectIdString]);

  const now: Date = OneUptimeDate.getCurrentDate();

  const clock: FeedClock = getFeedClock({
    language: translator.language,
    now: now,
  });

  const spans: Array<UpcomingShiftSpan> | null = shifts
    ? buildUpcomingShiftSpans(shifts.response.shifts, now, shifts.window.to)
    : null;

  const steps: MemberFirstStepsData = buildMemberFirstSteps({
    checklist: checklistState.checklist,
    isChecklistLoading: checklistState.isLoading,
    spans: spans,
    isShiftsLoading: isShiftsLoading,
    canSendEmail: props.answer.canSendEmail,
    hasAcknowledgedTestPage:
      props.answer.hasAcknowledgedTestPage || isAcknowledgedHere,
    clock: clock,
  });

  /*
   * Gone once a test page had reached the person when Home opened, and
   * nothing is left: an outcome, as the owner's card ends on its outcomes.
   * A test acknowledged in this visit ticks its tile and leaves the card
   * up, so its dialog is not taken away under the reader. Nothing is
   * drawn while that is still being worked out, so a finished card never
   * shows for a moment and goes.
   */
  if (props.answer.hasAcknowledgedTestPage) {
    if (steps.isSettling) {
      return <></>;
    }

    if (steps.isFinished) {
      return <></>;
    }
  }

  const openStep: (tile: MemberStepTile) => void = (
    tile: MemberStepTile,
  ): void => {
    ProductEvents.send(ProductEventName.MemberStepStarted, {
      step: tile.step,
    });

    if (tile.step === MemberStep.TestPage) {
      setIsTestPageOpen(true);
      return;
    }

    if (tile.step === MemberStep.MobileApp) {
      setIsMobileAppOpen(!isMobileAppOpen);
      return;
    }

    if (tile.pageMap) {
      Navigation.navigate(
        RouteUtil.populateRouteParams(RouteMap[tile.pageMap] as Route),
      );
    }
  };

  const hide: () => void = (): void => {
    ProductEvents.send(ProductEventName.MemberStepsDismissed, {
      open_count: steps.openCount,
    });
    props.onHide();
  };

  const isClickable: (tile: MemberStepTile) => boolean = (
    tile: MemberStepTile,
  ): boolean => {
    if (tile.isLoading) {
      return false;
    }

    if (tile.isDone) {
      return false;
    }

    return (
      Boolean(tile.pageMap) ||
      tile.step === MemberStep.TestPage ||
      tile.step === MemberStep.MobileApp
    );
  };

  const drawTile: (tile: MemberStepTile) => ReactElement = (
    tile: MemberStepTile,
  ): ReactElement => {
    const isComplete: boolean = tile.isDone;
    const clickable: boolean = isClickable(tile);

    // Spans, not divs: a button may only hold phrasing content.
    const content: ReactElement = (
      <>
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
            isComplete ? "bg-emerald-100" : tile.iconBackgroundClassName
          }`}
        >
          <Icon
            icon={isComplete ? IconProp.Check : tile.icon}
            className={`h-5 w-5 ${isComplete ? "text-emerald-600" : "text-white"}`}
          />
        </span>
        <span className="block min-w-0 flex-1">
          {tile.isLoading ? (
            <span
              className="block space-y-2 pt-1"
              data-testid={`member-first-steps-${tile.step}-loading`}
            >
              <span className="block h-3 w-2/3 animate-pulse rounded bg-gray-200" />
              <span className="block h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </span>
          ) : (
            <>
              <span
                className={`flex flex-wrap items-center gap-2 text-sm font-medium ${
                  isComplete ? "text-gray-500" : "text-gray-900"
                }`}
              >
                <span data-testid={`member-first-steps-${tile.step}-title`}>
                  {translator.translateTemplate(
                    tile.title,
                    tile.titleValues || {},
                  )}
                </span>
                {tile.isNext ? (
                  <span
                    data-testid="member-first-steps-next"
                    className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700"
                  >
                    {translator.translateText(WELCOME_CHECKLIST_COPY.nextBadge)}
                  </span>
                ) : (
                  <></>
                )}
              </span>
              {tile.description ? (
                <span
                  className="mt-1 block text-sm text-gray-500"
                  data-testid={`member-first-steps-${tile.step}-description`}
                >
                  {translator.translateTemplate(
                    tile.description,
                    tile.descriptionValues || {},
                  )}
                </span>
              ) : (
                <></>
              )}
              {tile.countLine ? (
                <span
                  className="mt-1 block text-xs font-medium text-indigo-700"
                  data-testid={`member-first-steps-${tile.step}-count`}
                >
                  {translator.translatePlural(
                    tile.countLine.template,
                    tile.countLine.count,
                  )}
                </span>
              ) : (
                <></>
              )}
            </>
          )}
        </span>
        {isComplete ? (
          <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-emerald-600">
            {translator.translateText(WELCOME_CHECKLIST_COPY.done)}
          </span>
        ) : clickable ? (
          /*
           * Grey at rest, indigo on hover - on two elements, as on the
           * owner's card: the dark theme paints a hovered group child that
           * carries a text-gray-* class near-white.
           */
          <span className="mt-0.5 flex-shrink-0 text-gray-400">
            <Icon
              icon={
                tile.step === MemberStep.MobileApp
                  ? isMobileAppOpen
                    ? IconProp.ChevronUp
                    : IconProp.ChevronDown
                  : IconProp.ChevronRight
              }
              className="h-5 w-5 transition group-hover:text-indigo-500"
            />
          </span>
        ) : (
          <></>
        )}
      </>
    );

    if (!clickable) {
      return (
        <div
          key={tile.step}
          data-testid={`member-first-steps-${tile.step}`}
          data-done={isComplete ? "true" : "false"}
          className={`group flex items-start gap-4 rounded-lg border border-gray-200 p-4 ${
            isComplete ? "bg-gray-50" : "bg-white"
          }`}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        key={tile.step}
        type="button"
        onClick={() => {
          openStep(tile);
        }}
        data-testid={`member-first-steps-${tile.step}`}
        data-done="false"
        data-next={tile.isNext ? "true" : "false"}
        aria-expanded={
          tile.step === MemberStep.MobileApp ? isMobileAppOpen : undefined
        }
        className={`group flex w-full items-start gap-4 rounded-lg border bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          tile.isNext ? "border-indigo-300 ring-1 ring-indigo-200" : "border-gray-200"
        }`}
      >
        {content}
      </button>
    );
  };

  const storeCode: (data: { name: string; url: string }) => ReactElement = (data: {
    name: string;
    url: string;
  }): ReactElement => {
    return (
      <div className="flex flex-col items-center gap-2">
        {/* A code is for a phone held up to a big screen, not for a phone. */}
        <div className="hidden h-28 w-28 sm:block">
          <QR text={data.url} alt={data.name} />
        </div>
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-500"
        >
          {data.name}
        </a>
      </div>
    );
  };

  return (
    <Card
      className={props.className}
      title={MEMBER_FIRST_STEPS_COPY.title}
      description={MEMBER_FIRST_STEPS_COPY.description}
      rightElement={
        <Button
          title={WELCOME_CHECKLIST_COPY.hideButton}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          disabled={props.isSaving}
          onClick={hide}
          dataTestId="member-first-steps-hide"
        />
      }
    >
      <div data-testid={MEMBER_FIRST_STEPS_TEST_ID}>
        {props.error ? (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {translator.translateText(props.error)}
          </p>
        ) : (
          <></>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {steps.tiles.map(drawTile)}
        </div>
        {isMobileAppOpen ? (
          <div
            data-testid="member-first-steps-mobile-app-panel"
            className="mt-3 flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center"
          >
            <div className="flex flex-shrink-0 justify-center gap-6">
              {storeCode({ name: APP_STORE_NAME, url: MOBILE_APP_IOS_URL })}
              {storeCode({
                name: GOOGLE_PLAY_NAME,
                url: MOBILE_APP_ANDROID_URL,
              })}
            </div>
            <p className="min-w-0 text-sm leading-6 text-gray-700">
              <TranslatedSentence
                template={MEMBER_FIRST_STEPS_COPY.mobileAppInstall}
                slots={{
                  serverUrl: (
                    <code
                      className="break-all rounded bg-white px-1 py-0.5 font-mono text-[0.8125rem] font-medium text-gray-900"
                      data-testid="member-first-steps-server-url"
                      dir="ltr"
                    >
                      {getMobileAppServerUrl()}
                    </code>
                  ),
                }}
              />
            </p>
          </div>
        ) : (
          <></>
        )}
      </div>
      {isTestPageOpen ? (
        <SendTestPageModal
          target={{ kind: "self" }}
          onClose={() => {
            setIsTestPageOpen(false);
          }}
          onResult={(result: OnCallTestPageResult) => {
            if (result.status === OnCallTestPageStatus.Acknowledged) {
              setIsAcknowledgedHere(true);
            }
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

const MemberFirstSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Hidden by this person: a line to show it again, and nothing is read.
  if (props.answer.isHiddenForMe) {
    return (
      <div className={props.className} data-testid="member-first-steps-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>{translator.translateText(MEMBER_FIRST_STEPS_COPY.hiddenLine)}</span>
          <Button
            title={WELCOME_CHECKLIST_COPY.showButton}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            disabled={props.isSaving}
            onClick={props.onShow}
            dataTestId="member-first-steps-show"
          />
          {props.error ? (
            <span role="alert" className="text-red-600">
              {translator.translateText(props.error)}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  }

  return <MemberFirstStepsCard {...props} />;
};

export default MemberFirstSteps;
