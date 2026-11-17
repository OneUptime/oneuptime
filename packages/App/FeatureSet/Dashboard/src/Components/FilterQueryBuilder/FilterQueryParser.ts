import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
  LogicalConnector,
} from "./Types";

export function parseFilterQuery(
  query: string,
  config: FilterBuilderConfig,
): {
  conditions: Array<FilterConditionData>;
  connector: LogicalConnector;
} {
  const defaultResult: {
    conditions: Array<FilterConditionData>;
    connector: LogicalConnector;
  } = {
    conditions: [{ ...config.defaultCondition }],
    connector: "AND",
  };

  if (!query || !query.trim()) {
    return defaultResult;
  }

  const connector: LogicalConnector = query.includes(" OR ") ? "OR" : "AND";
  const connectorRegex: RegExp = connector === "AND" ? / AND /i : / OR /i;
  const parts: Array<string> = query.split(connectorRegex);

  const conditions: Array<FilterConditionData> = [];

  for (const part of parts) {
    let trimmed: string = part.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    const likeMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(LIKE)\s+'([^']*)'$/i,
    );
    const inMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(IN)\s+\(([^)]*)\)$/i,
    );
    const eqQuotedMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s*(=|!=)\s*'([^']*)'$/,
    );
    const eqUnquotedMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s*(=|!=)\s*([^\s'"]+)$/,
    );

    if (likeMatch) {
      conditions.push({
        field: likeMatch[1]!,
        operator: "LIKE",
        value: likeMatch[3]!,
      });
    } else if (inMatch) {
      conditions.push({
        field: inMatch[1]!,
        operator: "IN",
        value: inMatch[3]!.replace(/'/g, "").trim(),
      });
    } else if (eqQuotedMatch) {
      conditions.push({
        field: eqQuotedMatch[1]!,
        operator: eqQuotedMatch[2]!,
        value: eqQuotedMatch[3]!,
      });
    } else if (eqUnquotedMatch) {
      conditions.push({
        field: eqUnquotedMatch[1]!,
        operator: eqUnquotedMatch[2]!,
        value: eqUnquotedMatch[3]!,
      });
    }
  }

  if (conditions.length === 0) {
    return defaultResult;
  }

  return { conditions, connector };
}

function formatValue(
  fieldKey: string,
  value: string,
  config: FilterBuilderConfig,
): string {
  if (fieldKey.startsWith("attributes.")) {
    return `'${value}'`;
  }
  const field: FilterFieldDefinition | undefined = config.fields.find(
    (f: FilterFieldDefinition) => {
      return f.key === fieldKey;
    },
  );
  if (field?.valueType === "number" || field?.valueType === "boolean") {
    return value;
  }
  return `'${value}'`;
}

export function buildFilterQuery(
  conditions: Array<FilterConditionData>,
  connector: LogicalConnector,
  config: FilterBuilderConfig,
): string {
  const parts: Array<string> = conditions
    .filter((c: FilterConditionData) => {
      return c.field && c.operator && c.value;
    })
    .map((c: FilterConditionData) => {
      if (c.operator === "LIKE") {
        return `${c.field} LIKE '${c.value}'`;
      }
      if (c.operator === "IN") {
        const values: string = c.value
          .split(",")
          .map((v: string) => {
            return `'${v.trim()}'`;
          })
          .join(", ");
        return `${c.field} IN (${values})`;
      }
      return `${c.field} ${c.operator} ${formatValue(c.field, c.value, config)}`;
    });

  return parts.join(` ${connector} `);
}

/*
 * AN "IS ONE OF" CONDITION'S VALUES (#9214).
 *
 * Its value is the list as one string, "0, 2", the way parseFilterQuery reads
 * it out of `statusCode IN ('0', '2')` and buildFilterQuery writes it back.
 * These turn it into the values themselves and back, so a field the builder
 * offers as a dropdown can offer "is one of" as a pick of the same labels
 * (Unset, Error) and still store the codes.
 */
export function splitListValue(value: string): Array<string> {
  const values: Array<string> = [];

  for (const part of (value || "").split(",")) {
    const trimmed: string = part.trim();

    if (trimmed && !values.includes(trimmed)) {
      values.push(trimmed);
    }
  }

  return values;
}

export function joinListValue(values: Array<string>): string {
  return splitListValue(values.join(",")).join(", ");
}

/*
 * The value a condition keeps when its operator changes. "Is one of" holds a
 * list, while "equals" and "does not equal" on a dropdown field pick one
 * value, so a list keeps only its first value there, rather than show an
 * empty dropdown over a value no option has.
 */
export function getValueForOperator(
  value: string,
  operator: string,
  field: FilterFieldDefinition | undefined,
): string {
  if (
    field?.valueType === "dropdown" &&
    (operator === "=" || operator === "!=")
  ) {
    return splitListValue(value)[0] || "";
  }

  return value;
}
