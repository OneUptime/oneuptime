import Label from "../../Models/DatabaseModels/Label";
import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * Labels and custom fields as metric attributes
 * ---------------------------------------------------------------------------
 *
 * Incident / alert / monitor metrics carry a fixed set of dimensions (severity,
 * owners, monitor names). Everything a project uses to describe *its own*
 * taxonomy — labels and custom fields — lived only in Postgres, so a dashboard
 * could not answer "MTTR for the payments product" without leaving the metric
 * store. These helpers turn both into ClickHouse metric attributes so they are
 * groupable and filterable like any other dimension.
 *
 * Labels are a flat list of names, and projects already encode structure in
 * that name. Two shapes are supported:
 *
 *   "product"    -> oneuptime.label.product = "true"   (the label is present)
 *   "product:X"  -> oneuptime.label.product = "X"      (the label carries a value)
 *
 * Custom fields already are key/value, so they map straight across:
 *
 *   { "Team": "Payments" } -> oneuptime.customField.team = "Payments"
 *
 * Three properties are load-bearing:
 *
 *  1. VALUES ARE ALWAYS STRINGS. The ClickHouse column is Map(String, String);
 *     numbers, booleans and multi-select arrays are stringified here rather
 *     than at each call site, so every writer records the same shape.
 *
 *  2. THE SAME RESOURCE ALWAYS PRODUCES THE SAME ATTRIBUTES. Incident and alert
 *     metrics are *mutable* metrics — a refresh replaces the previous point for
 *     the same identity. If attribute order or collision handling varied
 *     between refreshes the series would churn, so merged values are sorted and
 *     collisions resolve deterministically.
 *
 *  3. A KEY THAT CANNOT BE FORMED IS DROPPED, NEVER GUESSED. A label named
 *     ":::" or a custom field named " " yields no attribute at all instead of
 *     an empty-keyed one, which ClickHouse would happily store and no filter
 *     could ever select.
 */

/** Namespace for attributes derived from a resource's labels. */
export const LabelMetricAttributeNamespace: string = "oneuptime.label";

/** Namespace for attributes derived from a resource's custom fields. */
export const CustomFieldMetricAttributeNamespace: string =
  "oneuptime.customField";

/**
 * Value recorded for a label that carries no `key:value` payload. The label's
 * presence is itself the fact worth charting, so it records as a string
 * "true" — Map(String, String) has no boolean.
 */
export const LabelPresentAttributeValue: string = "true";

/** One label name, split into the attribute key and its optional value. */
export interface ParsedLabelName {
  /** Normalized key segment, e.g. `product`. Never empty. */
  key: string;
  /** Text after the first `:`, or null for a bare label. Never empty. */
  value: string | null;
}

export default class MetricResourceAttributeUtil {
  /*
   * Long text custom fields would otherwise put a whole paragraph in a metric
   * attribute, which bloats every row of the series. Attributes are dimensions,
   * not payloads, so values are cut at a length that still distinguishes them.
   */
  private static readonly MAX_ATTRIBUTE_VALUE_LENGTH: number = 512;

  /*
   * Guard for pathological nesting inside a custom field's jsonb value. Real
   * values are scalars or a one-level array (multi-select); anything deeper is
   * stringified rather than walked forever.
   */
  private static readonly MAX_VALUE_DEPTH: number = 2;

