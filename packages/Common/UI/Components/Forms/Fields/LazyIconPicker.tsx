/*
 * Type-only on purpose: the one place the icon field is loaded is the
 * import() below, so it - its grid of every icon and the popup it opens in -
 * stays out of the first load of every page whose forms pick no icon.
 */
import type IconPicker from "./IconPicker";
import type { ComponentProps } from "./IconPicker";
import FieldError from "./FieldError";
import LazyControlPlaceholder from "./LazyControlPlaceholder";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../../Utils/LazyLibrary";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The icon field as a form draws it (FormField, for an Icon field: an
 * incident role's icon). Every page with a form reaches FormField, and the
 * public pages' forms - the sign-in pages', a status page's, a public
 * dashboard's - pick no icon. So the field, with its grid of every icon and
 * the popup it opens in (UseAnchoredFieldPopup), is a file of its own (1.5
 * to 2 KiB gzipped of each one's first load,
 * packages/Common/Scripts/first-load-budgets.js), loaded by the first form
 * that has an icon field, as soon as the form is drawn (FormFieldControls),
 * and until it arrives the field draws its place, the same size
 * (IconPickerPlaceholder).
 */
const iconPicker: LazyLibrary<typeof IconPicker> = new LazyLibrary<
  typeof IconPicker
>(async (): Promise<typeof IconPicker> => {
  return (await import("./IconPicker")).default;
});

// Loads the field, once however many ask; a failed load is retried.
export const loadIconPicker: () => Promise<typeof IconPicker> = (): Promise<
  typeof IconPicker
> => {
  return iconPicker.load();
};

/*
 * The classes the field draws its box with, and what is in it: the picked
 * icon's preview, the box its name or the placeholder is written in, and the
 * button that clears it (IconPicker, and the Input it draws). So its place is
 * as big as the field. Tests/UI/Components/Forms/LazyIconPicker.test.tsx
 * holds them to the field's.
 */
export const ICON_PLACEHOLDER_BOX_CLASS: string =
  "flex block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";
export const ICON_PLACEHOLDER_PREVIEW_CLASS: string =
  "flex items-center justify-center h-5 w-5";
export const ICON_PLACEHOLDER_PREVIEW_ICON_CLASS: string = "h-5 w-5";
export const ICON_PLACEHOLDER_NONE_CLASS: string =
  "h-5 w-5 border border-dashed border-gray-300 rounded";
export const ICON_PLACEHOLDER_TEXT_BOX_CLASS: string = "w-full pl-2";
export const ICON_PLACEHOLDER_CLEAR_CLASS: string = "flex items-center";

export interface IconPickerPlaceholderProps extends ComponentProps {
  loadError: Error | null;
}

/*
 * The field's place: its box, with the picked icon (or the dashed square of
 * none), its name or the placeholder, and - when one is picked - the cross
 * that clears it, none of which can be pressed yet. Nothing moves when the
 * field arrives.
 */
export const IconPickerPlaceholder: FunctionComponent<
  IconPickerPlaceholderProps
> = (props: IconPickerPlaceholderProps): ReactElement => {
  const translator: Translator = useTranslator();

  // The field shows the icon it is opened on, and writes its name.
  const pickedIcon: IconProp | undefined = props.initialValue || undefined;
  const writtenValue: string = pickedIcon || props.value || "";

  const placeholder: string =
    (props.isPlaceholderTranslated
      ? props.placeholder
      : translator.translateText(props.placeholder)) || "";

  // Under the place while it is on its way, as the field has it.
  const shownError: string | undefined = props.loadError
    ? undefined
    : props.error;

  const shape: ReactElement = (
    <div>
      <div className={ICON_PLACEHOLDER_BOX_CLASS}>
        <div className={ICON_PLACEHOLDER_PREVIEW_CLASS} aria-hidden="true">
          {pickedIcon ? (
            <Icon
              icon={pickedIcon}
              className={`${ICON_PLACEHOLDER_PREVIEW_ICON_CLASS} text-gray-600`}
            />
          ) : (
            <div
              data-testid="icon-picker-placeholder-none"
              className={ICON_PLACEHOLDER_NONE_CLASS}
            ></div>
          )}
        </div>
        <div className={`${ICON_PLACEHOLDER_TEXT_BOX_CLASS} min-w-0`}>
          <span
            data-testid="icon-picker-placeholder-text"
            className={`block w-full truncate pl-2 ${
              writtenValue ? "text-gray-500" : "text-gray-400"
            }${props.disabled ? " bg-gray-100" : ""}`}
          >
            {writtenValue || placeholder}
          </span>
        </div>
        {pickedIcon && !props.disabled && (
          <span
            data-testid="icon-picker-placeholder-clear"
            className={`${ICON_PLACEHOLDER_CLEAR_CLASS} text-gray-400`}
            aria-hidden="true"
          >
            <Icon icon={IconProp.Close} className="h-5 w-5" />
          </span>
        )}
      </div>
      {shownError && <FieldError message={shownError} announce="none" />}
    </div>
  );

  return (
    <LazyControlPlaceholder
      dataTestId="icon-picker-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={shape}
    />
  );
};

const LazyIconPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof IconPicker> = useLazyLibraryLoad(
    iconPicker,
    true,
  );

  if (load.library) {
    const Picker: typeof IconPicker = load.library;

    return <Picker {...props} />;
  }

  return <IconPickerPlaceholder {...props} loadError={load.error} />;
};

export default LazyIconPicker;
