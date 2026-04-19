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
    const trimmed: string = part.trim().replace(/^\(|\)$/g, "");

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
