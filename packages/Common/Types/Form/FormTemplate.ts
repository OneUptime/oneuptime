import ColumnLength from "../Database/ColumnLength";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";
import { FORM_FIELD_ID_PATTERN, FORM_MAX_FIELDS } from "./FormField";
import { FORM_DESCRIPTION_MAX_LENGTH } from "./FormTargetCatalog";

/*
 * A form's templates (Form.templates): named sets of answers a submission can
 * start from - "Application Outage", "Planned Maintenance", "Service
 * Restored" - so one form serves every common case of a team, instead of a
 * form (and a bookmark) per case.
 *
 * A template holds answers keyed by question id, in the shape a submission
 * sends them (FormPublic's validateFormSubmission takes them as they are):
 * text as text, a yes/no as a boolean, a choice as the option's value, a
 * multi-select as a list of values. Any question may be answered, none has
 * to be.
 *
 * On the public page the submitter picks a template above the questions (or
 * opens a link that names one, ?template=<id>), and the answers it holds for
 * the questions the page asks fill the form in; the submitter can change any
 * of them before sending. A hidden question (FormField.isHidden) is never on
 * the page: the server answers it from the template the submission started
 * from, so a template can set what the submitter does not see.
 *
 * The form opens with its default template, when it has one: a form whose
 * only template is its default is a pre-filled form.
 *
 * This module holds what a template is and the list operations the
 * dashboard's Templates page makes; how an answer is checked against its
 * question is FormPublic's (getFormTemplateAnswers,
 * validateFormTemplateAnswers), since that needs the questions as the public
 * page asks them. Read the stored value with readFormTemplates (it never
 * throws, and drops what it cannot use), and check a value before storing it
 * with validateFormTemplates, which the server runs on every write.
 *
 * Pure, with no database or React imports.
 */

export interface FormTemplate {
  // Never changes once the template exists: links name it.
  id: string;
  // What the public page's picker lists.
  name: string;
  // The form opens with this template. At most one template is.
  isDefault?: boolean | undefined;
  // Keyed by question id.
  answers: JSONObject;
}

// The most templates one form has.
export const FORM_MAX_TEMPLATES: number = 50;

export const FORM_TEMPLATE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

/*
 * The longest text a template may hold for one answer: the longest any
 * question takes (a description). Each question's own limit is checked
 * against the question itself (validateFormTemplateAnswers).
 */
export const FORM_TEMPLATE_ANSWER_MAX_LENGTH: number =
  FORM_DESCRIPTION_MAX_LENGTH;

// The most entries one multi-select answer of a template may list.
export const FORM_TEMPLATE_MAX_CHOICES: number = 100;

/*
 * The query parameter of a link that opens the form with one of its
 * templates: /accounts/form/<shareKey>?template=<templateId>.
 */
export const FORM_TEMPLATE_QUERY_PARAMETER: string = "template";

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export type IsFormTemplateIdFunction = (value: unknown) => value is string;

/*
 * A template's id has a question id's shape: it is put in a link's query
 * and read back from one, so nothing in it needs escaping.
 */
export const isFormTemplateId: IsFormTemplateIdFunction = (
  value: unknown,
): value is string => {
  return typeof value === "string" && FORM_FIELD_ID_PATTERN.test(value);
};

export type GenerateFormTemplateIdFunction = () => string;

export const generateFormTemplateId: GenerateFormTemplateIdFunction =
  (): string => {
    return ObjectID.generate().toString();
  };

type IsAnswerScalarFunction = (value: unknown) => boolean;

const isAnswerScalar: IsAnswerScalarFunction = (value: unknown): boolean => {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
};

type IsAnswerValueFunction = (value: unknown) => boolean;

/*
 * What one answer may be, whatever its question: text, a number, a yes/no,
 * or a list of those (a multi-select) - nothing nested, nothing longer than
 * any question takes. Whether it suits its question is FormPublic's to say.
 */
