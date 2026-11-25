/*
 * Type-only on purpose: the one place the dropdown is loaded is the import()
 * below, so it - with its search on the server, its Labels tab and the Label
 * model that tab reads - stays out of the first load of every page whose
 * forms pick no record.
 */
import type EntityDropdown from "./EntityDropdown";
import type { EntityDropdownProps } from "./EntityDropdown";
import FieldError from "../Forms/Fields/FieldError";
import LazyControlPlaceholder from "../Forms/Fields/LazyControlPlaceholder";
import {
  SKELETON_BAR_CLASS_NAME,
  SKELETON_MOTION_CLASS_NAME,
} from "../Skeleton/SkeletonStatus";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "../../Utils/LazyLibrary";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The dropdown a form field picks records with (FormField draws it for a
 * field with a dropdownModal: an incident's monitors, a policy's teams).
 * Every page with a form reaches FormField, and the public pages' forms - the
 * sign-in pages', a status page's, a public dashboard's - pick no record. So
 * the dropdown is a file of its own (8 to 10 KiB gzipped of each one's first
 * load, packages/Common/Scripts/first-load-budgets.js, since its Labels tab
 * searches on the server, LabelSearch, #10646), loaded by the first form
 * that has such a field, as soon as the form is drawn (FormFieldControls),
 * and until it arrives the field draws its box, the same size
 * (EntityDropdownPlaceholder).
 */
const entityDropdown: LazyLibrary<typeof EntityDropdown> = new LazyLibrary<
  typeof EntityDropdown
>(async (): Promise<typeof EntityDropdown> => {
  return (await import("./EntityDropdown")).default;
});

// Loads the dropdown, once however many ask; a failed load is retried.
export const loadEntityDropdown: () => Promise<
  typeof EntityDropdown
> = (): Promise<typeof EntityDropdown> => {
  return entityDropdown.load();
};

export interface EntityDropdownPlaceholderProps extends EntityDropdownProps {
  loadError: Error | null;
}

// Whether the field holds a pick, read as the dropdown reads it: its value, else its first one.
const holdsAPick: (props: EntityDropdownProps) => boolean = (
  props: EntityDropdownProps,
): boolean => {
  const value: unknown =
    props.value !== undefined ? props.value : props.initialValue;

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null && value !== "";
};

/*
 * The dropdown's place: its box, at its height, with its placeholder's
 * words - or "Loading..." where a pick will be named, as the people
 * picker's place says it (PeoplePickerPlaceholder) - and, above the box, a
 * skeleton bar on the row where the dropdown will list the picks of a field
 * of several. The classes are the ones that give the dropdown its margins,
 * its box and its row of picks their size.
 */
export const EntityDropdownPlaceholder: FunctionComponent<
  EntityDropdownPlaceholderProps
> = (props: EntityDropdownPlaceholderProps): ReactElement => {
  const translator: Translator = useTranslator();

  const loadingText: string =
    translator.translateText("Loading...") || "Loading...";
  const placeholderText: string =
    props.isPlaceholderTranslated && props.placeholder
      ? props.placeholder
      : translator.translateText(props.placeholder || "Select...") || "";

  const hasPick: boolean = holdsAPick(props);
  const isMultiSelect: boolean = Boolean(props.isMultiSelect);

  // Under the place while it is on its way, as the dropdown has it.
  const shownError: string | undefined = props.loadError
    ? undefined
    : props.error;

  return (
    <LazyControlPlaceholder
      dataTestId="entity-dropdown-placeholder"
      loadError={props.loadError}
      fieldError={props.error}
      ariaLabelledby={props.ariaLabelledby}
      shape={
        <div className={props.className || "relative mt-2 mb-1 w-full"}>
          {isMultiSelect && hasPick && (
            // The row of picks' height: a chip's text-xs line, py-1 and border.
            <div
              aria-hidden="true"
              data-testid="entity-dropdown-placeholder-picks"
              className="mb-2 flex h-[26px] items-center"
            >
              <div
                className={`h-4 w-24 ${SKELETON_BAR_CLASS_NAME} ${SKELETON_MOTION_CLASS_NAME}`}
              />
            </div>
          )}
          <div
            className={`relative rounded-lg border shadow-sm ${
              props.error ? "border-red-400" : "border-gray-300"
            } ${props.disabled ? "bg-gray-100" : "bg-white"}`}
          >
            <div className="block min-h-[38px] w-full truncate rounded-lg px-3 py-2 text-sm text-gray-500">
              {hasPick && !isMultiSelect ? loadingText : placeholderText}
            </div>
          </div>
          {shownError && <FieldError message={shownError} announce="none" />}
        </div>
      }
    />
  );
};

const LazyEntityDropdown: FunctionComponent<EntityDropdownProps> = (
  props: EntityDropdownProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof EntityDropdown> = useLazyLibraryLoad(
    entityDropdown,
    true,
  );

  if (load.library) {
    const Dropdown: typeof EntityDropdown = load.library;

    return <Dropdown {...props} />;
  }

  return <EntityDropdownPlaceholder {...props} loadError={load.error} />;
};

export default LazyEntityDropdown;
