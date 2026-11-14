import AppLink from "../AppLink/AppLink";
import { getSetupHealthRouteFromHome } from "../Home/NeedsAttention";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import FeedbackWhereItGoes from "./FeedbackWhereItGoes";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
  ProductFeedbackKind,
  isCheckInDue,
} from "Common/Types/ProductFeedback/ProductFeedback";
import Project from "Common/Models/DatabaseModels/Project";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import ProductFeedback, {
  useProductFeedbackSettings,
} from "Common/UI/Utils/ProductFeedback";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/*
 * THE FIRST-WEEK CHECK-IN, ON HOME (issue #6832).
 *
 * Seven days after a project was made, the person who made it sees one
 * card on Home, once: "Is OneUptime set up the way you wanted?". Yes
 * thanks them. "Not yet" opens a box for what is missing, beside the guided
 * setups that do the common jobs from start to finish.
 *
 * Asked only:
 *   - of the project's creator, from its 7th day to its 30th (isCheckInDue);
 *   - while the project has no open incident or alert (Home's counts, and
 *     the server checks again);
 *   - when the server says to ask (ProductFeedback.ask): once per project,
 *     at most one question a week, and never once the person or the server
 *     switched questions off.
 * The X puts it away for good: it was asked.
 *
 * Setup health (#6812) is the list of what is misconfigured in a project.
 * When it found something, "Not yet" leads to its page, rather than
 * repeating findings Home's Needs attention already counts.
 */

export const SETUP_CHECK_IN_TEST_ID: string = "setup-check-in";
export const SETUP_CHECK_IN_YES_TEST_ID: string = "setup-check-in-yes";
export const SETUP_CHECK_IN_NOT_YET_TEST_ID: string = "setup-check-in-not-yet";
export const SETUP_CHECK_IN_CLOSE_TEST_ID: string = "setup-check-in-close";
export const SETUP_CHECK_IN_DETAILS_TEST_ID: string = "setup-check-in-details";
export const SETUP_CHECK_IN_SEND_TEST_ID: string = "setup-check-in-send";
export const SETUP_CHECK_IN_THANKS_TEST_ID: string = "setup-check-in-thanks";
export const SETUP_CHECK_IN_SETUPS_TEST_ID: string = "setup-check-in-setups";
export const SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID: string =
  "setup-check-in-setup-health";

export interface ComponentProps {
  projectId: string;
  // Whether the project has an open incident or alert; null while Home reads it.
  isInIncident: boolean | null;
  /*
   * How many things in the setup need a look (Setup health, #6812), as
   * Home read it; null while read or when it could not be.
   */
  setupHealthCount?: number | null | undefined;
}

// Whether this person is asked at all for this project, before the server is.
export const isCheckInForReader: (data: {
  project: Project | null;
  userId: string;
  now: Date;
}) => boolean = (data: {
  project: Project | null;
  userId: string;
  now: Date;
}): boolean => {
  const creatorId: string | undefined = data.project?.createdByUserId
    ?.toString()
    .toLowerCase();

  return Boolean(
    creatorId &&
      data.userId &&
      creatorId === data.userId.toLowerCase() &&
      isCheckInDue({
        projectCreatedAt: data.project?.createdAt,
        now: data.now,
      }),
  );
};

type Stage = "asking" | "yes" | "not_yet" | "sent";

interface GuidedSetupLink {
  page: PageMap;
  title: string;
}

const GUIDED_SETUPS: ReadonlyArray<GuidedSetupLink> = [
  {
    page: PageMap.MONITOR_GUIDED_SETUP,
    title: "Know when my website or API is down",
  },
  {
    page: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
    title: "Page the right person when something breaks",
  },
  { page: PageMap.STATUS_PAGES_GUIDED_SETUP, title: "Publish a status page" },
  {
    page: PageMap.SERVICES_GUIDED_SETUP,
    title: "Send logs, metrics and traces, then get alerted",
  },
];

const SetupCheckInCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  useProductFeedbackSettings();
  const titleId: string = useId();
  const [isShown, setIsShown] = useState<boolean>(false);
  const [stage, setStage] = useState<Stage>("asking");
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [details, setDetails] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const askedForRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const isAskingMe: boolean = ProductFeedback.isAskingMe();

  useEffect(() => {
    if (
      !isAskingMe ||
      props.isInIncident !== false ||
      askedForRef.current === props.projectId
    ) {
      return;
    }

    let isMounted: boolean = true;

    if (
      !isCheckInForReader({
        project: ProjectUtil.getCurrentProject(),
        userId: UserUtil.getUserId()?.toString() || "",
        now: new Date(),
      })
    ) {
      return;
    }

    askedForRef.current = props.projectId;

    void ProductFeedback.ask({
      kind: ProductFeedbackKind.CheckIn,
      topic: props.projectId,
    }).then((shouldAsk: boolean) => {
      if (isMounted && shouldAsk) {
        setIsShown(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [props.projectId, props.isInIncident, isAskingMe]);

  if (!isShown) {
    return <></>;
  }

  const answer: (isSetUp: boolean) => Promise<void> = async (
    isSetUp: boolean,
  ): Promise<void> => {
    setStage(isSetUp ? "yes" : "not_yet");

    const id: string | null = await ProductFeedback.submit({
      kind: ProductFeedbackKind.CheckIn,
      topic: "",
      isPositive: isSetUp,
    });

    setAnswerId(id);
  };

  const sendDetails: () => Promise<void> = async (): Promise<void> => {
    if (!answerId || !details.trim()) {
      return;
    }

    setIsSending(true);

    const isAdded: boolean = await ProductFeedback.addDetails({
      answerId: answerId,
      details: details,
    });

    setIsSending(false);

    if (isAdded) {
      setStage("sent");
    }
  };

  /*
   * An AppLink's words are a string, and translateText answers string |
   * undefined: each link here falls back to its English words (#7407), as
   * the guided setups' titles do below, so no link is ever drawn empty.
   */
  const openSetupHealthWords: string =
    translator.translateText("Open Setup Health") || "Open Setup Health";

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
      data-testid={SETUP_CHECK_IN_TEST_ID}
      aria-labelledby={titleId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            icon={IconProp.ChatBubbleLeftRight}
            className="mt-0.5 h-5 w-5 flex-none text-indigo-500"
          />
          <div className="min-w-0">
            <p
              id={titleId}
              className="text-sm font-medium text-gray-900 text-pretty"
            >
              {stage === "yes" || stage === "sent"
                ? translator.translateText("Thanks for telling us.")
                : translator.translateText(
                    "Is OneUptime set up the way you wanted?",
                  )}
            </p>
            {stage === "asking" ? (
              <p className="mt-0.5 text-sm text-gray-600 text-pretty">
                {translator.translateText(
                  "Your project is a week old. One click tells us how it went.",
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>
        <button
          type="button"
          className="-m-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={translator.translateText("Close") || ""}
          data-testid={SETUP_CHECK_IN_CLOSE_TEST_ID}
          onClick={() => {
            setIsShown(false);
          }}
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>

      {stage === "asking" ? (
        <div className="ms-8 mt-3 flex flex-wrap items-center gap-2">
          <Button
            title="Yes"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={SETUP_CHECK_IN_YES_TEST_ID}
            onClick={() => {
              void answer(true);
            }}
          />
          <Button
            title="Not yet"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={SETUP_CHECK_IN_NOT_YET_TEST_ID}
            onClick={() => {
              void answer(false);
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {stage === "not_yet" ? (
        <div className="ms-8 mt-3 space-y-3">
          {/*
           * Setup health (#6812) found something: the way to its page, by
           * how many - its findings are its page's, not repeated here.
           */}
          {props.setupHealthCount && props.setupHealthCount > 0 ? (
            <p
              className="text-sm text-gray-700"
              data-testid={SETUP_CHECK_IN_SETUP_HEALTH_TEST_ID}
            >
              {translator.translateText(
                "Setup health lists what in your project's setup needs a look.",
              )}{" "}
              <AppLink
                to={getSetupHealthRouteFromHome()}
                className="font-medium text-indigo-600 hover:text-indigo-800"
              >
                {openSetupHealthWords}
              </AppLink>
            </p>
          ) : (
            <></>
          )}
          <div data-testid={SETUP_CHECK_IN_SETUPS_TEST_ID}>
            <p className="text-sm text-gray-700">
              {translator.translateText(
                "These guided setups do the most common jobs from start to finish:",
              )}
            </p>
            <ul className="mt-1 space-y-1">
              {GUIDED_SETUPS.map((setup: GuidedSetupLink): ReactElement => {
                return (
                  <li key={setup.page}>
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[setup.page] as Route,
                      )}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {translator.translateText(setup.title) || setup.title}
                    </AppLink>
                  </li>
                );
              })}
            </ul>
          </div>
          <TextArea
            value={details}
            onChange={(value: string) => {
              setDetails(value.slice(0, PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH));
            }}
            placeholder="What is missing, or what got in the way?"
            ariaLabelledby={titleId}
            autoGrow={true}
            rows={2}
            maxRows={6}
            dataTestId={SETUP_CHECK_IN_DETAILS_TEST_ID}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              title="Send"
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              disabled={!details.trim() || !answerId || isSending}
              isLoading={isSending}
              dataTestId={SETUP_CHECK_IN_SEND_TEST_ID}
              onClick={() => {
                void sendDetails();
              }}
            />
            <FeedbackWhereItGoes />
          </div>
        </div>
      ) : (
        <></>
      )}

      {stage === "sent" ? (
        <p
          className="ms-8 mt-1 text-sm text-gray-600"
          data-testid={SETUP_CHECK_IN_THANKS_TEST_ID}
        >
          {translator.translateText(
            "Your answer helps decide what to make simpler next.",
          )}
        </p>
      ) : (
        <></>
      )}
    </section>
  );
};

export default SetupCheckInCard;
