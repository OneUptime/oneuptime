/*
 * The {{variables}} a template can use, as the forms that edit a template
 * offer them: a note template, an SLA reminder, a burn rate rule's alert,
 * a monitor's incident description, a subscriber notification. Whatever
 * fills the template in owns the list; this is only how a list is described
 * and searched, and how one is put into the text being written.
 *
 * The editors show the list three ways, all from the same groups:
 *
 *   - a collapsed "Template variables" list under the field, each variable a
 *     button that adds it where the cursor is (TemplateVariablesList);
 *   - an "Insert variable" button in the editor's toolbar, which opens the
 *     list with a search box (InsertTemplateVariableButton);
 *   - typing "{{" in the field, which opens the list under the cursor,
 *     filtered by what is typed after the braces (findTemplateVariableTrigger).
 *
 * Nobody has to know the syntax, or copy a name out of a table, to use one.
 *
 * Pure: no DOM and no React, so the logic is tested directly.
 */

export interface TemplateVariable {
  /** As written between the braces: "incident.title". */
  name: string;
  /**
   * What it is filled with, in a few words: "Title", "Declared At". Looked up
   * in the page's language like any other label, unless it is something a
   * person typed (see isDescriptionVerbatim).
   */
  description: string;
  /** What it might be filled with: "Checkout availability". */
  example?: string | undefined;
  /**
   * The description is shown exactly as written - the name a project member
   * gave a custom field - rather than looked up in the page's language.
   */
  isDescriptionVerbatim?: boolean | undefined;
}

export interface TemplateVariableGroup {
  /** Shown above the group's variables: "Incident", "Custom Fields". */
  title?: string | undefined;
  /** A line under the title, shown in the list under the field. */
  description?: string | undefined;
  variables: ReadonlyArray<TemplateVariable>;
}

export type TemplateVariableGroups = ReadonlyArray<TemplateVariableGroup>;

export type FormatTemplateVariableFunction = (name: string) => string;

/** The variable as it is written into a template: "{{incident.title}}". */
export const formatTemplateVariable: FormatTemplateVariableFunction = (
  name: string,
): string => {
  return `{{${name}}}`;
};

export type CountTemplateVariablesFunction = (
  groups: TemplateVariableGroups | null | undefined,
) => number;

/** How many variables there are to pick from, across the groups. */
export const countTemplateVariables: CountTemplateVariablesFunction = (
  groups: TemplateVariableGroups | null | undefined,
): number => {
  if (!groups) {
    return 0;
  }

  return groups.reduce((count: number, group: TemplateVariableGroup) => {
    return count + group.variables.length;
  }, 0);
};

export type HasTemplateVariablesFunction = (
  groups: TemplateVariableGroups | null | undefined,
) => boolean;

/**
 * Whether a field has anything to show: a variable to pick, or a group that
 * says why it has none yet (a project with no custom fields).
 */
export const hasTemplateVariables: HasTemplateVariablesFunction = (
  groups: TemplateVariableGroups | null | undefined,
): boolean => {
  if (!groups) {
    return false;
  }

  return groups.some((group: TemplateVariableGroup): boolean => {
    return group.variables.length > 0 || Boolean(group.description);
  });
};

type NormalizeQueryFunction = (query: string | null | undefined) => string;

/*
 * What is searched for. Braces typed into the search box ("{{incident") are
 * not part of any name or description, so they are dropped.
 */
const normalizeQuery: NormalizeQueryFunction = (
  query: string | null | undefined,
): string => {
  return (query || "").replace(/[{}]/g, " ").trim().toLowerCase();
};

export type TemplateVariableMatchesFunction = (
  variable: TemplateVariable,
  query: string | null | undefined,
  describe?: ((variable: TemplateVariable) => string) | undefined,
) => boolean;

/**
 * Whether a variable is one of what was searched for: every word typed is in
 * its name, its description or its example, in any case. "declared" finds
 * {{incident.startedAt}} by its description, "startedat" by its name.
 * `describe` gives the description as it is shown (translated).
 */
export const templateVariableMatches: TemplateVariableMatchesFunction = (
  variable: TemplateVariable,
  query: string | null | undefined,
  describe?: ((variable: TemplateVariable) => string) | undefined,
): boolean => {
  const terms: Array<string> = normalizeQuery(query)
    .split(/\s+/)
    .filter((term: string): boolean => {
      return term.length > 0;
    });

  if (terms.length === 0) {
    return true;
  }

  const shownDescription: string = describe
    ? describe(variable)
    : variable.description;

  const haystack: string = [
    variable.name,
    variable.description,
    shownDescription,
    variable.example || "",
  ]
    .join("\n")
    .toLowerCase();

  return terms.every((term: string): boolean => {
    return haystack.includes(term);
  });
};

