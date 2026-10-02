import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { translateTemplate } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { DraggableProvidedDragHandleProps } from "react-beautiful-dnd";

/*
 * The grip a row of a reorderable list is dragged by - the same six dots the
 * column picker and the on-call layer users are dragged by.
 *
 * It is a real control, not decoration: react-beautiful-dnd makes it
 * focusable, and from the keyboard Space picks the row up, the arrow keys
 * move it and Space drops it (Escape puts it back). The accessible name says
 * which row it moves.
 *
 * While reordering is off - a filter or search is narrowing the list, or a
 * move is still being saved - the grip stays where it is, greyed out, and
 * says why instead of silently doing nothing.
 */
export interface ComponentProps {
  dragHandleProps?: DraggableProvidedDragHandleProps | null | undefined;
  // What the row is ("Rule: Critical incidents"), for the grip's name.
  itemLabel?: string | undefined;
  isDisabled?: boolean | undefined;
  disabledReason?: string | undefined;
  className?: string | undefined;
}

export const DRAG_HANDLE_TEST_ID: string = "drag-handle";

const DragHandle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const hint: string = translateString("Drag to reorder") || "Drag to reorder";

  const label: string = props.itemLabel
    ? translateTemplate("Drag to reorder {{item}}", { item: props.itemLabel })
    : hint;

  const disabledReason: string | undefined = props.disabledReason
    ? translateString(props.disabledReason) || props.disabledReason
    : undefined;

  return (
    <div
      {...(props.dragHandleProps || {})}
      /*
       * Focusable whether or not dragging is on. react-beautiful-dnd hands a
       * disabled row no handle props at all, so a grip that relied on its
       * tabIndex lost keyboard focus the moment a row dropped from the
       * keyboard was being saved - and the person's place on the page with
       * it. Disabled, it can still be reached, and says why.
       */
      tabIndex={0}
      role="button"
      data-testid={DRAG_HANDLE_TEST_ID}
      aria-label={label}
      aria-disabled={props.isDisabled ? true : undefined}
      title={props.isDisabled ? disabledReason || hint : hint}
      className={`inline-flex h-7 w-6 flex-none items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isDisabled
          ? "cursor-not-allowed text-gray-300"
          : "cursor-grab text-gray-400 hover:text-gray-700 active:cursor-grabbing"
      } ${props.className || ""}`}
    >
      <Icon icon={IconProp.GripVertical} className="h-5 w-5" />
    </div>
  );
};

export default DragHandle;
