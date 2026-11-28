/*
 * Type-only on purpose: the one place the color field is loaded is the
 * import() below, so it - its swatches, its custom color panel and the color
 * math they read - stays out of the first load of every page whose forms pick
 * no color.
 */
import type ColorPicker from "./ColorPicker";
import type { ComponentProps } from "./ColorPicker";
import FieldError from "./FieldError";
import LazyControlPlaceholder from "./LazyControlPlaceholder";
import { COLOR_PICKER_SWATCHES } from "../../ColorPicker/ColorPalette";
import Icon from "../../Icon/Icon";
import {
  SKELETON_BAR_CLASS_NAME,
  SKELETON_MOTION_CLASS_NAME,
} from "../../Skeleton/SkeletonStatus";
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
 * The color field as a form draws it (FormField, for a Color field: a label's,
 * a state's, a severity's color). Every page with a form reaches FormField,
 * and the public pages' forms - the sign-in pages', a status page's, a public
 * dashboard's - pick no color. So the field, with its custom color panel and
 * the color math they read, is a file of its own (about 4 KiB gzipped of each
 * one's first load, packages/Common/Scripts/first-load-budgets.js), loaded by
 * the first form that has a color field, as soon as the form is drawn
 * (FormFieldControls), and until it arrives the field draws its place, the
 * same size (ColorPickerPlaceholder).
 */
const colorPicker: LazyLibrary<typeof ColorPicker> = new LazyLibrary<
  typeof ColorPicker
>(async (): Promise<typeof ColorPicker> => {
  return (await import("./ColorPicker")).default;
});

// Loads the field, once however many ask; a failed load is retried.
export const loadColorPicker: () => Promise<typeof ColorPicker> = (): Promise<
  typeof ColorPicker
> => {
  return colorPicker.load();
};

/*
 * The words and classes the field draws its choices with (ColorPicker,
 * ColorSwatchGroup), so its place is as big as the field: the pills of "No
 * color" and "Custom color" and the round swatches between them.
 * Tests/UI/Components/Forms/LazyColorPicker.test.tsx holds them to the
 * field's.
 */
export const COLOR_PLACEHOLDER_NO_COLOR_LABEL: string = "No color";
export const COLOR_PLACEHOLDER_CUSTOM_COLOR_LABEL: string = "Custom color";
export const COLOR_PLACEHOLDER_PILL_CLASS: string =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border text-xs font-medium border-gray-300 bg-white text-gray-400";
export const COLOR_PLACEHOLDER_SWATCH_CLASS: string =
  "inline-flex h-7 w-7 shrink-0 items-center rounded-full";

// The swatches in the runs that wrap as wholes, as the field lays them out.
const getSwatchRuns: (count: number) => Array<number> = (
  count: number,
): Array<number> => {
  if (count <= 5) {
    return count > 0 ? [count] : [];
  }

  const first: number = Math.ceil(count / 2);

  return [first, count - first];
};

export interface ColorPickerPlaceholderProps extends ComponentProps {
  loadError: Error | null;
}

/*
 * The field's place: in a form, its row of choices - "No color" (ticked while
 * nothing is picked) for a field that may be left empty, a round swatch for
 * each ready color, and "Custom color" - with their words, dimmed, and the
 * swatches as skeleton circles; as a compact field, its box with its words.
 * The words wrap the same way at any width, and nothing moves when the field
 * arrives.
 */
export const ColorPickerPlaceholder: FunctionComponent<
  ColorPickerPlaceholderProps
> = (props: ColorPickerPlaceholderProps): ReactElement => {
  const translator: Translator = useTranslator();

  const hasValue: boolean = Boolean(
    (props.value !== undefined ? props.value : props.initialValue)?.toString(),
  );
  const isClearable: boolean = props.isClearable !== false;
  const swatchCount: number = (props.swatches || COLOR_PICKER_SWATCHES).length;

  // Under the place while it is on its way, as the field has it.
  const shownError: string | undefined = props.loadError
    ? undefined
    : props.error;

  const skeletonClassName: string = `${SKELETON_BAR_CLASS_NAME} ${SKELETON_MOTION_CLASS_NAME}`;

  const shape: ReactElement =
    props.layout === "compact" ? (
      <div className="w-full">
        <div className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-2 text-left text-sm text-gray-400">
          <span
            className={`h-5 w-5 shrink-0 rounded-full ${skeletonClassName}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {props.placeholder && props.isPlaceholderTranslated
              ? props.placeholder
              : translator.translateText(
                  props.placeholder || COLOR_PLACEHOLDER_NO_COLOR_LABEL,
                ) || COLOR_PLACEHOLDER_NO_COLOR_LABEL}
          </span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
        </div>
        {shownError && <FieldError message={shownError} announce="none" />}
      </div>
    ) : (
      <div className="w-full">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {isClearable && (
              <span
                data-testid="color-picker-placeholder-clear"
                className={`${COLOR_PLACEHOLDER_PILL_CLASS} px-2.5`}
              >
                {hasValue ? (
                  <></>
                ) : (
                  <Icon icon={IconProp.Check} className="h-3 w-3" />
                )}
                <span>
                  {translator.translateText(
                    props.clearLabel || COLOR_PLACEHOLDER_NO_COLOR_LABEL,
                  ) ||
                    props.clearLabel ||
                    COLOR_PLACEHOLDER_NO_COLOR_LABEL}
                </span>
              </span>
            )}
            {getSwatchRuns(swatchCount).map(
              (runLength: number, runIndex: number): ReactElement => {
                return (
                  <div key={runIndex} className="flex items-center gap-2">
                    {Array.from({ length: runLength }).map(
                      (_: unknown, index: number): ReactElement => {
                        return (
                          <span
                            key={index}
                            data-testid="color-picker-placeholder-swatch"
                            className={`${COLOR_PLACEHOLDER_SWATCH_CLASS} ${skeletonClassName}`}
                          />
                        );
                      },
                    )}
                  </div>
                );
              },
            )}
          </div>
          <span
            data-testid="color-picker-placeholder-custom"
            className={`${COLOR_PLACEHOLDER_PILL_CLASS} pl-1 pr-2.5`}
          >
            <span
              className={`h-5 w-5 shrink-0 rounded-full ${skeletonClassName}`}
            />
            <span className="whitespace-nowrap">
              {translator.translateText(COLOR_PLACEHOLDER_CUSTOM_COLOR_LABEL) ||
                COLOR_PLACEHOLDER_CUSTOM_COLOR_LABEL}
            </span>
          </span>
        </div>
        {shownError && <FieldError message={shownError} announce="none" />}
      </div>
    );

  return (
    <LazyControlPlaceholder
      dataTestId="color-picker-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={shape}
    />
  );
};

const LazyColorPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof ColorPicker> = useLazyLibraryLoad(
    colorPicker,
    true,
  );

  if (load.library) {
    const Picker: typeof ColorPicker = load.library;

    return <Picker {...props} />;
  }

  return <ColorPickerPlaceholder {...props} loadError={load.error} />;
};

export default LazyColorPicker;