const isAnswerValue: IsAnswerValueFunction = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.length <= FORM_TEMPLATE_ANSWER_MAX_LENGTH;
  }

  if (Array.isArray(value)) {
    return (
      value.length <= FORM_TEMPLATE_MAX_CHOICES &&
      value.every((entry: unknown): boolean => {
        return (
          isAnswerScalar(entry) &&
          (typeof entry !== "string" ||
            entry.length <= FORM_TEMPLATE_ANSWER_MAX_LENGTH)
        );
      })
    );
  }

  return isAnswerScalar(value);
};

type DefineFunction = (
  target: JSONObject,
  key: string,
  value: JSONValue,
) => void;

/*
 * Defined, not assigned: a key such as "__proto__" would set the object's
 * prototype instead of storing the answer. (Question ids cannot be such a
 * key, but the value read here may come from anywhere.)
 */
const define: DefineFunction = (
  target: JSONObject,
  key: string,
  value: JSONValue,
): void => {
  Object.defineProperty(target, key, {
    value: value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

type ReadAnswersFunction = (value: unknown) => JSONObject;

// A template's answers, as read: entries that cannot be one are dropped.
const readAnswers: ReadAnswersFunction = (value: unknown): JSONObject => {
  const answers: JSONObject = {};

  if (!isPlainObject(value)) {
    return answers;
  }

  let count: number = 0;

  for (const key of Object.keys(value)) {
    if (count >= FORM_MAX_FIELDS) {
      break;
    }

    const answer: unknown = value[key];

    if (!FORM_FIELD_ID_PATTERN.test(key) || !isAnswerValue(answer)) {
      continue;
    }

    define(
      answers,
      key,
      Array.isArray(answer)
        ? (answer.slice() as JSONValue)
        : (answer as JSONValue),
    );
    count++;
  }

  return answers;
};

export type ReadFormTemplatesFunction = (value: unknown) => Array<FormTemplate>;

/**
 * A form's stored templates, in order, as the dashboard and the server read
 * them: an entry with no usable id or name is dropped, and so is a second
 * template with an id already listed; an answer that cannot be one is
 * dropped from its template; only the first default is a default. Never
 * throws.
 */
export const readFormTemplates: ReadFormTemplatesFunction = (
  value: unknown,
): Array<FormTemplate> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const templates: Array<FormTemplate> = [];
  const ids: Set<string> = new Set<string>();
  let hasDefault: boolean = false;

  for (const entry of value.slice(0, FORM_MAX_TEMPLATES)) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const id: unknown = entry["id"];
    const name: string =
      typeof entry["name"] === "string" ? entry["name"].trim() : "";

    if (!isFormTemplateId(id) || ids.has(id) || !name) {
      continue;
    }

    ids.add(id);

    const template: FormTemplate = {
      id: id,
      name: name.slice(0, FORM_TEMPLATE_NAME_MAX_LENGTH),
      answers: readAnswers(entry["answers"]),
    };

    if (entry["isDefault"] === true && !hasDefault) {
      template.isDefault = true;
      hasDefault = true;
    }

    templates.push(template);
  }

  return templates;
};

// The most problems one refusal lists.
const MAX_LISTED_PROBLEMS: number = 8;

export type DescribeFormTemplateFunction = (data: {
  index: number;
  name?: unknown;
}) => string;

/*
 * How a problem names the template it is about: its position, and its name
 * when it has one - 'Template 2 ("Network Outage")'.
 */
export const describeFormTemplate: DescribeFormTemplateFunction = (data: {
  index: number;
  name?: unknown;
}): string => {
  const name: string =
    typeof data.name === "string" ? data.name.trim().slice(0, 60) : "";

  return name
    ? `Template ${data.index + 1} ("${name}")`
    : `Template ${data.index + 1}`;
};

export type ValidateFormTemplatesFunction = (value: unknown) => string | null;

/**
 * Null when the value can be stored as a form's templates; otherwise one
 * message naming every problem (the first eight). Checked:
 *
 *   - a list of at most FORM_MAX_TEMPLATES templates, each an object;
 *   - each with an id of a question id's shape, used once, and a name of at
 *     most FORM_TEMPLATE_NAME_MAX_LENGTH characters that no other template
 *     of the form has (whatever the case);
 *   - Default true or false, and at most one default;
 *   - answers, when given, an object keyed by question ids, each answer
 *     text, a number, a yes/no or a list of those.
 *
 * Whether each answer suits its question - an option the question offers,
 * a number where a number is asked - needs the questions as the public page
 * asks them, so the server checks that too (validateFormTemplateAnswers).
 */
export const validateFormTemplates: ValidateFormTemplatesFunction = (
  value: unknown,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    return "Templates must be a list.";
  }

  if (value.length > FORM_MAX_TEMPLATES) {
    return `A form cannot have more than ${FORM_MAX_TEMPLATES} templates.`;
  }

  const problems: Array<string> = [];
  const ids: Set<string> = new Set<string>();
  const names: Set<string> = new Set<string>();
  let defaults: number = 0;

  value.forEach((entry: unknown, index: number): void => {
    if (!isPlainObject(entry)) {
      problems.push(`${describeFormTemplate({ index })} must be an object.`);
      return;
    }

    const label: string = describeFormTemplate({
      index,
      name: entry["name"],
    });
    const id: unknown = entry["id"];

    if (!isFormTemplateId(id)) {
      problems.push(
        `${label} needs an id of letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.`,
      );
    } else if (ids.has(id)) {
      problems.push(`${label} has the same id as another template.`);
    } else {
      ids.add(id);
    }

    const name: unknown = entry["name"];

    if (typeof name !== "string" || name.trim().length === 0) {
      problems.push(`${label} needs a name.`);
    } else if (name.trim().length > FORM_TEMPLATE_NAME_MAX_LENGTH) {
      problems.push(
        `${label}: the name cannot be more than ${FORM_TEMPLATE_NAME_MAX_LENGTH} characters.`,
      );
    } else {
      const key: string = name.trim().toLowerCase();

      if (names.has(key)) {
        problems.push(`${label} has the same name as another template.`);
      }

      names.add(key);
    }

    const isDefault: unknown = entry["isDefault"];

    if (
      isDefault !== undefined &&
      isDefault !== null &&
      typeof isDefault !== "boolean"
    ) {
      problems.push(`${label}: Default must be true or false.`);
    } else if (isDefault === true) {
      defaults++;
    }

    const answers: unknown = entry["answers"];

    if (answers === undefined || answers === null) {
      return;
    }

    if (!isPlainObject(answers)) {
      problems.push(
        `${label}: its answers must be an object keyed by question.`,
      );
      return;
    }

    const keys: Array<string> = Object.keys(answers);

    if (keys.length > FORM_MAX_FIELDS) {
      problems.push(
        `${label} cannot answer more than ${FORM_MAX_FIELDS} questions.`,
      );
      return;
    }

    if (
      keys.some((key: string): boolean => {
        return !FORM_FIELD_ID_PATTERN.test(key);
      })
    ) {
      problems.push(`${label}: its answers must be keyed by question id.`);
      return;
    }

    if (
      keys.some((key: string): boolean => {
        return !isAnswerValue(answers[key]);
      })
    ) {
      problems.push(
        `${label}: each answer must be text of at most ${FORM_TEMPLATE_ANSWER_MAX_LENGTH} characters, a number, true or false, or a list of at most ${FORM_TEMPLATE_MAX_CHOICES} of those.`,
      );
    }
  });

  if (defaults > 1) {
    problems.push("Only one template can be the default.");
  }

  if (problems.length === 0) {
    return null;
  }

  const more: number = problems.length - MAX_LISTED_PROBLEMS;

  return `${problems.slice(0, MAX_LISTED_PROBLEMS).join(" ")}${
    more > 0 ? ` And ${more} more ${more === 1 ? "problem" : "problems"}.` : ""
  }`;
};

