import { loadCodeEditor } from "../../CodeEditor/LazyCodeEditor";
import { loadYamlEditor } from "../../CodeEditor/LazyYamlEditor";
import { loadEntityDropdown } from "../../EntityDropdown/LazyEntityDropdown";
import { loadFilePicker } from "../../FilePicker/LazyFilePicker";
import { loadMarkdownEditor } from "../../Markdown.tsx/LazyMarkdownEditor";
import { loadPeoplePicker } from "../../PeoplePicker/LazyPeoplePicker";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";

/*
 * The controls a form field can draw that are files of their own: every page
 * with a form reaches FormField, and few forms have one of these fields
 * (issue #5619). Each is drawn by its Lazy wrapper, which loads it when the
 * field is drawn. A form asks for them sooner, as it is drawn itself, for the
 * fields it has not drawn yet (loadFormFieldControls).
 */
type LoadControlFunction = () => Promise<unknown>;

const LOAD_CONTROL: Partial<Record<FormFieldSchemaType, LoadControlFunction>> =
  {
    [FormFieldSchemaType.JSON]: loadCodeEditor,
    [FormFieldSchemaType.HTML]: loadCodeEditor,
    [FormFieldSchemaType.CSS]: loadCodeEditor,
    [FormFieldSchemaType.JavaScript]: loadCodeEditor,
    [FormFieldSchemaType.YAML]: loadYamlEditor,
    [FormFieldSchemaType.Markdown]: loadMarkdownEditor,
    [FormFieldSchemaType.File]: loadFilePicker,
    [FormFieldSchemaType.ImageFile]: loadFilePicker,
    [FormFieldSchemaType.MultipleFiles]: loadFilePicker,
    [FormFieldSchemaType.PeoplePicker]: loadPeoplePicker,
  };

/*
 * The control a field of this type draws with, or none for a field whose
 * control is part of the first load.
 */
export const getLoadControl: (
  fieldType: FormFieldSchemaType | undefined,
) => LoadControlFunction | null = (
  fieldType: FormFieldSchemaType | undefined,
): LoadControlFunction | null => {
  return (fieldType && LOAD_CONTROL[fieldType]) || null;
};

// A field as a form holds it, for what its control is.
export interface FieldWithControl {
  fieldType?: FormFieldSchemaType | undefined;
  // Set on a dropdown that picks records rather than from a fixed list.
  dropdownModal?: { type?: unknown } | undefined;
}

/*
 * The control a field draws with, or none for a field whose control is part
 * of the first load: by its type, and for a dropdown that picks records (a
 * dropdownModal, which FormField draws as the entity dropdown) the entity
 * dropdown, whose file is its own as well. A dropdown from a fixed list draws
 * with the first load's Dropdown.
 */
export const getFieldLoadControl: (
  field: FieldWithControl,
) => LoadControlFunction | null = (
  field: FieldWithControl,
): LoadControlFunction | null => {
  if (
    (field.fieldType === FormFieldSchemaType.Dropdown ||
      field.fieldType === FormFieldSchemaType.MultiSelectDropdown) &&
    field.dropdownModal?.type
  ) {
    return loadEntityDropdown;
  }

  return getLoadControl(field.fieldType);
};

/*
 * Loads the controls these fields draw with, however far off the fields are:
 * on a step not reached yet, or hidden until another answer shows them. So a
 * control is there by the time its field is. A load that fails is the field's
 * to say, once it is drawn: it asks again then, and says so if it still cannot.
 */
export const loadFormFieldControls: (
  fields: ReadonlyArray<FieldWithControl>,
) => void = (fields: ReadonlyArray<FieldWithControl>): void => {
  const asked: Set<LoadControlFunction> = new Set<LoadControlFunction>();

  for (const field of fields) {
    const loadControl: LoadControlFunction | null = getFieldLoadControl(field);

    if (loadControl && !asked.has(loadControl)) {
      asked.add(loadControl);

      loadControl().catch((): void => {
        // Said by the field, when it is drawn.
      });
    }
  }
};

/*
 * Every one of them, for what must have them before it draws (a test that
 * types in a field straight after rendering it).
 */
export const loadAllFormFieldControls: () => Promise<void> =
  async (): Promise<void> => {
    await Promise.all(
      [...Object.values(LOAD_CONTROL), loadEntityDropdown].map(
        (loadControl: LoadControlFunction): Promise<unknown> => {
          return loadControl();
        },
      ),
    );
  };
