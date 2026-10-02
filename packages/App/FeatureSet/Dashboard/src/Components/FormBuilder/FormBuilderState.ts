import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "Common/Types/CustomField/CustomFieldDropdownOption";
import {
  createCustomFieldField,
  createQuestionField,
  createSubmitterField,
  createTargetField,
  FORM_CHOICE_QUESTION_TYPES,
  FORM_MAX_FIELDS,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  generateFormFieldId,
} from "Common/Types/Form/FormField";
import { FormCustomFieldDefinition } from "Common/Types/Form/FormPublic";
import {
  FormTargetFieldDefinition,
  getFormTargetField,
  getFormTargetFields,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType from "Common/Types/Form/FormTargetType";

/*
 * Everything the form builder does to a form's questions, apart from drawing
 * them: adding, moving, editing, duplicating and removing a question, what
 * the palette still offers, and what each question is linked to. Pure and
 * React-free, so the builder's rules are tested on their own; the builder
 * holds a draft of the questions and runs every change through here.
 *
 * Every function returns a new list and leaves the one it was given alone:
 * the draft is React state.
 */

// What the palette offers, and whether each one can still be added.
export interface FormPaletteState {
  targetFields: Array<{
    definition: FormTargetFieldDefinition;
    isAdded: boolean;
  }>;
  customFields: Array<{
    definition: FormCustomFieldDefinition;
    isAdded: boolean;
  }>;
  submitterFields: Array<{
    submitterField: FormSubmitterField;
    isAdded: boolean;
  }>;
  // The form has as many questions as a form may have.
  isFull: boolean;
}

export type GetFormPaletteStateFunction = (data: {
  fields: Array<FormField>;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}) => FormPaletteState;

/**
 * The palette for a form: the target's own fields, its custom fields and the
 * submitter's details, each marked added once a question asks it - a field
 * is asked once. A question of the form's own can always be added, until the
 * form is full.
 */
export const getFormPaletteState: GetFormPaletteStateFunction = (data: {
  fields: Array<FormField>;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}): FormPaletteState => {
  const askedTargetFields: Set<string> = new Set<string>();
  const askedCustomFields: Set<string> = new Set<string>();
  const askedSubmitterFields: Set<string> = new Set<string>();

  for (const field of data.fields) {
    if (field.source === FormFieldSource.TargetField && field.targetField) {
      askedTargetFields.add(field.targetField);
    }

    if (
      field.source === FormFieldSource.TargetCustomField &&
      field.customFieldId
    ) {
      askedCustomFields.add(field.customFieldId.toLowerCase());
    }

    if (field.source === FormFieldSource.Submitter && field.submitterField) {
      askedSubmitterFields.add(field.submitterField);
    }
  }

  return {
    targetFields: getFormTargetFields(data.targetType).map(
      (definition: FormTargetFieldDefinition) => {
        return {
          definition: definition,
          isAdded: askedTargetFields.has(definition.key),
        };
      },
    ),
    customFields: data.customFields.map(
      (definition: FormCustomFieldDefinition) => {
        return {
          definition: definition,
          isAdded: askedCustomFields.has(definition.id.toLowerCase()),
        };
      },
    ),
    submitterFields: [FormSubmitterField.Name, FormSubmitterField.Email].map(
      (submitterField: FormSubmitterField) => {
        return {
          submitterField: submitterField,
          isAdded: askedSubmitterFields.has(submitterField),
        };
      },
    ),
    isFull: data.fields.length >= FORM_MAX_FIELDS,
  };
};

export interface FormFieldsChange {
  fields: Array<FormField>;
  // The question to select after the change, if any.
  selectedId: string | null;
}

export type InsertFormFieldFunction = (data: {
  fields: Array<FormField>;
  field: FormField;
  // Insert after this question; at the end when it is not in the list.
  afterId?: string | null | undefined;
}) => FormFieldsChange;

/**
 * Adds a question after the selected one (or at the end), and selects it.
 * A form that is already full is returned as it was.
 */
export const insertFormField: InsertFormFieldFunction = (data: {
  fields: Array<FormField>;
  field: FormField;
  afterId?: string | null | undefined;
}): FormFieldsChange => {
  if (data.fields.length >= FORM_MAX_FIELDS) {
    return { fields: [...data.fields], selectedId: data.afterId || null };
  }

  const index: number = data.afterId
    ? data.fields.findIndex((field: FormField): boolean => {
        return field.id === data.afterId;
      })
    : -1;

  const fields: Array<FormField> = [...data.fields];

  if (index === -1) {
    fields.push(data.field);
  } else {
    fields.splice(index + 1, 0, data.field);
  }

  return { fields: fields, selectedId: data.field.id };
};

export type CreatePaletteFieldFunction = (
  item:
    | { kind: "question"; type: CustomFieldType; label: string }
    | { kind: "target"; definition: FormTargetFieldDefinition }
    | { kind: "customField"; definition: FormCustomFieldDefinition }
    | { kind: "submitter"; submitterField: FormSubmitterField },
) => FormField;

// The question a palette entry adds.
export const createPaletteField: CreatePaletteFieldFunction = (
  item:
    | { kind: "question"; type: CustomFieldType; label: string }
    | { kind: "target"; definition: FormTargetFieldDefinition }
    | { kind: "customField"; definition: FormCustomFieldDefinition }
    | { kind: "submitter"; submitterField: FormSubmitterField },
): FormField => {
  switch (item.kind) {
    case "target":
      return createTargetField({ definition: item.definition });

    case "customField":
      return createCustomFieldField({
        customFieldId: item.definition.id,
        name: item.definition.name,
        description: item.definition.description,
      });

    case "submitter":
      return createSubmitterField({ submitterField: item.submitterField });

    default:
      return createQuestionField({ type: item.type, label: item.label });
  }
};

export type MoveFormFieldFunction = (data: {
  fields: Array<FormField>;
  fromIndex: number;
  toIndex: number;
}) => Array<FormField>;

/** Moves one question to another position, as a drag and drop does. */
export const moveFormField: MoveFormFieldFunction = (data: {
  fields: Array<FormField>;
  fromIndex: number;
  toIndex: number;
}): Array<FormField> => {
  const fields: Array<FormField> = [...data.fields];

  if (
    data.fromIndex < 0 ||
    data.fromIndex >= fields.length ||
    data.toIndex < 0 ||
    data.toIndex >= fields.length ||
    data.fromIndex === data.toIndex
  ) {
    return fields;
  }

  const [moved] = fields.splice(data.fromIndex, 1);
  fields.splice(data.toIndex, 0, moved!);

  return fields;
};

export type MoveFormFieldByFunction = (data: {
  fields: Array<FormField>;
  id: string;
  // -1 moves it up one place, 1 down one place.
  offset: number;
}) => Array<FormField>;

// Moves a question up or down, for the keyboard's Move Up and Move Down.
export const moveFormFieldBy: MoveFormFieldByFunction = (data: {
  fields: Array<FormField>;
  id: string;
  offset: number;
}): Array<FormField> => {
  const fromIndex: number = data.fields.findIndex(
    (field: FormField): boolean => {
      return field.id === data.id;
    },
  );

  return moveFormField({
    fields: data.fields,
    fromIndex: fromIndex,
    toIndex: fromIndex + data.offset,
  });
};

export type UpdateFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
  changes: Partial<FormField>;
}) => Array<FormField>;

