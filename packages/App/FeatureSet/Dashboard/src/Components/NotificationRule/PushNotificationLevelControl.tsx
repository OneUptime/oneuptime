import IconProp from "Common/Types/Icon/IconProp";
import PushNotificationLevel, {
  getPushNotificationLevel,
} from "Common/Types/NotificationRule/PushNotificationLevel";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import API from "Common/UI/Utils/API/API";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The two ways an on-call push can sound, as the On-Call Rules page offers
 * them: a card each on the form that adds a rule, and a pill on every push
 * rule's row that opens a menu of the same two. One list, so the form and the
 * row can never describe a level two different ways.
 */
export interface PushNotificationLevelChoice {
  level: PushNotificationLevel;
  // English, looked up when shown.
  title: string;
  description: string;
  icon: IconProp;
}

export const PUSH_NOTIFICATION_LEVEL_CHOICES: ReadonlyArray<PushNotificationLevelChoice> =
  [
    {
      level: PushNotificationLevel.Critical,
      title: translationKey("Critical alert"),
      description: translationKey(
        "Rings even when the phone is on silent or in Do Not Disturb.",
      ),
      icon: IconProp.BellAlert,
    },
    {
      level: PushNotificationLevel.Standard,
      title: translationKey("Standard"),
      description: translationKey(
        "Follows the phone's sound, silent and Do Not Disturb settings.",
      ),
      icon: IconProp.Bell,
    },
  ];

export function getPushNotificationLevelChoice(
  level: unknown,
): PushNotificationLevelChoice {
  const resolvedLevel: PushNotificationLevel = getPushNotificationLevel(level);

  return (
    PUSH_NOTIFICATION_LEVEL_CHOICES.find(
      (choice: PushNotificationLevelChoice): boolean => {
        return choice.level === resolvedLevel;
      },
    ) || PUSH_NOTIFICATION_LEVEL_CHOICES[0]!
  );
}

// The create form's cards. CardSelect looks the words up itself.
export function getPushNotificationLevelCardSelectOptions(): Array<CardSelectOption> {
  return PUSH_NOTIFICATION_LEVEL_CHOICES.map(
    (choice: PushNotificationLevelChoice): CardSelectOption => {
      return {
        value: choice.level,
        title: choice.title,
        description: choice.description,
        icon: choice.icon,
      };
    },
  );
}

/*
 * Said under a Critical rule whose phone has not turned critical alerts on.
 * The rule cannot make a phone louder than its owner allowed, so without this
 * a red "Critical alert" would promise a page that rings through silent mode
 * on a phone that will in fact stay silent.
 */
export const DEVICE_NOT_OPTED_IN_HINT: string = translationKey(
  "Rings like a standard push until Critical On-Call Alerts is turned on in the OneUptime On-Call app on this phone.",
);

export const SAVE_FAILED_MESSAGE: string = translationKey(
  "Could not change how this push sounds.",
);

/*
 * The pill's colours, from the classes the dark theme already re-tints
 * (Common/UI/Styles/Theme.css), so it reads in both themes without a rule of
 * its own. Red is kept for Critical: it is the one level that overrides the
 * switch somebody flicked to be left alone, and it should look like it.
 */
const PILL_BASE_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

const PILL_CLASS_NAMES: Record<PushNotificationLevel, string> = {
  [PushNotificationLevel.Critical]: "bg-red-50 text-red-700 ring-red-200",
  [PushNotificationLevel.Standard]: "bg-gray-50 text-gray-700 ring-gray-200",
};

export interface ComponentProps {
  // The rule's stored level. Absent - a rule read without it - is the default.
  level: PushNotificationLevel | string | null | undefined;
  /*
   * Saves a new level. Left out, or with isEditable false, the pill is
   * drawn without its menu: somebody who may not change the rule can still
   * read how loud it is.
   */
  onChange?: ((level: PushNotificationLevel) => Promise<void>) | undefined;
  isEditable: boolean;
  /*
   * Whether the phone this rule pages has Critical On-Call Alerts on, when the
   * page can read it - only the owner's own page can. Undefined says nothing.
   */
  isDeviceCriticalAlertEnabled?: boolean | undefined;
}

