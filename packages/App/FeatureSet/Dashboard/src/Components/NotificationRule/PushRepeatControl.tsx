import IconProp from "Common/Types/Icon/IconProp";
import {
  getRepeatEveryMinutes,
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
} from "Common/Types/NotificationRule/NotificationRepeat";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import API from "Common/UI/Utils/API/API";
import {
  composedValue,
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
 * How often a push rule's push is sent again until somebody acknowledges
 * (NotificationRepeat), as the On-Call Rules page offers it: a dropdown on the
 * form that adds a push rule, and a pill on every push rule's row that opens a
 * menu of the same intervals. One list, so the form and the row can never
 * offer different intervals - and every one of them is an interval the server
 * accepts (REPEAT_EVERY_MINUTES_OPTIONS, which a test holds this list to).
 */
export const PUSH_REPEAT_DROPDOWN_OPTIONS: Array<DropdownOption> = [
  { value: NO_NOTIFICATION_REPEAT, label: "Don't repeat" },
  { value: 1, label: "Every minute" },
  { value: 2, label: "Every 2 minutes" },
  { value: 3, label: "Every 3 minutes" },
  { value: 5, label: "Every 5 minutes" },
  { value: 10, label: "Every 10 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
];

export const REPEAT_HELP_TEXT: string = translationKey(
  "Sent again until somebody acknowledges, up to {{count}} more times.",
);

export const REPEAT_SAVE_FAILED_MESSAGE: string = translationKey(
  "Could not change how often this push repeats.",
);

/*
 * The pill's colours, from classes the dark theme already re-tints
 * (Common/UI/Styles/Theme.css). Indigo while it repeats - something will keep
 * happening - and grey while it does not.
 */
const PILL_BASE_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

const REPEATING_CLASS_NAME: string =
  "bg-indigo-50 text-indigo-700 ring-indigo-200";

const NOT_REPEATING_CLASS_NAME: string =
  "bg-gray-50 text-gray-700 ring-gray-200";

export interface ComponentProps {
  // The rule's stored interval. Absent - a rule read without it - repeats never.
  repeatEveryMinutes: number | null | undefined;
  // Saves a new interval. Left out, or with isEditable false, no menu.
  onChange?: ((repeatEveryMinutes: number) => Promise<void>) | undefined;
  isEditable: boolean;
}

/*
 * How often one push rule repeats, on its row of the On-Call Rules table:
 * a pill naming the interval, which opens a menu to change it. Saved at once,
 * shown before the server answers, and put back with the reason if the save
 * fails - as the push level beside it.
 */
const PushRepeatControl: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [repeatEveryMinutes, setRepeatEveryMinutes] = useState<number>(
    getRepeatEveryMinutes(props.repeatEveryMinutes),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // The table reloads its rows, and a row whose interval changed shows it.
  useEffect(() => {
    setRepeatEveryMinutes(getRepeatEveryMinutes(props.repeatEveryMinutes));
  }, [props.repeatEveryMinutes]);

  const canChange: boolean = Boolean(props.isEditable && props.onChange);

  const isRepeating: boolean = repeatEveryMinutes !== NO_NOTIFICATION_REPEAT;

  // The pill's words, in whichever language the sentence they sit in uses.
  const describeRepeat: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    return isRepeating
      ? sentence.translatePlural(
          {
            one: "Repeats every minute",
            other: "Repeats every {{count}} minutes",
          },
          repeatEveryMinutes,
        )
      : sentence.translateText("Doesn't repeat") || "Doesn't repeat";
  };

  const label: string = describeRepeat(translator);

  const helpText: string = translator.translateTemplate(REPEAT_HELP_TEXT, {
    count: MAX_NOTIFICATION_REPEATS,
  });

  const changeRepeat: (newValue: number) => Promise<void> = async (
    newValue: number,
  ): Promise<void> => {
    if (!props.onChange || newValue === repeatEveryMinutes || isSaving) {
      return;
    }

    const previousValue: number = repeatEveryMinutes;

    setError("");
    setRepeatEveryMinutes(newValue);
    setIsSaving(true);

    try {
      await props.onChange(newValue);
    } catch (err) {
      // Back to what is still stored, and why the change did not stick.
      setRepeatEveryMinutes(previousValue);
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const pillClassName: string = `${PILL_BASE_CLASS_NAME} ${
    isRepeating ? REPEATING_CLASS_NAME : NOT_REPEATING_CLASS_NAME
  }`;

  const pillContent: ReactElement = (
    <>
      <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="push-repeat"
      data-repeat-every-minutes={repeatEveryMinutes}
    >
      {canChange ? (
        <MoreMenu
          isMenuPortaled={true}
          isMenuLeftAligned={true}
          isDisabled={isSaving}
          dataTestId="push-repeat-menu"
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              className={`${pillClassName} cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isSaving ? "opacity-60" : ""
              }`}
              aria-label={translator.translateTemplate(
                "{{repeat}}. Change how often this push repeats until acknowledged.",
                { repeat: composedValue(describeRepeat) },
              )}
              aria-busy={isSaving}
              title={isRepeating ? helpText : undefined}
              data-testid="push-repeat-pill"
            >
              {pillContent}
              <Icon
                icon={IconProp.ChevronDown}
                className="h-3 w-3 flex-shrink-0 opacity-70"
              />
            </button>
          }
        >
          {PUSH_REPEAT_DROPDOWN_OPTIONS.map(
            (option: DropdownOption): ReactElement => {
              const optionValue: number = Number(option.value);
              const isSelected: boolean = optionValue === repeatEveryMinutes;

              return (
                <MoreMenuItem
                  key={String(option.value)}
                  text={option.label}
                  isChecked={isSelected}
                  isIconSpaceReserved={true}
                  rightElement={
                    isSelected ? (
                      <Icon
                        icon={IconProp.Check}
                        className="h-4 w-4 text-indigo-600"
                      />
                    ) : undefined
                  }
                  dataTestId={`push-repeat-option-${optionValue}`}
                  onClick={() => {
                    void changeRepeat(optionValue);
                  }}
                />
              );
            },
          )}
        </MoreMenu>
      ) : (
        <span
          className={pillClassName}
          title={isRepeating ? helpText : undefined}
          data-testid="push-repeat-pill"
        >
          {pillContent}
        </span>
      )}

      {error ? (
        <p
          className="text-xs text-red-700"
          role="alert"
          data-testid="push-repeat-error"
        >
          {translator.translateText(REPEAT_SAVE_FAILED_MESSAGE)} {error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PushRepeatControl;
