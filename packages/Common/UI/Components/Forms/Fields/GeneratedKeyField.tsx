import FieldLabelElement from "./FieldLabel";
import Field, { CustomElementProps } from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";
import FormValues from "../Types/FormValues";
import Input from "../../Input/Input";
import useTranslateValue from "../../../Utils/Translation";
import SelectFormFields from "../../../Types/SelectEntityField";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * A key made from the name, on a form: one short line under the Name field,
 *
 *   Key  time-to-detect  Edit
 *
 * that follows the name as it is typed. Nobody has to fill it in. Edit opens
 * it as a text box for someone who wants a different key; what they type
 * stays, whatever the name becomes, until they empty the box or choose
 * "Make it from the name" again.
 *
 * The maintainer, on the measurement forms that asked for a Key: "it should
 * be automatically generated based on the name. If a human wants to edit
 * it, they can edit it as well, but please don't require an input from a
 * human." This is that, for every form with such a key - build the field
 * with getGeneratedKeyFormField below rather than a Text field.
 *
 * What the form holds. The field's value is only ever a key someone typed:
 * while the key is made from the name the value stays empty, and the
 * request leaves the key out. The server then makes the same key from the
 * same name (each kind of key has one pure function for it, shared by both
 * sides - Types/Measurement/MeasurementKey for example), and it can number
 * it (time-to-detect-2) when another record of the project already has it,
 * which a form cannot know.
 */

// Every word the field draws itself, for the locale files.
export const GeneratedKeyFieldText: {
  edit: string;
  pendingName: string;
  makeFromName: string;
} = {
  edit: "Edit",
  // Shown in place of the key until a name is typed.
  pendingName: "Made from the name",
  // Goes back from a typed key to the one the name makes.
  makeFromName: "Make it from the name",
};

export interface ComponentProps {
  // What the key is called on the form: "Key", "Output Metric Name".
  title: string;
  /*
   * The key someone typed, or "" while the key is made from the name. On a
   * form, the field's own value.
   */
  value: string;
  // The key the name makes as it stands, or "" while there is no name.
  generatedValue: string;
  // Called with what was typed, or "" when the key is made from the name.
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  // Shown with the text box: what the key is for and what it may hold.
  description?: string | undefined;
  // Shown in the text box when it is empty and there is no name yet.
  placeholder?: string | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

const GeneratedKeyField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const baseId: string = useId();
  const titleId: string = `${baseId}-title`;
  const editButtonId: string = `${baseId}-edit`;
  const inputId: string = `${baseId}-input`;
  const dataTestId: string = props.dataTestId || "generated-key-field";

  /*
   * Whether the text box is open. It opens by itself for a key someone
   * typed - one the form already holds when the field is drawn again, after
   * the user went to another step and came back.
   */
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(props.value));

  /*
   * What was typed into the box, or null while it shows the name's key and
   * follows the name: opening the box to look is not typing a key.
   */
  const [typedText, setTypedText] = useState<string | null>(
    props.value ? props.value : null,
  );

  /*
   * The text box takes the focus when Edit opens it, not when it is drawn
   * open again with the step: then the form's first field keeps it.
   */
  const [focusWhenOpened, setFocusWhenOpened] = useState<boolean>(false);

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) ?? text;
  };

  const effectiveValue: string = props.value || props.generatedValue;

  // A validateKey message is written in English, like a field description.
  const error: string | undefined = props.error
    ? translate(props.error)
    : undefined;

  const errorElement: ReactElement | null =
    error && !isOpen ? (
      <p
        className="mt-1 text-sm text-red-400"
        role="alert"
        data-testid={`${dataTestId}-error`}
      >
        {error}
      </p>
    ) : null;

  if (!isOpen) {
    return (
      /*
       * Drawn up towards the name field above it, whose key it is: the
       * form's usual gap between two fields would make it read as a field of
       * its own.
       */
      <div className="-mt-2" data-testid={dataTestId}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span id={titleId} className="font-medium text-gray-700">
            {translate(props.title)}
          </span>
          {effectiveValue ? (
            <code
              className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800"
              data-testid={`${dataTestId}-value`}
            >
              {effectiveValue}
            </code>
          ) : (
            <span
              className="text-gray-500"
              data-testid={`${dataTestId}-pending`}
            >
              {translate(GeneratedKeyFieldText.pendingName)}
            </span>
          )}
          <button
            type="button"
            id={editButtonId}
            // "Edit Key": the button's word, then the field's title.
            aria-labelledby={`${editButtonId} ${titleId}`}
            className="rounded font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            data-testid={`${dataTestId}-edit`}
            onClick={() => {
              setFocusWhenOpened(true);
              setTypedText(props.value ? props.value : null);
              setIsOpen(true);
            }}
          >
            {translate(GeneratedKeyFieldText.edit)}
          </button>
        </div>
        {errorElement}
      </div>
    );
  }

  return (
    <div data-testid={dataTestId}>
      <FieldLabelElement
        title={props.title}
        htmlFor={inputId}
        description={props.description}
        hideOptionalLabel={true}
      />
      <Input
        id={inputId}
        value={typedText === null ? props.generatedValue : typedText}
        autoFocus={focusWhenOpened}
        disableSpellCheck={true}
        dataTestId={`${dataTestId}-input`}
        placeholder={props.generatedValue || props.placeholder}
        error={error}
        onChange={(text: string) => {
          /*
           * The name's own key, typed back in, is no override: the box
           * follows the name again, and the form holds nothing.
           */
          const isNamesKey: boolean =
            text.length > 0 && text === props.generatedValue;

          setTypedText(isNamesKey ? null : text);
          props.onChange(isNamesKey ? "" : text);
        }}
        onBlur={props.onBlur}
      />
      {props.value ? (
        <button
          type="button"
          className="mt-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          data-testid={`${dataTestId}-make-from-name`}
          onClick={() => {
            setTypedText(null);
            setIsOpen(false);
            props.onChange("");
          }}
        >
          {translate(GeneratedKeyFieldText.makeFromName)}
        </button>
      ) : null}
    </div>
  );
};

