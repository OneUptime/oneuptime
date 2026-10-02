import IconProp from "../../../Types/Icon/IconProp";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "../../Types/UseAnchoredFieldPopup";
import useTranslateValue from "../../Utils/Translation";
import Icon from "../Icon/Icon";
import { PeopleChip } from "./PeopleList";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "./PeopleSearchPopup";
import {
  addToPeoplePickerValue,
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
  removeFromPeoplePickerValue,
} from "./PeoplePickerTypes";
import usePeopleOptions, { PeopleOptionsLookup } from "./usePeopleOptions";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";

/*
 * One field for several kinds of pick - owners are people and teams - in
 * place of a dropdown for each: what is picked shows as chips, each with a
 * remove button, and "Add owner" opens one search list of every kind, the
 * same list the Owners page opens. Picking is one click, several in a row.
 *
 * The button comes first and the chips after it, so the button - and the
 * list hanging from it - stays where it is while picks are added: the next
 * row to click never moves out from under the pointer.
 *
 * Controlled: the value is the picks as ids per kind, and every change is
 * the whole new value. Used as a form field (FormFieldSchemaType.PeoplePicker,
 * which writes each kind to its own form value) and on its own.
 */

export interface ComponentProps {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
  onChange: (value: PeoplePickerValue) => void;
  // The button that opens the search list. Default: "Add".
  addButtonText?: string | undefined;
  searchPlaceholder?: string | undefined;
  // What the search list says when there is nothing to pick at all.
  emptyText?: string | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  // The id of the label that names the field.
  ariaLabelledby?: string | undefined;
  dataTestId?: string | undefined;
  // The search list closed: the field has been visited.
  onBlur?: (() => void) | undefined;
}

const PeoplePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const errorId: string = `${useId()}-people-picker-error`;

  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
  });

  const lookup: PeopleOptionsLookup = usePeopleOptions({
    kinds: props.kinds,
    value: props.value,
  });

  /*
   * The value the latest change was made from. Picks made in a row, before
   * the form has handed the last change back, must not undo each other.
   */
  const latestValueRef: React.MutableRefObject<PeoplePickerValue> =
    useRef<PeoplePickerValue>(props.value);

  useEffect(() => {
    latestValueRef.current = props.value;
  }, [props.value]);

  const wasOpenRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    if (wasOpenRef.current && !popup.isPopupOpen) {
      props.onBlur?.();
    }

    wasOpenRef.current = popup.isPopupOpen;
  }, [popup.isPopupOpen]);

  const picks: Array<{ kind: PeoplePickerKind; id: string }> = useMemo(() => {
    const result: Array<{ kind: PeoplePickerKind; id: string }> = [];

    for (const kind of props.kinds) {
      for (const id of props.value[kind] || []) {
        result.push({ kind, id });
      }
    }

    return result;
  }, [props.kinds.join(","), props.value]);

  const selectedKeys: Set<string> = useMemo((): Set<string> => {
    return new Set<string>(
      picks.map((pick: { kind: PeoplePickerKind; id: string }): string => {
        return getPeoplePickerOptionKey(pick.kind, pick.id);
      }),
    );
  }, [picks]);

  const change: (next: PeoplePickerValue) => void = (
    next: PeoplePickerValue,
  ): void => {
    latestValueRef.current = next;
    props.onChange(next);
  };

  const remove: (kind: PeoplePickerKind, id: string) => void = (
    kind: PeoplePickerKind,
    id: string,
  ): void => {
    const existing: string | undefined = (
      latestValueRef.current[kind] || []
    ).find((candidate: string): boolean => {
      return candidate.toLowerCase() === id.toLowerCase();
    });

    change(
      removeFromPeoplePickerValue(latestValueRef.current, kind, existing || id),
    );
  };

  const onPick: (option: PeoplePickerOption, isPicked: boolean) => void = (
    option: PeoplePickerOption,
    isPicked: boolean,
  ): void => {
    lookup.remember([option]);

    if (isPicked) {
      remove(option.kind, option.id);
      return;
    }

    change(
      addToPeoplePickerValue(latestValueRef.current, option.kind, option.id),
    );
  };

  const addButtonText: string = props.addButtonText || "Add";
  const isInteractive: boolean = !props.disabled;

  return (
    <div data-testid={props.dataTestId || "people-picker"}>
      <div
        role="group"
        aria-labelledby={props.ariaLabelledby}
        aria-describedby={props.error ? errorId : undefined}
        className="flex flex-wrap items-center gap-2"
      >
        <div ref={popup.anchorRef} className="inline-flex">
          <button
            type="button"
            data-testid="people-picker-add-button"
            disabled={!isInteractive}
            aria-haspopup="dialog"
            aria-expanded={popup.isPopupOpen}
            aria-controls={popup.isPopupOpen ? popup.popupId : undefined}
            onClick={() => {
              if (isInteractive) {
                popup.togglePopup();
              }
            }}
            onKeyDown={isInteractive ? popup.onTriggerKeyDown : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon icon={IconProp.Add} className="h-4 w-4" />
            <span>{translateString(addButtonText) || addButtonText}</span>
          </button>
        </div>

        {picks.map(
          (pick: { kind: PeoplePickerKind; id: string }): ReactElement => {
            return (
              <PeopleChip
                key={getPeoplePickerOptionKey(pick.kind, pick.id)}
                kind={pick.kind}
                id={pick.id}
                option={lookup.getOption(pick.kind, pick.id)}
                disabled={!isInteractive}
                onRemove={
                  isInteractive
                    ? () => {
                        remove(pick.kind, pick.id);
                      }
                    : undefined
                }
              />
            );
          },
        )}
      </div>

      {lookup.error && (
        <p className="mt-1 text-sm text-gray-500">{lookup.error}</p>
      )}

      {props.error && (
        <p
          id={errorId}
          role="alert"
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
        >
          {props.error}
        </p>
      )}

      <PeopleSearchPopup
        popup={popup}
        kinds={props.kinds}
        selectedKeys={selectedKeys}
        selectionMode="toggle"
        onPick={onPick}
        onOptionsLoaded={lookup.remember}
        searchPlaceholder={props.searchPlaceholder}
        emptyText={props.emptyText}
        ariaLabel={addButtonText}
      />
    </div>
  );
};

export default PeoplePicker;
