import Icon from "../../Icon/Icon";
import {
  VIEW_SWITCH_ACTIVE_CLASS_NAME,
  VIEW_SWITCH_CLASS_NAME,
  VIEW_SWITCH_IDLE_CLASS_NAME,
} from "../../ViewSwitch/ViewSwitch";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  THEME_PREFERENCES,
  ThemePreference,
} from "../../../../Types/Theme/ThemePreference";
import ThemeUtil, { useThemePreference } from "../../../Utils/Theme";
import {
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * The person's theme, in the user menu of the Dashboard and of the Admin
 * Dashboard: one row, "Theme", and its three choices beside it - Light, Dark
 * and System, light or dark as the device is set (Common/Types/Theme/
 * ThemePreference.ts). The sign-in pages follow the same pick.
 *
 * The choices are the product's view switch (ViewSwitch): a grey track, the
 * one in use raised in white with its icon in the accent colour, the others
 * plain until hovered. Icons only - a sun, a moon and a screen - so the row
 * fits the menu in every language; each says its name to a screen reader
 * and in a tooltip. A pick is drawn at once and kept in the browser; the
 * menu stays open, so the person sees the page in it and can change it again.
 */

export const THEME_CHOICE_ROW_TEST_ID: string = "theme-choice";

export const getThemeChoiceTestId: (preference: ThemePreference) => string = (
  preference: ThemePreference,
): string => {
  return `${THEME_CHOICE_ROW_TEST_ID}-${preference}`;
};

// What the row is called, and each choice: English the row translates.
export const THEME_CHOICE_ROW_TITLE: string = translationKey("Theme");

export const THEME_CHOICES: Readonly<
  Record<ThemePreference, { label: string; icon: IconProp }>
> = {
  [ThemePreference.Light]: {
    label: translationKey("Light"),
    icon: IconProp.Sun,
  },
  [ThemePreference.Dark]: {
    label: translationKey("Dark"),
    icon: IconProp.Moon,
  },
  [ThemePreference.System]: {
    label: translationKey("System"),
    icon: IconProp.ComputerDesktop,
  },
};

// The option's box: a square the size of the row's text line, plus the track.
export const THEME_CHOICE_OPTION_CLASS_NAME: string =
  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const ThemeChoiceRow: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const preference: ThemePreference = useThemePreference();
  const titleId: string = useId();

  return (
    <div
      className="mx-2 flex items-center gap-3 rounded-lg px-4 py-1.5 text-sm text-gray-700"
      data-testid={THEME_CHOICE_ROW_TEST_ID}
      data-theme-preference={preference}
    >
      <div className="h-5 w-5 flex-shrink-0 text-gray-400">
        <Icon icon={IconProp.Swatch} />
      </div>
      <span id={titleId} className="min-w-0 flex-1 truncate font-medium">
        {translator.translateText(THEME_CHOICE_ROW_TITLE)}
      </span>
      <div
        role="group"
        aria-labelledby={titleId}
        className={VIEW_SWITCH_CLASS_NAME}
      >
        {THEME_PREFERENCES.map((choice: ThemePreference): ReactElement => {
          const isInUse: boolean = choice === preference;
          const label: string = translator.translateText(
            THEME_CHOICES[choice].label,
          );

          return (
            <button
              key={choice}
              type="button"
              aria-pressed={isInUse}
              aria-label={label}
              title={label}
              data-testid={getThemeChoiceTestId(choice)}
              className={`${THEME_CHOICE_OPTION_CLASS_NAME} ${
                isInUse
                  ? VIEW_SWITCH_ACTIVE_CLASS_NAME
                  : VIEW_SWITCH_IDLE_CLASS_NAME
              }`}
              onClick={() => {
                if (!isInUse) {
                  ThemeUtil.setPreference(choice);
                }
              }}
            >
              <Icon
                icon={THEME_CHOICES[choice].icon}
                className={`h-4 w-4 ${isInUse ? "text-indigo-600" : ""}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ThemeChoiceRow;
