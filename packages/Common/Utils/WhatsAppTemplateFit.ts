import {
  WhatsAppTemplateId,
  WhatsAppTemplateMessages,
} from "../Types/WhatsApp/WhatsAppTemplates";
import {
  fitTextsToBudget,
  MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
  TRUNCATED_NAME_NOTE,
} from "./MessageFit";

/*
 * A WHATSAPP TEMPLATE'S VARIABLES, HELD TO WHAT META TAKES.
 *
 * A WhatsApp notification is one of OneUptime's templates
 * (WhatsAppTemplateMessages) with its variables filled in, and Meta refuses
 * one whose text then comes to more than MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH
 * characters: the message is lost. A title can be 500 characters, and a
 * workflow can fill a variable with anything. So the longest values are
 * cut first - all to about the same length, each ending with "…" - until
 * the text fits; a link (where the message points) is never cut. Variables
 * that fit, or of a template this does not know, are returned as they are.
 *
 * Pure, with no Node or browser APIs.
 */

// A variable in a template's text: {{incident_title}}, {{1}}.
const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// A value that is where the message points: never cut.
const isLink: (value: string) => boolean = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

export const fitWhatsAppTemplateVariables: (
  templateKey: string,
  variables: Record<string, string> | undefined,
) => Record<string, string> | undefined = (
  templateKey: string,
  variables: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  const template: string | undefined =
    WhatsAppTemplateMessages[templateKey as WhatsAppTemplateId];

  if (!template || !variables) {
    return variables;
  }

  // How often each variable is in the text, and what the rest of it takes.
  const occurrences: Map<string, number> = new Map<string, number>();
  let fixedLength: number = template.length;

  const pattern: RegExp = new RegExp(PLACEHOLDER_PATTERN.source, "g");

  for (
    let match: RegExpExecArray | null = pattern.exec(template);
    match !== null;
    match = pattern.exec(template)
  ) {
    const name: string = match[1]!;

    fixedLength -= match[0].length;
    occurrences.set(name, (occurrences.get(name) || 0) + 1);
  }

  const cuttable: Array<string> = [];

  for (const [name, count] of occurrences) {
    const value: unknown = variables[name];

    if (typeof value !== "string") {
      continue;
    }

    if (isLink(value)) {
      fixedLength += value.length * count;
    } else {
      cuttable.push(name);
    }
  }

  const fitted: Array<string> = fitTextsToBudget(
    cuttable.map((name: string): string => {
      return variables[name]!;
    }),
    MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH - fixedLength,
    {
      measure: (text: string, index: number): number => {
        return text.length * (occurrences.get(cuttable[index]!) || 1);
      },
      getNote: (): string => {
        return TRUNCATED_NAME_NOTE;
      },
    },
  );

  if (
    fitted.every((value: string, index: number): boolean => {
      return value === variables[cuttable[index]!];
    })
  ) {
    return variables;
  }

  const result: Record<string, string> = { ...variables };

  cuttable.forEach((name: string, index: number): void => {
    result[name] = fitted[index]!;
  });

  return result;
};