/*
 * Changes a question. Its id and source never change, and a question the
 * target cannot do without stays required. A question of the form's own that
 * becomes a dropdown gets two starting options, and one that stops being one
 * drops its options.
 */
export const updateFormField: UpdateFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
  changes: Partial<FormField>;
}): Array<FormField> => {
  return data.fields.map((field: FormField): FormField => {
    if (field.id !== data.id) {
      return field;
    }

    const updated: FormField = {
      ...field,
      ...data.changes,
      id: field.id,
      source: field.source,
    };

    if (updated.source === FormFieldSource.Question && updated.type) {
      const isChoice: boolean = FORM_CHOICE_QUESTION_TYPES.includes(
        updated.type,
      );

      if (isChoice && !updated.dropdownOptions) {
        updated.dropdownOptions = JSON.stringify([
          { value: "Option 1" },
          { value: "Option 2" },
        ]);
      }

      if (!isChoice) {
        delete updated.dropdownOptions;
      }
    }

    if (!updated.helpText) {
      delete updated.helpText;
    }

    return updated;
  });
};

export type IsFormFieldLockedFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
}) => boolean;

/*
 * Whether the target cannot do without the question - a maintenance event's
 * start and end: it cannot be removed, and stays required.
 */
export const isFormFieldLocked: IsFormFieldLockedFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
}): boolean => {
  if (data.field.source !== FormFieldSource.TargetField) {
    return false;
  }

  const definition: FormTargetFieldDefinition | undefined = getFormTargetField(
    data.targetType,
    data.field.targetField,
  );

  return Boolean(
    definition && definition.isRequiredByTarget && !definition.hasDefault,
  );
};

