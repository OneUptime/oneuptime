export interface CustomFieldDropdownOption {
  value: string;
  color?: string | undefined;
}

const HEX_COLOR_REGEX: RegExp = /^#[0-9a-f]{6}$/i;

export type NormalizeCustomFieldDropdownOptionColorFunction = (
  value: unknown,
) => string | undefined;

export const normalizeCustomFieldDropdownOptionColor: NormalizeCustomFieldDropdownOptionColorFunction =
  (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }

    const color: string = value.trim().toLowerCase();

    return HEX_COLOR_REGEX.test(color) ? color : undefined;
  };

const normalizeOption: (
  value: unknown,
) => CustomFieldDropdownOption | undefined = (
  value: unknown,
): CustomFieldDropdownOption | undefined => {
  if (typeof value === "string") {
    const optionValue: string = value.trim();

    return optionValue ? { value: optionValue } : undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const optionValue: unknown =
    (value as Record<string, unknown>)["value"] ??
    (value as Record<string, unknown>)["label"];

  if (typeof optionValue !== "string" || !optionValue.trim()) {
    return undefined;
  }

  const option: CustomFieldDropdownOption = {
    value: optionValue.trim(),
  };
  const color: string | undefined = normalizeCustomFieldDropdownOptionColor(
    (value as Record<string, unknown>)["color"],
  );

  if (color) {
    option.color = color;
  }

  return option;
};

const isStructuredOptions: (value: unknown) => value is Array<unknown> = (
  value: unknown,
): value is Array<unknown> => {
  return (
    Array.isArray(value) &&
    value.some((option: unknown) => {
      return Boolean(
        option &&
          typeof option === "object" &&
          !Array.isArray(option) &&
          Object.prototype.hasOwnProperty.call(option, "color"),
      );
    })
  );
};

export type ParseCustomFieldDropdownOptionsFunction = (
  value: unknown,
) => Array<CustomFieldDropdownOption>;

/*
 * Dropdown options used to be stored as one value per line. Colored options
 * use a compact JSON array, while this parser deliberately keeps accepting
 * the original newline format so existing custom fields need no migration.
 */
export const parseCustomFieldDropdownOptions: ParseCustomFieldDropdownOptionsFunction =
  (value: unknown): Array<CustomFieldDropdownOption> => {
    if (typeof value !== "string" || !value.trim()) {
      return [];
    }

    const serialized: string = value.trim();

    if (serialized.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(serialized);

        if (isStructuredOptions(parsed)) {
          return parsed
            .map((option: unknown) => {
              return normalizeOption(option);
            })
            .filter(
              (
                option: CustomFieldDropdownOption | undefined,
              ): option is CustomFieldDropdownOption => {
                return Boolean(option);
              },
            );
        }
      } catch {
        /*
         * Fall through to the legacy format. A value may legitimately start
         * with "[", and malformed data must remain editable instead of vanish.
         */
      }
    }

    return serialized
      .split("\n")
      .map((line: string) => {
        return normalizeOption(line);
      })
      .filter(
        (
          option: CustomFieldDropdownOption | undefined,
        ): option is CustomFieldDropdownOption => {
          return Boolean(option);
        },
      );
  };

export type SerializeCustomFieldDropdownOptionsFunction = (
  options: Array<CustomFieldDropdownOption>,
) => string;

export const serializeCustomFieldDropdownOptions: SerializeCustomFieldDropdownOptionsFunction =
  (options: Array<CustomFieldDropdownOption>): string => {
    const normalizedOptions: Array<CustomFieldDropdownOption> = (options || [])
      .map((option: CustomFieldDropdownOption) => {
        return normalizeOption(option);
      })
      .filter(
        (
          option: CustomFieldDropdownOption | undefined,
        ): option is CustomFieldDropdownOption => {
          return Boolean(option);
        },
      );

    if (normalizedOptions.length === 0) {
      return "";
    }

    if (
      normalizedOptions.every((option: CustomFieldDropdownOption) => {
        return !option.color;
      })
    ) {
      return normalizedOptions
        .map((option: CustomFieldDropdownOption) => {
          return option.value;
        })
        .join("\n");
    }

    return JSON.stringify(normalizedOptions);
  };

export type GetCustomFieldDropdownOptionFunction = (
  serializedOptions: unknown,
  value: unknown,
) => CustomFieldDropdownOption | undefined;

export const getCustomFieldDropdownOption: GetCustomFieldDropdownOptionFunction =
  (
    serializedOptions: unknown,
    value: unknown,
  ): CustomFieldDropdownOption | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }

    const optionValue: string = String(value);

    return parseCustomFieldDropdownOptions(serializedOptions).find(
      (option: CustomFieldDropdownOption) => {
        return option.value === optionValue;
      },
    );
  };
