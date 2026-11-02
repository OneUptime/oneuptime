import { OutputFormat } from "../Types/CLITypes";
import { formatOutput } from "../Core/OutputFormatter";
import { DescribedField, ResourceDescription } from "./ResourceFields";
import Table from "cli-table3";
import chalk from "chalk";

/*
 * How `oneuptime <resource> fields` prints: JSON as it is, for scripts and
 * agents; for people, a table of the fields a request reaches - the field,
 * the flag that sets it, its type, whether a create must give it, and what
 * it is for - after a line that says how to use them.
 */

const DESCRIPTION_WIDTH: number = 60;

function shorten(text: string, width: number): string {
  return text.length > width ? `${text.substring(0, width - 3)}...` : text;
}

// "create, update", "create", "update", or "read only".
export function describeWrites(field: DescribedField): string {
  if (field.create && field.update) {
    return "create, update";
  }

  if (field.create) {
    return "create";
  }

  if (field.update) {
    return "update";
  }

  return "read only";
}

// The flag a field is set with: its own, its address's, or --data.
export function describeFlag(field: DescribedField): string {
  if (field.flag && field.emailFlag) {
    return `${field.flag} or ${field.emailFlag}`;
  }

  if (field.flag) {
    return field.flag;
  }

  return field.create || field.update ? "in --data" : "";
}

function isColorDisabled(): boolean {
  return (
    process.env["NO_COLOR"] !== undefined || process.argv.includes("--no-color")
  );
}

export function formatResourceFieldsTable(
  description: ResourceDescription,
): string {
  const useColor: boolean = !isColorDisabled();
  const table: Table.Table = new Table({
    head: ["Field", "Flag", "Type", "Required", "Writes", "Description"].map(
      (head: string): string => {
        return useColor ? chalk.cyan(head) : head;
      },
    ),
    style: { head: [], border: [] },
    wordWrap: true,
  });

  for (const field of description.fields) {
    table.push([
      field.name,
      describeFlag(field),
      field.type,
      field.required ? "yes" : "",
      describeWrites(field),
      shorten(field.description, DESCRIPTION_WIDTH),
    ]);
  }

  const lines: Array<string> = [
    `${description.pluralName}: oneuptime ${description.resource} ${description.commands.join(", ")}`,
    "",
    table.toString(),
  ];

  if (
    description.fields.some((field: DescribedField): boolean => {
      return !field.flag && (field.create || field.update);
    })
  ) {
    lines.push(
      "",
      `A field without a flag is set in --data, such as --data '{"<field>": <value>}'.`,
    );
  }

  return lines.join("\n");
}

export function printResourceFields(
  description: ResourceDescription,
  format: OutputFormat,
): void {
  // eslint-disable-next-line no-console
  console.log(
    format === OutputFormat.JSON
      ? formatOutput(description as never, OutputFormat.JSON)
      : formatResourceFieldsTable(description),
  );
}
