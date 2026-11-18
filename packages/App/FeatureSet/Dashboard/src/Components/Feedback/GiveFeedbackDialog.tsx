import EventName from "../../Utils/EventName";
import FeedbackGitHubLink from "./FeedbackGitHubLink";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import { getFeedbackGitHubIssueUrl } from "./FeedbackPage";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import {
  DEFAULT_GIVE_FEEDBACK_CATEGORY,
  GIVE_FEEDBACK_CATEGORIES,
  GIVE_FEEDBACK_CATEGORY_TITLES,
  GiveFeedbackCategory,
  GiveFeedbackDestination,
  PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
  isGiveFeedbackCategory,
} from "Common/Types/ProductFeedback/ProductFeedback";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { getPageTrail, getPageTrailName } from "Common/UI/Utils/PageTrail";
import ProductFeedback, {
  GiveFeedbackSent,
  useProductFeedbackSettings,
} from "Common/UI/Utils/ProductFeedback";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
 * "GIVE FEEDBACK", FROM ANY PAGE (issues #6832, #8893).
 *
 * Help's Give feedback (the header's menu and the phone's), Search
 * (Cmd/Ctrl+K) and the first-week check-in open this. It asks two things,
 * the first already answered:
 *
 *   - what it is about: something broken (picked when it opens), confusing,
 *     an idea, or other (GiveFeedbackCategory). The pick words the question
 *     under it ("What happened?", "What's your idea?") and is the answer's
 *     topic;
 *   - what they want to say.
 *
 * One line under the box says exactly what is sent and to whom, before
 * anything is (GiveFeedbackDestination, from the server's settings):
 *
 *   - OneUptime Cloud: the OneUptime team, by email, with the person's name
 *     and email address, their project, the page and the version;
 *   - a self-hosted server with an Admin Notification Email: its admins, the
 *     same way, and nothing to OneUptime;
 *   - a self-hosted server with none: kept for its admins with the page and
 *     the version, without the person's name, and nothing leaves the server.
 *
 * The page is named as its breadcrumbs name it ("SLOs", PageTrail), while
 * what is sent is still its route with no ids (FeedbackPage): the route
 * reads as gibberish to a person.
 *
 * Once sent, it says what happened and what happens next: to whom it went,
 * and where a copy is on its way - only what the server says it did. On a
 * self-hosted server, the person may also tell OneUptime in a public
 * GitHub issue (FeedbackGitHubLink): pre-filled, and posted only by them.
 *
 * Mounted once in App.tsx, beside How OneUptime works, and opened with a
 * window event (openGiveFeedback), so an opener needs nothing but its name.
 */

export enum GiveFeedbackOpenedFrom {
  Help = "help",
  PhoneMenu = "phone_menu",
  CommandPalette = "command_palette",
  CheckIn = "check_in",
}

export const GIVE_FEEDBACK_DIALOG_TEST_ID: string = "give-feedback-dialog";
export const GIVE_FEEDBACK_CATEGORY_TEST_ID: string = "give-feedback-category";
export const GIVE_FEEDBACK_DETAILS_TEST_ID: string = "give-feedback-details";
export const GIVE_FEEDBACK_ATTACHED_TEST_ID: string = "give-feedback-attached";
export const GIVE_FEEDBACK_SENT_TEST_ID: string = "give-feedback-sent";
export const GIVE_FEEDBACK_GITHUB_TEST_ID: string = "give-feedback-github";

/*
 * What the dialog starts on, by where it was opened: the first-week
 * check-in asks what is missing. Anywhere else, the default.
 */
const CATEGORY_WHEN_OPENED_FROM: Readonly<
  Partial<Record<string, GiveFeedbackCategory>>
> = {
  [GiveFeedbackOpenedFrom.CheckIn]: GiveFeedbackCategory.Idea,
};

// Opens the dialog, from anywhere in the dashboard.
export const openGiveFeedback: (from: GiveFeedbackOpenedFrom) => void = (
  from: GiveFeedbackOpenedFrom,
): void => {
  GlobalEvents.dispatchEvent(EventName.GIVE_FEEDBACK_OPEN, { from: from });
};

// What each kind of feedback is drawn with.
export const GIVE_FEEDBACK_CATEGORY_ICONS: Readonly<
  Record<GiveFeedbackCategory, IconProp>
> = {
  [GiveFeedbackCategory.Broken]: IconProp.Bug,
  [GiveFeedbackCategory.Confusing]: IconProp.QuestionMarkCircle,
  [GiveFeedbackCategory.Idea]: IconProp.LightBulb,
  [GiveFeedbackCategory.Other]: IconProp.ChatBubbleLeftRight,
};

// The question each kind asks, and the hint inside its box.
export const GIVE_FEEDBACK_CATEGORY_QUESTIONS: Readonly<
  Record<GiveFeedbackCategory, { question: string; placeholder: string }>
> = {
  [GiveFeedbackCategory.Broken]: {
    question: translationKey("What happened?"),
    placeholder: translationKey(
      "What did you do, what did you expect, and what happened instead?",
    ),
  },
  [GiveFeedbackCategory.Confusing]: {
    question: translationKey("What was confusing?"),
    placeholder: translationKey(
      "What were you trying to do, and where did you get stuck?",
    ),
  },
  [GiveFeedbackCategory.Idea]: {
    question: translationKey("What's your idea?"),
    placeholder: translationKey(
      "What would you like to be able to do, and what would it help you with?",
    ),
  },
  [GiveFeedbackCategory.Other]: {
    question: translationKey("What would you like to tell us?"),
    placeholder: translationKey(
      "Anything at all: what works well, what doesn't, or what you need.",
    ),
  },
};

// Who it goes to, under the dialog's title.
const DESCRIPTIONS: Readonly<Record<GiveFeedbackDestination, string>> = {
  [GiveFeedbackDestination.OneUptimeTeam]: translationKey(
    "Tell the OneUptime team what's broken, confusing or missing. We read every message.",
  ),
  [GiveFeedbackDestination.ServerAdminsByEmail]: translationKey(
    "Tell this server's admins what's broken, confusing or missing.",
  ),
  [GiveFeedbackDestination.ServerAdmins]: translationKey(
    "Tell this server's admins what's broken, confusing or missing.",
  ),
};

// Exactly what is sent with it, and to whom: one line, before anything is.
const WHAT_IS_SENT: Readonly<Record<GiveFeedbackDestination, string>> = {
  [GiveFeedbackDestination.OneUptimeTeam]: translationKey(
    "Sent to the OneUptime team with your name and email ({{email}}), your project, this page ({{page}}) and the version ({{version}}).",
  ),
  [GiveFeedbackDestination.ServerAdminsByEmail]: translationKey(
    "Sent to this server's admins with your name and email ({{email}}), your project, this page ({{page}}) and the version ({{version}}). Nothing is sent to OneUptime.",
  ),
  [GiveFeedbackDestination.ServerAdmins]: translationKey(
    "Kept for this server's admins with this page ({{page}}) and the version ({{version}}), without your name. Nothing leaves this server.",
  ),
};

/*
 * A kind of feedback, as a tile: its icon over its name, so the name has the
 * tile's whole width. Beside its icon, "Something's broken" (140 pixels)
 * had 124 in a desktop's row of four and 120 in a phone's two by two, and
 * the kind picked when the dialog opens was the one name on two lines. Over
 * it, the name has about 160 and 150. Picked, a tile is indigo, as a picked
 * choice is everywhere; every tile in a row is as tall as the tallest, so a
 * name that wraps in a long language ("Etwas funktioniert nicht") is never
 * cut. Its colours are plain utilities, which the dark theme repaints
 * (Theme.css): a peer-checked: one it would not.
 */
const CATEGORY_CHIP_CLASS_NAME: string =
  "flex h-full w-full cursor-pointer select-none flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-sm font-medium leading-5 shadow-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-1";

const PICKED_CATEGORY_CHIP_CLASS_NAME: string =
  "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500";

const UNPICKED_CATEGORY_CHIP_CLASS_NAME: string =
  "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50";

// A tile's icon: indigo on the picked kind, quieter than the name elsewhere.
const PICKED_CATEGORY_ICON_CLASS_NAME: string =
  "h-5 w-5 shrink-0 text-indigo-600";

const UNPICKED_CATEGORY_ICON_CLASS_NAME: string =
  "h-5 w-5 shrink-0 text-gray-400";

interface SentFeedback extends GiveFeedbackSent {
  details: string;
}

const GiveFeedbackDialog: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();
  const categoryLabelId: string = useId();
  const categoryGroupName: string = useId();
  // Where it goes is the server's to say; drawn again when the settings arrive.
  useProductFeedbackSettings();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [category, setCategory] = useState<GiveFeedbackCategory>(
    DEFAULT_GIVE_FEEDBACK_CATEGORY,
  );
  const [details, setDetails] = useState<string>("");
  const [sent, setSent] = useState<SentFeedback | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The page, read when the dialog opens: as it is sent, and its trail.
  const [page, setPage] = useState<string>("/");
  const [pageTrail, setPageTrail] = useState<Array<Link> | null>(null);
  /*
   * Each opening draws the dialog afresh, so one opened again while it is
   * open starts empty too: the box keeps what it holds until it is drawn
   * again.
   */
  const [openedCount, setOpenedCount] = useState<number>(0);

  useEffect(() => {
    const open: (event: CustomEvent) => void = (event: CustomEvent): void => {
      const detail: { from?: unknown; category?: unknown } | null =
        event.detail as { from?: unknown; category?: unknown } | null;

      setCategory(
        isGiveFeedbackCategory(detail?.category)
          ? detail.category
          : (typeof detail?.from === "string" &&
              CATEGORY_WHEN_OPENED_FROM[detail.from]) ||
              DEFAULT_GIVE_FEEDBACK_CATEGORY,
      );
      setPage(ProductFeedback.getPage());
      setPageTrail(getPageTrail());
      setDetails("");
      setSent(null);
      setError("");
      setOpenedCount((count: number): number => {
        return count + 1;
      });
      setIsOpen(true);
    };

    GlobalEvents.addEventListener(EventName.GIVE_FEEDBACK_OPEN, open);

    return () => {
      GlobalEvents.removeEventListener(EventName.GIVE_FEEDBACK_OPEN, open);
    };
  }, []);

  const formRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * Each opening starts in the message box, as the dialog did before it
   * asked what the message is about: that question comes answered, and a
   * person opens Give Feedback to write. A Modal starts on the first control
   * in its body, here the first kind's tile, which took the start from the
   * box's autoFocus. This moves it on afterwards: a parent's effects run
   * after its children's. Tab and Shift+Tab still reach the kinds.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    formRef.current
      ?.querySelector<HTMLTextAreaElement>("textarea")
      ?.focus({ preventScroll: true });
  }, [isOpen, openedCount]);

  if (!isOpen) {
    return <></>;
  }

  const close: () => void = (): void => {
    setIsOpen(false);
  };

  const destination: GiveFeedbackDestination =
    ProductFeedback.getGiveFeedbackDestination();
  const isOneUptimeTeam: boolean =
    destination === GiveFeedbackDestination.OneUptimeTeam;
  const version: string = ProductFeedback.getVersion();

  // The page as a person reads it: its trail, or the route where it has none.
  const pageName: string =
    getPageTrailName(pageTrail, (value: string | undefined) => {
      return translator.translateText(value);
    }) || page;

  if (sent !== null) {
    return (
      <Modal
        title="Thanks for Your Feedback"
        modalWidth={ModalWidth.Medium}
        onClose={close}
        closeButtonText="Close"
      >
        {/*
         * One column of words beside the tick, the link to GitHub in it too,
         * lined up with what it follows. An address too long for a phone's
         * line breaks rather than pushing the dialog sideways.
         */}
        <div data-testid={GIVE_FEEDBACK_SENT_TEST_ID}>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-emerald-600"
              />
            </span>
            <div className="min-w-0 space-y-1 break-words pt-1.5 text-sm text-gray-700">
              <p className="font-medium text-gray-900">
                {
                  /*
                   * On OneUptime Cloud the answer reaches the OneUptime team
                   * whether or not it was emailed: they are its admins.
                   */
                  isOneUptimeTeam
                    ? translator.translateText("Sent to the OneUptime team.")
                    : sent.isEmailed
                      ? translator.translateText(
                          "Sent to this server's admins.",
                        )
                      : translator.translateText(
                          "This server's admins can read it in the Admin Dashboard, under Feedback.",
                        )
                }
              </p>
              {sent.isEmailed && sent.copyTo ? (
                <p>
                  {translator.translateTemplate(
                    "A copy is on its way to {{email}}, and any reply will come there too.",
                    { email: sent.copyTo },
                  )}
                </p>
              ) : (
                <></>
              )}
              {!isOneUptimeTeam ? (
                /*
                 * After what was said of where it went: a public issue the
                 * person may also post, which says it is public (#7462).
                 */
                <div className="pt-2">
                  <FeedbackGitHubLink
                    href={getFeedbackGitHubIssueUrl({
                      details: sent.details,
                      page: page,
                      version: version,
                    })}
                    dataTestId={GIVE_FEEDBACK_GITHUB_TEST_ID}
                  />
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  const send: () => Promise<void> = async (): Promise<void> => {
    if (!details.trim()) {
      setError(
        translator.translateText(
          "Write what you want to tell us, then send it.",
        ) || "",
      );
      return;
    }

    setIsSending(true);
    setError("");

    const result: GiveFeedbackSent | null = await ProductFeedback.giveFeedback({
      category: category,
      details: details,
    });

    setIsSending(false);

    if (result === null) {
      setError(
        translator.translateText(
          "Your feedback could not be sent. Check your connection, then try again.",
        ) || "",
      );
      return;
    }

    setSent({ ...result, details: details.trim() });
  };

  const question: { question: string; placeholder: string } =
    GIVE_FEEDBACK_CATEGORY_QUESTIONS[category];

  return (
    <Modal
      key={openedCount}
      title="Give Feedback"
      description={DESCRIPTIONS[destination]}
      modalWidth={ModalWidth.Medium}
      onClose={close}
      onSubmit={() => {
        void send();
      }}
      submitButtonText="Send Feedback"
      isLoading={isSending}
      error={error || undefined}
    >
      <div
        ref={formRef}
        className="space-y-5"
        data-testid={GIVE_FEEDBACK_DIALOG_TEST_ID}
      >
        <div>
          <p id={categoryLabelId} className="text-sm font-medium text-gray-700">
            {translator.translateText("What is it about?")}
          </p>
          <div
            role="radiogroup"
            aria-labelledby={categoryLabelId}
            className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid={GIVE_FEEDBACK_CATEGORY_TEST_ID}
          >
            {GIVE_FEEDBACK_CATEGORIES.map(
              (choice: GiveFeedbackCategory): ReactElement => {
                return (
                  <label key={choice} className="block h-full">
                    <input
                      type="radio"
                      name={categoryGroupName}
                      value={choice}
                      checked={category === choice}
                      onChange={() => {
                        setCategory(choice);
                      }}
                      className="peer sr-only"
                      data-testid={`${GIVE_FEEDBACK_CATEGORY_TEST_ID}-${choice}`}
                    />
                    <span
                      className={`${CATEGORY_CHIP_CLASS_NAME} ${
                        category === choice
                          ? PICKED_CATEGORY_CHIP_CLASS_NAME
                          : UNPICKED_CATEGORY_CHIP_CLASS_NAME
                      }`}
                    >
                      <Icon
                        icon={GIVE_FEEDBACK_CATEGORY_ICONS[choice]}
                        className={
                          category === choice
                            ? PICKED_CATEGORY_ICON_CLASS_NAME
                            : UNPICKED_CATEGORY_ICON_CLASS_NAME
                        }
                      />
                      {/* Wraps rather than cut: "Etwas funktioniert nicht". */}
                      <span>
                        {translator.translateText(
                          GIVE_FEEDBACK_CATEGORY_TITLES[choice],
                        )}
                      </span>
                    </span>
                  </label>
                );
              },
            )}
          </div>
        </div>
        <div>
          <label
            id={labelId}
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(question.question)}
          </label>
          <div className="mt-2">
            <TextArea
              value={details}
              onChange={(value: string) => {
                setDetails(value.slice(0, PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH));
              }}
              // English: the box looks it up in the reader's language.
              placeholder={question.placeholder}
              ariaLabelledby={labelId}
              rows={5}
              dataTestId={GIVE_FEEDBACK_DETAILS_TEST_ID}
            />
          </div>
        </div>
        <p
          className="flex items-start gap-2 text-xs leading-5 text-gray-500"
          data-testid={GIVE_FEEDBACK_ATTACHED_TEST_ID}
        >
          <Icon
            icon={
              destination === GiveFeedbackDestination.ServerAdmins
                ? IconProp.Lock
                : IconProp.Email
            }
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          {/* An address too long for a phone's line breaks, never runs off. */}
          <span className="min-w-0 break-words">
            {translator.translateTemplate(WHAT_IS_SENT[destination], {
              email: UserUtil.getEmail()?.toString() || EMPTY_VALUE_MARK,
              page: pageName,
              version: version || EMPTY_VALUE_MARK,
            })}
          </span>
        </p>
      </div>
    </Modal>
  );
};

export default GiveFeedbackDialog;
