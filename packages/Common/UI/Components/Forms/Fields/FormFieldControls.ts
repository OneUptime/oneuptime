import { loadCodeEditor } from "../../CodeEditor/LazyCodeEditor";
import { loadYamlEditor } from "../../CodeEditor/LazyYamlEditor";
import { loadFilePicker } from "../../FilePicker/LazyFilePicker";
import { loadMarkdownEditor } from "../../Markdown.tsx/LazyMarkdownEditor";
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

/*
 * Loads the controls these fields draw with, however far off the fields are:
 * on a step not reached yet, or hidden until another answer shows them. So a
 * control is there by the time its field is. A load that fails is the field's
 * to say, once it is drawn: it asks again then, and says so if it still cannot.
 */
export const loadFormFieldControls: (
  fields: ReadonlyArray<{ fieldType?: FormFieldSchemaType | undefined }>,
) => void = (
  fields: ReadonlyArray<{ fieldType?: FormFieldSchemaType | undefined }>,
): void => {
  const asked: Set<LoadControlFunction> = new Set<LoadControlFunction>();

  for (const field of fields) {
    const loadControl: LoadControlFunction | null = getLoadControl(
      field.fieldType,
    );

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
      Object.values(LOAD_CONTROL).map(
        (loadControl: LoadControlFunction): Promise<unknown> => {
          return loadControl();
        },
      ),
    );
  };
