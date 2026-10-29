import Icon from "../../Icon/Icon";
import { TABLE_RESET_COLUMN_WIDTHS_BUTTON_CLASS_NAME } from "../TableLayout";
import IconProp from "../../../../Types/Icon/IconProp";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a table's reset of its column widths says and shows, in a card's ⋯
 * (CardMenuExtras) or at the header row's end.
 */
export const RESET_COLUMN_WIDTHS_TEXT: string = translationKey(
  "Reset column widths",
);

export const RESET_COLUMN_WIDTHS_ICON: IconProp = IconProp.ArrowUturnLeft;

// The key every table's item shares in a card's ⋯: one item for them all.
export const RESET_COLUMN_WIDTHS_MENU_KEY: string = "reset-column-widths";

export const RESET_COLUMN_WIDTHS_TEST_ID: string = "reset-column-widths";

export interface ComponentProps {
  onClick: () => void;
}

/*
 * The reset as an icon button, for a table whose card keeps no ⋯ menu
 * (TableLayout's TABLE_RESET_COLUMN_WIDTHS_BUTTON_CLASS_NAME), named by
 * what it does for a screen reader and under the pointer.
 */
const ResetColumnWidthsButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string =
    translator.translateText(RESET_COLUMN_WIDTHS_TEXT) ||
    RESET_COLUMN_WIDTHS_TEXT;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={TABLE_RESET_COLUMN_WIDTHS_BUTTON_CLASS_NAME}
      data-testid={RESET_COLUMN_WIDTHS_TEST_ID}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      <Icon icon={RESET_COLUMN_WIDTHS_ICON} className="h-4 w-4" />
    </button>
  );
};

export default ResetColumnWidthsButton;
