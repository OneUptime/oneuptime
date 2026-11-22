import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import FieldError from "../Forms/Fields/FieldError";
import Label from "../../../Models/DatabaseModels/Label";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import Icon from "../Icon/Icon";
import {
  DROPDOWN_MENU_Z_INDEX,
  DropdownOption,
  DropdownOptionGroup,
  DropdownOptionLabel,
  DropdownValue,
  getDropdownOptionText,
} from "../Dropdown/Dropdown";
import { isRecordNameAsWritten } from "../../../Utils/DefaultRecordNames";
import { DropdownChange } from "../Dropdown/DropdownChange";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import joinAriaIds from "../../Utils/AriaIds";
import {
  canPickByLabel,
  withLabels,
  withSearchIn,
} from "./EntityDropdownQuery";
import { getEntityDropdownEmptyListText } from "./EntityDropdownEmptyList";
import useLabelSearch, { LabelSearch } from "./LabelSearch";
import ArchivedValuePicker from "../../Utils/ArchivedValuePicker";
import ArchivedTag from "../ArchivedTag/ArchivedTag";
import {
  SharedNameMark,
  getSharedNameFacts,
  getSharedNameMarks,
  getSharedNameOptionKey,
  getSharedNameSelect,
} from "../../Utils/SharedNameOptions";
import {
  SharedNameDetail,
  SharedNamePill,
  SharedNameValueDetail,
} from "../Dropdown/SharedNameOptionLines";

/*
 * EntityDropdown is the generalized successor to react-select-based Dropdown.
 * It accepts the same prop shape so callers can drop it in, but adds:
 *
 *   - A built-in chip / popover / search UI (no react-select dependency).
 *   - Server-side lazy search when `modelType` is provided — only the first
 *     page of options needs to live in component memory at any time.
 *   - A "Labels" tab in the popover for multi-select on entities that have
 *     a `labels` M2M to Label, mirroring the AffectedResourcesPicker UX.
 *     Click a label to bulk-select every entity tagged with it.
 *
 * For static-option dropdowns (enum-like fields, no modelType), the popover
 * filters client-side and the Labels tab is hidden. Single-select hides
 * the Labels tab too — bulk-adding into a single slot makes no sense.
 *
 * The prop surface intentionally mirrors `Dropdown` for the simplest possible
 * form-field swap. Internally we normalize everything to `Array<DropdownOption>`
 * (length 1 for single-select) and treat the chips as the source of truth so
 * we don't have to re-resolve IDs to labels on every render.
 */

/*
 * Same permissive shape as react-select-based Dropdown. Callers may pass
 * either raw values (string / number / ObjectID / arrays thereof) or
 * resolved DropdownOption(s). We normalize internally so consumers don't
 * need to think about it — particularly the form layer, which stores
 * raw IDs on Formik state.
 */
export type EntityDropdownValue =
  | DropdownValue
  | Array<DropdownValue>
  | DropdownOption
  | Array<DropdownOption>
  | ObjectID
  | Array<ObjectID>
  | null
  | undefined;

/** A label the Labels tab expanded, as handed to onLabelsBulkAdded. */
export interface BulkAddedLabel {
  id: string;
  name: string;
}

export interface EntityDropdownProps {
  /*
   * Static options (enum-like). Used as initial cache when modelType is set;
   * sole source of options when it isn't.
   */
  options?: Array<DropdownOption | DropdownOptionGroup> | undefined;

  // Drop-in compatibility with `Dropdown`.
  initialValue?: EntityDropdownValue | undefined;
  value?: EntityDropdownValue | undefined;
  /*
   * The value as the form keeps it (raw ids), and what the pick changed as
   * the list showed it: the options picked now and before, with their labels
   * (DropdownChange). A server-searched entry is often in no list the caller
   * holds, so this is the one place its label is known.
   */
  onChange?:
    | ((
        value: DropdownValue | Array<DropdownValue> | null,
        change: DropdownChange,
      ) => void)
    | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  placeholder?: string | undefined;
  // In the reader's words already: drawn as given (Field's, #7682).
  isPlaceholderTranslated?: boolean | undefined;
  className?: string | undefined;
  isMultiSelect?: boolean | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  id?: string | undefined;
  dataTestId?: string | undefined;
  ariaLabel?: string | undefined;
  ariaLabelledby?: string | undefined;
  // What describes the field besides its error, read first: its help.
  ariaDescribedby?: string | undefined;
  disabled?: boolean | undefined;
  /*
   * Whether a single pick can be taken back to nothing: its Clear button,
   * and Backspace or Delete on the value. A required pick passes false -
   * one is always picked, and Clear only emptied what the form then said
   * was required - as FormField's plain Dropdown has since #5482
   * (isClearable={!required}). A multi-select is not affected: each chip
   * keeps its own Remove. Unset, true.
   */
  isClearable?: boolean | undefined;

  /*
   * Entity backing. When set, the popover fetches options server-side and
   * (for multi-select on labeled entities) exposes a Labels tab.
   */
  modelType?: { new (): BaseModel } | undefined;
  labelField?: string | undefined;
  valueField?: string | undefined;
  colorField?: string | undefined;
  /*
   * The API every list the dropdown asks for goes through: the search, the
   * label of an entry already picked, and the Labels tab's labels and their
   * entries. A form hands it the API it reads its own options with
   * (ModelForm's modelAPI). The shared ModelAPI names the project the browser
   * last opened in the Dashboard, and the server lists that project's rows
   * only - so the Admin Dashboard hands AdminModelAPI, which names none, or a
   * master admin's project picker offers one project. Unset, the shared
   * ModelAPI.
   */
  modelAPI?: typeof ModelAPI | undefined;
  /*
   * Only the entries that match this, by columns of modelType - `{
   * isVerified: true }` offers only the domains a project has verified.
   * Every list the dropdown asks the server for to offer entries (the
   * search, and the Labels tab's entries for a label) is narrowed by it.
   * Looking up the label of an entry that is already picked is not, so a
   * saved value never shows as a raw id. The reader's search and label pick
   * are added to it, never in place of it: a condition on labelField or on
   * labels stays (EntityDropdownQuery). The Labels tab is left out when the
   * query has a condition on labels that a label pick cannot be added to.
   */
  query?: Record<string, unknown> | undefined;
  /*
   * Override the auto-detection — explicitly hide the Labels tab even on a
   * labeled entity, or force-show it.
   */
  enableLabelsTab?: boolean | undefined;
  /*
   * Fired when the Labels tab actually expands a label into entries, with the
   * labels that were applied. Bulk-add by tag is a one-time expansion - the
   * labels are dropped the moment the entries land in the selection - so a
   * caller that wants to remember which label a selection came from (to keep
   * it in sync later, say) has no other way to find out. Names come along
   * because the caller has no cheap way back from an id to one.
   */
  onLabelsBulkAdded?: ((labels: Array<BulkAddedLabel>) => void) | undefined;
  /*
   * What the open list says when there is nothing to pick at all: a
   * translation key naming what is missing, such as "No repositories are
   * connected yet." Unset, "Nothing to pick yet." (EntityDropdownEmptyList).
   */
  emptyListText?: string | undefined;
  /*
   * What a value the field holds reads as once looking it up found no such
   * record - a monitor or a label a rule's condition names, since deleted
   * (#7807): in English, to look up, drawn in muted italics as the rule's
   * card draws it, and removable like any pick. Unset, such a value shows
   * its id, as before: a form whose values the database keeps whole has
   * none.
   */
  notFoundLabel?: string | undefined;
  /*
   * When valueField is not the record's id - an inventory item picked by its
   * entityKey, an OpenStack project by its externalId, a metric by its name
   * - what else names one record by it: the cloud a project id belongs to,
   * say. A value the field holds is read by valueField within this (and
   * the project), never narrowed by `query`, so one that is no longer
   * pickable is still named. Unset, the value alone. Ignored while
   * valueField is "_id" (a value is read by its id, as always).
   */
  heldValueQuery?: Record<string, unknown> | undefined;
  /*
   * The columns the reader's search looks in. Unset, labelField alone, as
   * always: an inventory item is found by its name or by its key.
   */
  searchFields?: Array<string> | undefined;
  /*
   * A column drawn beside each option's name in the list, muted - an
   * inventory item's type ("Pod"), so two of one name are told apart.
   * Unset, none.
   */
  descriptionField?: string | undefined;
  /*
   * Whether archived values are offered too, marked Archived: a list's
   * filter, whose records that have one stay findable by it (#10646).
   * Unset, a dropdown of values that can be archived offers the live ones
   * only (ArchivedValuePicker).
   */
  listsArchivedValues?: boolean | undefined;
  /*
   * How a record reads as an option, past the one built from labelField,
   * colorField and descriptionField: a network device named by its hostname
   * when it has no name, and without its hostname beside a name that is the
   * same (#10646). Every record the dropdown reads - a search's, a held
   * value's, a label's entries - goes through it. Unset, as built.
   */
  formatOption?:
    | ((option: DropdownOption, record: BaseModel) => DropdownOption)
    | undefined;
}

const SEARCH_DEBOUNCE_MS: number = 250;
const SEARCH_PAGE_SIZE: number = 50;
const LABEL_PREVIEW_LIMIT: number = 50;
const MENU_GAP_PX: number = 4;
const MENU_MAX_HEIGHT_PX: number = 384;
const MENU_MIN_USEFUL_HEIGHT_PX: number = 160;
const MENU_VIEWPORT_PADDING_PX: number = 8;

