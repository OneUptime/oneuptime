/*
 * CHOICES A CONNECTION'S FORM READS FROM THE PRODUCT ITSELF.
 *
 * Some settings are picked from what the credentials can read in the
 * product, not typed: a Cloudflare connection's account and zones are the
 * accounts and zones its API token can read. The catalog marks such a field
 * (ConnectorField.choicesFromProvider), the connector lists its choices with
 * the credentials on the form (SecurityEventConnector.listFieldChoices,
 * behind POST /security-event-connection/field-choices), and the form draws
 * a picker of them after the credentials, which read them.
 *
 * Shared by the server, which lists the choices, and the Dashboard, which
 * draws them: no server imports.
 */

/*
 * How a field's choices come from the product. A field that takes several
 * stores the values it was given joined by commas, and nothing picked keeps
 * it empty: what an empty field means (every zone) is the field's
 * description to say.
 */
export interface ConnectorFieldChoicesFromProvider {
  isMultiple: boolean;
  /*
   * Another field whose picked value narrows these choices: a zone belongs
   * to an account, so the zones offered are those of the account picked.
   */
  parentKey?: string | undefined;
}

export interface ConnectorFieldChoice {
  value: string;
  // How the choice is named in the picker: a zone's domain, an account's name.
  label: string;
  // A short fact drawn beside the label, as the product words it: a zone's plan.
  description?: string | undefined;
  // The parent field's value this choice belongs to (its account's ID).
  parentValue?: string | undefined;
}

// What POST /security-event-connection/field-choices answers: each field's choices, by its key.
export interface ConnectorFieldChoicesReport {
  provider: string;
  choices: Record<string, Array<ConnectorFieldChoice>>;
}

// The separator a multiple-choice field stores its values with.
export const CONNECTOR_FIELD_CHOICES_SEPARATOR: string = ",";

// The values a multiple-choice field holds, each once, in the order stored.
export function readConnectorFieldChoiceValues(
  value: string | undefined | null,
): Array<string> {
  const values: Array<string> = [];

  for (const part of (value || "").split(CONNECTOR_FIELD_CHOICES_SEPARATOR)) {
    const trimmed: string = part.trim();

    if (trimmed && !values.includes(trimmed)) {
      values.push(trimmed);
    }
  }

  return values;
}

// The text a multiple-choice field stores for these values.
export function writeConnectorFieldChoiceValues(
  values: ReadonlyArray<string>,
): string {
  return readConnectorFieldChoiceValues(
    values.join(CONNECTOR_FIELD_CHOICES_SEPARATOR),
  ).join(CONNECTOR_FIELD_CHOICES_SEPARATOR);
}