export type FilterTemplateVariableGroupsFunction = (
  groups: TemplateVariableGroups,
  query: string | null | undefined,
  describe?: ((variable: TemplateVariable) => string) | undefined,
) => Array<TemplateVariableGroup>;

/**
 * The groups with only the variables that match, in their own order; a group
 * left with none is dropped. With nothing searched for, every group that has
 * a variable to pick.
 */
export const filterTemplateVariableGroups: FilterTemplateVariableGroupsFunction =
  (
    groups: TemplateVariableGroups,
    query: string | null | undefined,
    describe?: ((variable: TemplateVariable) => string) | undefined,
  ): Array<TemplateVariableGroup> => {
    const filtered: Array<TemplateVariableGroup> = [];

    for (const group of groups) {
      const variables: Array<TemplateVariable> = group.variables.filter(
        (variable: TemplateVariable): boolean => {
          return templateVariableMatches(variable, query, describe);
        },
      );

      if (variables.length > 0) {
        filtered.push({ ...group, variables: variables });
      }
    }

    return filtered;
  };

export interface TemplateVariableTrigger {
  /** Where the "{{" starts. */
  start: number;
  /**
   * Where what is replaced ends: the caret, or past the rest of a variable
   * that is already there - the "}}" an editor closed the braces with, or
   * "ident.title}}" when the caret is inside "{{inc|ident.title}}" - so a
   * pick never leaves a stray half behind.
   */
  end: number;
  /** What has been typed after the braces: "inc", "declared". */
  query: string;
}

// What may follow "{{" while a variable is still being typed.
const TRIGGER_QUERY_PATTERN: RegExp = /^[A-Za-z0-9_.\- ]*$/;

// The rest of a variable after the caret, through its closing braces.
const REST_OF_VARIABLE_PATTERN: RegExp = /^[A-Za-z0-9_.-]*\}\}/;

export const MAX_TEMPLATE_VARIABLE_QUERY_LENGTH: number = 60;

export type FindTemplateVariableTriggerFunction = (
  text: string,
  caret: number,
) => TemplateVariableTrigger | null;

/**
 * The variable being typed at the caret: in "Severity: {{sev" with the caret
 * at the end, a trigger with the query "sev". None once the braces are
 * closed, across a line, for a Handlebars tag ("{{#each", "{{> Footer"), for
 * triple braces, or past a few words.
 */
export const findTemplateVariableTrigger: FindTemplateVariableTriggerFunction =
  (text: string, caret: number): TemplateVariableTrigger | null => {
    if (
      typeof text !== "string" ||
      !Number.isInteger(caret) ||
      caret < 2 ||
      caret > text.length
    ) {
      return null;
    }

    const before: string = text.slice(0, caret);
    const start: number = before.lastIndexOf("{{");

    if (start === -1) {
      return null;
    }

    // "{{{" is Handlebars' unescaped value, not a variable being typed.
    if (start > 0 && text.charAt(start - 1) === "{") {
      return null;
    }

    const query: string = before.slice(start + 2);

    if (
      query.length > MAX_TEMPLATE_VARIABLE_QUERY_LENGTH ||
      query.startsWith(" ") ||
      query.includes("  ") ||
      !TRIGGER_QUERY_PATTERN.test(query)
    ) {
      return null;
    }

    const rest: RegExpMatchArray | null = text
      .slice(caret)
      .match(REST_OF_VARIABLE_PATTERN);

    return {
      start: start,
      end: caret + (rest ? rest[0].length : 0),
      query: query,
    };
  };

export interface TemplateVariableTextEdit {
  text: string;
  /** Where the caret goes: just after the variable. */
  caret: number;
}

export type InsertTemplateVariableFunction = (data: {
  text: string;
  start: number;
  end: number;
  name: string;
}) => TemplateVariableTextEdit;

/**
 * The text with {{name}} in place of start..end - the selection, or a
 * trigger's braces and query - and where the caret goes after it.
 */
export const insertTemplateVariable: InsertTemplateVariableFunction = (data: {
  text: string;
  start: number;
  end: number;
  name: string;
}): TemplateVariableTextEdit => {
  const text: string = typeof data.text === "string" ? data.text : "";
  const from: number = Math.max(0, Math.min(data.start, data.end, text.length));
  const to: number = Math.min(text.length, Math.max(data.start, data.end, 0));
  const variable: string = formatTemplateVariable(data.name);

  return {
    text: text.slice(0, from) + variable + text.slice(to),
    caret: from + variable.length,
  };
};