  /**
   * Normalize free text (a label key, a custom field name) into one attribute
   * key segment: lowercased, with whitespace and ASCII punctuation collapsed to
   * `_`. Non-ASCII letters survive, so "Produção" stays "produção" instead of
   * degrading to "produ_o" and colliding with unrelated names.
   *
   * Returns null when nothing usable is left.
   */
  public static getAttributeKeySegment(
    name: string | undefined | null,
  ): string | null {
    if (typeof name !== "string") {
      return null;
    }

    /*
     * Everything in the ASCII range that is not a letter or a digit — control
     * characters, space, punctuation, symbols. Ranges rather than \p{...} so
     * the regex is valid at this project's es2017 target.
     *
     * no-control-regex is disabled deliberately: a control character inside a
     * user-typed name is exactly what has to be stripped before the text can
     * become a ClickHouse map key.
     */
    const segment: string = name
      .trim()
      .toLowerCase()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007F]+/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "");

    if (segment.length === 0) {
      return null;
    }

    return segment;
  }

  /**
   * Split one label name into its attribute key and value. Only the FIRST `:`
   * separates the two, so "env:us-east:1a" reads as env = "us-east:1a" rather
   * than silently losing the tail.
   */
  public static parseLabelName(
    labelName: string | undefined | null,
  ): ParsedLabelName | null {
    if (typeof labelName !== "string") {
      return null;
    }

    const trimmedName: string = labelName.trim();

    if (trimmedName.length === 0) {
      return null;
    }

    const separatorIndex: number = trimmedName.indexOf(":");

    const rawKey: string =
      separatorIndex === -1
        ? trimmedName
        : trimmedName.substring(0, separatorIndex);

    const rawValue: string =
      separatorIndex === -1
        ? ""
        : trimmedName.substring(separatorIndex + 1).trim();

    const key: string | null = this.getAttributeKeySegment(rawKey);

    if (!key) {
      return null;
    }

    return {
      key: key,
      // "product:" is a bare label with a stray separator, not an empty value.
      value: rawValue.length > 0 ? this.truncate(rawValue) : null,
    };
  }

  /**
   * Build `oneuptime.label.*` attributes from a resource's labels.
   *
   * Several labels can normalize onto one key ("product:web" and
   * "Product: api"). Their values merge into a sorted, comma-separated list so
   * the result does not depend on the order the database returned the rows in.
   * An explicit value always beats the bare presence marker: "product" plus
   * "product:web" records "web", not "true, web".
   */
  public static getLabelAttributes(
    labels: Array<Label> | undefined | null,
  ): JSONObject {
    const attributes: JSONObject = {};

    if (!labels || !Array.isArray(labels)) {
      return attributes;
    }

    /*
     * key -> the explicit values seen for it. A key present with an empty
     * list was only ever seen bare, and records the presence marker.
     */
    const collected: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const label of labels) {
      const parsed: ParsedLabelName | null = this.parseLabelName(label?.name);

      if (!parsed) {
        continue;
      }

      let values: Array<string> | undefined = collected.get(parsed.key);

      if (!values) {
        values = [];
        collected.set(parsed.key, values);
      }

      if (parsed.value !== null && !values.includes(parsed.value)) {
        values.push(parsed.value);
      }
    }

    // Sorted so the emitted object's key order is stable too, not just its content.
    for (const key of Array.from(collected.keys()).sort()) {
      const values: Array<string> = collected.get(key) || [];

      attributes[`${LabelMetricAttributeNamespace}.${key}`] =
        values.length > 0
          ? this.truncate(values.slice().sort().join(", "))
          : LabelPresentAttributeValue;
    }

    return attributes;
  }

  /**
   * Build `oneuptime.customField.*` attributes from a resource's `customFields`
   * jsonb column, which stores a flat object keyed by each custom field
   * definition's name.
   *
   * Two definitions whose names normalize onto the same key ("Team Name" and
   * "team-name") are an accident, not a taxonomy, so they do not merge: the
   * first by sorted field name wins, which keeps the result stable across
   * refreshes instead of depending on object key order.
   */
  public static getCustomFieldAttributes(
    customFields: JSONObject | undefined | null,
  ): JSONObject {
    const attributes: JSONObject = {};

    if (
      !customFields ||
      typeof customFields !== "object" ||
      Array.isArray(customFields)
    ) {
      return attributes;
    }

    for (const fieldName of Object.keys(customFields).sort()) {
      const key: string | null = this.getAttributeKeySegment(fieldName);

      if (!key) {
        continue;
      }

      const attributeKey: string = `${CustomFieldMetricAttributeNamespace}.${key}`;

      if (attributes[attributeKey] !== undefined) {
        continue;
      }

      const value: string | null = this.toAttributeValue(
        customFields[fieldName] as JSONValue,
        0,
      );

      if (value === null) {
        continue;
      }

      attributes[attributeKey] = value;
    }

    return attributes;
  }

  /**
   * Every label and custom field attribute for one resource. Callers merge this
   * into their metric's attributes; the two namespaces cannot collide with the
   * existing dimension names, which are unprefixed camelCase.
   */
  public static getResourceAttributes(data: {
    labels?: Array<Label> | undefined | null;
    customFields?: JSONObject | undefined | null;
  }): JSONObject {
    return {
      ...this.getLabelAttributes(data.labels),
      ...this.getCustomFieldAttributes(data.customFields),
    };
  }

  /**
   * Merge resource attributes into an existing attribute set. Resource
   * attributes win on conflict, so a user-supplied attribute (custom monitor
   * metrics let callers pass their own) cannot shadow the namespace.
   */
  public static mergeResourceAttributes(
    attributes: JSONObject,
    resourceAttributes: JSONObject,
  ): JSONObject {
    return { ...attributes, ...resourceAttributes };
  }

  /*
   * One custom field value as attribute text. Returns null for anything that
   * carries no information — absent, empty, or non-finite — so the caller drops
   * the attribute instead of recording "undefined".
   */
  private static toAttributeValue(
    value: JSONValue | undefined,
    depth: number,
  ): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      const trimmedValue: string = value.trim();
      return trimmedValue.length > 0 ? this.truncate(trimmedValue) : null;
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "number") {
      // NaN / Infinity would record as text no chart could use.
      return isFinite(value) ? String(value) : null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      // Multi-select dropdowns: keep the order the user chose.
      if (depth >= this.MAX_VALUE_DEPTH) {
        return this.stringifyValue(value);
      }

      const parts: Array<string> = [];

      for (const element of value) {
        const part: string | null = this.toAttributeValue(
          element as JSONValue,
          depth + 1,
        );

        if (part !== null) {
          parts.push(part);
        }
      }

      return parts.length > 0 ? this.truncate(parts.join(", ")) : null;
    }

    if (typeof value === "object") {
      return this.stringifyValue(value);
    }

    return null;
  }

  private static stringifyValue(value: unknown): string | null {
    try {
      const serialized: string | undefined = JSON.stringify(value);

      if (!serialized || serialized === "{}" || serialized === "[]") {
        return null;
      }

      return this.truncate(serialized);
    } catch {
      // Circular structures cannot become an attribute; drop rather than throw.
      return null;
    }
  }

  private static truncate(value: string): string {
    return value.length > this.MAX_ATTRIBUTE_VALUE_LENGTH
      ? value.substring(0, this.MAX_ATTRIBUTE_VALUE_LENGTH)
      : value;
  }
}
