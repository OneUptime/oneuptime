import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import Icon from "../Icon/Icon";
import {
  DropdownOption,
  DropdownOptionGroup,
  DropdownOptionLabel,
  DropdownValue,
} from "../Dropdown/Dropdown";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

export interface EntityDropdownProps {
  /*
   * Static options (enum-like). Used as initial cache when modelType is set;
   * sole source of options when it isn't.
   */
  options?: Array<DropdownOption | DropdownOptionGroup>;

  // Drop-in compatibility with `Dropdown`.
  initialValue?: EntityDropdownValue;
  value?: EntityDropdownValue;
  onChange?: (value: DropdownValue | Array<DropdownValue> | null) => void;
  onClick?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  isMultiSelect?: boolean;
  tabIndex?: number;
  error?: string;
  id?: string;
  dataTestId?: string;
  ariaLabel?: string;
  disabled?: boolean;

  /*
   * Entity backing. When set, the popover fetches options server-side and
   * (for multi-select on labeled entities) exposes a Labels tab.
   */
  modelType?: { new (): BaseModel };
  labelField?: string;
  valueField?: string;
  colorField?: string;
  /*
   * Override the auto-detection — explicitly hide the Labels tab even on a
   * labeled entity, or force-show it.
   */
  enableLabelsTab?: boolean;
}