interface EntityDropdownMenuPosition {
  bottom?: number | undefined;
  left: number;
  maxHeight: number;
  top?: number | undefined;
  width: number;
}

const flattenOptions: (
  options: Array<DropdownOption | DropdownOptionGroup> | undefined,
) => Array<DropdownOption> = (
  options: Array<DropdownOption | DropdownOptionGroup> | undefined,
): Array<DropdownOption> => {
  if (!options) {
    return [];
  }
  const flat: Array<DropdownOption> = [];
  for (const item of options) {
    if (
      item &&
      typeof item === "object" &&
      "options" in item &&
      Array.isArray((item as DropdownOptionGroup).options)
    ) {
      for (const sub of (item as DropdownOptionGroup).options) {
        flat.push(sub);
      }
    } else {
      flat.push(item as DropdownOption);
    }
  }
  return flat;
};

/*
 * Pull a string key out of any incoming DropdownValue (string | number |
 * boolean | ObjectID-stringified). All comparisons + map keys use the
 * string form to dodge mismatches between numeric and string IDs.
 */
const valueKey: (v: DropdownValue) => string = (v: DropdownValue): string => {
  if (typeof v === "string") {
    return v;
  }
  return String(v);
};

/*
 * Normalize the prop value down to a list of string keys regardless of
 * the shape callers pass. Mirrors react-select-Dropdown's value coercion
 * so the form layer can keep storing whichever shape it has today.
 */
const valueToKeys: (v: EntityDropdownValue) => Array<string> = (
  v: EntityDropdownValue,
): Array<string> => {
  if (v === undefined || v === null) {
    return [];
  }
  if (typeof v === "string") {
    return v === "" ? [] : [v];
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return [String(v)];
  }
  if (v instanceof ObjectID) {
    return [v.toString()];
  }
  if (Array.isArray(v)) {
    const keys: Array<string> = [];
    for (const item of v) {
      if (item === undefined || item === null) {
        continue;
      }
      if (item instanceof ObjectID) {
        keys.push(item.toString());
        continue;
      }
      if (typeof item === "string") {
        if (item !== "") {
          keys.push(item);
        }
        continue;
      }
      if (typeof item === "number" || typeof item === "boolean") {
        keys.push(String(item));
        continue;
      }
      if (typeof item === "object" && "value" in item) {
        keys.push(valueKey((item as DropdownOption).value));
        continue;
      }
    }
    return keys;
  }
  if (typeof v === "object" && v && "value" in v) {
    return [valueKey((v as DropdownOption).value)];
  }
  return [];
};

/*
 * Best-effort runtime detection of a `labels` ManyToMany. The convention
 * across OneUptime models is a property literally named `labels` typed
 * `Array<Label>` (44 such models at last count), so a property-existence
 * probe is the cheapest reliable check we can do without yanking column
 * metadata. Callers can override via `enableLabelsTab` if heuristics fail.
 */
