import {
  HELP_AND_SUPPORT_PAGE_TEST_ID,
  HELP_CARDS,
  HELP_ITEM_COPY,
  HelpAndSupportCopy,
  HelpCard,
  getChoiceTitle,
  getHelpCardTestId,
  getHelpItemTestId,
} from "./HelpAndSupportCopy";
import { fetchHelpAndSupport, postHelpItemChange } from "./HelpAndSupportApi";
import {
  ChatKind,
  ChatLink,
  DEFAULT_INVITE_MESSAGE,
  HELP_ITEMS,
  HELP_ITEM_CHOICES,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  HelpItemSetting,
  INVITE_MESSAGE_MAX_LENGTH,
  ONEUPTIME_HELP_URL,
  ONEUPTIME_SUPPORT_EMAIL,
  SSO_INVITE_SCREEN_TITLE,
  getChatLink,
  getHelpEmailProblem,
  getHelpLinkLabel,
  getHelpLinkProblem,
  getInviteMessage,
  getInviteMessageProblem,
  getRequestDemoUrl,
  getSupportEmailAddress,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { HelpAndSupportAnswer } from "Common/Types/HelpAndSupport/HelpAndSupportAnswer";
import {
  InviteMessageParagraph,
  InviteMessagePart,
  toInviteMessageParagraphs,
} from "Common/Types/HelpAndSupport/InviteMessage";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Button from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import BasicRadioButtons, {
  BasicRadioButtonOption,
} from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT (#10864, #10865, #10866):
 * where this server sends its people for help.
 *
 * It reads like a short checklist of what people see. Each card is a place
 * - the Help menu, the footer and products menu, the mobile app prompts,
 * the single sign-on screen - and each row in it one thing people meet
 * there: where it appears in a sentence, what it does now with a Default,
 * Your Own or Hidden pill, and one way to change it. A row that can only be
 * shown or hidden is a switch, which saves the moment it is flipped; every
 * other row's Change opens a short dialog of its choices - the default,
 * an address or link of the server's own, or hidden - with the field the
 * choice needs. The Help menu and the sign-in screen draw a preview beside
 * their rows, from what is saved, so the page shows what people will see.
 *
 * Nothing is changed until an admin changes it, and the default of every
 * row is what OneUptime always did. Every value is checked here and again
 * on the server: links take https, http and mailto only, and the message
 * is plain text.
 */

type DialogValues = Record<HelpChoice, string>;

const EMPTY_VALUES: DialogValues = {
  [HelpChoice.Default]: "",
  [HelpChoice.Email]: "",
  [HelpChoice.Link]: "",
  [HelpChoice.Text]: "",
  [HelpChoice.Hidden]: "",
};

// The rows that are a switch: shown on OneUptime's default, or hidden.
const SWITCH_ITEMS: ReadonlyArray<HelpItem> = [
  HelpItem.RequestDemo,
  HelpItem.GitHub,
];

// Why a value cannot be kept for its choice, as the server would say it.
const getValueProblem: (choice: HelpChoice, value: string) => string | null = (
  choice: HelpChoice,
  value: string,
): string | null => {
  switch (choice) {
    case HelpChoice.Email:
      return getHelpEmailProblem(value);
    case HelpChoice.Link:
      return getHelpLinkProblem(value);
    case HelpChoice.Text:
      return getInviteMessageProblem(value);
    default:
      return null;
  }
};

// A link without its scheme, as a person reads one: "oneuptime.com/support".
const withoutScheme: (link: string) => string = (link: string): string => {
  return link.replace(/^https?:\/\//i, "").replace(/\/$/, "");
};

// What each item does on its default, in words the admin reads.
const getDefaultValueText: (
  item: HelpItem,
  answer: HelpAndSupportAnswer,
  translator: Translator,
) => string = (
  item: HelpItem,
  answer: HelpAndSupportAnswer,
  translator: Translator,
): string => {
  const say: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  switch (item) {
    case HelpItem.SupportEmail:
      return ONEUPTIME_SUPPORT_EMAIL;
    case HelpItem.Chat:
      return say(HelpAndSupportCopy.oneUptimeChat);
    case HelpItem.HelpLink:
      return answer.isProductRenamed
        ? say(HelpAndSupportCopy.helpPageHiddenWhileRenamed)
        : withoutScheme(ONEUPTIME_HELP_URL);
    case HelpItem.GiveFeedback:
      if (answer.isOneUptimeCloud) {
        return translator.translateTemplate(
          HelpAndSupportCopy.feedbackToOneUptimeTeam,
          { email: ONEUPTIME_SUPPORT_EMAIL },
        );
      }

      return answer.adminNotificationEmail
        ? translator.translateTemplate(HelpAndSupportCopy.feedbackToAdmins, {
            email: answer.adminNotificationEmail,
          })
        : say(HelpAndSupportCopy.feedbackKeptForAdmins);
    case HelpItem.MobileApp:
      return say(HelpAndSupportCopy.oneUptimeApp);
    default:
      return "";
  }
};

/*
 * The pill that says where a row stands: OneUptime's default, the server's
 * own, or hidden - grey with a hollow dot, as a choice someone made to
 * switch something off always is.
 */
const StatePill: FunctionComponent<{
  setting: HelpItemSetting;
  dataTestId: string;
}> = (props: {
  setting: HelpItemSetting;
  dataTestId: string;
}): ReactElement => {
  if (props.setting.choice === HelpChoice.Hidden) {
    return (
      <Pill
        text={HelpAndSupportCopy.hiddenPill}
        tone={PillTone.Paused}
        dataTestId={props.dataTestId}
      />
    );
  }

  if (props.setting.choice === HelpChoice.Default) {
    return (
      <Pill
        text={HelpAndSupportCopy.defaultPill}
        tone={PillTone.Neutral}
        isDotHidden={true}
        dataTestId={props.dataTestId}
      />
    );
  }

  return (
    <Pill
      text={HelpAndSupportCopy.ownPill}
      tone={PillTone.Info}
      isDotHidden={true}
      dataTestId={props.dataTestId}
    />
  );
};

/*
 * THE HELP MENU, AS PEOPLE SEE IT: its ways to ask, from what is saved.
 * A picture of the menu, never the menu: nothing in it opens anything.
 */
const HelpMenuPreview: FunctionComponent<{
  answer: HelpAndSupportAnswer;
}> = (props: { answer: HelpAndSupportAnswer }): ReactElement => {
  const translator: Translator = useTranslator();
  const { t } = useTranslation();
  const settings: HelpAndSupportSettings = props.answer.settings;
  const feedback: HelpItemSetting = settings[HelpItem.GiveFeedback];
  const chat: ChatLink | null = getChatLink(settings);

  const isFeedbackOffered: boolean =
    feedback.choice !== HelpChoice.Hidden &&
    !(feedback.choice === HelpChoice.Email && !props.answer.canSendEmail);

  const entries: Array<{ id: string; icon: IconProp; title: string }> = [
    ...(isFeedbackOffered
      ? [
          {
            id: "give-feedback",
            icon: IconProp.ChatBubbleLeftRight,
            title: translator.translateText("Give feedback") || "",
          },
        ]
      : []),
    {
      id: "keyboard-shortcuts",
      icon: IconProp.Keyboard,
      title: translator.translateText("Keyboard shortcuts") || "",
    },
    ...(getSupportEmailAddress(settings)
      ? [
          {
            id: "support-email",
            icon: IconProp.Email,
            title: t("help.supportEmail"),
          },
        ]
      : []),
    ...(chat
      ? [
          {
            id: "chat",
            icon:
              chat.kind === ChatKind.Slack
                ? IconProp.Slack
                : chat.kind === ChatKind.MicrosoftTeams
                  ? IconProp.MicrosoftTeams
                  : IconProp.Chat,
            title:
              chat.kind === ChatKind.Slack
                ? t("help.chatSlack")
                : chat.kind === ChatKind.MicrosoftTeams
                  ? translator.translateText(
                      HelpAndSupportCopy.chatWithTeams,
                    ) || ""
                  : translator.translateText(
                      HelpAndSupportCopy.chatWithSupport,
                    ) || "",
          },
        ]
      : []),
    ...(getRequestDemoUrl(settings)
      ? [
          {
            id: "request-demo",
            icon: IconProp.Window,
            title: t("help.requestDemo"),
          },
        ]
      : []),
  ];

  return (
    <figure
      className="rounded-lg bg-gray-50 p-4 ring-1 ring-inset ring-gray-200"
      data-testid="help-and-support-help-menu-preview"
    >
      <figcaption className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon icon={IconProp.Help} className="h-4 w-4 text-gray-400" />
        {translator.translateText(HelpAndSupportCopy.helpMenuPreviewNote)}
      </figcaption>
      <ul className="overflow-hidden rounded-md bg-white py-1 shadow-sm ring-1 ring-gray-200">
        {entries.map(
          (entry: { id: string; icon: IconProp; title: string }) => {
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700"
                data-testid={`help-and-support-preview-${entry.id}`}
              >
                <Icon icon={entry.icon} className="h-4 w-4 text-gray-400" />
                <span className="min-w-0 truncate">{entry.title}</span>
              </li>
            );
          },
        )}
      </ul>
    </figure>
  );
};

/*
 * THE SINGLE SIGN-ON SCREEN, AS IT READS: its title and the message, links
 * and addresses drawn as links would be - and pressing them opens nothing.
 * The screen is drawn by the server in English, so its words here are as
 * the screen writes them.
 */
const SignInPreview: FunctionComponent<{
  settings: HelpAndSupportSettings;
}> = (props: { settings: HelpAndSupportSettings }): ReactElement => {
  const translator: Translator = useTranslator();
  const paragraphs: Array<InviteMessageParagraph> = toInviteMessageParagraphs(
    getInviteMessage(props.settings, DEFAULT_INVITE_MESSAGE),
  );

  return (
    <figure
      className="rounded-lg bg-gray-50 p-4 ring-1 ring-inset ring-gray-200"
      data-testid="help-and-support-sign-in-preview"
    >
      <figcaption className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon icon={IconProp.Lock} className="h-4 w-4 text-gray-400" />
        {translator.translateText(HelpAndSupportCopy.signInPreviewNote)}
      </figcaption>
      <div className="rounded-md bg-white p-4 shadow-sm ring-1 ring-gray-200" lang="en" dir="ltr">
        <p className="text-base font-medium text-gray-900">
          {SSO_INVITE_SCREEN_TITLE}
        </p>
        <div
          className="mt-2 space-y-2 text-sm text-gray-600"
          data-testid="help-and-support-sign-in-preview-message"
        >
          {paragraphs.map(
            (paragraph: InviteMessageParagraph, paragraphIndex: number) => {
              return (
                <p key={paragraphIndex} className="break-words">
                  {paragraph.map(
                    (part: InviteMessagePart, partIndex: number) => {
                      return part.href ? (
                        <span
                          key={partIndex}
                          className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2"
                        >
                          {part.text}
                        </span>
                      ) : (
                        <React.Fragment key={partIndex}>
                          {part.text}
                        </React.Fragment>
                      );
                    },
                  )}
                </p>
              );
            },
          )}
        </div>
      </div>
    </figure>
  );
};

/*
 * ONE PLACE'S CHOICES, IN A SHORT DIALOG: the default, the server's own
 * address, link or words with the field for them, or hidden. Checked as the
 * server checks it, before anything is sent.
 */
const HelpItemDialog: FunctionComponent<{
  item: HelpItem;
  answer: HelpAndSupportAnswer;
  onClose: () => void;
  onSaved: (answer: HelpAndSupportAnswer) => void;
}> = (props: {
  item: HelpItem;
  answer: HelpAndSupportAnswer;
  onClose: () => void;
  onSaved: (answer: HelpAndSupportAnswer) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const fieldId: string = useId();
  const current: HelpItemSetting = props.answer.settings[props.item];
  const [choice, setChoice] = useState<HelpChoice>(current.choice);
  const [values, setValues] = useState<DialogValues>({
    ...EMPTY_VALUES,
    ...(current.value !== null ? { [current.choice]: current.value } : {}),
  });
  const [problem, setProblem] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const say: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  const setValue: (value: string) => void = (value: string): void => {
    setValues((before: DialogValues): DialogValues => {
      return { ...before, [choice]: value };
    });
    setProblem("");
  };

  const field: (forChoice: HelpChoice) => ReactElement | undefined = (
    forChoice: HelpChoice,
  ): ReactElement | undefined => {
    if (forChoice === HelpChoice.Email || forChoice === HelpChoice.Link) {
      const isEmail: boolean = forChoice === HelpChoice.Email;

      return (
        <div className="mt-2 ms-7 space-y-1">
          <Input
            id={`${fieldId}-${forChoice}`}
            value={values[forChoice]}
            onChange={setValue}
            placeholder={
              isEmail
                ? HelpAndSupportCopy.emailPlaceholder
                : HelpAndSupportCopy.linkPlaceholder
            }
            // Already in the reader's words: the input draws it as given.
            ariaLabel={say(getChoiceTitle(props.item, forChoice))}
            readsLeftToRight={true}
            disableSpellCheck={true}
            error={problem ? say(problem) : undefined}
            dataTestId={`help-and-support-dialog-${forChoice}-input`}
            autoFocus={true}
          />
          {isEmail ? (
            props.item === HelpItem.GiveFeedback &&
            !props.answer.canSendEmail ? (
              <p
                className="text-sm text-amber-700"
                data-testid="help-and-support-dialog-cannot-send"
              >
                {say(HelpAndSupportCopy.feedbackCannotSend)}
              </p>
            ) : (
              <></>
            )
          ) : (
            <p className="text-xs text-gray-500">
              {say(HelpAndSupportCopy.linkHint)}
            </p>
          )}
        </div>
      );
    }

    if (forChoice === HelpChoice.Text) {
      return (
        <div className="mt-2 ms-7 space-y-1">
          <TextArea
            id={`${fieldId}-${forChoice}`}
            value={values[forChoice]}
            onChange={(value: string) => {
              setValue(value.slice(0, INVITE_MESSAGE_MAX_LENGTH));
            }}
            placeholder={HelpAndSupportCopy.messagePlaceholder}
            rows={4}
            error={problem ? say(problem) : undefined}
            dataTestId="help-and-support-dialog-text-input"
            autoFocus={true}
          />
          <p className="text-xs text-gray-500">
            {say(HelpAndSupportCopy.messageHint)}
          </p>
        </div>
      );
    }

    return undefined;
  };

  const getDescription: (forChoice: HelpChoice) => string | undefined = (
    forChoice: HelpChoice,
  ): string | undefined => {
    if (forChoice === HelpChoice.Default) {
      if (props.item === HelpItem.InviteMessage) {
        return DEFAULT_INVITE_MESSAGE;
      }

      return getDefaultValueText(props.item, props.answer, translator) || undefined;
    }

    if (props.item === HelpItem.GiveFeedback) {
      if (forChoice === HelpChoice.Email) {
        return say(HelpAndSupportCopy.feedbackChoiceEmailDescription);
      }

      if (forChoice === HelpChoice.Link) {
        return say(HelpAndSupportCopy.feedbackChoiceLinkDescription);
      }
    }

    return undefined;
  };

  const options: Array<BasicRadioButtonOption> = HELP_ITEM_CHOICES[
    props.item
  ].map((forChoice: HelpChoice): BasicRadioButtonOption => {
    return {
      value: forChoice,
      title: say(getChoiceTitle(props.item, forChoice)),
      description: getDescription(forChoice),
      children: field(forChoice),
    };
  });

  const save: () => Promise<void> = async (): Promise<void> => {
    const value: string = values[choice] || "";
    const valueProblem: string | null = getValueProblem(choice, value);

    if (valueProblem) {
      setProblem(valueProblem);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const saved: HelpAndSupportAnswer = await postHelpItemChange({
        item: props.item,
        choice: choice,
        value:
          choice === HelpChoice.Email ||
          choice === HelpChoice.Link ||
          choice === HelpChoice.Text
            ? value
            : null,
      });

      Toast.success(say(HelpAndSupportCopy.saved));
      props.onSaved(saved);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={HELP_ITEM_COPY[props.item].title}
      description={HELP_ITEM_COPY[props.item].where}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      onSubmit={() => {
        void save();
      }}
      submitButtonText={HelpAndSupportCopy.save}
      isLoading={isSaving}
      error={error || undefined}
    >
      <div data-testid="help-and-support-dialog">
        <BasicRadioButtons
          id={`${fieldId}-choices`}
          initialValue={current.choice}
          options={options}
          onChange={(value: string) => {
            if (
              (HELP_ITEM_CHOICES[props.item] as ReadonlyArray<string>).includes(
                value,
              )
            ) {
              setChoice(value as HelpChoice);
              setProblem("");
            }
          }}
        />
      </div>
    </Modal>
  );
};

const HelpAndSupportSettings: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<HelpAndSupportAnswer | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [editing, setEditing] = useState<HelpItem | null>(null);
  const [switching, setSwitching] = useState<HelpItem | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchHelpAndSupport()
      .then((loaded: HelpAndSupportAnswer) => {
        if (isCurrent) {
          setAnswer(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (!answer) {
    return (
      <div data-testid={HELP_AND_SUPPORT_PAGE_TEST_ID}>
        {loadError ? (
          <Card title={HelpAndSupportCopy.helpMenuTitle}>
            <ErrorMessage
              message={
                loadError ||
                translator.translateText(HelpAndSupportCopy.loadError) ||
                HelpAndSupportCopy.loadError
              }
            />
          </Card>
        ) : (
          <PageSkeleton />
        )}
      </div>
    );
  }

  const say: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  // A switch row: shown on the default, or hidden. Saves as it is flipped.
  const flip: (item: HelpItem, isShown: boolean) => Promise<void> = async (
    item: HelpItem,
    isShown: boolean,
  ): Promise<void> => {
    setSwitching(item);

    try {
      setAnswer(
        await postHelpItemChange({
          item: item,
          choice: isShown ? HelpChoice.Default : HelpChoice.Hidden,
          value: null,
        }),
      );
      Toast.success(say(HelpAndSupportCopy.saved));
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    }

    setSwitching(null);
  };

  // What a row does now, under its sentence.
  const renderValue: (item: HelpItem) => ReactElement = (
    item: HelpItem,
  ): ReactElement => {
    const setting: HelpItemSetting = answer.settings[item];
    const isSwitch: boolean = SWITCH_ITEMS.includes(item);
    let value: ReactElement = <></>;

    if (setting.choice === HelpChoice.Default && !isSwitch) {
      const text: string =
        item === HelpItem.InviteMessage
          ? ""
          : getDefaultValueText(item, answer, translator);

      value = text ? (
        <span
          className="min-w-0 break-words text-sm text-gray-600"
          data-testid={`${getHelpItemTestId(item)}-value`}
        >
          {text}
        </span>
      ) : (
        <></>
      );
    }

    if (
      (setting.choice === HelpChoice.Email ||
        setting.choice === HelpChoice.Link) &&
      setting.value
    ) {
      value = (
        <span
          className="min-w-0 break-all text-sm font-medium text-gray-900"
          dir="ltr"
          data-testid={`${getHelpItemTestId(item)}-value`}
        >
          {setting.choice === HelpChoice.Link &&
          item === HelpItem.GiveFeedback
            ? translator.translateTemplate(
                HelpAndSupportCopy.feedbackOpensPage,
                { address: getHelpLinkLabel(setting.value) },
              )
            : setting.value}
        </span>
      );
    }

    return (
      <div className="mt-2 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatePill
            setting={setting}
            dataTestId={`${getHelpItemTestId(item)}-state`}
          />
          {value}
        </div>
        {item === HelpItem.GiveFeedback &&
        setting.choice === HelpChoice.Email &&
        !answer.canSendEmail ? (
          <p
            className="text-sm text-amber-700"
            data-testid={`${getHelpItemTestId(item)}-cannot-send`}
          >
            {say(HelpAndSupportCopy.feedbackCannotSend)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderRow: (item: HelpItem) => ReactElement = (
    item: HelpItem,
  ): ReactElement => {
    const copy: (typeof HELP_ITEM_COPY)[HelpItem] = HELP_ITEM_COPY[item];
    const isSwitch: boolean = SWITCH_ITEMS.includes(item);
    const isShown: boolean =
      answer.settings[item].choice !== HelpChoice.Hidden;

    return (
      <div
        key={item}
        className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
        data-testid={getHelpItemTestId(item)}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100"
          >
            <Icon icon={copy.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900">
              {say(copy.title)}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">{say(copy.where)}</p>
            {renderValue(item)}
          </div>
        </div>
        <div className="flex flex-none items-center ps-12 sm:ps-0">
          {isSwitch ? (
            <Toggle
              value={isShown}
              ariaLabel={say(copy.title)}
              isAriaLabelTranslated={true}
              title={HelpAndSupportCopy.toggleShown}
              disabled={switching !== null}
              dataTestId={`${getHelpItemTestId(item)}-switch`}
              onChange={(value: boolean) => {
                void flip(item, value);
              }}
            />
          ) : (
            <Button
              title={HelpAndSupportCopy.change}
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.Edit}
              dataTestId={`${getHelpItemTestId(item)}-change`}
              onClick={() => {
                setEditing(item);
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const renderCard: (card: {
    card: HelpCard;
    title: string;
    description: string;
  }) => ReactElement = (card: {
    card: HelpCard;
    title: string;
    description: string;
  }): ReactElement => {
    const items: Array<HelpItem> = HELP_ITEMS.filter(
      (item: HelpItem): boolean => {
        return HELP_ITEM_COPY[item].card === card.card;
      },
    );

    const preview: ReactElement | null =
      card.card === HelpCard.HelpMenu ? (
        <HelpMenuPreview answer={answer} />
      ) : card.card === HelpCard.SignIn ? (
        <SignInPreview settings={answer.settings} />
      ) : null;

    return (
      <div key={card.card} data-testid={getHelpCardTestId(card.card)}>
        <Card title={card.title} description={card.description}>
          <div
            className={
              preview
                ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
                : ""
            }
          >
            <div className="divide-y divide-gray-200">
              {items.map(renderRow)}
            </div>
            {preview ? <div className="min-w-0">{preview}</div> : <></>}
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div data-testid={HELP_AND_SUPPORT_PAGE_TEST_ID}>
      {HELP_CARDS.map(renderCard)}
      {editing ? (
        <HelpItemDialog
          item={editing}
          answer={answer}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={(saved: HelpAndSupportAnswer) => {
            setAnswer(saved);
            setEditing(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default HelpAndSupportSettings;