export default GeneratedKeyField;

export interface GeneratedKeyFormFieldOptions<TEntity> {
  // The column the key is saved in: { key: true }.
  field: SelectFormFields<TEntity>;
  // The form value the key is made from, usually "name".
  nameField: keyof TEntity & string;
  // What the key is called on the form: "Key".
  title: string;
  /*
   * The key a name makes: the same pure function the server uses when a
   * create leaves the key out (getMeasurementKeyFromName, ...).
   */
  makeKey: (name: string) => string;
  stepId?: string | undefined;
  /*
   * Shown when someone opens the key to type their own: what it is for and
   * what it may hold. One or two short sentences.
   */
  description?: string | undefined;
  // Shown in the text box while it is empty and there is no name yet.
  placeholder?: string | undefined;
  /*
   * The message for a key someone typed that the server would refuse, or
   * null when it is fine. Not asked of a key made from the name.
   */
  validateKey?: ((key: string) => string | null) | undefined;
  dataTestId?: string | undefined;
}

export type GetGeneratedKeyFormFieldFunction = <TEntity>(
  options: GeneratedKeyFormFieldOptions<TEntity>,
) => Field<TEntity>;

/**
 * The form field for a key made from the name: on the Create form only (a
 * key that can be changed after create is an ordinary field on the Edit
 * form), never required, drawn as GeneratedKeyField. Put it right after the
 * name field, on the same step.
 */
export const getGeneratedKeyFormField: GetGeneratedKeyFormFieldFunction = <
  TEntity,
>(
  options: GeneratedKeyFormFieldOptions<TEntity>,
): Field<TEntity> => {
  const keyFieldName: string = Object.keys(options.field)[0] as string;

  type ReadFunction = (values: FormValues<TEntity>, key: string) => string;

  const read: ReadFunction = (
    values: FormValues<TEntity>,
    key: string,
  ): string => {
    const value: unknown = (values as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  };

  type GetGeneratedValueFunction = (values: FormValues<TEntity>) => string;

  const getGeneratedValue: GetGeneratedValueFunction = (
    values: FormValues<TEntity>,
  ): string => {
    const name: string = read(values, options.nameField);
    // No name, no key yet: not the fallback a name of nothing makes.
    return name.trim() ? options.makeKey(name) : "";
  };

  return {
    field: options.field,
    title: options.title,
    ...(options.stepId ? { stepId: options.stepId } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    ...(options.dataTestId ? { dataTestId: options.dataTestId } : {}),
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    // Left alone, the server makes the key from the name.
    required: false,
    hideOptionalLabel: true,
    // Made once, at create. A key that changes later is an Edit form field.
    doNotShowWhenEditing: true,
    customValidation: (values: FormValues<TEntity>): string | null => {
      const typedKey: string = read(values, keyFieldName);

      if (!typedKey || !options.validateKey) {
        return null;
      }

      return options.validateKey(typedKey);
    },
    getCustomElement: (
      values: FormValues<TEntity>,
      elementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <GeneratedKeyField
          title={options.title}
          value={
            typeof elementProps.initialValue === "string"
              ? elementProps.initialValue
              : ""
          }
          generatedValue={getGeneratedValue(values)}
          onChange={(value: string) => {
            elementProps.onChange?.(value);
          }}
          onBlur={elementProps.onBlur}
          description={options.description}
          placeholder={options.placeholder}
          error={elementProps.error}
          dataTestId={options.dataTestId}
        />
      );
    },
  };
};
