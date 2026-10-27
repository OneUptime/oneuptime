/*
 * The list of values a setting can use, grouped by where they come from: each
 * step that runs before this one, by its name, then the workflow's variables.
 * Every value says what it is called, what it holds and what shape it is; the
 * {{...}} reference it inserts is only in its tooltip. Nobody has to know the
 * syntax to use it.
 *
 * A record opens to its fields - the useful reference is almost always one
 * field of it, not the record - and a JSON value or a set of headers can be
 * opened to type a path into it. Once a step has run, a value says what it
 * held, and a JSON value opens to the fields it had (StepSampleSource).
 *
 * The list is searchable, and walked with the arrow keys and Enter.
 */

import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import useClipboardCopy, {
  ClipboardCopy,
  ClipboardCopyStatus,
} from "../../../Utils/UseClipboardCopy";
import {
  ChildrenState,
  ChildrenStatus,
  ValuePickerContextValue,
  useValuePicker,
} from "./ValuePickerContext";
import {
  ValueAvailability,
  ValueAvailabilityState,
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionNote,
  ValueSuggestionSentence,
  appendPathToReference,
  filterSuggestionGroups,
  suggestionMatches,
} from "./ValueSuggestion";
import { StepSampleCopy } from "./StepSampleSource";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import React, {
  ReactElement,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * While a group's note waits for something - a webhook's first request - the
 * open list asks its source again this often, for at most this long.
 */
export const NOTE_REFRESH_INTERVAL_MS: number = 3000;
export const NOTE_REFRESH_MAX_MS: number = 10 * 60 * 1000;

/*
 * How long the steps that cannot be used are kept in view after they are
 * opened, while their styles arrive and their lines wrap.
 */
export const UNAVAILABLE_SETTLE_MS: number = 2000;

export const ValuePickerMenuCopy: {
  readonly notAvailable: PluralTemplate;
  readonly notAvailableHint: string;
  readonly notAvailableTitle: string;
  readonly notPassedOnTitle: string;
  readonly fieldCount: PluralTemplate;
} = {
  // A plural, written whole so the extractor reads both forms.
  notAvailable: {
    one: "{{count}} step isn't available here",
    other: "{{count}} steps aren't available here",
  },
  notAvailableHint: translationKey(
    "Their values aren't there when this step runs.",
  ),
  notAvailableTitle: translationKey("Not available here"),
  // Over a record's fields its step does not pass on, and how many there are.
  notPassedOnTitle: translationKey("Not passed on"),
  fieldCount: { one: "{{count}} field", other: "{{count}} fields" },
};

/*
 * Room kept clear at the bottom of a record's fields while the heading of
 * the ones that are not passed on is pinned there, so the field the keys are
 * on is scrolled to above it, not under it.
 */
export const EMPTY_HERE_HEADING_ROOM: string = "2.5rem";

export const HIDDEN_SAMPLE_TEXT: string = translationKey("hidden");
export const HIDDEN_SAMPLE_TITLE: string = translationKey(
  "Not shown: it looks like a secret, or the run kept it hidden.",
);

export interface ValuePickerMenuHandle {
  /**
   * Inline mode: the field passes its keys here. True when the menu used the
   * key, in which case the field must not.
   */
  handleKeyDown: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
}

export interface ValuePickerMenuProps {
  /**
   * True: a search box of its own, which takes the focus. False: filtered by
   * what is typed after "{{" in the field, which keeps the focus.
   */
  hasSearchBox: boolean;
  /** The filter when there is no search box. */
  query?: string | undefined;
  onPick: (reference: string) => void;
  /** Only some groups - the Schedule trigger takes variables only. */
  groupFilter?: ((group: ValueSuggestionGroup) => boolean) | undefined;
  /** Inline mode: the option the arrow keys are on, for aria-activedescendant. */
  onActiveOptionChange?: ((optionId: string | undefined) => void) | undefined;
  /** The listbox's id, for the field's aria-controls. */
  listboxId?: string | undefined;
  searchPlaceholder?: string | undefined;
  /** Said when there is nothing at all to pick. */
  emptyMessage?: string | undefined;
}

interface DrillView {
  item: ValueSuggestion;
  group: ValueSuggestionGroup;
}

interface MenuOption {
  key: string;
  label: string;
  description?: string | undefined;
  typeLabel?: string | undefined;
  badges?: Array<string> | undefined;
  /** What it held the last time its step ran. */
  sample?: string | undefined;
  isSampleHidden?: boolean | undefined;
  /** What the option inserts, when it inserts something. */
  reference: string;
  /** Picking this opens it rather than inserting it. */
  opens?: boolean | undefined;
  /*
   * A record's field its step does not pass on: it can be picked, but is
   * empty here, so it is drawn quieter, under why.
   */
  isEmptyHere?: boolean | undefined;
  /** Shows a separate "look inside" button. */
  canLookInside?: boolean | undefined;
  item?: ValueSuggestion | undefined;
  group?: ValueSuggestionGroup | undefined;
}

interface OptionSection {
  key: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  iconProp?: IconProp | undefined;
  note?: ValueSuggestionNote | undefined;
  // A step before this one on some runs only says so under its name.
  availability?: ValueAvailability | undefined;
  // Above a record's fields that are empty here: whose they are.
  emptyHereNote?: ValueSuggestionSentence | undefined;
  options: Array<MenuOption>;
}

type FindItemFunction = (
  groups: Array<ValueSuggestionGroup>,
  reference: string,
) => ValueSuggestion | undefined;

// The item as the groups have it now, which a refresh may have filled in.
const findItem: FindItemFunction = (
  groups: Array<ValueSuggestionGroup>,
  reference: string,
): ValueSuggestion | undefined => {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.reference === reference && !item.searchOnly) {
        return item;
      }
    }
  }

  return undefined;
};