export type RemoveFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
  targetType: FormTargetType;
}) => FormFieldsChange;

/**
 * Removes a question - unless the target cannot do without it - and selects
 * nothing.
 */
export const removeFormField: RemoveFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
  targetType: FormTargetType;
}): FormFieldsChange => {
  const field: FormField | undefined = data.fields.find(
    (candidate: FormField): boolean => {
      return candidate.id === data.id;
    },
  );

  if (!field || isFormFieldLocked({ field, targetType: data.targetType })) {
    return { fields: [...data.fields], selectedId: field ? field.id : null };
  }

  return {
    fields: data.fields.filter((candidate: FormField): boolean => {
      return candidate.id !== data.id;
    }),
    selectedId: null,
  };
};

export type DuplicateFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
}) => FormFieldsChange;

/**
 * Copies a question of the form's own right after it, with a new id, and
 * selects the copy. A linked question is asked once, so it is not copied.
 */
export const duplicateFormField: DuplicateFormFieldFunction = (data: {
  fields: Array<FormField>;
  id: string;
}): FormFieldsChange => {
  const field: FormField | undefined = data.fields.find(
    (candidate: FormField): boolean => {
      return candidate.id === data.id;
    },
  );

  if (!field || field.source !== FormFieldSource.Question) {
    return { fields: [...data.fields], selectedId: data.id };
  }

  return insertFormField({
    fields: data.fields,
    field: { ...field, id: generateFormFieldId() },
    afterId: field.id,
  });
};

export type GetQuestionOptionsFunction = (field: FormField) => Array<string>;

// A dropdown question's options, as a list of their texts.
export const getQuestionOptions: GetQuestionOptionsFunction = (
  field: FormField,
): Array<string> => {
  return parseCustomFieldDropdownOptions(field.dropdownOptions).map(
    (option: CustomFieldDropdownOption): string => {
      return option.value;
    },
  );
};

export type SerializeQuestionOptionsFunction = (
  options: Array<string>,
) => string;

/*
 * Options as they are stored: the custom fields' JSON format. Blank options
 * are kept while somebody is typing them; the server refuses a blank or a
 * repeated option when the form is saved, and says which.
 */
export const serializeQuestionOptions: SerializeQuestionOptionsFunction = (
  options: Array<string>,
): string => {
  return JSON.stringify(
    options.map((value: string): { value: string } => {
      return { value: value };
    }),
  );
};

export type AreFormFieldsEqualFunction = (
  a: Array<FormField>,
  b: Array<FormField>,
) => boolean;

// Whether two lists of questions are the same, for "unsaved changes".
export const areFormFieldsEqual: AreFormFieldsEqualFunction = (
  a: Array<FormField>,
  b: Array<FormField>,
): boolean => {
  return JSON.stringify(a) === JSON.stringify(b);
};