const SEARCH_DEBOUNCE_MS: number = 250;
const SEARCH_PAGE_SIZE: number = 50;
const LABEL_PREVIEW_LIMIT: number = 50;

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
  const isMulti: boolean = Boolean(props.isMultiSelect);
  const modelType: { new (): BaseModel } | undefined = props.modelType;
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
      const probe: WithColorProbe = new modelType() as unknown as WithColorProbe;
      if (typeof probe.getFirstColorColumn === "function") {
        return probe.getFirstColorColumn() || undefined;
      }
    } catch {
      // Model can't be instantiated for inspection; fall back to no color.
    }
    return undefined;
  }, [modelType]);
  const colorField: string | undefined =
    props.colorField || detectedColorField;
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
    Boolean(modelType);

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

  // Same reasoning as initialFlat — seed at render time so the first paint
  // has the labels.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalKeys.join("|")]);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Array<DropdownOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [activeTab, setActiveTab] = useState<"options" | "labels">("options");

  // Labels tab state.
  const [allLabels, setAllLabels] = useState<Array<Label>>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState<boolean>(false);
  const [labelsLoaded, setLabelsLoaded] = useState<boolean>(false);
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
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const debounceRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const searchSeqRef: React.MutableRefObject<number> = useRef<number>(0);

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
          option.color = colorRaw as unknown as DropdownOption["color"];
        }
      }
      return option;
    },
    [labelField, valueField, colorField],
  );

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
          const query: Query<BaseModel> = {} as Query<BaseModel>;
          if (trimmed.length > 0) {
            (query as Record<string, unknown>)[labelField] = new Search(
              trimmed,
            );
          }
          const baseSelect: Record<string, true> = {
            _id: true,
            [labelField]: true,
          } as Record<string, true>;
          if (colorField) {
            baseSelect[colorField] = true;
          }
          const result: ListResult<BaseModel> =
            await ModelAPI.getList<BaseModel>({
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
    labelField,
    colorField,
    modelToOption,
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
        } as Record<string, true>;
        if (colorField) {
          baseSelect[colorField] = true;
        }
        const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>(
          {
            modelType: modelType,
            query: {
              _id: new Includes(missing),
            } as Query<BaseModel>,
            limit: missing.length,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedKeys.join("|"),
    modelType,
    labelField,
    colorField,
    modelToOption,
  ]);

  /*
   * Lazy-load the project's labels the first time the user clicks the
   * Labels tab — same gating as AffectedResourcesPicker. DON'T add
   * isLoadingLabels to the deps; setting it inside the effect would
   * self-cancel the in-flight request.
   */
  useEffect(() => {
    if (!labelsTabEnabled || activeTab !== "labels" || labelsLoaded) {
      return;
    }
    let cancelled: boolean = false;
    const loadLabels: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingLabels(true);
      setLabelError("");
      try {
        const result: ListResult<Label> = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {} as Query<Label>,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, name: true, color: true } as never,
          sort: { name: SortOrder.Ascending } as never,
        });
        if (cancelled) {
          return;
        }
        setAllLabels(result.data || []);
        setLabelsLoaded(true);
      } catch {
        if (cancelled) {
          return;
        }
        setLabelError(
          "Failed to load labels. You may not have permission to read labels.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingLabels(false);
        }
      }
    };
    void loadLabels();
    return () => {
      cancelled = true;
    };
  }, [labelsTabEnabled, activeTab, labelsLoaded]);

  const filteredLabels: Array<Label> = useMemo(() => {
    const q: string = searchQuery.trim().toLowerCase();
    if (q === "") {
      return allLabels;
    }
    return allLabels.filter((label: Label): boolean => {
      const name: string = (label.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [allLabels, searchQuery]);

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
      return opt.label.toLowerCase().includes(q);
    };
    const seen: Set<string> = new Set();
    const out: Array<DropdownOption> = [];
    for (const opt of initialFlat) {
      const key: string = valueKey(opt.value);
      if (seen.has(key) || !matches(opt)) {
        continue;
      }
      seen.add(key);
      out.push(opt);
    }
    if (modelType) {
      for (const opt of searchResults) {
        const key: string = valueKey(opt.value);
        if (seen.has(key) || !matches(opt)) {
          continue;
        }
        seen.add(key);
        out.push(opt);
      }
    }
    return out;
  }, [modelType, searchResults, searchQuery, initialFlat]);

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

  const notify: (next: Array<string>) => void = useCallback(
    (next: Array<string>): void => {
      if (!props.onChange) {
        return;
      }
      if (isMulti) {
        props.onChange(next as Array<DropdownValue>);
        return;
      }
      props.onChange(next.length > 0 ? next[0]! : null);
    },
    [isMulti, props.onChange],
  );

  const addOption: (opt: DropdownOption) => void = (
    opt: DropdownOption,
  ): void => {
    const key: string = valueKey(opt.value);
    optionsCacheRef.current.set(key, opt);
    if (isMulti) {
      if (selectedKeys.includes(key)) {
        return;
      }
      const next: Array<string> = [...selectedKeys, key];
      setSelectedKeys(next);
      notify(next);
      setSearchQuery("");
      inputRef.current?.focus();
      return;
    }
    setSelectedKeys([key]);
    notify([key]);
    setSearchQuery("");
    setIsOpen(false);
  };

  const removeKey: (key: string) => void = (key: string): void => {
    const next: Array<string> = selectedKeys.filter((k: string): boolean => {
      return k !== key;
    });
    setSelectedKeys(next);
    notify(next);
  };

  const clearAll: () => void = (): void => {
    setSelectedKeys([]);
    notify([]);
  };

  /*
   * Bulk-add via labels: fetch every entity tagged with any selected label
   * and merge into the current selection. Caps generous (LIMIT_PER_PROJECT)
   * since this is an intentional bulk action, not a typeahead.
   */
  const applyLabelSelection: () => Promise<void> = async (): Promise<void> => {
    if (!modelType || selectedLabelIds.length === 0) {
      return;
    }
    setIsApplyingLabels(true);
    setLabelError("");
    try {
      const baseSelect: Record<string, true> = {
        _id: true,
        [labelField]: true,
      } as Record<string, true>;
      if (colorField) {
        baseSelect[colorField] = true;
      }
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: modelType,
        query: {
          labels: new Includes(selectedLabelIds),
        } as Query<BaseModel>,
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
      if (additions.length === 0) {
        setLabelError(
          "No new entries matched the selected labels (or you don't have read access).",
        );
        return;
      }
      const next: Array<string> = [...selectedKeys, ...additions];
      setSelectedKeys(next);
      notify(next);
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
    if (!modelType) {
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
      } as Record<string, true>;
      if (colorField) {
        baseSelect[colorField] = true;
      }
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: modelType,
        query: {
          labels: new Includes([labelId]),
        } as Query<BaseModel>,
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
          return { ...prev, [labelId]: "Failed to load entries." };
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
      return { value: key, label: key };
    });
    /*
     * Cache is mutated during render based on initialFlat / inboundOptions
     * (see seed loops above), so include them here to make the dependency
     * graph honest — when the parent hands us new options, this memo
     * recomputes against the freshly-seeded cache.
     */
  }, [selectedKeys, initialFlat, inboundOptions]);

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
  const placeholderText: string = props.placeholder || "Select...";
  const showSingleSelectedText: boolean =
    !isMulti && !isOpen && selectedOptions.length > 0;

  return (
    <div
      ref={containerRef}
      id={props.id}
      className={props.className || "relative mt-2 mb-1 w-full"}
    >
      {isMulti && selectedOptions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedOptions.map((opt: DropdownOption): ReactElement => {
            const key: string = valueKey(opt.value);
            const colorStr: string | undefined = optionColorString(opt);
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900"
              >
                {colorStr && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorStr }}
                  />
                )}
                <span className="max-w-[14rem] truncate">{opt.label}</span>
                {!props.disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${opt.label}`}
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

      <div className="relative">
        {/*
         * Single-select shows the resolved label in-place when closed so the
         * chrome looks like a static value field. Click anywhere on the
         * container to start typing.
         */}
        {showSingleSelectedText && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={(): void => {
              if (props.disabled) {
                return;
              }
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            onFocus={() => {
              props.onFocus?.();
            }}
            className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors ${
              props.error
                ? "border-red-400"
                : "border-gray-300 hover:border-indigo-300"
            } ${
              props.disabled
                ? "cursor-not-allowed bg-gray-100 text-gray-400"
                : ""
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
              <span className="font-medium text-gray-900">
                {selectedOptions[0]!.label}
              </span>
            </span>
            <div className="flex items-center gap-1 text-gray-400">
              {!props.disabled && (
                <button
                  type="button"
                  aria-label="Clear selection"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
                    e.stopPropagation();
                    clearAll();
                  }}
                  className="rounded p-0.5 hover:bg-gray-100 hover:text-red-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
            </div>
          </button>
        )}

        {!showSingleSelectedText && (
          <div
            className={`relative rounded-lg border bg-white shadow-sm transition-colors ${
              props.error
                ? "border-red-400 ring-2 ring-red-100"
                : isOpen
                  ? "border-indigo-400 ring-2 ring-indigo-100"
                  : "border-gray-300 hover:border-indigo-300"
            } ${props.disabled ? "bg-gray-100" : ""}`}
          >
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              disabled={props.disabled}
              tabIndex={props.tabIndex}
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-label={props.ariaLabel}
              aria-invalid={props.error ? true : undefined}
              data-testid={props.dataTestId}
              role="combobox"
              placeholder={
                isMulti && selectedOptions.length > 0
                  ? "Search to add more..."
                  : placeholderText
              }
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearchQuery(event.target.value);
                setIsOpen(true);
                setHighlightedIndex(-1);
              }}
              onFocus={() => {
                setIsOpen(true);
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
                    addOption(opt);
                    setHighlightedIndex(-1);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  setIsOpen(false);
                  setHighlightedIndex(-1);
                  return;
                }
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
              className="block w-full rounded-lg bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-500"
            />
            {!isMulti && selectedKeys.length > 0 && !props.disabled && (
              <button
                type="button"
                aria-label="Clear selection"
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
          className="absolute z-20 mt-1 flex max-h-96 w-full flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg"
          role="listbox"
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
                Results
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
                Labels
                {selectedLabelIds.length > 0 && (
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700">
                    {selectedLabelIds.length}
                  </span>
                )}
              </button>
              <span className="ml-auto pr-1 text-[11px] text-gray-400">
                {activeTab === "options"
                  ? "Pick individually"
                  : "Bulk-add by tag"}
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
                  <span>Searching...</span>
                </div>
              )}
              {!isLoading && availableOptions.length === 0 && (
                <div className="px-3 py-2 text-gray-500">
                  {searchQuery.trim() === ""
                    ? "No options."
                    : "No matching entries."}
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
                        onClick={(): void => {
                          addOption(opt);
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
                        <span className="truncate">{opt.label}</span>
                        {opt.description && (
                          <span
                            className={`ml-auto truncate text-xs ${
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
              {isLoadingLabels && (
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
                  <span>Loading labels...</span>
                </div>
              )}
              {!isLoadingLabels && labelError !== "" && (
                <div className="px-3 py-2 text-red-600">{labelError}</div>
              )}
              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No labels found in this project. Create labels first to use
                    this shortcut.
                  </div>
                )}
              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length > 0 &&
                filteredLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No labels match &ldquo;{searchQuery.trim()}&rdquo;.
                  </div>
                )}
              {!isLoadingLabels &&
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
                            aria-label={
                              isExpanded ? "Collapse entries" : "Expand entries"
                            }
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
                            <span className="truncate">
                              {label.name || "Unnamed Label"}
                            </span>
                          </button>
                          {preview !== undefined && (
                            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
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
                                <span>Loading entries...</span>
                              </div>
                            ) : previewError ? (
                              <div className="py-1 text-xs text-red-600">
                                {previewError}
                              </div>
                            ) : !preview || preview.length === 0 ? (
                              <div className="py-1 text-xs italic text-gray-500">
                                No entries tagged with this label.
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
                                          {item.label}
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
            </div>
          )}

          {activeTab === "labels" && selectedLabelIds.length > 0 && (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-2 py-1.5">
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setSelectedLabelIds([]);
                }}
                disabled={isApplyingLabels}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  void applyLabelSelection();
                }}
                disabled={isApplyingLabels}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-60"
              >
                {isApplyingLabels && (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
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
                )}
                {isApplyingLabels
                  ? "Adding..."
                  : `Add entries from ${selectedLabelIds.length} label${
                      selectedLabelIds.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          )}
        </div>
      )}

      {props.error && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {props.error}
        </p>
      )}
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
