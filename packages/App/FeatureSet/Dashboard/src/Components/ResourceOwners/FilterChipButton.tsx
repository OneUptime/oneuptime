import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  FILTER_CHIP_ACTIVE_CLASSES,
  FILTER_CHIP_BOX_CLASSES,
  FILTER_CHIP_CLEAR_CLASSES,
  FILTER_CHIP_CLEAR_PLACE_CLASSES,
  FILTER_CHIP_INACTIVE_CLASSES,
  FILTER_CHIP_TRIGGER_CLASSES,
} from "./FilterChipStyles";

/*
 * The pill of a facet bar chip (FilterChipDropdown, FilterChipValueInput,
 * FilterChipDateRange): the chip's button, which opens its popover, and the
 * button that clears the chip, side by side.
 *
 * The clear control used to sit inside the chip's button, as a span acting
 * as a button. A screen reader reads a button's content as part of that
 * button, so the clear control was lost to it - it heard one button, "Status
 * · Open Clear Status filter" - and a control inside a control is invalid
 * HTML besides. Now the two are siblings in one pill, which looks and behaves
 * as before: the pill is drawn around both (FilterChipStyles), the clear
 * button sits where it always sat, Tab reaches the chip and then its clear
 * button, and Enter or Space on either does what a click does.
 */

export interface ComponentProps {
  // Draws the chip as an applied filter (indigo) rather than an empty one.
  isActive: boolean;
  isExpanded: boolean;
  // What the chip opens: a list of options, or a popover of its own.
  popupKind: "listbox" | "dialog";
  onToggle: () => void;
  // What the chip says: its icon, label and value.
  children: ReactNode;
  // The clear button's name, "Clear Status filter". Shown with onClear.
  clearLabel?: string | undefined;
  onClear?: (() => void) | undefined;
}

const FilterChipButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const canClear: boolean = Boolean(props.onClear);

  return (
    <div
      data-testid="filter-chip"
      className={`${FILTER_CHIP_BOX_CLASSES} ${
        props.isActive
          ? FILTER_CHIP_ACTIVE_CLASSES
          : FILTER_CHIP_INACTIVE_CLASSES
      }`}
    >
      <button
        type="button"
        onClick={props.onToggle}
        className={FILTER_CHIP_TRIGGER_CLASSES}
        aria-expanded={props.isExpanded}
        aria-haspopup={props.popupKind}
      >
        {props.children}
        {canClear && (
          <span aria-hidden="true" className={FILTER_CHIP_CLEAR_PLACE_CLASSES} />
        )}
      </button>
      {canClear && (
        <button
          type="button"
          onClick={() => {
            props.onClear?.();
          }}
          className={FILTER_CHIP_CLEAR_CLASSES}
          aria-label={props.clearLabel}
        >
          <Icon icon={IconProp.Close} className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export default FilterChipButton;