export enum FormFieldIssue {
  // Linked to a custom field that was deleted.
  CustomFieldDeleted = "CustomFieldDeleted",
  // A choice of records with none chosen, on a target that needs some.
  NoAllowedOptions = "NoAllowedOptions",
  // A dropdown question with no option, or a blank one.
  NoOptions = "NoOptions",
  // No label.
  NoLabel = "NoLabel",
}

export type GetFormFieldIssuesFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}) => Array<FormFieldIssue>;

/**
 * What is wrong with a question as the builder holds it, for the warnings on
 * its card - the server refuses most of them on save, and leaves a question
 * linked to a deleted custom field off the public page.
 */
export const getFormFieldIssues: GetFormFieldIssuesFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}): Array<FormFieldIssue> => {
  const issues: Array<FormFieldIssue> = [];

  if (!data.field.label.trim()) {
    issues.push(FormFieldIssue.NoLabel);
  }

  if (data.field.source === FormFieldSource.TargetCustomField) {
    const exists: boolean = data.customFields.some(
      (definition: FormCustomFieldDefinition): boolean => {
        return (
          definition.id.toLowerCase() ===
          (data.field.customFieldId || "").toLowerCase()
        );
      },
    );

    if (!exists) {
      issues.push(FormFieldIssue.CustomFieldDeleted);
    }
  }

  if (data.field.source === FormFieldSource.TargetField) {
    const definition: FormTargetFieldDefinition | undefined =
      getFormTargetField(data.targetType, data.field.targetField);

    if (
      definition &&
      definition.mustChooseOptions &&
      (data.field.allowedOptionIds || []).length === 0
    ) {
      issues.push(FormFieldIssue.NoAllowedOptions);
    }
  }

  if (
    data.field.source === FormFieldSource.Question &&
    data.field.type &&
    FORM_CHOICE_QUESTION_TYPES.includes(data.field.type)
  ) {
    const options: Array<string> = getQuestionOptions(data.field);

    if (
      options.length === 0 ||
      options.some((option: string): boolean => {
        return !option.trim();
      })
    ) {
      issues.push(FormFieldIssue.NoOptions);
    }
  }

  return issues;
};

export type FindCustomFieldDefinitionFunction = (
  customFields: Array<FormCustomFieldDefinition>,
  customFieldId: string | undefined,
) => FormCustomFieldDefinition | undefined;

export const findCustomFieldDefinition: FindCustomFieldDefinitionFunction = (
  customFields: Array<FormCustomFieldDefinition>,
  customFieldId: string | undefined,
): FormCustomFieldDefinition | undefined => {
  const id: string = (customFieldId || "").toLowerCase();

  return customFields.find(
    (definition: FormCustomFieldDefinition): boolean => {
      return definition.id.toLowerCase() === id;
    },
  );
};

export type GetFormFieldAnswerTypeFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}) => CustomFieldType | "Email";

/*
 * How a question is answered, for the input the builder draws on its card:
 * a question's own type, a target field's input, a custom field's type, and
 * the submitter's name (a short answer) or email.
 */
export const getFormFieldAnswerType: GetFormFieldAnswerTypeFunction = (data: {
  field: FormField;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
}): CustomFieldType | "Email" => {
  switch (data.field.source) {
    case FormFieldSource.TargetField:
      return (
        getFormTargetField(data.targetType, data.field.targetField)
          ?.inputType || CustomFieldType.Text
      );

    case FormFieldSource.TargetCustomField: {
      const type: unknown = findCustomFieldDefinition(
        data.customFields,
        data.field.customFieldId,
      )?.customFieldType;

      return typeof type === "string" &&
        (Object.values(CustomFieldType) as Array<string>).includes(type)
        ? (type as CustomFieldType)
        : CustomFieldType.Text;
    }

    case FormFieldSource.Submitter:
      return data.field.submitterField === FormSubmitterField.Email
        ? "Email"
        : CustomFieldType.Text;

    default:
      return data.field.type || CustomFieldType.Text;
  }
};