/*
 * How one push rule sounds, on its row of the On-Call Rules table: a pill
 * naming the level, which opens a menu to change it. The change is saved at
 * once - it is one choice between two, and making somebody open the edit form
 * for it would hide it - and shown before the server answers, then put back
 * with the reason if the save fails.
 */
const PushNotificationLevelControl: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [level, setLevel] = useState<PushNotificationLevel>(
    getPushNotificationLevel(props.level),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * The table reloads its rows (a refresh, another tab's change), and a row
   * whose stored level changed underneath shows the new one.
   */
  useEffect(() => {
    setLevel(getPushNotificationLevel(props.level));
  }, [props.level]);

  const choice: PushNotificationLevelChoice =
    getPushNotificationLevelChoice(level);

  const canChange: boolean = Boolean(props.isEditable && props.onChange);

  const changeLevel: (
    newLevel: PushNotificationLevel,
  ) => Promise<void> = async (
    newLevel: PushNotificationLevel,
  ): Promise<void> => {
    if (!props.onChange || newLevel === level || isSaving) {
      return;
    }

    const previousLevel: PushNotificationLevel = level;

    setError("");
    setLevel(newLevel);
    setIsSaving(true);

    try {
      await props.onChange(newLevel);
    } catch (err) {
      // Back to what is still stored, and why the change did not stick.
      setLevel(previousLevel);
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const pillContent: ReactElement = (
    <>
      <Icon
        icon={choice.icon}
        className="h-3.5 w-3.5 flex-shrink-0"
        data-testid="push-notification-level-icon"
      />
      <span className="truncate">{translator.translateText(choice.title)}</span>
    </>
  );

  const pillClassName: string = `${PILL_BASE_CLASS_NAME} ${PILL_CLASS_NAMES[level]}`;

  const shouldWarnDeviceNotOptedIn: boolean =
    level === PushNotificationLevel.Critical &&
    props.isDeviceCriticalAlertEnabled === false;

  return (
    <div
      className="mt-1.5 flex flex-col items-start gap-1"
      data-testid="push-notification-level"
      data-level={level}
    >
      {canChange ? (
        <MoreMenu
          isMenuPortaled={true}
          isDisabled={isSaving}
          dataTestId="push-notification-level-menu"
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              className={`${pillClassName} cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isSaving ? "opacity-60" : ""
              }`}
              aria-label={translator.translateTemplate(
                "Push notification: {{level}}. Change how this push sounds.",
                {
                  level: translatableTerm(choice.title),
                },
              )}
              aria-busy={isSaving}
              title={translator.translateText(choice.description)}
              data-testid="push-notification-level-pill"
            >
              {pillContent}
              <Icon
                icon={IconProp.ChevronDown}
                className="h-3 w-3 flex-shrink-0 opacity-70"
              />
            </button>
          }
        >
          {PUSH_NOTIFICATION_LEVEL_CHOICES.map(
            (option: PushNotificationLevelChoice): ReactElement => {
              const isSelected: boolean = option.level === level;

              return (
                <MoreMenuItem
                  key={option.level}
                  text={option.title}
                  icon={option.icon}
                  tooltip={option.description}
                  isChecked={isSelected}
                  rightElement={
                    isSelected ? (
                      <Icon
                        icon={IconProp.Check}
                        className="h-4 w-4 text-indigo-600"
                      />
                    ) : undefined
                  }
                  dataTestId={`push-notification-level-option-${option.level}`}
                  onClick={() => {
                    void changeLevel(option.level);
                  }}
                />
              );
            },
          )}
        </MoreMenu>
      ) : (
        <span
          className={pillClassName}
          title={translator.translateText(choice.description)}
          data-testid="push-notification-level-pill"
        >
          {pillContent}
        </span>
      )}

      {shouldWarnDeviceNotOptedIn ? (
        <div
          className="flex items-start gap-1 text-xs text-amber-700"
          data-testid="push-notification-level-device-hint"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-px h-3.5 w-3.5 flex-shrink-0"
          />
          <span>{translator.translateText(DEVICE_NOT_OPTED_IN_HINT)}</span>
        </div>
      ) : (
        <></>
      )}

      {error ? (
        <p
          className="text-xs text-red-700"
          role="alert"
          data-testid="push-notification-level-error"
        >
          {translator.translateText(SAVE_FAILED_MESSAGE)} {error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PushNotificationLevelControl;