const detectLabelsField: (
  ModelType: { new (): BaseModel } | undefined,
) => boolean = (ModelType: { new (): BaseModel } | undefined): boolean => {
  if (!ModelType) {
    return false;
  }
  try {
    const instance: BaseModel = new ModelType();
    /*
     * OneUptime models declare `public labels?: Array<Label> = undefined;`
     * so the property is present on the instance (initialized to undefined)
     * and the `in` check is reliable. We add the column-metadata probe
     * underneath as a belt-and-suspenders fallback in case a future model
     * declares the field differently.
     */
    if ("labels" in (instance as unknown as Record<string, unknown>)) {
      return true;
    }
    type WithColumnLookup = {
      getTableColumnMetadata?: (name: string) => unknown;
      getTableColumns?: () => { columns?: Array<string> };
    };
    const metaProbe: WithColumnLookup = instance as unknown as WithColumnLookup;
    if (
      typeof metaProbe.getTableColumnMetadata === "function" &&
      metaProbe.getTableColumnMetadata("labels")
    ) {
      return true;
    }
    if (typeof metaProbe.getTableColumns === "function") {
      const cols: { columns?: Array<string> } | undefined =
        metaProbe.getTableColumns();
      if (cols?.columns?.includes("labels")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

const EntityDropdown: FunctionComponent<EntityDropdownProps> = (
  props: EntityDropdownProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isMulti: boolean = Boolean(props.isMultiSelect);
  const modelType: { new (): BaseModel } | undefined = props.modelType;
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;
  const labelField: string = props.labelField || "name";
  const valueField: string = props.valueField || "_id";
  /*
   * Color column auto-detection mirrors ModelForm.fetchDropdownOptions —
   * BaseModel exposes getFirstColorColumn() which returns the first column
   * decorated as a color (Severity.color, Status.color, etc.). When set,
   * we include it in the server-side SELECT so our supplemental searches
   * carry the same color metadata as the form's pre-fetch.
   */
  const detectedColorField: string | undefined = useMemo(() => {
    if (!modelType) {
      return undefined;
    }
    try {
      type WithColorProbe = {
        getFirstColorColumn?: () => string | null | undefined;
      };
      const probe: WithColorProbe =
        new modelType() as unknown as WithColorProbe;
      if (typeof probe.getFirstColorColumn === "function") {
        return probe.getFirstColorColumn() || undefined;
      }
    } catch {
      // Model can't be instantiated for inspection; fall back to no color.
    }
    return undefined;
  }, [modelType]);
  const colorField: string | undefined = props.colorField || detectedColorField;

  /*
   * The table its entries are records of, which says how each one's name
   * reads (Common/Utils/DefaultRecordNames). Unknown for a list of static
   * options, which no table names.
   */
  const tableName: string | undefined = useMemo(() => {
    if (!modelType) {
      return undefined;
    }
    try {
      return new modelType().tableName || undefined;
    } catch {
      return undefined;
    }
  }, [modelType]);

  /*
   * AN ENTRY'S LABEL, AS ITS READER READS IT - by the rule a Dropdown's
   * option reads by (getDropdownOptionText), decided entry by entry:
   *
   *   - an option that says how it reads (isUserContent) reads so: true,
   *     drawn as written; false, looked up in the reader's language;
   *   - any other entry is a record of the dropdown's table, and its name
   *     reads by that table's list (isRecordNameAsWritten): a label named
   *     "Network" as written, never "Red", and the default state
   *     "Resolved" in the reader's words ("Resuelto"), as its badge reads
   *     it. A list of static options names no table, so its labels are
   *     drawn as written, as they always were here.
   *
   * The chips, the value picked, the list and a label's preview all draw an
   * entry through this, so they never disagree.
   */
  const getOptionText: (option: DropdownOption) => string = useCallback(
    (option: DropdownOption): string => {
      return getDropdownOptionText(
        {
          label: option.label,
          isUserContent:
            option.isUserContent ??
            isRecordNameAsWritten(tableName, option.label),
        },
        translator.translateText,
      );
    },
    [tableName, translator],
  );

  /*
   * The query is read from a ref when a request goes out, and the search
   * re-runs when its content changes - not when a caller hands in an equal
   * object on every render, which would search again on every render.
   */
  /*
   * A dropdown of values that can be archived lists the live ones only
   * (ArchivedValuePicker); a value a record already has is read by its id
   * below, archived or not.
   */
  const pickerQuery: Record<string, unknown> = props.listsArchivedValues
    ? { ...(props.query || {}) }
    : ArchivedValuePicker.getPickerQuery(modelType, props.query);
  /*
   * What a search reads to mark an archived value it offers: a list's filter
   * offers them (listsArchivedValues).
   */
  const archivedSelect: Record<string, true> = props.listsArchivedValues
    ? ArchivedValuePicker.getSelectedValueSelect(modelType)
    : {};
  const baseQueryRef: React.MutableRefObject<Record<string, unknown>> =
    useRef<Record<string, unknown>>(pickerQuery);
  baseQueryRef.current = pickerQuery;
  const baseQueryKey: string = JSON.stringify(pickerQuery);
  /*
   * The columns a search looks in (searchFields; labelField unless named),
   * and what a held value is read within (heldValueQuery), read from refs
   * as the query is.
   */
  const searchFields: Array<string> =
    props.searchFields && props.searchFields.length > 0
      ? props.searchFields
      : [labelField];
  const searchFieldsRef: React.MutableRefObject<Array<string>> =
    useRef<Array<string>>(searchFields);
  searchFieldsRef.current = searchFields;
  const searchFieldsKey: string = searchFields.join("|");
  const heldValueQueryRef: React.MutableRefObject<
    Record<string, unknown> | undefined
  > = useRef<Record<string, unknown> | undefined>(props.heldValueQuery);
  heldValueQueryRef.current = props.heldValueQuery;
  const descriptionField: string | undefined = props.descriptionField;
  // Read from a ref, so a caller's inline function never searches again.
  const formatOptionRef: React.MutableRefObject<
    EntityDropdownProps["formatOption"]
  > = useRef<EntityDropdownProps["formatOption"]>(props.formatOption);
  formatOptionRef.current = props.formatOption;
  const hasLabelsAutoDetected: boolean = useMemo(() => {
    return detectLabelsField(modelType);
  }, [modelType]);
  /*
   * The Labels tab is only meaningful on multi-select against a labeled
   * entity. enableLabelsTab is an opt-out override (or explicit opt-in for
   * cases where the heuristic misses).
   */
  const labelsTabEnabled: boolean =
    isMulti &&
    (props.enableLabelsTab !== undefined
      ? props.enableLabelsTab
      : hasLabelsAutoDetected) &&
    Boolean(modelType) &&
    canPickByLabel(props.query || {});

  /*
   * optionsCache is the single source of truth for which DropdownOption goes
   * with which value. It's seeded with the props.options the form pre-fetched
   * and grows as the user types (server-side search) or as we resolve
   * previously-selected values that weren't in the first page.
   */
  const initialFlat: Array<DropdownOption> = useMemo(() => {
    return flattenOptions(props.options);
  }, [props.options]);

  const optionsCacheRef: React.MutableRefObject<Map<string, DropdownOption>> =
    useRef<Map<string, DropdownOption>>(new Map());

  /*
   * The values a finished look-up found no record for (notFoundLabel): a
   * record since deleted. One still being looked up is not among them.
   */
  const notFoundKeysRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());

  /*
   * Seed the cache *during render* rather than in a useEffect. A pure-effect
   * seed only fires after first paint, which means the first render's
   * `selectedOptions` lookup misses, the chip falls back to "label = raw
   * UUID", and the user sees an ID flash by before the next render swaps
   * in the real label. Mutating a ref during render is safe because we
   * don't read derived state from it within the same render — we read it
   * via `selectedOptions` below, whose useMemo deps already include the
   * inputs that change the cache.
   */
  for (const opt of initialFlat) {
    optionsCacheRef.current.set(valueKey(opt.value), opt);
  }

  /*
   * selectedKeys is the source of truth for what the user has picked. We
   * never mirror it from props beyond the initial sync — props.value updates
   * are honored through the effect below so saved-state restores work.
   */
  const externalKeys: Array<string> = useMemo(() => {
    /*
     * value takes precedence over initialValue (matching react-select
     * controlled-component semantics). We intentionally treat `undefined`
     * as "fall back to initialValue" and any other value as authoritative
     * so callers can clear the field by passing null.
     */
    const source: EntityDropdownValue =
      props.value !== undefined ? props.value : props.initialValue;
    return valueToKeys(source);
  }, [props.value, props.initialValue]);

  /*
   * Also harvest DropdownOption envelopes from props.value / initialValue,
   * so a parent that hands us a full option (rather than a raw ID) gets
   * its label cached immediately — no resolve round-trip needed.
   */
  const inboundOptions: Array<DropdownOption> = useMemo(() => {
    const collected: Array<DropdownOption> = [];
    const candidates: Array<EntityDropdownValue> = [
      props.value,
      props.initialValue,
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (Array.isArray(candidate)) {
        for (const item of candidate) {
          if (
            item &&
            typeof item === "object" &&
            !(item instanceof ObjectID) &&
            "value" in item &&
            "label" in item
          ) {
            collected.push(item as DropdownOption);
          }
        }
        continue;
      }
      if (
        typeof candidate === "object" &&
        !(candidate instanceof ObjectID) &&
        "value" in candidate &&
        "label" in candidate
      ) {
        collected.push(candidate as DropdownOption);
      }
    }
    return collected;
  }, [props.value, props.initialValue]);

  /*
   * Same reasoning as initialFlat — seed at render time so the first paint
   * has the labels.
   */
  for (const opt of inboundOptions) {
    optionsCacheRef.current.set(valueKey(opt.value), opt);
  }

  const [selectedKeys, setSelectedKeys] = useState<Array<string>>(externalKeys);

  /*
   * Mirror prop value back into local state when the parent rewrites it
   * (e.g. form reset, saved-view restore). We skip the round-trip if the
   * arrays are identical to avoid render thrash.
   */
  useEffect(() => {
    const same: boolean =
      externalKeys.length === selectedKeys.length &&
      externalKeys.every((k: string, i: number) => {
        return k === selectedKeys[i];
      });
    if (same) {
      return;
    }
    setSelectedKeys(externalKeys);
    // Also stash any new options that came in via props into the cache.
    for (const opt of initialFlat) {
      optionsCacheRef.current.set(valueKey(opt.value), opt);
    }
  }, [externalKeys.join("|")]);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [activeTab, setActiveTab] = useState<"options" | "labels">("options");

  // Labels tab state.
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>([]);
  const [isApplyingLabels, setIsApplyingLabels] = useState<boolean>(false);
  const [labelError, setLabelError] = useState<string>("");
  const [expandedLabelIds, setExpandedLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [resourcesByLabel, setResourcesByLabel] = useState<
    Record<string, Array<DropdownOption>>
  >({});
  const [loadingLabelIds, setLoadingLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [labelLoadErrors, setLabelLoadErrors] = useState<
    Record<string, string>
  >({});

  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const controlRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const valueButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const debounceRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const searchSeqRef: React.MutableRefObject<number> = useRef<number>(0);
  const [menuPosition, setMenuPosition] =
    useState<EntityDropdownMenuPosition | null>(null);

  const updateMenuPosition: () => void = useCallback((): void => {
    if (!controlRef.current || typeof window === "undefined") {
      return;
    }

    const controlRect: DOMRect = controlRef.current.getBoundingClientRect();
    const availableWidth: number = Math.max(
      0,
      window.innerWidth - MENU_VIEWPORT_PADDING_PX * 2,
    );
    const width: number = Math.min(controlRect.width, availableWidth);
    const maximumLeft: number = Math.max(
      MENU_VIEWPORT_PADDING_PX,
      window.innerWidth - MENU_VIEWPORT_PADDING_PX - width,
    );
    const left: number = Math.min(
      Math.max(controlRect.left, MENU_VIEWPORT_PADDING_PX),
      maximumLeft,
    );
    const spaceBelow: number = Math.max(
      0,
      window.innerHeight -
        controlRect.bottom -
        MENU_GAP_PX -
        MENU_VIEWPORT_PADDING_PX,
    );
    const spaceAbove: number = Math.max(
      0,
      controlRect.top - MENU_GAP_PX - MENU_VIEWPORT_PADDING_PX,
    );
    const shouldOpenAbove: boolean =
      spaceBelow < MENU_MIN_USEFUL_HEIGHT_PX && spaceAbove > spaceBelow;
    const availableHeight: number = shouldOpenAbove ? spaceAbove : spaceBelow;

    setMenuPosition({
      bottom: shouldOpenAbove
        ? window.innerHeight - controlRect.top + MENU_GAP_PX
        : undefined,
      left,
      maxHeight: Math.min(MENU_MAX_HEIGHT_PX, availableHeight),
      top: shouldOpenAbove ? undefined : controlRect.bottom + MENU_GAP_PX,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    let animationFrame: number | null = null;
    const schedulePositionUpdate: () => void = (): void => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame((): void => {
        animationFrame = null;
        updateMenuPosition();
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", schedulePositionUpdate);
    document.addEventListener("scroll", schedulePositionUpdate, true);
    /*
     * The control can move or change size after the menu was placed with
     * nothing scrolled or resized: a dialog that opens on a dropdown with
     * the focus scales in (the menu was placed against its smaller, moving
     * frame), and a class's styles can arrive a frame late - Code's Add
     * context dialog opened its incident list half as wide again as the
     * field, out past the dialog. The menu follows the control: when a
     * transition ends, and when the control's size changes.
     */
    document.addEventListener("transitionend", schedulePositionUpdate, true);
    const resizeObserver: ResizeObserver | null =
      typeof window.ResizeObserver === "function" && controlRef.current
        ? new window.ResizeObserver(schedulePositionUpdate)
        : null;

    if (resizeObserver && controlRef.current) {
      resizeObserver.observe(controlRef.current);
    }

    return () => {
      window.removeEventListener("resize", schedulePositionUpdate);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      document.removeEventListener(
        "transitionend",
        schedulePositionUpdate,
        true,
      );
      resizeObserver?.disconnect();
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isOpen, selectedKeys, updateMenuPosition]);

  // Click-outside closes the popover.
  useEffect(() => {
    const handle: (event: MouseEvent) => void = (event: MouseEvent): void => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
    };
  }, []);

  /*
   * The keyboard's side of the click-outside above. Tabbing out of the
   * dropdown - from the input, or on past the last option in the menu - onto
   * the next field used to leave the menu open, and when that field opened a
   * popup of its own (the next dropdown, the Affected Resources picker) the
   * two stacked on top of each other. The menu is a DOM child of the
   * container (laid out fixed, never portalled), so moving between the input,
   * the chips, the menu's tabs and its options stays inside and keeps it open.
   *
   * Only a move onto another element closes it. With no element to go to
   * (relatedTarget null, or the document itself) focus went nowhere in
   * particular - the window lost focus, a press landed on something that
   * takes no focus, the focused option unmounted - and presses are for the
   * listener above to judge.
   */
  const closeWhenFocusLeaves: (
    event: React.FocusEvent<HTMLDivElement>,
  ) => void = (event: React.FocusEvent<HTMLDivElement>): void => {
    const nextFocused: EventTarget | null = event.relatedTarget;

    if (
      !(nextFocused instanceof Element) ||
      event.currentTarget.contains(nextFocused)
    ) {
      return;
    }

    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  /*
   * A single-select showing its value swaps elements as the menu opens and
   * closes: the value button while closed, the search input while open. Focus
   * meant for the field across that swap has to wait for the element taking
   * over, which is not mounted yet when the swap is asked for. Set by the
   * value button, which hands focus to the search input as the menu opens,
   * and by Escape, which hands it back to the value button as the menu
   * closes (see closeMenuOnEscape). Without it focus went down with the
   * element being replaced, to the page: typing did not search, focus could
   * never leave the dropdown to close the menu (see closeWhenFocusLeaves),
   * and a keyboard user was left outside the field they were working in.
   */
  const focusFieldAfterSwapRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useLayoutEffect(() => {
    if (!focusFieldAfterSwapRef.current) {
      return;
    }

    focusFieldAfterSwapRef.current = false;

    if (isOpen) {
      inputRef.current?.focus();
      return;
    }

    valueButtonRef.current?.focus();
  }, [isOpen]);

  /*
   * Clearing what a closed single-select shows takes away the value button
   * and its Clear button, whichever of the two had focus, and puts the search
   * input in their place. Focus follows to that input once it is mounted (see
   * the effect after showSingleSelectedText), with the menu kept closed while
   * it lands: clearing a field is not asking for a new pick, and a menu that
   * opened by itself would keep Tab among its options instead of moving on to
   * the next field. Without this focus went down with the pressed button, to
   * the page.
   */
  const focusInputAfterClearRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const keepMenuClosedOnFocusRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // Names the shown value to a screen reader (aria-describedby).
  const valueLabelId: string = useId();
  // The error under the field, read with the control that failed.
  const errorId: string = `entity-dropdown-error-${useId()}`;

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  /*
   * BaseModel -> DropdownOption. Pulls label/value (and optional color)
   * via the configured field names. We don't try to be clever about nested
   * objects — the form pre-fetcher follows the same flat convention.
   */
  const modelToOption: (item: BaseModel) => DropdownOption | null = useCallback(
    (item: BaseModel): DropdownOption | null => {
      const raw: Record<string, unknown> = item as unknown as Record<
        string,
        unknown
      >;
      const valueRaw: unknown = raw[valueField] ?? item._id;
      const labelRaw: unknown = raw[labelField];
      if (valueRaw === undefined || valueRaw === null) {
        return null;
      }
      const label: string =
        typeof labelRaw === "string"
          ? labelRaw
          : labelRaw &&
              typeof (labelRaw as { toString?: () => string }).toString ===
                "function"
            ? (labelRaw as { toString: () => string }).toString()
            : "";
      const valueStr: string =
        typeof valueRaw === "string"
          ? valueRaw
          : (valueRaw as { toString: () => string }).toString();
      const option: DropdownOption = {
        value: valueStr,
        label: label || valueStr,
      };
      if (colorField) {
        const colorRaw: unknown = raw[colorField];
        if (colorRaw) {
          option.color = colorRaw as NonNullable<DropdownOption["color"]>;
        }
      }
      if (raw["isArchived"] === true) {
        option.isArchived = true;
      }
      // What tells it apart, drawn beside its name (descriptionField).
      if (descriptionField) {
        const descriptionRaw: unknown = raw[descriptionField];

        if (
          descriptionRaw !== undefined &&
          descriptionRaw !== null &&
          String(descriptionRaw).trim()
        ) {
          option.description = String(descriptionRaw);
        }
      }
      /*
       * A team, a label, an on-call policy or a schedule, listed by its
       * name: what tells it from another of the same name (#10064).
       */
      if (labelField === "name") {
        const sharedName: DropdownOption["sharedName"] =
          getSharedNameFacts(item);

        if (sharedName) {
          option.sharedName = sharedName;
        }
      }
      // How the caller has the record read (formatOption).
      return formatOptionRef.current
        ? formatOptionRef.current(option, item)
        : option;
    },
    [labelField, valueField, colorField, descriptionField],
  );

  /*
   * The columns every read selects beside the name: the value's own column
   * when it is not the id (an inventory item's entityKey) - the option's
   * value is read from it - and the description's. Nothing more for a
   * dropdown by id with no description, as before.
   */
  const valueSelect: Record<string, true> = {
    ...(valueField !== "_id" ? { [valueField]: true } : {}),
    ...(descriptionField ? { [descriptionField]: true } : {}),
  };

  /*
   * The columns each read selects beside the name, so records of one name
   * can be told apart: nothing for a model of any other kind, or a list
   * that is not by name.
   */
  const sharedNameSelect: Record<string, true> =
    labelField === "name" ? getSharedNameSelect(modelType) : {};

  /*
   * Server-side search. Runs when the popover is open on the options tab.
   * Static dropdowns (no modelType) skip the API and filter the seeded
   * options client-side instead.
   */
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    if (!isOpen || activeTab !== "options" || !modelType) {
      return;
    }
    const trimmed: string = searchQuery.trim();
    const mySeq: number = ++searchSeqRef.current;
    setIsLoading(true);
    debounceRef.current = window.setTimeout(
      async () => {
        try {
          const query: Query<BaseModel> = withSearchIn(
            baseQueryRef.current,
            searchFieldsRef.current,
            trimmed,
          ) as Query<BaseModel>;
          const baseSelect: Record<string, true> = {
            _id: true,
            [labelField]: true,
            ...valueSelect,
            ...sharedNameSelect,
            ...archivedSelect,
          } as Record<string, true>;
          if (colorField) {
            baseSelect[colorField] = true;
          }
          const result: ListResult<BaseModel> =
            await modelAPI.getList<BaseModel>({
              modelType: modelType,
              query: query,
              limit: SEARCH_PAGE_SIZE,
              skip: 0,
              select: baseSelect as never,
              sort: { [labelField]: SortOrder.Ascending } as never,
            });
          if (mySeq !== searchSeqRef.current) {
            return; // stale
          }
          const options: Array<DropdownOption> = [];
          for (const item of result.data) {
            const opt: DropdownOption | null = modelToOption(item);
            if (!opt) {
              continue;
            }
            options.push(opt);
            optionsCacheRef.current.set(valueKey(opt.value), opt);
          }
          setSearchResults(options);
        } catch {
          if (mySeq === searchSeqRef.current) {
            setSearchResults([]);
          }
        } finally {
          if (mySeq === searchSeqRef.current) {
            setIsLoading(false);
          }
        }
      },
      trimmed === "" ? 0 : SEARCH_DEBOUNCE_MS,
    );
  }, [
    searchQuery,
    isOpen,
    activeTab,
    modelType,
    modelAPI,
    labelField,
    colorField,
    modelToOption,
    baseQueryKey,
    searchFieldsKey,
  ]);

  /*
   * Resolve previously-selected values whose labels we don't yet have. Fires
   * once on mount and whenever externalKeys grows beyond what's in cache —
   * keeps the chips readable even when the form was saved with selections
   * that aren't on the dropdown's first page.
   */
  useEffect(() => {
    if (!modelType) {
      return;
    }
    const missing: Array<string> = selectedKeys.filter(
      (key: string): boolean => {
        return !optionsCacheRef.current.has(key);
      },
    );
    if (missing.length === 0) {
      return;
    }
    let cancelled: boolean = false;
    const resolve: () => Promise<void> = async (): Promise<void> => {
      try {
        const baseSelect: Record<string, true> = {
          _id: true,
          [labelField]: true,
          ...valueSelect,
          ...sharedNameSelect,
          // An archived value a record still has is marked as one.
          ...ArchivedValuePicker.getSelectedValueSelect(modelType),
        } as Record<string, true>;
        if (colorField) {
          baseSelect[colorField] = true;
        }
        /*
         * Read by the column the values are, never by the search's query:
         * an id names one record; another column's value (an inventory
         * item's entityKey) is read within heldValueQuery, and may name
         * more than one.
         */
        const isIdValue: boolean = valueField === "_id";
        const result: ListResult<BaseModel> = await modelAPI.getList<BaseModel>(
          {
            modelType: modelType,
            query: (isIdValue
              ? { _id: new Includes(missing) }
              : {
                  ...(heldValueQueryRef.current || {}),
                  [valueField]: new Includes(missing),
                }) as Query<BaseModel>,
            limit: isIdValue ? missing.length : LIMIT_PER_PROJECT,
            skip: 0,
            select: baseSelect as never,
            sort: {},
          },
        );
        if (cancelled) {
          return;
        }
        for (const item of result.data) {
          const opt: DropdownOption | null = modelToOption(item);
          if (opt) {
            optionsCacheRef.current.set(valueKey(opt.value), opt);
          }
        }
        // Asked for, and not there: no such record any more.
        for (const key of missing) {
          if (!optionsCacheRef.current.has(key)) {
            notFoundKeysRef.current.add(key);
          }
        }
        // Force a re-render so chips pick up the resolved labels.
        setSelectedKeys((prev: Array<string>): Array<string> => {
          return [...prev];
        });
      } catch {
        // Leave the unresolved chips as raw IDs.
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [
    selectedKeys.join("|"),
    modelType,
    modelAPI,
    labelField,
    colorField,
    modelToOption,
  ]);

  /*
   * The Labels tab's labels: the ones whose name holds what is typed,
   * searched on the server while the tab is open (useLabelSearch) - never
   * the project's first 10,000 filtered here (#10646).
   */
  const labelSearch: LabelSearch = useLabelSearch({
    isActive: labelsTabEnabled && isOpen && activeTab === "labels",
    searchText: searchQuery,
    modelAPI: modelAPI,
  });
  const filteredLabels: Array<Label> = labelSearch.labels;

  /*
   * The labels of the Labels tab that share a name (#10064), each with the
   * pill its list draws and what sets it apart.
   */
  const labelSharedNameMarks: Map<string, SharedNameMark> = useMemo(() => {
    return getSharedNameMarks(
      filteredLabels.map((label: Label) => {
        return {
          value: label._id?.toString() || "",
          label: label.name || "",
          sharedName: getSharedNameFacts(label),
        };
      }),
      translator,
    );
  }, [filteredLabels, translator.language]);

  /*
   * Available results = initialFlat (the form's pre-fetched set, which has
   * the color/labels metadata we want to preserve) UNIONed with searchResults
   * (the supplemental server-side hits for big lists), filtered by the
   * current query. Even for entity-backed dropdowns we keep initialFlat in
   * the mix so colors and any other rich fields the pre-fetch carried
   * survive — our supplemental fetch only requests the minimum SELECT.
   */
  const optionsList: Array<DropdownOption> = useMemo(() => {
    const q: string = searchQuery.trim().toLowerCase();
    const matches: (opt: DropdownOption) => boolean = (
      opt: DropdownOption,
    ): boolean => {
      if (q === "") {
        return true;
      }
      // The English finds an entry, and so does what the list shows for it.
      return (
        opt.label.toLowerCase().includes(q) ||
        getOptionText(opt).toLowerCase().includes(q)
      );
    };
    const seen: Map<string, number> = new Map();
    const out: Array<DropdownOption> = [];
    for (const opt of initialFlat) {
      const key: string = valueKey(opt.value);
      if (seen.has(key) || !matches(opt)) {
        continue;
      }
      seen.set(key, out.length);
      out.push(opt);
    }
    if (modelType) {
      for (const opt of searchResults) {
        const key: string = valueKey(opt.value);
        if (!matches(opt)) {
          continue;
        }
        const at: number | undefined = seen.get(key);
        if (at !== undefined) {
          /*
           * The form's own list knew the option without what tells it
           * from another of its name: the search's read does (#10064).
           */
          if (!out[at]!.sharedName && opt.sharedName) {
            out[at] = { ...out[at]!, sharedName: opt.sharedName };
          }
          continue;
        }
        seen.set(key, out.length);
        out.push(opt);
      }
    }
    return out;
  }, [modelType, searchResults, searchQuery, initialFlat, getOptionText]);

  /*
   * Filter out the currently-selected key(s) ONLY in multi-select. For
   * single-select the user needs to see the current value too so they can
   * compare and switch — react-select keeps the selected option visible
   * (just highlights it), so we match that.
   */
  const availableOptions: Array<DropdownOption> = useMemo(() => {
    if (!isMulti) {
      return optionsList;
    }
    const selectedSet: Set<string> = new Set(selectedKeys);
    return optionsList.filter((opt: DropdownOption): boolean => {
      return !selectedSet.has(valueKey(opt.value));
    });
  }, [optionsList, selectedKeys, isMulti]);

  // Clamp the keyboard cursor when the visible list shrinks.
  useEffect(() => {
    const len: number =
      activeTab === "labels" ? filteredLabels.length : availableOptions.length;
    if (highlightedIndex >= len) {
      setHighlightedIndex(len - 1);
    }
  }, [availableOptions, filteredLabels, highlightedIndex, activeTab]);

  /*
   * The options behind some keys, as the list knows them. A key whose label
   * has not been resolved yet is left out: its raw id is no name.
   */
  const getKnownOptions: (keys: Array<string>) => Array<DropdownOption> = (
    keys: Array<string>,
  ): Array<DropdownOption> => {
    const known: Array<DropdownOption> = [];

    for (const key of keys) {
      const option: DropdownOption | undefined =
        optionsCacheRef.current.get(key);

      if (option) {
        known.push(option);
      }
    }

    return known;
  };

  const notify: (next: Array<string>, previous: Array<string>) => void =
    useCallback(
      (next: Array<string>, previous: Array<string>): void => {
        if (!props.onChange) {
          return;
        }

        const change: DropdownChange = {
          selectedOptions: getKnownOptions(next),
          previousOptions: getKnownOptions(previous),
        };

        if (isMulti) {
          props.onChange(next as Array<DropdownValue>, change);
          return;
        }
        props.onChange(next.length > 0 ? next[0]! : null, change);
      },
      [isMulti, props.onChange],
    );

  const addOption: (
    opt: DropdownOption,
    pickedWithKeyboard?: boolean,
  ) => void = (opt: DropdownOption, pickedWithKeyboard?: boolean): void => {
    const key: string = valueKey(opt.value);
    optionsCacheRef.current.set(key, opt);
    if (isMulti) {
      if (selectedKeys.includes(key)) {
        return;
      }
      const next: Array<string> = [...selectedKeys, key];
      setSelectedKeys(next);
      notify(next, selectedKeys);
      setSearchQuery("");
      inputRef.current?.focus();
      return;
    }
    setSelectedKeys([key]);
    notify([key], selectedKeys);
    setSearchQuery("");
    /*
     * The pick closes the menu, which swaps the search input (or the option
     * that had focus) for the value button. A keyboard user's focus follows
     * to that button, as it does on Escape, instead of dropping to the page;
     * a pointer pick leaves focus alone, so no focus ring appears after a
     * click.
     */
    if (pickedWithKeyboard) {
      focusFieldAfterSwapRef.current = true;
    }
    setIsOpen(false);
  };

  const removeKey: (key: string) => void = (key: string): void => {
    const next: Array<string> = selectedKeys.filter((k: string): boolean => {
      return k !== key;
    });
    setSelectedKeys(next);
    notify(next, selectedKeys);
  };

  const clearAll: () => void = (): void => {
    setSelectedKeys([]);
    notify([], selectedKeys);
  };

  /*
   * Bulk-add via labels: fetch every entity tagged with any selected label
   * and merge into the current selection. Caps generous (LIMIT_PER_PROJECT)
   * since this is an intentional bulk action, not a typeahead.
   */
  const applyLabelSelection: () => Promise<void> = async (): Promise<void> => {
    const labelQuery: Record<string, unknown> | null = withLabels(
      baseQueryRef.current,
      selectedLabelIds,
    );
    if (!modelType || selectedLabelIds.length === 0 || !labelQuery) {
      return;
    }
    setIsApplyingLabels(true);
    setLabelError("");
    try {
      const baseSelect: Record<string, true> = {
        _id: true,
        [labelField]: true,
        ...sharedNameSelect,
      } as Record<string, true>;
      if (colorField) {
        baseSelect[colorField] = true;
      }
      const result: ListResult<BaseModel> = await modelAPI.getList<BaseModel>({
        modelType: modelType,
        query: labelQuery as Query<BaseModel>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: baseSelect as never,
        sort: { [labelField]: SortOrder.Ascending } as never,
      });
      const existing: Set<string> = new Set(selectedKeys);
      const additions: Array<string> = [];
      for (const item of result.data) {
        const opt: DropdownOption | null = modelToOption(item);
        if (!opt) {
          continue;
        }
        const key: string = valueKey(opt.value);
        optionsCacheRef.current.set(key, opt);
        if (!existing.has(key)) {
          existing.add(key);
          additions.push(key);
        }
      }
      /*
       * Tell the caller which labels the user applied. Reported before the
       * empty check below, and before the selection is cleared further down:
       * the interesting case is a label whose entries are ALL already
       * selected, which adds nothing here but is still a label the user asked
       * this selection to be built from.
       */
      props.onLabelsBulkAdded?.(
        selectedLabelIds.map((labelId: string): BulkAddedLabel => {
          // Named by the search that offered it, whatever is typed now.
          const label: Label | undefined = labelSearch.getLabel(labelId);

          return { id: labelId, name: label?.name || "" };
        }),
      );
      if (additions.length === 0) {
        setLabelError(
          "No new entries matched the selected labels (or you don't have read access).",
        );
        return;
      }
      const next: Array<string> = [...selectedKeys, ...additions];
      setSelectedKeys(next);
      notify(next, selectedKeys);
      setSelectedLabelIds([]);
      setSearchQuery("");
      setActiveTab("options");
      setIsOpen(false);
    } catch {
      setLabelError("Failed to fetch entries for the selected labels.");
    } finally {
      setIsApplyingLabels(false);
    }
  };

  const toggleLabelId: (id: string) => void = (id: string): void => {
    setSelectedLabelIds((prev: Array<string>): Array<string> => {
      if (prev.includes(id)) {
        return prev.filter((x: string): boolean => {
          return x !== id;
        });
      }
      return [...prev, id];
    });
  };

  const fetchLabelPreview: (labelId: string) => Promise<void> = async (
    labelId: string,
  ): Promise<void> => {
    const labelQuery: Record<string, unknown> | null = withLabels(
      baseQueryRef.current,
      [labelId],
    );
    if (!modelType || !labelQuery) {
      return;
    }
    setLoadingLabelIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      next.add(labelId);
      return next;
    });
    setLabelLoadErrors(
      (prev: Record<string, string>): Record<string, string> => {
        const next: Record<string, string> = { ...prev };
        delete next[labelId];
        return next;
      },
    );
    try {
      const baseSelect: Record<string, true> = {
        _id: true,
        [labelField]: true,
        ...sharedNameSelect,
      } as Record<string, true>;
      if (colorField) {
        baseSelect[colorField] = true;
      }
      const result: ListResult<BaseModel> = await modelAPI.getList<BaseModel>({
        modelType: modelType,
        query: labelQuery as Query<BaseModel>,
        limit: LABEL_PREVIEW_LIMIT,
        skip: 0,
        select: baseSelect as never,
        sort: { [labelField]: SortOrder.Ascending } as never,
      });
      const items: Array<DropdownOption> = [];
      for (const item of result.data) {
        const opt: DropdownOption | null = modelToOption(item);
        if (opt) {
          items.push(opt);
          optionsCacheRef.current.set(valueKey(opt.value), opt);
        }
      }
      setResourcesByLabel(
        (
          prev: Record<string, Array<DropdownOption>>,
        ): Record<string, Array<DropdownOption>> => {
          return { ...prev, [labelId]: items };
        },
      );
    } catch {
      setLabelLoadErrors(
        (prev: Record<string, string>): Record<string, string> => {
          return {
            ...prev,
            [labelId]: translationKey("Failed to load entries."),
          };
        },
      );
    } finally {
      setLoadingLabelIds((prev: Set<string>): Set<string> => {
        const next: Set<string> = new Set(prev);
        next.delete(labelId);
        return next;
      });
    }
  };

  const toggleLabelExpansion: (labelId: string) => void = (
    labelId: string,
  ): void => {
    setExpandedLabelIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
        if (resourcesByLabel[labelId] === undefined) {
          void fetchLabelPreview(labelId);
        }
      }
      return next;
    });
  };

  const selectedOptions: Array<DropdownOption> = useMemo(() => {
    return selectedKeys.map((key: string): DropdownOption => {
      const cached: DropdownOption | undefined =
        optionsCacheRef.current.get(key);
      if (cached) {
        return cached;
      }
      /*
       * A value no record answers to any more says so, where the page asks
       * (notFoundLabel), in words to look up - never as a name as written.
       */
      if (props.notFoundLabel && notFoundKeysRef.current.has(key)) {
        return {
          value: key,
          label: props.notFoundLabel,
          isUserContent: false,
          isNotFound: true,
        };
      }
      return { value: key, label: key };
    });
    /*
     * Cache is mutated during render based on initialFlat / inboundOptions
     * (see seed loops above), so include them here to make the dependency
     * graph honest — when the parent hands us new options, this memo
     * recomputes against the freshly-seeded cache.
     */
  }, [selectedKeys, initialFlat, inboundOptions, props.notFoundLabel]);

  /*
   * Records that share a name (#10064), among every one the dropdown
   * knows - the list and what is picked, which a multi-select takes out of
   * the list - each with its list's pill and what sets it apart.
   */
  const sharedNameMarks: Map<string, SharedNameMark> = useMemo(() => {
    const known: Map<string, DropdownOption> = new Map();

    for (const opt of [...optionsList, ...selectedOptions]) {
      const key: string = valueKey(opt.value);
      const before: DropdownOption | undefined = known.get(key);

      if (!before || (!before.sharedName && opt.sharedName)) {
        known.set(key, opt);
      }
    }

    return getSharedNameMarks(Array.from(known.values()), translator);
  }, [optionsList, selectedOptions, translator.language]);

  const getSharedNameMark: (
    opt: DropdownOption,
  ) => SharedNameMark | undefined = (
    opt: DropdownOption,
  ): SharedNameMark | undefined => {
    return sharedNameMarks.get(getSharedNameOptionKey(opt.value));
  };

  /*
   * Visual label color extracted from option.color (which can be either a
   * Color instance or a string). Used to render a small dot next to each
   * row that has one.
   */
  const optionColorString: (opt: DropdownOption) => string | undefined = (
    opt: DropdownOption,
  ): string | undefined => {
    const c: unknown = opt.color;
    if (!c) {
      return undefined;
    }
    if (typeof c === "string") {
      return c;
    }
    if (typeof (c as { toString?: () => string }).toString === "function") {
      return (c as { toString: () => string }).toString();
    }
    return undefined;
  };

  const labelColorString: (label: Label) => string | undefined = (
    label: Label,
  ): string | undefined => {
    const c: unknown = label.color;
    if (!c) {
      return undefined;
    }
    if (typeof c === "string") {
      return c;
    }
    if (typeof (c as { toString?: () => string }).toString === "function") {
      return (c as { toString: () => string }).toString();
    }
    return undefined;
  };

  /*
   * Render the *current selection* as either a chip row (multi) or the
   * single value in-place when the popover is closed (single). When the
   * popover is open the input takes over for typing.
   */
  const placeholderText: string =
    props.isPlaceholderTranslated && props.placeholder
      ? props.placeholder
      : translator.translateText(props.placeholder || "Select...") || "";
  const showSingleSelectedText: boolean =
    !isMulti && !isOpen && selectedOptions.length > 0;

  useLayoutEffect(() => {
    if (!focusInputAfterClearRef.current || showSingleSelectedText) {
      return;
    }

    focusInputAfterClearRef.current = false;
    // The focus event fires inside focus(), so the flag is read by then.
    keepMenuClosedOnFocusRef.current = true;
    inputRef.current?.focus();
    keepMenuClosedOnFocusRef.current = false;
  }, [showSingleSelectedText]);

  /*
   * Whether the single pick can be cleared from the field: not while it is
   * locked, and not when it is required (isClearable={false}) - one is
   * always picked, and another is picked from the list in its place.
   */
  const canClearPick: boolean = !props.disabled && props.isClearable !== false;

  /*
   * Clears what a closed single-select shows: its Clear button, or Backspace
   * or Delete on the value button, as in a text field. Focus then goes to the
   * search input that takes the two buttons' place (focusInputAfterClearRef).
   */
  const clearShownValue: () => void = (): void => {
    if (!canClearPick) {
      return;
    }

    focusInputAfterClearRef.current = true;
    clearAll();
  };

  /*
   * Escape while the menu is open closes just the menu, wherever focus is in
   * the dropdown: the search input, or - reached with Tab - an option, one of
   * the menu's tabs or footer buttons, a chip or the Clear button. It is
   * claimed, so Modal's document listener never hears it: that listener
   * closes the whole form and throws away its unsaved edits, which is what
   * Escape on a Tab-reached option used to do while Escape in the input only
   * closed the menu. With the menu already closed Escape is left alone, so
   * the next press still closes the modal.
   *
   * Focus goes back to the field rather than down with the menu's buttons.
   */
  const closeMenuOnEscape: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || !isOpen) {
      return;
    }

    event.preventDefault();

    if (!isMulti && selectedOptions.length > 0) {
      /*
       * Closing swaps the search input for the value button, so focus waits
       * for the button to mount (see focusFieldAfterSwapRef).
       */
      focusFieldAfterSwapRef.current = true;
    } else {
      // Focusing the input asks to open the menu; closing it after wins.
      inputRef.current?.focus();
    }

    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <div
      ref={containerRef}
      id={props.id}
      className={props.className || "relative mt-2 mb-1 w-full"}
      onBlur={closeWhenFocusLeaves}
      onKeyDown={closeMenuOnEscape}
    >
      {isMulti && selectedOptions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedOptions.map((opt: DropdownOption): ReactElement => {
            const key: string = valueKey(opt.value);
            const colorStr: string | undefined = optionColorString(opt);
            return (
              <span
                key={key}
                data-testid="entity-dropdown-chip"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900"
              >
                {colorStr && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorStr }}
                  />
                )}
                {/*
                 * The whole name, on two lines if it must: cut at 14rem, two
                 * picks that differ only at their end read the same.
                 */}
                <span
                  data-testid="entity-dropdown-chip-label"
                  data-not-found={opt.isNotFound ? "true" : undefined}
                  className={`min-w-0 [overflow-wrap:anywhere] ${
                    opt.isNotFound ? "font-normal italic text-gray-500" : ""
                  }`}
                >
                  {getOptionText(opt)}
                </span>
                {opt.isArchived && (
                  <ArchivedTag
                    isCompact={true}
                    dataTestId="entity-dropdown-archived-tag"
                  />
                )}
                {/*
                 * One of records that share a name: what sets it apart,
                 * so two picked twins read as two (#10064).
                 */}
                {getSharedNameMark(opt) && (
                  <SharedNameValueDetail mark={getSharedNameMark(opt)!} />
                )}
                {!props.disabled && (
                  <button
                    type="button"
                    aria-label={translator.translateTemplate(
                      "Remove {{option}}",
                      { option: getOptionText(opt) },
                    )}
                    onClick={(): void => {
                      removeKey(key);
                    }}
                    className="ml-0.5 rounded-full text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div ref={controlRef} className="relative">
        {/*
         * Single-select shows the resolved label in-place when closed so the
         * chrome looks like a static value field. Click anywhere on it to
         * start typing.
         *
         * The value button and its Clear button sit side by side. The Clear
         * button used to be inside the value button: a button in a button is
         * invalid HTML (React warned "<button> cannot appear as a descendant
         * of <button>"), and a screen reader reads a button's content as part
         * of the button, so the Clear button was lost to it. Now:
         *
         *   - this wrapper draws the field's box, so pointing at either
         *     button lights its border, as pointing anywhere on the one
         *     button did;
         *   - the value button covers the whole box: its -1px margin and
         *     clear 1px border lie over the wrapper's border, so its content
         *     and its focus outline sit where they always did;
         *   - it keeps an empty place where the Clear button was, and the
         *     Clear button is laid over that place (right-8: the value
         *     button's px-3, the chevron's w-4 and the gap-1 between them).
         *
         * Either box has one fill. A disabled box used to carry bg-gray-100
         * beside bg-white, and in light mode bg-white won (the stylesheet
         * orders the two, not the class list), so a locked field looked
         * like one to click; it also lit its border under the pointer.
         */}
        {showSingleSelectedText && (
          <div
            data-testid="entity-dropdown-value"
            className={`relative rounded-lg border shadow-sm transition-colors ${
              props.error
                ? "border-red-400"
                : props.disabled
                  ? "border-gray-300"
                  : "border-gray-300 hover:border-indigo-300"
            } ${props.disabled ? "bg-gray-100" : "bg-white"}`}
          >
            <button
              ref={valueButtonRef}
              type="button"
              disabled={props.disabled}
              aria-labelledby={props.ariaLabelledby}
              /*
               * Named by the field's label, the button would otherwise never
               * say what is picked.
               */
              aria-describedby={joinAriaIds(
                props.ariaLabelledby ? valueLabelId : undefined,
                props.ariaDescribedby,
                props.error ? errorId : undefined,
              )}
              onClick={(): void => {
                if (props.disabled) {
                  return;
                }
                focusFieldAfterSwapRef.current = true;
                setIsOpen(true);
              }}
              onFocus={() => {
                props.onFocus?.();
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
                if (
                  (event.key !== "Backspace" && event.key !== "Delete") ||
                  !canClearPick
                ) {
                  return;
                }
                event.preventDefault();
                clearShownValue();
              }}
              className={`-m-px flex min-h-[40px] w-[calc(100%+2px)] items-center justify-between rounded-lg border border-transparent px-3 py-2 text-left text-sm ${
                props.disabled ? "cursor-not-allowed text-gray-400" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                {(() => {
                  const colorStr: string | undefined = optionColorString(
                    selectedOptions[0]!,
                  );
                  if (!colorStr) {
                    return null;
                  }
                  return (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full border border-gray-200"
                      style={{ backgroundColor: colorStr }}
                    />
                  );
                })()}
                <span
                  id={valueLabelId}
                  data-not-found={
                    selectedOptions[0]!.isNotFound ? "true" : undefined
                  }
                  className={
                    selectedOptions[0]!.isNotFound
                      ? "font-normal italic text-gray-500"
                      : "font-medium text-gray-900"
                  }
                >
                  {getOptionText(selectedOptions[0]!)}
                </span>
                {selectedOptions[0]!.isArchived && (
                  <ArchivedTag dataTestId="entity-dropdown-archived-tag" />
                )}
                {getSharedNameMark(selectedOptions[0]!) && (
                  <SharedNameValueDetail
                    mark={getSharedNameMark(selectedOptions[0]!)!}
                  />
                )}
              </span>
              <div className="flex items-center gap-1 text-gray-400">
                {canClearPick && (
                  <span
                    aria-hidden="true"
                    data-testid="entity-dropdown-clear-place"
                    className="box-content block h-3.5 w-3.5 p-0.5"
                  />
                )}
                <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
              </div>
            </button>
            {canClearPick && (
              <button
                type="button"
                aria-label={translator.translateText("Clear selection")}
                data-testid="entity-dropdown-clear"
                onClick={clearShownValue}
                className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {!showSingleSelectedText && (
          <div
            data-testid="entity-dropdown-box"
            className={`relative rounded-lg border shadow-sm transition-colors ${
              props.error
                ? "border-red-400 ring-2 ring-red-100"
                : isOpen
                  ? "border-indigo-400 ring-2 ring-indigo-100"
                  : props.disabled
                    ? "border-gray-300"
                    : "border-gray-300 hover:border-indigo-300"
            } ${props.disabled ? "bg-gray-100" : "bg-white"}`}
          >
            <input
              data-unsaved-changes-ignore
              ref={inputRef}
              type="text"
              value={searchQuery}
              disabled={props.disabled}
              tabIndex={props.tabIndex}
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledby}
              aria-invalid={props.error ? true : undefined}
              aria-describedby={joinAriaIds(
                props.ariaDescribedby,
                props.error ? errorId : undefined,
              )}
              data-testid={props.dataTestId}
              role="combobox"
              placeholder={
                isMulti && selectedOptions.length > 0
                  ? translator.translateText("Search to add more...")
                  : placeholderText
              }
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearchQuery(event.target.value);
                setIsOpen(true);
                setHighlightedIndex(-1);
              }}
              /*
               * A click opens the menu even when the box already has the
               * focus: after Escape closed the menu (focus stays here, see
               * closeMenuOnEscape) or after Clear, a click on the box did
               * nothing, and picking a second item needed a click away
               * first.
               */
              onClick={() => {
                if (!props.disabled) {
                  setIsOpen(true);
                }
              }}
              onFocus={() => {
                // Not when focus lands here after a clear (clearShownValue).
                if (!keepMenuClosedOnFocusRef.current) {
                  setIsOpen(true);
                }
                props.onFocus?.();
              }}
              onBlur={() => {
                props.onBlur?.();
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                const activeLen: number =
                  activeTab === "labels"
                    ? filteredLabels.length
                    : availableOptions.length;
                if (event.key === "ArrowDown") {
                  if (activeLen === 0) {
                    return;
                  }
                  event.preventDefault();
                  setIsOpen(true);
                  setHighlightedIndex((prev: number): number => {
                    const next: number = prev + 1;
                    return next >= activeLen ? 0 : next;
                  });
                  return;
                }
                if (event.key === "ArrowUp") {
                  if (activeLen === 0) {
                    return;
                  }
                  event.preventDefault();
                  setIsOpen(true);
                  setHighlightedIndex((prev: number): number => {
                    if (prev <= 0) {
                      return activeLen - 1;
                    }
                    return prev - 1;
                  });
                  return;
                }
                if (event.key === "Enter") {
                  if (highlightedIndex < 0 || highlightedIndex >= activeLen) {
                    return;
                  }
                  event.preventDefault();
                  if (activeTab === "labels") {
                    const label: Label | undefined =
                      filteredLabels[highlightedIndex];
                    const labelId: string = label?._id ? String(label._id) : "";
                    if (labelId) {
                      toggleLabelId(labelId);
                    }
                    return;
                  }
                  const opt: DropdownOption | undefined =
                    availableOptions[highlightedIndex];
                  if (opt) {
                    addOption(opt, true);
                    setHighlightedIndex(-1);
                  }
                  return;
                }
                /*
                 * Escape bubbles to the container, which closes the menu for
                 * every control in the dropdown alike (closeMenuOnEscape).
                 */
                if (
                  event.key === "Backspace" &&
                  searchQuery === "" &&
                  isMulti &&
                  selectedKeys.length > 0 &&
                  activeTab === "options"
                ) {
                  event.preventDefault();
                  removeKey(selectedKeys[selectedKeys.length - 1] as string);
                }
              }}
              className="block min-h-[38px] w-full rounded-lg bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-500"
            />
            {!isMulti && selectedKeys.length > 0 && canClearPick && (
              <button
                type="button"
                aria-label={translator.translateText("Clear selection")}
                onClick={(): void => {
                  clearAll();
                  setSearchQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-2 my-auto flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {isOpen && !props.disabled && (
        <div
          className="fixed flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg"
          data-testid="entity-dropdown-menu"
          role="listbox"
          style={{
            bottom: menuPosition?.bottom,
            left: menuPosition?.left ?? 0,
            maxHeight: menuPosition?.maxHeight,
            top: menuPosition?.top,
            visibility: menuPosition ? "visible" : "hidden",
            width: menuPosition?.width ?? 0,
            zIndex: DROPDOWN_MENU_Z_INDEX,
          }}
        >
          {labelsTabEnabled && (
            <div className="flex flex-shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50 px-1.5 py-1">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "options"}
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setActiveTab("options");
                  setHighlightedIndex(-1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  activeTab === "options"
                    ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
                }`}
              >
                {translator.translateText("Results")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "labels"}
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setActiveTab("labels");
                  setHighlightedIndex(-1);
                }}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  activeTab === "labels"
                    ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
                }`}
              >
                <Icon icon={IconProp.Tag} className="h-3.5 w-3.5" />
                {translator.translateText("Labels")}
                {selectedLabelIds.length > 0 && (
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-xs font-semibold text-indigo-700">
                    {selectedLabelIds.length}
                  </span>
                )}
              </button>
              <span className="ml-auto pr-1 text-xs text-gray-500">
                {translator.translateText(
                  activeTab === "options"
                    ? "Pick individually"
                    : "Bulk-add by tag",
                )}
              </span>
            </div>
          )}

          {activeTab === "options" && (
            <div className="flex-1 overflow-auto py-1">
              {isLoading && (
                <div className="flex items-center px-3 py-2 text-gray-500">
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>{translator.translateText("Searching...")}</span>
                </div>
              )}
              {!isLoading && availableOptions.length === 0 && (
                <div
                  className="px-3 py-2 text-gray-500"
                  data-testid="entity-dropdown-empty-list"
                >
                  {translator.translateText(
                    getEntityDropdownEmptyListText({
                      searchQuery: searchQuery,
                      pickedHiddenCount:
                        optionsList.length - availableOptions.length,
                      mayHaveMore:
                        Boolean(modelType) &&
                        searchResults.length >= SEARCH_PAGE_SIZE,
                      emptyListText: props.emptyListText,
                    }),
                  )}
                </div>
              )}
              {!isLoading &&
                availableOptions.map(
                  (opt: DropdownOption, idx: number): ReactElement => {
                    const key: string = valueKey(opt.value);
                    const isHighlighted: boolean = idx === highlightedIndex;
                    const isCurrentSelection: boolean =
                      !isMulti && selectedKeys[0] === key;
                    const colorStr: string | undefined = optionColorString(opt);
                    const sharedNameMark: SharedNameMark | undefined =
                      getSharedNameMark(opt);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={isCurrentSelection || isHighlighted}
                        onMouseEnter={(): void => {
                          setHighlightedIndex(idx);
                        }}
                        onMouseDown={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ): void => {
                          event.preventDefault();
                        }}
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ): void => {
                          // Enter or Space on an option reached with Tab.
                          addOption(opt, event.detail === 0);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                          isHighlighted
                            ? "bg-indigo-600 text-white"
                            : isCurrentSelection
                              ? "bg-indigo-50 text-indigo-900"
                              : "text-gray-700 hover:bg-indigo-50"
                        }`}
                      >
                        {colorStr && (
                          <span
                            aria-hidden="true"
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-gray-200"
                            style={{ backgroundColor: colorStr }}
                          />
                        )}
                        {/*
                         * The name comes first: it takes the row, and the
                         * line beside it never more than half of it. Both
                         * shrinking alike cut a short name ("infra") to
                         * "in..." beside a long description on a phone.
                         */}
                        {sharedNameMark ? (
                          /*
                           * One of records that share a name (#10064): the
                           * pill its list draws beside the name, and under
                           * it what sets this one apart.
                           */
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 truncate">
                                {getOptionText(opt)}
                              </span>
                              <SharedNamePill mark={sharedNameMark} />
                            </span>
                            <SharedNameDetail
                              mark={sharedNameMark}
                              className={`block truncate text-xs ${
                                isHighlighted
                                  ? "text-indigo-100"
                                  : "text-gray-500"
                              }`}
                            />
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {getOptionText(opt)}
                          </span>
                        )}
                        {/*
                         * An archived value a list's filter offers
                         * (listsArchivedValues), marked as one.
                         */}
                        {opt.isArchived && (
                          <ArchivedTag
                            isCompact={true}
                            dataTestId="entity-dropdown-option-archived-tag"
                          />
                        )}
                        {opt.description && (
                          <span
                            className={`max-w-[50%] flex-none truncate text-xs ${
                              isHighlighted
                                ? "text-indigo-100"
                                : "text-gray-500"
                            }`}
                          >
                            {opt.description}
                          </span>
                        )}
                        {/*
                         * Trailing check for the current single-select value
                         * — same visual cue react-select uses to flag the
                         * active option without taking it out of the list.
                         */}
                        {isCurrentSelection && (
                          <svg
                            className={`ml-auto h-4 w-4 flex-shrink-0 ${
                              isHighlighted ? "text-white" : "text-indigo-600"
                            }`}
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  },
                )}
            </div>
          )}

          {activeTab === "labels" && (
            <div className="flex-1 overflow-auto py-1">
              {labelSearch.isLoading && (
                <div className="flex items-center px-3 py-2 text-gray-500">
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>{translator.translateText("Loading labels...")}</span>
                </div>
              )}
              {!labelSearch.isLoading &&
                (labelError || labelSearch.error) !== "" && (
                  <div className="px-3 py-2 text-red-600">
                    {translator.translateText(labelError || labelSearch.error)}
                  </div>
                )}
              {!labelSearch.isLoading &&
                labelError === "" &&
                labelSearch.error === "" &&
                labelSearch.hasLoaded &&
                filteredLabels.length === 0 &&
                searchQuery.trim() === "" && (
                  <div
                    className="px-3 py-2 text-gray-500"
                    data-testid="entity-dropdown-no-labels"
                  >
                    {translator.translateText(
                      "No labels found in this project. Create labels first to use this shortcut.",
                    )}
                  </div>
                )}
              {!labelSearch.isLoading &&
                labelError === "" &&
                labelSearch.error === "" &&
                labelSearch.hasLoaded &&
                filteredLabels.length === 0 &&
                searchQuery.trim() !== "" && (
                  <div
                    className="px-3 py-2 text-gray-500"
                    data-testid="entity-dropdown-no-matching-labels"
                  >
                    {translator.translateTemplate(
                      "No labels match “{{search}}”.",
                      { search: searchQuery.trim() },
                    )}
                  </div>
                )}
              {!labelSearch.isLoading &&
                filteredLabels.map(
                  (label: Label, idx: number): ReactElement => {
                    const labelId: string = label._id ? String(label._id) : "";
                    if (!labelId) {
                      return <span key={`empty-${idx}`} />;
                    }
                    const isChecked: boolean =
                      selectedLabelIds.includes(labelId);
                    const isHighlighted: boolean = idx === highlightedIndex;
                    const isExpanded: boolean = expandedLabelIds.has(labelId);
                    const isLoadingPreview: boolean =
                      loadingLabelIds.has(labelId);
                    const preview: Array<DropdownOption> | undefined =
                      resourcesByLabel[labelId];
                    const previewError: string | undefined =
                      labelLoadErrors[labelId];
                    const colorStr: string | undefined =
                      labelColorString(label);
                    return (
                      <div
                        key={labelId}
                        onMouseEnter={(): void => {
                          setHighlightedIndex(idx);
                        }}
                        className={`border-b border-gray-100 last:border-b-0 ${
                          isHighlighted ? "bg-indigo-50" : ""
                        }`}
                      >
                        <div className="flex w-full items-center gap-2 px-2 py-1.5">
                          <button
                            type="button"
                            aria-label={translator.translateText(
                              isExpanded
                                ? "Collapse entries"
                                : "Expand entries",
                            )}
                            aria-expanded={isExpanded}
                            onMouseDown={(
                              event: React.MouseEvent<HTMLButtonElement>,
                            ): void => {
                              event.preventDefault();
                            }}
                            onClick={(): void => {
                              toggleLabelExpansion(labelId);
                            }}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <Icon
                              icon={IconProp.ChevronRight}
                              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isChecked}
                            onMouseDown={(
                              event: React.MouseEvent<HTMLButtonElement>,
                            ): void => {
                              event.preventDefault();
                            }}
                            onClick={(): void => {
                              toggleLabelId(labelId);
                            }}
                            className={`flex flex-1 items-center gap-2 rounded px-1 py-1 text-left ${
                              isHighlighted
                                ? "text-gray-900"
                                : "text-gray-700 hover:bg-indigo-100/50"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                                isChecked
                                  ? "border-indigo-600 bg-indigo-600 text-white"
                                  : "border-gray-300 bg-white"
                              }`}
                            >
                              {isChecked && (
                                <svg
                                  className="h-3 w-3"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </span>
                            {colorStr && (
                              <span
                                className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: colorStr }}
                                aria-hidden="true"
                              />
                            )}
                            {labelSharedNameMarks.get(labelId) ? (
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 truncate">
                                    {label.name ||
                                      translator.translateText("Unnamed Label")}
                                  </span>
                                  <SharedNamePill
                                    mark={labelSharedNameMarks.get(labelId)!}
                                  />
                                </span>
                                <SharedNameDetail
                                  mark={labelSharedNameMarks.get(labelId)!}
                                  className="block truncate text-xs text-gray-500"
                                />
                              </span>
                            ) : (
                              <span className="truncate">
                                {label.name ||
                                  translator.translateText("Unnamed Label")}
                              </span>
                            )}
                          </button>
                          {preview !== undefined && (
                            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                              {preview.length}
                              {preview.length >= LABEL_PREVIEW_LIMIT ? "+" : ""}
                            </span>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 pl-10">
                            {isLoadingPreview ? (
                              <div className="flex items-center gap-2 py-1 text-xs text-gray-500">
                                <svg
                                  className="h-3.5 w-3.5 animate-spin text-indigo-500"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                  />
                                </svg>
                                <span>
                                  {translator.translateText(
                                    "Loading entries...",
                                  )}
                                </span>
                              </div>
                            ) : previewError ? (
                              <div className="py-1 text-xs text-red-600">
                                {translator.translateText(previewError)}
                              </div>
                            ) : !preview || preview.length === 0 ? (
                              <div className="py-1 text-xs italic text-gray-500">
                                {translator.translateText(
                                  "No entries tagged with this label.",
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {preview.map(
                                  (item: DropdownOption): ReactElement => {
                                    return (
                                      <span
                                        key={valueKey(item.value)}
                                        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                                      >
                                        <span className="max-w-[10rem] truncate">
                                          {getOptionText(item)}
                                        </span>
                                      </span>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              {/*
               * More labels match than one search lists: how many, and how
               * to find the rest - typing more of a name narrows them.
               */}
              {!labelSearch.isLoading &&
                labelSearch.count > filteredLabels.length && (
                  <p
                    className="px-3 py-2 text-xs text-gray-500"
                    data-testid="entity-dropdown-more-labels"
                  >
                    {translator.translateTemplate(
                      "Showing {{shown}} of {{total}}. Type to narrow the list.",
                      {
                        shown: translator.formatNumber(filteredLabels.length),
                        total: translator.formatNumber(labelSearch.count),
                      },
                    )}
                  </p>
                )}
            </div>
          )}

          {activeTab === "labels" && selectedLabelIds.length > 0 && (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-2 py-1.5">
              <Button
                title="Clear"
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                buttonSize={ButtonSize.Small}
                disabled={isApplyingLabels}
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setSelectedLabelIds([]);
                }}
              />
              {/*
                The shared Button, kept from taking the focus as it is
                pressed (onMouseDown): the search field above keeps it,
                and the list stays open while the entries are added.
              */}
              <Button
                title={
                  isApplyingLabels
                    ? translator.translateText("Adding...")
                    : translator.translatePlural(
                        {
                          one: "Add entries from {{count}} label",
                          other: "Add entries from {{count}} labels",
                        },
                        selectedLabelIds.length,
                      )
                }
                isTitleTranslated={true}
                buttonStyle={ButtonStyleType.PRIMARY}
                buttonSize={ButtonSize.Small}
                isLoading={isApplyingLabels}
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  void applyLabelSelection();
                }}
              />
            </div>
          )}
        </div>
      )}

      {props.error && <FieldError id={errorId} message={props.error} />}
    </div>
  );
};

// Re-export the option types from Dropdown so callers don't need both imports.
export type {
  DropdownOption,
  DropdownOptionGroup,
  DropdownOptionLabel,
  DropdownValue,
};

export default EntityDropdown;
