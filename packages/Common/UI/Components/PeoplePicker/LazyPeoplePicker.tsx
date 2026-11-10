/*
 * Type-only on purpose: the one place the picker is loaded is the import()
 * below, so it - with its search list and the kinds of record it searches,
 * models and all - stays out of the first load of every page that draws a
 * form.
 */
import type PeoplePicker from "./PeoplePicker";
import type { ComponentProps } from "./PeoplePicker";
import {
  getPeoplePickerOptionKey,
  PEOPLE_PICKER_ADD_BUTTON_TEXT,
  PEOPLE_PICKER_CHANGE_BUTTON_TEXT,
  PEOPLE_PICKER_NONE_TEXT,
  PeoplePickerNobodyPicked,
} from "./PeoplePickerTypes";
import FieldError from "../Forms/Fields/FieldError";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The people picker as a form field draws it. Every page with a form reaches
 * FormField, and few forms pick people: a status page's and the sign-in
 * pages' never do. So the picker, with its search list and the kinds of
 * record it searches (about 9 KiB gzipped of a status page's first load), is
 * a file of its own, loaded by the first form that has one - as soon as the
 * form is drawn (FormFieldControls) - and until it arrives the field draws
 * its place, the same size (PeoplePickerPlaceholder).
 */
const peoplePicker: LazyLibrary<typeof PeoplePicker> = new LazyLibrary<
  typeof PeoplePicker
>(async (): Promise<typeof PeoplePicker> => {
  return (await import("./PeoplePicker")).default;
});

// Loads the picker, once however many ask; a failed load is retried.
export const loadPeoplePicker: () => Promise<typeof PeoplePicker> = (): Promise<
  typeof PeoplePicker
> => {
  return peoplePicker.load();
};

export interface PeoplePickerPlaceholderProps extends ComponentProps {
  loadError: Error | null;
}

const BOX_CLASS_NAME: string = "animate-pulse rounded-full bg-gray-100";

/*
 * The picker's place: its button and a chip for each pick, in the picker's
 * order, saying what the picker says, dimmed - a pick's chip says
 * "Loading...", as the picker's own does until the pick's name arrives. The
 * classes are the ones that give the button and the chips their size.
 */
export const PeoplePickerPlaceholder: FunctionComponent<
  PeoplePickerPlaceholderProps
> = (props: PeoplePickerPlaceholderProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const pickKeys: Array<string> = [];

  for (const kind of props.kinds) {
    for (const id of props.value[kind] || []) {
      pickKeys.push(getPeoplePickerOptionKey(kind, id));
    }
  }

  const isReadOnly: boolean = Boolean(props.readOnly);
  const isInteractive: boolean = !props.disabled && !isReadOnly;
  const extraChips: Array<ReactElement> = props.extraChips || [];

  const buttonText: string =
    props.isSinglePick && pickKeys.length > 0
      ? PEOPLE_PICKER_CHANGE_BUTTON_TEXT
      : props.addButtonText || PEOPLE_PICKER_ADD_BUTTON_TEXT;

  const button: ReactElement = (
    <span
      key="people-picker-placeholder-button"
      data-testid="people-picker-placeholder-button"
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-400"
    >
      <span className="h-4 w-4" />
      <span>{translateString(buttonText) || buttonText}</span>
    </span>
  );

  const loadingText: string = translateString("Loading...") || "Loading...";

  const chips: Array<ReactElement> = pickKeys.map(
    (pickKey: string): ReactElement => {
      return (
        <span
          key={pickKey}
          data-testid="people-picker-placeholder-chip"
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 text-sm ring-1 ring-inset ring-gray-200 ${
            isInteractive ? "pr-1" : "pr-2.5"
          }`}
        >
          <span className={`h-6 w-6 flex-shrink-0 ${BOX_CLASS_NAME}`} />
          <span className="min-w-0 truncate italic text-gray-400">
            {loadingText}
          </span>
          {isInteractive && (
            // Where the chip's remove button will be.
            <span className="flex-shrink-0 p-0.5">
              <span className="block h-3.5 w-3.5" />
            </span>
          )}
        </span>
      );
    },
  );

  chips.push(...extraChips);

  const nobodyPicked: PeoplePickerNobodyPicked | undefined =
    props.whenNobodyPicked;

  if (isReadOnly && !nobodyPicked && chips.length === 0) {
    chips.push(
      <span
        key="people-picker-placeholder-none"
        data-testid="people-picker-placeholder-none"
        className="text-sm text-gray-400"
      >
        {translateString(PEOPLE_PICKER_NONE_TEXT) || PEOPLE_PICKER_NONE_TEXT}
      </span>,
    );
  }

  if (nobodyPicked && pickKeys.length === 0 && extraChips.length === 0) {
    const nobodyPickedText: string =
      translateString(nobodyPicked.text) || nobodyPicked.text;

    chips.push(
      <span
        key="people-picker-placeholder-nobody-picked"
        data-testid="people-picker-placeholder-nobody-picked"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-sm font-medium text-gray-400 ring-1 ring-inset ring-gray-200"
      >
        {nobodyPicked.icon ? <span className="h-4 w-4 flex-shrink-0" /> : null}
        <span className="min-w-0 truncate">{nobodyPickedText}</span>
      </span>,
    );
  }

  // Under the place while it is on its way, as the picker has it.
  const shownError: string | undefined = props.loadError
    ? undefined
    : props.error;

  return (
    <LazyControlPlaceholder
      dataTestId="people-picker-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {isReadOnly
              ? chips
              : props.isSinglePick
                ? [...chips, button]
                : [button, ...chips]}
            {props.trailing}
          </div>
          {shownError && <FieldError message={shownError} announce="none" />}
        </div>
      }
    />
  );
};

const LazyPeoplePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof PeoplePicker> = useLazyLibraryLoad(
    peoplePicker,
    true,
  );

  if (load.library) {
    const Picker: typeof PeoplePicker = load.library;

    return <Picker {...props} />;
  }

  return <PeoplePickerPlaceholder {...props} loadError={load.error} />;
};

export default LazyPeoplePicker;
