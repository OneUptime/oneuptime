import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import ColorPicker from "../Forms/Fields/ColorPicker";
import Input, { InputType } from "../Input/Input";
import DragHandle from "../Table/DragHandle";
import Color from "../../../Types/Color";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import {
  CustomFieldOptionCopier,
  CustomFieldOptionRename,
  CustomFieldOptionUsage,
  CustomFieldRecordName,
  getCustomFieldOptionUsageCount,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import IconProp from "../../../Types/Icon/IconProp";
import {
  EditableDropdownOption,
  getDropdownOptionRenames,
  getDropdownOptionText,
  getDuplicateDropdownOptionTexts,
  getRetiredDropdownOptionValues,
  isRenamedDropdownOption,
  moveDropdownOption,
  RemovedDropdownOption,
  RetiredDropdownOptionValue,
} from "./DropdownOptionsEditState";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * The options of a Dropdown or Multi-select field - and of a form's own
 * choice question, which uses the same editor: one row per option, with its
 * text and an optional color, dragged by its grip into the order the options
 * are listed in.
 *
 * Editing a field that may already have values (issue #4564), the page hands
 * in onRenamesChange - and, when it has them, how many records hold each
 * value. Then:
 *
 *   - changing the text of an option the field had RENAMES it: the row says
 *     "Renamed from ...", and how many records will show the new name, and
 *     the rename is reported to be sent with the save;
 *   - an option taken out, and a value records hold that is not an option,
 *     is listed under "No longer options" with how many records hold it.
 *     They keep it unless an option is picked for them there (a rename too),
 *     and an option taken out by mistake can be put back;
 *   - two rows of the same text are pointed out.
 *
 * Without onRenamesChange - a new field, a form's question - it is a plain
 * list. The value is the options serialized as the custom fields store them
 * (serializeCustomFieldDropdownOptions); emitted only when it changes.
 */

export type { CustomFieldRecordName } from "../../../Types/CustomField/CustomFieldOptionEdit";

export interface ComponentProps {
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
  /*
   * Editing a saved field's options: the renames the edit makes, whenever
   * they change (CustomFieldOptionEdit), to be sent with the save.
   */
  onRenamesChange?:
    | ((renames: Array<CustomFieldOptionRename>) => void)
    | undefined;
  // How many records hold each value; null or undefined while not known.
  usage?: CustomFieldOptionUsage | null | undefined;
  // What the field's records are called, for the counts.
  recordName?: CustomFieldRecordName | undefined;
}

// The choice that keeps a retired value on the records that hold it.
const KEEP_VALUE: string = "keep";

const DropdownOptionsInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const nextIdRef: MutableRefObject<number> = useRef<number>(0);
  const droppableId: string = `dropdown-options-${useId()}`;
  const isEditingSavedField: boolean = Boolean(props.onRenamesChange);

  // The field's options when the editor opened.
  const originalOptions: Array<CustomFieldDropdownOption> = useMemo(() => {
    return parseCustomFieldDropdownOptions(props.initialValue);
  }, []);

  const createEditableOption: (
    option?: CustomFieldDropdownOption,
    originalValue?: string,
  ) => EditableDropdownOption = (
    option?: CustomFieldDropdownOption,
    originalValue?: string,
  ): EditableDropdownOption => {
    const editableOption: EditableDropdownOption = {
      id: nextIdRef.current,
      value: option?.value || "",
    };
    nextIdRef.current += 1;

    if (option?.color) {
      editableOption.color = option.color;
    }

    if (originalValue !== undefined) {
      editableOption.originalValue = originalValue;
    }

    return editableOption;
  };

  const [options, setOptions] = useState<Array<EditableDropdownOption>>(() => {
    return originalOptions.length > 0
      ? originalOptions.map((option: CustomFieldDropdownOption) => {
          return createEditableOption(option, option.value);
        })
      : [createEditableOption()];
  });

  // Options the field had, taken out here: Undo puts them back.
  const [removed, setRemoved] = useState<Array<RemovedDropdownOption>>([]);

  // The row picked for each retired value, by the value.
  const [replacements, setReplacements] = useState<
    Record<string, number | undefined>
  >({});

  const lastEmittedRef: MutableRefObject<string> = useRef<string>(
    serializeCustomFieldDropdownOptions(originalOptions),
  );

  const lastEmittedRenamesRef: MutableRefObject<string> = useRef<string>("[]");

  useEffect(() => {
    const serialized: string = serializeCustomFieldDropdownOptions(options);
    if (serialized !== lastEmittedRef.current) {
      lastEmittedRef.current = serialized;
      if (props.onChange) {
        props.onChange(serialized);
      }
    }
  }, [options]);

  const retired: Array<RetiredDropdownOptionValue> = isEditingSavedField
    ? getRetiredDropdownOptionValues({
        originalOptions: originalOptions,
        options: options,
        removed: removed,
        usage: props.usage,
      })
    : [];

  const renames: Array<CustomFieldOptionRename> = isEditingSavedField
    ? getDropdownOptionRenames({
        options: options,
        retired: retired,
        replacements: replacements,
      })
    : [];

  const renamesKey: string = JSON.stringify(renames);

  useEffect(() => {
    if (
      !props.onRenamesChange ||
      renamesKey === lastEmittedRenamesRef.current
    ) {
      return;
    }

    lastEmittedRenamesRef.current = renamesKey;
    props.onRenamesChange(renames);
  }, [renamesKey]);

  const duplicates: Set<string> = getDuplicateDropdownOptionTexts(options);

  type UpdateAtFunction = (
    id: number,
    update: Partial<CustomFieldDropdownOption>,
  ) => void;
  const updateAt: UpdateAtFunction = (
    id: number,
    update: Partial<CustomFieldDropdownOption>,
  ): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      return previousOptions.map((option: EditableDropdownOption) => {
        if (option.id !== id) {
          return option;
        }

        return {
          ...option,
          ...update,
        };
      });
    });
  };

  type UpdateColorAtFunction = (id: number, color: Color | null) => void;
  const updateColorAt: UpdateColorAtFunction = (
    id: number,
    color: Color | null,
  ): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      const next: Array<EditableDropdownOption> = previousOptions.map(
        (option: EditableDropdownOption) => {
          if (option.id !== id) {
            return option;
          }

          const updatedOption: EditableDropdownOption = {
            id: option.id,
            value: option.value,
          };

          if (option.originalValue !== undefined) {
            updatedOption.originalValue = option.originalValue;
          }

          if (color) {
            updatedOption.color = color.toString();
          }

          return updatedOption;
        },
      );

      return next;
    });
  };

  type RemoveAtFn = (id: number) => void;
  const removeAt: RemoveAtFn = (id: number): void => {
    const index: number = options.findIndex(
      (option: EditableDropdownOption): boolean => {
        return option.id === id;
      },
    );
    const option: EditableDropdownOption | undefined = options[index];

    if (option && option.originalValue !== undefined) {
      setRemoved((previous: Array<RemovedDropdownOption>) => {
        return [...previous, { option: option, index: index }];
      });
    }

    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      const next: Array<EditableDropdownOption> = previousOptions.filter(
        (candidate: EditableDropdownOption) => {
          return candidate.id !== id;
        },
      );
      return next.length > 0 ? next : [createEditableOption()];
    });
  };

  type UndoRemoveFn = (entry: RemovedDropdownOption) => void;
  const undoRemove: UndoRemoveFn = (entry: RemovedDropdownOption): void => {
    setRemoved((previous: Array<RemovedDropdownOption>) => {
      return previous.filter((candidate: RemovedDropdownOption) => {
        return candidate.option.id !== entry.option.id;
      });
    });

    setReplacements((previous: Record<string, number | undefined>) => {
      const next: Record<string, number | undefined> = { ...previous };
      delete next[entry.option.originalValue || ""];
      return next;
    });

    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      // The blank row left by taking out the last option gives way to it.
      const rows: Array<EditableDropdownOption> = previousOptions.filter(
        (option: EditableDropdownOption) => {
          return (
            option.originalValue !== undefined ||
            getDropdownOptionText(option).length > 0 ||
            previousOptions.length > 1
          );
        },
      );

      const next: Array<EditableDropdownOption> = [...rows];
      next.splice(Math.min(entry.index, next.length), 0, entry.option);
      return next;
    });
  };

  type AddOptionFn = () => void;
  const addOption: AddOptionFn = (): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      return [...previousOptions, createEditableOption()];
    });
  };

  type OnDragEndFn = (result: DropResult) => void;
  const onDragEnd: OnDragEndFn = (result: DropResult): void => {
    if (!result.destination) {
      return;
    }

    const from: number = result.source.index;
    const to: number = result.destination.index;

    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      return moveDropdownOption(previousOptions, from, to);
    });
  };

  type ReplaceFn = (value: string, rowId: number | undefined) => void;
  const replace: ReplaceFn = (
    value: string,
    rowId: number | undefined,
  ): void => {
    setReplacements((previous: Record<string, number | undefined>) => {
      const next: Record<string, number | undefined> = { ...previous };

      if (rowId === undefined) {
        delete next[value];
      } else {
        next[value] = rowId;
      }

      return next;
    });
  };

  // What the field's records are called, in a sentence: "incident(s)".
  const recordName: CustomFieldRecordName = props.recordName || {
    singular: "Record",
    plural: "Records",
  };

  const recordTerms: { item: TranslatableTerm; items: TranslatableTerm } = {
    item: translatableTerm(recordName.singular, { inSentence: true }),
    items: translatableTerm(recordName.plural, { inSentence: true }),
  };

  type RenameHintFunction = (option: EditableDropdownOption) => string;

  const renameHint: RenameHintFunction = (
    option: EditableDropdownOption,
  ): string => {
    const count: number | undefined = getCustomFieldOptionUsageCount(
      props.usage,
      option.originalValue || "",
    );

    if (!count) {
      return translator.translateTemplate('Renamed from "{{option}}".', {
        option: option.originalValue || "",
      });
    }

    return translator.translatePlural(
      {
        one: 'Renamed from "{{option}}": {{count}} {{item}} will show the new name.',
        other:
          'Renamed from "{{option}}": {{count}} {{items}} will show the new name.',
      },
      count,
      {
        option: option.originalValue || "",
        ...recordTerms,
      },
    );
  };

  // The options a retired value can become: the rows with text, once each.
  const replacementOptions: Array<DropdownOption> = [];
  const replacementTexts: Set<string> = new Set<string>();

  for (const option of options) {
    const text: string = getDropdownOptionText(option);

    if (!text || replacementTexts.has(text)) {
      continue;
    }

    replacementTexts.add(text);

    const dropdownOption: DropdownOption = {
      label: text,
      value: String(option.id),
    };

    if (option.color) {
      dropdownOption.color = Color.fromString(option.color);
    }

    replacementOptions.push(dropdownOption);
  }

  const keepOption: DropdownOption = {
    label: translator.translateText("Keep it as it is") || "Keep it as it is",
    value: KEEP_VALUE,
  };

  type RenderRowFunction = (
    option: EditableDropdownOption,
    index: number,
    provided: DraggableProvided,
    snapshot: DraggableStateSnapshot,
  ) => ReactElement;

  const renderRow: RenderRowFunction = (
    option: EditableDropdownOption,
    index: number,
    provided: DraggableProvided,
    snapshot: DraggableStateSnapshot,
  ): ReactElement => {
    const text: string = getDropdownOptionText(option);
    const isDuplicate: boolean = Boolean(text) && duplicates.has(text);
    const isRenamed: boolean =
      isEditingSavedField && isRenamedDropdownOption(option);
    const itemLabel: string =
      text ||
      translator.translateTemplate("Option {{number}}", {
        number: index + 1,
      });

    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        data-testid={`dropdown-option-row-${index}`}
        className={`rounded-md ${
          snapshot.isDragging
            ? "bg-white px-2 py-1 shadow-lg ring-1 ring-gray-200"
            : ""
        }`}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(9rem,12rem)_auto]">
          <DragHandle
            dragHandleProps={provided.dragHandleProps}
            itemLabel={itemLabel}
          />
          <div className="min-w-0">
            <span
              id={`dropdown-option-value-${option.id}-label`}
              className="sr-only"
            >
              {translator.translateTemplate("Dropdown option {{number}}", {
                number: index + 1,
              })}
            </span>
            <Input
              value={option.value}
              dataTestId={`dropdown-option-value-${index}`}
              ariaLabelledby={`dropdown-option-value-${option.id}-label`}
              placeholder={
                translator.translateText(props.placeholder) ||
                translator.translateTemplate("Option {{number}}", {
                  number: index + 1,
                })
              }
              onChange={(newValue: string) => {
                updateAt(option.id, { value: newValue });
              }}
              onBlur={() => {
                if (props.onBlur) {
                  props.onBlur();
                }
              }}
              type={InputType.TEXT}
            />
          </div>
          <div className="col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
            <span
              id={`dropdown-option-color-${option.id}-label`}
              className="sr-only"
            >
              {text
                ? translator.translateTemplate("Color for {{option}}", {
                    option: text,
                  })
                : translator.translateTemplate("Color for option {{number}}", {
                    number: index + 1,
                  })}
            </span>
            {/*
             * One line per option: the color as a small button with its
             * name, the swatches in a popover.
             */}
            <ColorPicker
              layout="compact"
              dataTestId={`dropdown-option-color-${index}`}
              ariaLabelledby={`dropdown-option-color-${option.id}-label`}
              placeholder="No color"
              value={option.color || ""}
              onChange={(color: Color | null) => {
                updateColorAt(option.id, color);
              }}
              onBlur={() => {
                if (props.onBlur) {
                  props.onBlur();
                }
              }}
            />
          </div>
          <Button
            title="Remove"
            className="col-start-3 row-start-1 sm:col-start-4"
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.Trash}
            onClick={() => {
              removeAt(option.id);
            }}
          />
        </div>
        {isDuplicate ? (
          <p
            className="mt-1 pl-8 text-xs text-red-600"
            data-testid={`dropdown-option-duplicate-${index}`}
          >
            {translator.translateText(
              "Another option has this name. Each option needs its own.",
            )}
          </p>
        ) : (
          <></>
        )}
        {isRenamed && !isDuplicate ? (
          <p
            className="mt-1 pl-8 text-xs text-gray-500"
            data-testid={`dropdown-option-renamed-${index}`}
          >
            {renameHint(option)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type RenderRetiredFunction = (
    entry: RetiredDropdownOptionValue,
    index: number,
  ) => ReactElement;

  const renderRetired: RenderRetiredFunction = (
    entry: RetiredDropdownOptionValue,
    index: number,
  ): ReactElement => {
    const pickedRowId: number | undefined = replacements[entry.value];
    const picked: DropdownOption | undefined = replacementOptions.find(
      (option: DropdownOption): boolean => {
        return option.value === String(pickedRowId);
      },
    );

    return (
      <li
        key={entry.value}
        data-testid={`dropdown-option-retired-${index}`}
        className={`py-2 ${index > 0 ? "border-t border-amber-200/70" : ""}`}
      >
        {/*
         * What the value is and how many records hold it, on one line; what
         * happens to it on the next, the same at every width.
         */}
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words text-sm font-medium text-amber-900">
            {entry.value}
          </span>
          <span
            className="text-xs text-amber-800"
            data-testid={`dropdown-option-retired-count-${index}`}
          >
            {entry.count === undefined
              ? translator.translateTemplate(
                  "{{items}} that have it keep it unless you pick an option for them.",
                  { items: translatableTerm(recordName.plural) },
                )
              : translator.translatePlural(
                  {
                    one: "{{count}} {{item}} has it.",
                    other: "{{count}} {{items}} have it.",
                  },
                  entry.count,
                  recordTerms,
                )}
          </span>
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <Dropdown
              options={[keepOption, ...replacementOptions]}
              value={picked || keepOption}
              isClearable={false}
              // Under its value, without the gap a form field's dropdown keeps.
              className="relative w-full overflow-visible rounded-md"
              dataTestId={`dropdown-option-retired-choice-${index}`}
              ariaLabel={translator.translateTemplate(
                "What happens to {{option}}",
                { option: entry.value },
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const chosen: string = Array.isArray(value)
                  ? String(value[0] ?? KEEP_VALUE)
                  : String(value ?? KEEP_VALUE);

                replace(
                  entry.value,
                  chosen === KEEP_VALUE ? undefined : Number(chosen),
                );
              }}
            />
          </div>
          {entry.removed ? (
            <Button
              title="Undo"
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              icon={IconProp.ArrowUturnLeft}
              dataTestId={`dropdown-option-retired-undo-${index}`}
              ariaLabel={translator.translateTemplate("Put {{option}} back", {
                option: entry.value,
              })}
              onClick={() => {
                if (entry.removed) {
                  undoRemove(entry.removed);
                }
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId={droppableId}>
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className="space-y-3"
              >
                {options.map(
                  (option: EditableDropdownOption, index: number) => {
                    return (
                      <Draggable
                        key={option.id}
                        draggableId={`${droppableId}-${option.id}`}
                        index={index}
                      >
                        {(
                          provided: DraggableProvided,
                          snapshot: DraggableStateSnapshot,
                        ) => {
                          return renderRow(option, index, provided, snapshot);
                        }}
                      </Draggable>
                    );
                  },
                )}
                {droppableProvided.placeholder}
              </div>
            );
          }}
        </Droppable>
      </DragDropContext>
      <div className="mt-3">
        <Button
          title="Add Option"
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={addOption}
        />
      </div>
      {retired.length > 0 ? (
        <div
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
          data-testid="dropdown-options-retired"
        >
          <p className="pt-1 text-sm font-medium text-amber-900">
            {translator.translateText("No longer options")}
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            {translator.translateTemplate(
              "{{items}} that have these values keep them unless you pick an option for them.",
              { items: translatableTerm(recordName.plural) },
            )}
          </p>
          <ul className="mt-1">
            {retired.map((entry: RetiredDropdownOptionValue, index: number) => {
              return renderRetired(entry, index);
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
      {(props.usage?.copiedBy || []).map(
        (copier: CustomFieldOptionCopier, index: number) => {
          return (
            <p
              key={`${copier.resource}-${copier.fieldName}-${index}`}
              className="mt-3 text-xs text-gray-500"
              data-testid={`dropdown-options-copied-by-${index}`}
            >
              {translator.translateTemplate(
                'The {{resource}} field "{{field}}" copies this field: options you rename here are renamed there too, and options you add are added to it.',
                {
                  resource: translatableTerm(copier.resource, {
                    inSentence: true,
                  }),
                  field: copier.fieldName,
                },
              )}
            </p>
          );
        },
      )}
      {props.error ? (
        <p className="mt-2 text-sm text-red-500">{props.error}</p>
      ) : null}
    </div>
  );
};

export default DropdownOptionsInput;