export type FindFormTemplateFunction = (
  templates: Array<FormTemplate>,
  id: unknown,
) => FormTemplate | undefined;

// The template with this id, if the form has one.
export const findFormTemplate: FindFormTemplateFunction = (
  templates: Array<FormTemplate>,
  id: unknown,
): FormTemplate | undefined => {
  if (!isFormTemplateId(id)) {
    return undefined;
  }

  return templates.find((template: FormTemplate): boolean => {
    return template.id === id;
  });
};

export type GetDefaultFormTemplateFunction = (
  templates: Array<FormTemplate>,
) => FormTemplate | undefined;

// The template the form opens with, if it has one.
export const getDefaultFormTemplate: GetDefaultFormTemplateFunction = (
  templates: Array<FormTemplate>,
): FormTemplate | undefined => {
  return templates.find((template: FormTemplate): boolean => {
    return template.isDefault === true;
  });
};

// A name that ends in a number, as "<base> <number>" ("Outage 2").
const NAME_ENDING_IN_A_NUMBER: RegExp = /^(.*\S)\s+(\d+)$/;

export type GetFormTemplateCopyNameFunction = (data: {
  name: string;
  // The names the form's templates have.
  existingNames: Array<string>;
}) => string;

/**
 * The name a copy of a template starts with, as Duplicate names a copy
 * anywhere in the dashboard: "Outage" becomes "Outage 2", and a copy of
 * "Outage 2" goes on with the series ("Outage 3") while "Outage" is still
 * one of the form's templates - whichever number no template has, compared
 * without case. Shortened from the end of its base, never its number, to
 * fit FORM_TEMPLATE_NAME_MAX_LENGTH.
 */