const DEFAULT_BADGE_CLASS: string =
  "border-amber-200 bg-amber-50 text-amber-700";

type TranslateSentenceFunction = (
  translator: Translator,
  sentence: ValueSuggestionSentence,
) => string;

// A picker sentence in the reader's language.
const translateSentence: TranslateSentenceFunction = (
  translator: Translator,
  sentence: ValueSuggestionSentence,
): string => {
  return translator.translateTemplate(sentence.template, sentence.values || {});
};

const ValuePickerMenu: React.ForwardRefExoticComponent<
  ValuePickerMenuProps & React.RefAttributes<ValuePickerMenuHandle>
> = forwardRef<ValuePickerMenuHandle, ValuePickerMenuProps>(
  (
    props: ValuePickerMenuProps,
    ref: React.ForwardedRef<ValuePickerMenuHandle>,
  ): ReactElement => {
    const translator: Translator = useTranslator();
    const picker: ValuePickerContextValue = useValuePicker();
    const generatedId: string = useId();
    const listboxId: string = props.listboxId || `${generatedId}-values`;

    const [search, setSearch] = useState<string>("");
    const [drill, setDrill] = useState<DrillView | null>(null);
    const [activeIndex, setActiveIndex] = useState<number>(0);
    const [path, setPath] = useState<string>("");
    const [pathError, setPathError] = useState<string | null>(null);

    const searchRef: React.MutableRefObject<HTMLInputElement | null> =
      useRef<HTMLInputElement | null>(null);
    const listRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);
    const emptyHereHeadingRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);
    const emptyHereGroupRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);

    const query: string = props.hasSearchBox ? search : props.query || "";

    const allGroups: Array<ValueSuggestionGroup> = useMemo(() => {
      return props.groupFilter
        ? picker.groups.filter(props.groupFilter)
        : picker.groups;
    }, [picker.groups, props.groupFilter]);

    /*
     * What can be used here, and what cannot: the steps whose values are not
     * there when this one runs are listed apart, after everything else.
     */
    const groups: Array<ValueSuggestionGroup> = useMemo(() => {
      return allGroups.filter((group: ValueSuggestionGroup): boolean => {
        return group.availability?.state !== ValueAvailabilityState.Unavailable;
      });
    }, [allGroups]);

    const unavailableGroups: Array<ValueSuggestionGroup> = useMemo(() => {
      return allGroups.filter((group: ValueSuggestionGroup): boolean => {
        return group.availability?.state === ValueAvailabilityState.Unavailable;
      });
    }, [allGroups]);

    const [isUnavailableOpen, setIsUnavailableOpen] = useState<boolean>(false);
    const unavailableRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);

    /*
     * The steps that cannot be used are at the end of the list, so opened
     * they were under its fold: the line said "1 step isn't available here"
     * and showed nothing. Opening it brings them into view.
     *
     * And keeps them there while they settle. The Dashboard builds a class's
     * style the first time the class is drawn, so a moment after the block
     * opens its reasons get their indent, the longer ones wrap onto another
     * line, and the last step would end under the list's edge.
     */
    useEffect(() => {
      const block: HTMLDivElement | null = unavailableRef.current;

      if (
        !isUnavailableOpen ||
        !block ||
        typeof block.scrollIntoView !== "function"
      ) {
        return;
      }

      const reveal: () => void = (): void => {
        block.scrollIntoView({ block: "nearest" });
      };

      reveal();

      if (typeof ResizeObserver === "undefined") {
        return;
      }

      const observer: ResizeObserver = new ResizeObserver(reveal);

      observer.observe(block);

      // Settled: from here on the list is the reader's to scroll.
      const settled: ReturnType<typeof setTimeout> = setTimeout(() => {
        observer.disconnect();
      }, UNAVAILABLE_SETTLE_MS);

      return () => {
        clearTimeout(settled);
        observer.disconnect();
      };
    }, [isUnavailableOpen]);

    /*
     * The opened value as the list has it now. A request can arrive while it
     * is open, and its fields should then appear rather than wait for Back.
     */
    const drillItem: ValueSuggestion | null = drill
      ? findItem(groups, drill.item.reference) || drill.item
      : null;

    const drillChildren: ChildrenState | null = drillItem
      ? picker.getChildren(drillItem)
      : null;

    const drillHasLoader: boolean = Boolean(drillItem?.drillIn?.loadChildren);

    useEffect(() => {
      if (drillItem) {
        picker.loadChildren(drillItem);
      }
    }, [drill, drillHasLoader]);

    /*
     * The sources whose notes wait for something: asked again every few
     * seconds while the list is open, so a webhook's fields appear by
     * themselves once a test request arrives.
     */
    const refreshSourceIds: string = useMemo(() => {
      return Array.from(
        new Set<string>(
          groups
            .map((group: ValueSuggestionGroup) => {
              return group.note?.refreshSourceId || "";
            })
            .filter((id: string) => {
              return Boolean(id);
            }),
        ),
      )
        .sort()
        .join(",");
    }, [groups]);

    useEffect(() => {
      if (!refreshSourceIds) {
        return;
      }

      const ids: Array<string> = refreshSourceIds.split(",");
      const startedAt: number = Date.now();

      const timer: ReturnType<typeof setInterval> = setInterval((): void => {
        if (Date.now() - startedAt > NOTE_REFRESH_MAX_MS) {
          clearInterval(timer);
          return;
        }

        // Nothing to show it to in a tab nobody is looking at.
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }

        for (const id of ids) {
          picker.refreshSource(id);
        }
      }, NOTE_REFRESH_INTERVAL_MS);

      return () => {
        clearInterval(timer);
      };
    }, [refreshSourceIds, picker.refreshSource]);

    /*
     * A note's Copy says "Copied!" once the text is on the clipboard, and
     * "Copy failed" when the browser refused it - it used to say nothing
     * then, which read as a button that does nothing.
     */
    const noteClipboard: ClipboardCopy = useClipboardCopy();

    type CopyNoteTextFunction = (key: string, text: string) => Promise<void>;

    const copyNoteText: CopyNoteTextFunction = async (
      key: string,
      text: string,
    ): Promise<void> => {
      await noteClipboard.copy(text, key);
    };

    // Start from the top whenever what is listed changes.
    useEffect(() => {
      setActiveIndex(0);
    }, [query, drill]);

    const sections: Array<OptionSection> = useMemo(() => {
      if (drill && drillItem) {
        const whole: MenuOption = {
          key: `whole:${drillItem.reference}`,
          label: drillItem.drillIn?.wholeValueLabel || drillItem.label,
          typeLabel: drillItem.typeLabel,
          sample: drillItem.sample,
          isSampleHidden: drillItem.isSampleHidden,
          reference: drillItem.reference,
        };

        // Inline, what is typed is the reference so far, not a field's name.
        const childQuery: string = props.hasSearchBox ? search : "";

        const children: Array<MenuOption> = (drillChildren?.items || [])
          .filter((child: ValueSuggestion) => {
            return suggestionMatches(child, null, childQuery);
          })
          .map((child: ValueSuggestion): MenuOption => {
            return {
              key: child.reference,
              label: child.label,
              description: child.description,
              typeLabel: child.typeLabel,
              badges: child.badges,
              sample: child.sample,
              isSampleHidden: child.isSampleHidden,
              reference: child.reference,
              isEmptyHere: child.isEmptyHere,
            };
          });

        /*
         * The fields that are there first; the ones its step does not pass
         * on after them, apart, under whose they are and how to pass them on.
         */
        const usable: Array<MenuOption> = children.filter(
          (child: MenuOption): boolean => {
            return !child.isEmptyHere;
          },
        );
        const emptyHere: Array<MenuOption> = children.filter(
          (child: MenuOption): boolean => {
            return Boolean(child.isEmptyHere);
          },
        );

        const drillSections: Array<OptionSection> = [
          {
            key: "drill",
            options: childQuery.trim() === "" ? [whole, ...usable] : usable,
          },
        ];

        if (emptyHere.length > 0) {
          drillSections.push({
            key: "drill-empty-here",
            emptyHereNote: drillItem.drillIn?.emptyHereNote,
            options: emptyHere,
          });
        }

        return drillSections;
      }

      return filterSuggestionGroups(groups, query).map(
        (group: ValueSuggestionGroup): OptionSection => {
          return {
            key: group.id,
            title: group.title,
            subtitle: group.subtitle,
            iconProp: group.iconProp,
            note: group.note,
            availability: group.availability,
            options: group.items.map((item: ValueSuggestion): MenuOption => {
              return {
                key: item.reference,
                label: item.label,
                description: item.description,
                typeLabel: item.typeLabel,
                badges: item.badges,
                sample: item.sample,
                isSampleHidden: item.isSampleHidden,
                reference: item.reference,
                /*
                 * A value whose fields are known - a record, or JSON a run
                 * returned - is opened to them; anything else is inserted
                 * whole.
                 */
                opens: Boolean(item.drillIn?.loadChildren),
                canLookInside: Boolean(
                  item.drillIn &&
                    !item.drillIn.loadChildren &&
                    item.drillIn.allowsPath,
                ),
                item: item,
                group: group,
              };
            }),
          };
        },
      );
    }, [
      drill,
      drillItem,
      drillChildren,
      groups,
      query,
      search,
      props.hasSearchBox,
    ]);

    const options: Array<MenuOption> = useMemo(() => {
      return sections.flatMap((section: OptionSection) => {
        return section.options;
      });
    }, [sections]);

    const optionId: (index: number) => string = (index: number): string => {
      return `${listboxId}-option-${index}`;
    };

    const activeOptionId: string | undefined =
      options.length > 0 && activeIndex < options.length
        ? optionId(activeIndex)
        : undefined;

    useEffect(() => {
      props.onActiveOptionChange?.(activeOptionId);
    }, [activeOptionId]);

    // Keep the option the keys are on in view.
    useEffect(() => {
      const element: HTMLElement | null = activeOptionId
        ? document.getElementById(activeOptionId)
        : null;

      if (element && typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ block: "nearest" });
      }
    }, [activeOptionId]);

    useEffect(() => {
      if (props.hasSearchBox) {
        searchRef.current?.focus();
      }
    }, [drill]);

    type OpenFunction = (option: MenuOption) => void;

    const open: OpenFunction = (option: MenuOption): void => {
      if (!option.item || !option.group) {
        return;
      }

      setDrill({ item: option.item, group: option.group });
      setSearch("");
      setPath("");
      setPathError(null);
    };

    type ActivateFunction = (option: MenuOption) => void;

    const activate: ActivateFunction = (option: MenuOption): void => {
      if (option.opens) {
        open(option);
        return;
      }

      props.onPick(option.reference);
    };

    type BackFunction = () => void;

    const back: BackFunction = (): void => {
      setDrill(null);
      setSearch("");
      setPath("");
      setPathError(null);
    };

    type ShowEmptyHereFunction = () => void;

    /*
     * A press on the heading of the fields that are not passed on brings
     * them up: the heading to the top of the list, where it is no longer
     * pinned, and the line that says what to do and the fields under it.
     */
    const showEmptyHere: ShowEmptyHereFunction = (): void => {
      const list: HTMLDivElement | null = listRef.current;
      const group: HTMLDivElement | null = emptyHereGroupRef.current;

      if (!list || !group) {
        return;
      }

      // The heading's own place is right above the fields it is over.
      list.scrollTop +=
        group.getBoundingClientRect().top -
        list.getBoundingClientRect().top -
        (emptyHereHeadingRef.current?.offsetHeight || 0);
    };

    type InsertPathFunction = () => void;

    const insertPath: InsertPathFunction = (): void => {
      if (!drill) {
        return;
      }

      const reference: string | null = appendPathToReference(
        drill.item.reference,
        path,
      );

      if (!reference) {
        setPathError(
          translator.translateText(
            "Use names separated by dots, with [0] for a list item - for example title or alerts[0].status.",
          ) || "",
        );
        return;
      }

      props.onPick(reference);
    };

    type HandleKeyFunction = (event: {
      key: string;
      shiftKey?: boolean;
      preventDefault: () => void;
    }) => boolean;

    const handleKey: HandleKeyFunction = (event: {
      key: string;
      shiftKey?: boolean;
      preventDefault: () => void;
    }): boolean => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (options.length === 0) {
          return false;
        }

        event.preventDefault();
        const step: number = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current: number) => {
          return (current + step + options.length) % options.length;
        });
        return true;
      }

      if (event.key === "Enter") {
        const option: MenuOption | undefined = options[activeIndex];

        if (!option) {
          return false;
        }

        event.preventDefault();
        activate(option);
        return true;
      }

      if (event.key === "ArrowRight" && !drill) {
        const option: MenuOption | undefined = options[activeIndex];

        if (!option || (!option.opens && !option.canLookInside)) {
          return false;
        }

        // In the search box the key also moves the caret: only at the end.
        if (
          props.hasSearchBox &&
          searchRef.current &&
          searchRef.current.selectionStart !== search.length
        ) {
          return false;
        }

        event.preventDefault();
        open(option);
        return true;
      }

      if (
        drill &&
        (event.key === "ArrowLeft" || event.key === "Backspace") &&
        (!props.hasSearchBox || search === "")
      ) {
        event.preventDefault();
        back();
        return true;
      }

      return false;
    };

    useImperativeHandle(ref, () => {
      return { handleKeyDown: handleKey };
    });

    const groupFiltered: boolean = Boolean(props.groupFilter);
    const hasAnyValues: boolean = groups.length > 0;
    const showNotConnected: boolean =
      !drill &&
      !groupFiltered &&
      picker.isAvailable &&
      !picker.isTrigger &&
      !picker.hasIncomingConnection;

    type RenderOptionFunction = (
      option: MenuOption,
      index: number,
      caveatId?: string | undefined,
    ) => ReactElement;

    const renderOption: RenderOptionFunction = (
      option: MenuOption,
      index: number,
      caveatId?: string | undefined,
    ): ReactElement => {
      const isActive: boolean = index === activeIndex;
      /*
       * What a row says besides its name is gray-500 on the list's white,
       * and a shade darker on the row the pointer or the keys are on, whose
       * tint would otherwise leave it at 4.3:1.
       */
      const quiet: string = isActive ? "text-gray-600" : "text-gray-500";

      return (
        <div
          key={option.key}
          id={optionId(index)}
          role="option"
          aria-selected={isActive}
          aria-describedby={caveatId}
          title={option.reference}
          data-testid="value-picker-option"
          data-reference={option.reference}
          data-empty-here={option.isEmptyHere ? "true" : undefined}
          className={`mx-1 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 ${
            isActive ? "bg-indigo-50" : ""
          }`}
          onMouseMove={() => {
            if (!isActive) {
              setActiveIndex(index);
            }
          }}
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
            // The focus stays where it is: the search box, or the field.
            event.preventDefault();
          }}
          onClick={() => {
            activate(option);
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                data-part="name"
                className={`truncate text-sm ${
                  option.isEmptyHere ? quiet : "text-gray-900"
                }`}
              >
                {option.label}
              </span>
              {(option.badges || []).map((badge: string) => {
                return (
                  <span
                    key={badge}
                    className={`shrink-0 rounded border px-1 text-[10px] font-medium leading-4 ${DEFAULT_BADGE_CLASS}`}
                  >
                    {badge}
                  </span>
                );
              })}
            </div>
            {/* An empty-here field's section says why; each says no more. */}
            {option.description && !option.isEmptyHere && (
              <div data-part="detail" className={`truncate text-xs ${quiet}`}>
                {translator.translateText(option.description)}
              </div>
            )}
          </div>
          {/*
           * What it held the last time its step ran, so the list says what
           * is in a value and not only what it is called.
           */}
          {option.isSampleHidden ? (
            <div
              className={`mt-0.5 flex max-w-[45%] shrink-0 items-center gap-1 text-xs ${quiet}`}
              title={translator.translateText(HIDDEN_SAMPLE_TITLE)}
              data-testid="value-picker-sample"
              data-hidden="true"
            >
              <Icon icon={IconProp.Lock} className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {translator.translateText(HIDDEN_SAMPLE_TEXT)}
              </span>
            </div>
          ) : option.sample !== undefined ? (
            <span
              className={`mt-0.5 max-w-[45%] shrink-0 truncate text-xs ${quiet}`}
              title={option.sample}
              data-testid="value-picker-sample"
            >
              {option.sample}
            </span>
          ) : null}
          {option.typeLabel && (
            <span
              data-part="kind"
              className={`mt-0.5 shrink-0 rounded border border-gray-200 px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide ${quiet}`}
            >
              {translator.translateText(option.typeLabel)}
            </span>
          )}
          {option.opens && (
            <span
              className="mt-0.5 flex shrink-0 items-center text-gray-400"
              aria-hidden="true"
            >
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </span>
          )}
          {option.canLookInside && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={translator.translateTemplate(
                "Use a field inside {{value}}",
                {
                  value: option.label,
                },
              )}
              title={translator.translateTemplate(
                "Use a field inside {{value}}",
                {
                  value: option.label,
                },
              )}
              data-testid="value-picker-look-inside"
              className="-my-0.5 flex shrink-0 items-center rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                open(option);
              }}
            >
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    };

    type RenderNoteFunction = (section: OptionSection) => ReactElement | null;

    /*
     * Under a step's name: why there is nothing inside its values yet, and
     * what to do about it - for a Webhook, a test request to copy. The list
     * asks again while it waits, so the fields turn up by themselves.
     */
    const renderNote: RenderNoteFunction = (
      section: OptionSection,
    ): ReactElement | null => {
      const note: ValueSuggestionNote | undefined = section.note;

      if (!note) {
        return null;
      }

      const copyStatus: ClipboardCopyStatus = noteClipboard.statusOf(
        section.key,
      );
      const isCopied: boolean = copyStatus === ClipboardCopyStatus.Copied;
      const isCopyFailed: boolean = copyStatus === ClipboardCopyStatus.Failed;
      const copyText: string | undefined = note.copyText;

      let copyButtonText: string | undefined = translator.translateText(
        note.copyLabel || "Copy",
      );

      if (isCopied) {
        copyButtonText = translator.translateText("Copied!");
      } else if (isCopyFailed) {
        copyButtonText = translator.translateText("Copy failed");
      }

      return (
        <div
          className="mx-1 mb-1 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600"
          data-testid="value-picker-group-note"
        >
          <div className="flex items-start gap-1.5">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
            />
            <span>{translator.translateText(note.text)}</span>
          </div>
          {copyText ||
          note.waitingText ||
          (note.offersTestRun && picker.onTestRun) ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
              {note.offersTestRun && picker.onTestRun ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  data-testid="value-picker-note-test-run"
                  onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                    // The focus stays in the search box, or the field.
                    event.preventDefault();
                  }}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    picker.onTestRun?.();
                  }}
                >
                  <Icon icon={IconProp.Play} className="h-3.5 w-3.5" />
                  {translator.translateText(StepSampleCopy.testWithRunWorkflow)}
                </button>
              ) : null}
              {copyText ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${
                    isCopied
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : isCopyFailed
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                  data-testid="value-picker-note-copy"
                  data-copy-state={copyStatus}
                  onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                    // The focus stays in the search box, or the field.
                    event.preventDefault();
                  }}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    void copyNoteText(section.key, copyText);
                  }}
                >
                  <Icon
                    icon={
                      isCopied
                        ? IconProp.Check
                        : isCopyFailed
                          ? IconProp.Alert
                          : IconProp.Copy
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span aria-live="polite">{copyButtonText}</span>
                </button>
              ) : null}
              {note.waitingText ? (
                <span
                  className="inline-flex items-center gap-1.5 text-gray-500"
                  role="status"
                  data-testid="value-picker-note-waiting"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500"
                  />
                  {translator.translateText(note.waitingText)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    };

    type RenderUnavailableFunction = () => ReactElement | null;

    /*
     * The steps whose values are not there when this step runs, after
     * everything that is, greyed and never picked: each says why, so a step
     * missing from the list above is explained rather than looked for.
     * Folded while browsing; a search shows the matching values of each.
     */
    const renderUnavailable: RenderUnavailableFunction =
      (): ReactElement | null => {
        if (unavailableGroups.length === 0) {
          return null;
        }

        const isSearching: boolean = query.trim() !== "";
        const matching: Array<ValueSuggestionGroup> = isSearching
          ? filterSuggestionGroups(unavailableGroups, query)
          : unavailableGroups;

        if (matching.length === 0) {
          return null;
        }

        const isOpen: boolean = isSearching || isUnavailableOpen;

        return (
          <div
            ref={unavailableRef}
            className="mx-1 mt-1 border-t border-gray-100 pt-1"
            data-testid="value-picker-unavailable"
          >
            {/*
             * The words that explain - this title, the line under the fold
             * and each step's reason - are gray-500: they are there to be
             * read. Only the values that cannot be picked are fainter.
             */}
            {isSearching ? (
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {translator.translateText(
                  ValuePickerMenuCopy.notAvailableTitle,
                )}
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                aria-expanded={isOpen}
                data-testid="value-picker-unavailable-toggle"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                  // The focus stays where it is: the search box, or the field.
                  event.preventDefault();
                }}
                onClick={() => {
                  setIsUnavailableOpen(!isUnavailableOpen);
                }}
              >
                <Icon
                  icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
                  className="h-3.5 w-3.5 shrink-0 text-gray-400"
                />
                <span className="font-medium">
                  {translator.translatePlural(
                    ValuePickerMenuCopy.notAvailable,
                    matching.length,
                  )}
                </span>
              </button>
            )}

            {isOpen && !isSearching ? (
              <p
                className="px-2 pb-1 text-xs text-gray-500"
                data-testid="value-picker-unavailable-hint"
              >
                {translator.translateText(ValuePickerMenuCopy.notAvailableHint)}
              </p>
            ) : null}

            {isOpen
              ? matching.map((group: ValueSuggestionGroup) => {
                  return (
                    <div
                      key={group.id}
                      className="px-2 py-1"
                      data-testid="value-picker-unavailable-step"
                      data-step={group.subtitle}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {group.iconProp ? (
                          <Icon
                            icon={group.iconProp}
                            className="h-3.5 w-3.5 shrink-0 text-gray-300"
                          />
                        ) : null}
                        <span
                          className="truncate text-xs font-semibold text-gray-500"
                          data-part="step-name"
                        >
                          {translator.translateText(group.title)}
                        </span>
                        {group.subtitle ? (
                          <span
                            className="truncate text-[11px] text-gray-500"
                            data-part="step-id"
                          >
                            {group.subtitle}
                          </span>
                        ) : null}
                      </div>
                      {group.availability ? (
                        <p
                          className="pl-5 text-xs text-gray-500"
                          data-testid="value-picker-unavailable-reason"
                        >
                          {translateSentence(
                            translator,
                            group.availability.reason,
                          )}
                        </p>
                      ) : null}
                      {isSearching
                        ? group.items.map((item: ValueSuggestion) => {
                            return (
                              <div
                                key={item.reference}
                                aria-disabled="true"
                                title={item.reference}
                                data-testid="value-picker-unavailable-value"
                                data-reference={item.reference}
                                className="mt-0.5 flex min-w-0 cursor-not-allowed items-center gap-2 rounded-md py-1 pl-5 pr-1"
                              >
                                <span className="truncate text-sm text-gray-400">
                                  {item.label}
                                </span>
                                {item.typeLabel ? (
                                  <span className="ml-auto shrink-0 rounded border border-gray-200 px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide text-gray-400">
                                    {translator.translateText(item.typeLabel)}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })
                        : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      };

    const drillNote: string | undefined = drillItem?.drillIn?.note;

    const hasEmptyHereSection: boolean = sections.some(
      (section: OptionSection): boolean => {
        return Boolean(section.emptyHereNote);
      },
    );

    let optionIndex: number = 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {drill && (
          <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1">
            {/*
             * The way out of a record's fields: 24px tall, a target a finger
             * can hit. The row around it gives up what the button gains, so
             * the list under it is where it was.
             */}
            <button
              type="button"
              className="flex items-center gap-0.5 rounded px-1 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              data-testid="value-picker-back"
              onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
              }}
              onClick={back}
            >
              <Icon icon={IconProp.ChevronLeft} className="h-3.5 w-3.5" />
              {translator.translateText("Back")}
            </button>
            <div className="min-w-0 truncate text-xs text-gray-500">
              <TranslatedSentence
                template="{{value}} from {{source}}"
                slots={{
                  value: (
                    <span className="font-medium text-gray-900">
                      {drill.item.label}
                    </span>
                  ),
                }}
                values={{
                  source: translator.translateText(drill.group.title) || "",
                }}
              />
            </div>
          </div>
        )}

        {props.hasSearchBox && (
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                <Icon
                  icon={IconProp.Search}
                  className="h-4 w-4 text-gray-400"
                />
              </div>
              <input
                data-unsaved-changes-ignore
                ref={searchRef}
                type="text"
                value={search}
                role="combobox"
                aria-expanded={true}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-label={
                  drill
                    ? translator.translateTemplate("Search {{value}}", {
                        value: drill.item.label,
                      })
                    : translator.translateText("Search values")
                }
                placeholder={
                  drill
                    ? translator.translateTemplate(
                        "Search the fields of {{value}}",
                        {
                          value: drill.item.label,
                        },
                      )
                    : translator.translateText(
                        props.searchPlaceholder || "Search values",
                      )
                }
                data-testid="value-picker-search"
                spellCheck={false}
                autoComplete="off"
                className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  handleKey(event);
                }}
              />
            </div>
          </div>
        )}

        <div
          id={listboxId}
          role="listbox"
          aria-label={
            drill
              ? translator.translateTemplate("Inside {{value}}", {
                  value: drill.item.label,
                })
              : translator.translateText("Values")
          }
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto py-1"
          style={
            hasEmptyHereSection
              ? { scrollPaddingBottom: EMPTY_HERE_HEADING_ROOM }
              : undefined
          }
        >
          {showNotConnected && (
            <div
              className="mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600"
              data-testid="value-picker-not-connected"
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
              />
              <span>
                {translator.translateText(
                  "Only the trigger's values are listed until this step is connected. Connect it after the steps whose values you need.",
                )}
              </span>
            </div>
          )}

          {drill && drillNote && (
            <div
              className="mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600"
              data-testid="value-picker-drill-note"
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
              />
              <span>{translator.translateText(drillNote)}</span>
            </div>
          )}

          {sections.map((section: OptionSection, sectionIndex: number) => {
            const headerId: string = `${listboxId}-${section.key}`;

            /*
             * A record's own section with nothing left in it - a search that
             * only finds fields that are not passed on - is not drawn: it
             * was an empty band over the heading of the ones that are.
             */
            if (
              section.options.length === 0 &&
              !section.title &&
              !section.note &&
              !section.emptyHereNote
            ) {
              return null;
            }

            // Whether any value is listed above this section.
            const hasValuesAbove: boolean = sections
              .slice(0, sectionIndex)
              .some((earlier: OptionSection): boolean => {
                return earlier.options.length > 0;
              });
            /*
             * The line over a section's values that says what sets them
             * apart - they can be empty on some runs, or are not passed on -
             * is what the eye reads before it reads them. Each of the values
             * is described by it too, so someone walking the list by ear
             * hears it with the value the keys are on.
             */
            const hasCaveat: boolean =
              section.availability?.state ===
                ValueAvailabilityState.Sometimes ||
              Boolean(section.emptyHereNote);
            const caveatId: string | undefined = hasCaveat
              ? `${headerId}-caveat`
              : undefined;

            const isEmptyHere: boolean = Boolean(section.emptyHereNote);

            return (
              <React.Fragment key={section.key}>
                {/*
                 * The heading over a record's fields that are not passed on.
                 * It is pinned to the foot of the list for as long as they
                 * are below it: a step that passes on four fields fills the
                 * list with them, and nothing said there were sixty more, or
                 * that they would be empty. Scrolled to, it lets go and
                 * leads them like any heading. It is its own child of the
                 * list, not the group's: a pinned element keeps inside its
                 * parent, and the group is what is out of sight. Pinned, it
                 * goes down over the list's own bottom padding (py-1), or
                 * the rows passing under it show in that gap.
                 *
                 * The line over it divides it from the fields above: with
                 * none above - a search found only fields that are not
                 * passed on - there is nothing to divide it from.
                 */}
                {isEmptyHere ? (
                  <div
                    ref={emptyHereHeadingRef}
                    className={`sticky -bottom-1 z-10 bg-white px-1 ${
                      hasValuesAbove ? "pt-1" : ""
                    }`}
                    data-testid="value-picker-empty-here-heading"
                    data-divided={hasValuesAbove ? "true" : "false"}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      id={headerId}
                      data-testid="value-picker-empty-here-toggle"
                      className={`flex w-full items-center gap-2 px-2 pb-1 text-left text-[11px] text-gray-500 hover:text-gray-700 focus:outline-none ${
                        hasValuesAbove
                          ? "border-t border-gray-100 pt-2"
                          : "pt-1"
                      }`}
                      onMouseDown={(
                        event: React.MouseEvent<HTMLButtonElement>,
                      ) => {
                        // The focus stays where it is: the search box, or the field.
                        event.preventDefault();
                      }}
                      onClick={showEmptyHere}
                    >
                      <span
                        className="min-w-0 truncate font-semibold uppercase tracking-wider"
                        data-part="group-title"
                      >
                        {translator.translateText(
                          ValuePickerMenuCopy.notPassedOnTitle,
                        )}
                      </span>
                      <span
                        className="ml-auto shrink-0"
                        data-part="group-count"
                      >
                        {translator.translatePlural(
                          ValuePickerMenuCopy.fieldCount,
                          section.options.length,
                        )}
                      </span>
                    </button>
                  </div>
                ) : null}
                <div
                  ref={isEmptyHere ? emptyHereGroupRef : undefined}
                  role="group"
                  aria-labelledby={
                    section.title || isEmptyHere ? headerId : undefined
                  }
                  aria-describedby={caveatId}
                  className="pb-1"
                >
                  {section.title && (
                    <div
                      id={headerId}
                      className="flex min-w-0 items-center gap-1.5 px-3 pb-1 pt-2"
                    >
                      {section.iconProp && (
                        <Icon
                          icon={section.iconProp}
                          className="h-3.5 w-3.5 shrink-0 text-gray-400"
                        />
                      )}
                      <span
                        className="truncate text-xs font-semibold text-gray-700"
                        data-part="group-title"
                      >
                        {translator.translateText(section.title)}
                      </span>
                      {/*
                       * A step's ID, which is all that tells two steps of one
                       * kind apart - or a line about the group. Read, either
                       * way: gray-500, not the gray-400 of decoration.
                       */}
                      {section.subtitle && (
                        <span
                          className="truncate text-[11px] text-gray-500"
                          data-part="group-subtitle"
                        >
                          {translator.translateText(section.subtitle)}
                        </span>
                      )}
                    </div>
                  )}
                  {section.availability?.state ===
                  ValueAvailabilityState.Sometimes ? (
                    <div
                      id={caveatId}
                      className="mx-1 mb-1 flex items-start gap-1.5 px-2 text-xs text-amber-700"
                      data-testid="value-picker-sometimes"
                    >
                      <Icon
                        icon={IconProp.ExclaimationCircle}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600"
                      />
                      <span>
                        {translateSentence(
                          translator,
                          section.availability.reason,
                        )}
                      </span>
                    </div>
                  ) : null}
                  {section.emptyHereNote ? (
                    <div
                      id={caveatId}
                      className="mx-1 mb-1 px-2 text-xs text-gray-500"
                      data-testid="value-picker-empty-here-note"
                    >
                      {translateSentence(translator, section.emptyHereNote)}
                    </div>
                  ) : null}
                  {renderNote(section)}
                  {section.options.map((option: MenuOption) => {
                    return renderOption(option, optionIndex++, caveatId);
                  })}
                </div>
              </React.Fragment>
            );
          })}

          {!drill ? renderUnavailable() : null}

          {drill && drillChildren?.status === ChildrenStatus.Loading && (
            <div className="px-3 py-2 text-xs text-gray-500">
              {translator.translateTemplate(
                "Loading the fields of {{value}}…",
                {
                  value: drill.item.label,
                },
              )}
            </div>
          )}

          {drill && drillChildren?.status === ChildrenStatus.Failed && (
            <div className="px-3 py-2 text-xs text-amber-700">
              {translator.translateTemplate(
                "Couldn't load the fields of {{value}}: {{error}}",
                { value: drill.item.label, error: drillChildren.error || "" },
              )}
            </div>
          )}

          {!drill &&
            options.length === 0 &&
            query.trim() !== "" &&
            filterSuggestionGroups(unavailableGroups, query).length === 0 && (
              <div
                className="px-3 py-2 text-xs text-gray-500"
                data-testid="value-picker-no-match"
              >
                {translator.translateTemplate("No values match “{{search}}”.", {
                  search: query.trim(),
                })}
              </div>
            )}

          {!drill &&
            !hasAnyValues &&
            !picker.isLoading &&
            query.trim() === "" && (
              <div
                className="px-3 py-3 text-xs text-gray-500"
                data-testid="value-picker-empty"
              >
                {translator.translateText(
                  props.emptyMessage ||
                    (picker.isTrigger
                      ? "A trigger runs first, so there is nothing before it to use. Workflow and global variables show up here."
                      : "Nothing to use yet. The values of the steps that run before this one, and the workflow's variables, show up here."),
                )}
              </div>
            )}

          {!drill && picker.isLoading && (
            <div className="px-3 py-2 text-xs text-gray-500">
              {translator.translateText("Loading variables…")}
            </div>
          )}

          {!drill &&
            picker.loadErrors.map((error: string) => {
              return (
                <div key={error} className="px-3 py-2 text-xs text-amber-700">
                  {translator.translateTemplate(
                    "Couldn't load the variables: {{error}}",
                    {
                      error: error,
                    },
                  )}
                </div>
              );
            })}
        </div>

        {drill && drill.item.drillIn?.allowsPath && (
          <form
            className="border-t border-gray-100 p-2"
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              insertPath();
            }}
          >
            <label
              className="mb-1 block text-xs text-gray-600"
              htmlFor={`${listboxId}-path`}
            >
              {translator.translateTemplate("Or a field inside {{value}}", {
                value: drill.item.label,
              })}
            </label>
            <div className="flex gap-1.5">
              <input
                id={`${listboxId}-path`}
                type="text"
                value={path}
                placeholder={drill.item.drillIn.pathPlaceholder}
                data-testid="value-picker-path"
                spellCheck={false}
                autoComplete="off"
                className="block w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setPath(event.target.value);
                  setPathError(null);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  // Enter submits the form; it must not reach the field.
                  if (event.key === "Enter") {
                    event.stopPropagation();
                  }
                }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                data-testid="value-picker-path-insert"
              >
                {translator.translateText("Insert")}
              </button>
            </div>
            {pathError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {pathError}
              </p>
            )}
          </form>
        )}
      </div>
    );
  },
);

ValuePickerMenu.displayName = "ValuePickerMenu";

export default ValuePickerMenu;