export const getFormTemplateCopyName: GetFormTemplateCopyNameFunction = (data: {
  name: string;
  existingNames: Array<string>;
}): string => {
  const taken: Set<string> = new Set<string>(
    data.existingNames.map((name: string): string => {
      return name.trim().toLowerCase();
    }),
  );

  let base: string = data.name.trim();
  let start: number = 2;

  const match: RegExpExecArray | null = NAME_ENDING_IN_A_NUMBER.exec(base);

  if (
    match &&
    taken.has((match[1] as string).toLowerCase()) &&
    Number.isSafeInteger(Number(match[2]) + 1)
  ) {
    base = match[1] as string;
    start = Number(match[2]) + 1;
  }

  const nameWith: (number: number) => string = (number: number): string => {
    const suffix: string = ` ${number}`;

    return `${base.slice(0, FORM_TEMPLATE_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
  };

  /*
   * One more number than there are names is always enough: at most every
   * name takes one of them.
   */
  for (let attempt: number = 0; attempt <= taken.size; attempt++) {
    const candidate: string = nameWith(start + attempt);

    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Unreachable (see the loop bound); kept so the function always returns.
  return nameWith(start + taken.size + 1);
};

export interface FormTemplatesChange {
  templates: Array<FormTemplate>;
  // The template the change is about, when there is one.
  templateId: string | null;
}

export type SaveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  template: FormTemplate;
}) => FormTemplatesChange;

/**
 * Adds a template at the end, or - when one with its id is listed - puts it
 * in that one's place. A template saved as the default takes the default
 * from any other. A form that already has FORM_MAX_TEMPLATES templates gets
 * no new one.
 */
export const saveFormTemplate: SaveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  template: FormTemplate;
}): FormTemplatesChange => {
  const saved: FormTemplate = { ...data.template };

  if (saved.isDefault !== true) {
    delete saved.isDefault;
  }

  const exists: boolean = data.templates.some(
    (template: FormTemplate): boolean => {
      return template.id === saved.id;
    },
  );

  if (!exists && data.templates.length >= FORM_MAX_TEMPLATES) {
    return { templates: [...data.templates], templateId: null };
  }

  const others: Array<FormTemplate> = data.templates.map(
    (template: FormTemplate): FormTemplate => {
      if (template.id === saved.id) {
        return saved;
      }

      if (saved.isDefault && template.isDefault) {
        const copy: FormTemplate = { ...template };
        delete copy.isDefault;
        return copy;
      }

      return template;
    },
  );

  return {
    templates: exists ? others : [...others, saved],
    templateId: saved.id,
  };
};

export type DuplicateFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
}) => FormTemplatesChange;

/**
 * Copies a template right after it, with a new id and the next name of its
 * series ("Outage 2"), and never as the default: a form has one. A form
 * that is full, or a template that is not listed, is returned as it was.
 */
export const duplicateFormTemplate: DuplicateFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
}): FormTemplatesChange => {
  const index: number = data.templates.findIndex(
    (template: FormTemplate): boolean => {
      return template.id === data.id;
    },
  );

  if (index === -1 || data.templates.length >= FORM_MAX_TEMPLATES) {
    return { templates: [...data.templates], templateId: null };
  }

  const original: FormTemplate = data.templates[index]!;

  const copy: FormTemplate = {
    id: generateFormTemplateId(),
    name: getFormTemplateCopyName({
      name: original.name,
      existingNames: data.templates.map((template: FormTemplate): string => {
        return template.name;
      }),
    }),
    answers: JSON.parse(JSON.stringify(original.answers)) as JSONObject,
  };

  const templates: Array<FormTemplate> = [...data.templates];
  templates.splice(index + 1, 0, copy);

  return { templates, templateId: copy.id };
};

export type RemoveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
}) => Array<FormTemplate>;

// The templates without this one.
export const removeFormTemplate: RemoveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
}): Array<FormTemplate> => {
  return data.templates.filter((template: FormTemplate): boolean => {
    return template.id !== data.id;
  });
};

export type MoveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
  // -1 moves it up one place, 1 down one place.
  offset: number;
}) => Array<FormTemplate>;

/*
 * Moves a template up or down the list - the order the public page's picker
 * lists them in. A move past either end leaves the list as it was.
 */
export const moveFormTemplate: MoveFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string;
  offset: number;
}): Array<FormTemplate> => {
  const templates: Array<FormTemplate> = [...data.templates];
  const from: number = templates.findIndex(
    (template: FormTemplate): boolean => {
      return template.id === data.id;
    },
  );
  const to: number = from + data.offset;

  if (from === -1 || to < 0 || to >= templates.length || from === to) {
    return templates;
  }

  const [moved] = templates.splice(from, 1);
  templates.splice(to, 0, moved!);

  return templates;
};

export type SetDefaultFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  // The template to make the default; null for none.
  id: string | null;
}) => Array<FormTemplate>;

// Makes one template the default - the form opens with it - or none.
export const setDefaultFormTemplate: SetDefaultFormTemplateFunction = (data: {
  templates: Array<FormTemplate>;
  id: string | null;
}): Array<FormTemplate> => {
  return data.templates.map((template: FormTemplate): FormTemplate => {
    const copy: FormTemplate = { ...template };

    if (data.id !== null && template.id === data.id) {
      copy.isDefault = true;
    } else {
      delete copy.isDefault;
    }

    return copy;
  });
};

export type ReadFormTemplateIdFromSearchFunction = (
  search: string | null | undefined,
) => string | null;

/**
 * The template a form link names (?template=<id>), or null when it names
 * none or something that cannot be a template's id. Whether the form has
 * that template is the page's to find out.
 */
export const readFormTemplateIdFromSearch: ReadFormTemplateIdFromSearchFunction =
  (search: string | null | undefined): string | null => {
    if (typeof search !== "string" || !search) {
      return null;
    }

    let id: string | null = null;

    try {
      id = new URLSearchParams(search).get(FORM_TEMPLATE_QUERY_PARAMETER);
    } catch {
      return null;
    }

    const trimmed: string = (id || "").trim();

    return isFormTemplateId(trimmed) ? trimmed : null;
  };

export type GetFormTemplateLinkFunction = (data: {
  // The form's public link: /accounts/form/<shareKey>, absolute or not.
  formLink: string;
  templateId: string;
}) => string;

// The link that opens the form with one of its templates.
export const getFormTemplateLink: GetFormTemplateLinkFunction = (data: {
  formLink: string;
  templateId: string;
}): string => {
  const separator: string = data.formLink.includes("?") ? "&" : "?";

  return `${data.formLink}${separator}${FORM_TEMPLATE_QUERY_PARAMETER}=${encodeURIComponent(
    data.templateId,
  )}`;
};
