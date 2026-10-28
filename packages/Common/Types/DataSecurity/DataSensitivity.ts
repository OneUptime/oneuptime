/*
 * HOW SENSITIVE A PIECE OF DATA IS - AND SO A DATA STORE THAT HOLDS IT.
 *
 * Four levels, the ones classification policies have used for decades (and
 * that Microsoft Purview, Google Cloud's DLP and most data governance
 * programmes name the same way), each with one line a person can act on:
 *
 *  - Restricted: harm follows if it leaks - secrets, card numbers, health
 *    records, government IDs, the special categories of GDPR Article 9.
 *  - Confidential: personal data - who someone is and how to reach them -
 *    and documents marked confidential.
 *  - Internal: the business's own, not meant for outsiders.
 *  - Public: nothing sensitive was found.
 *
 * A store is as sensitive as the most sensitive data type found in it with
 * at least Medium confidence (DataSecurityRisk.ts).
 */
enum DataSensitivity {
  Restricted = "Restricted",
  Confidential = "Confidential",
  Internal = "Internal",
  Public = "Public",
}

export default DataSensitivity;

// Higher is more sensitive.
export const DATA_SENSITIVITY_RANK: Readonly<Record<DataSensitivity, number>> =
  {
    [DataSensitivity.Public]: 0,
    [DataSensitivity.Internal]: 1,
    [DataSensitivity.Confidential]: 2,
    [DataSensitivity.Restricted]: 3,
  };

// Most sensitive first: the order lists, filters and badges show them in.
export const ALL_DATA_SENSITIVITIES: ReadonlyArray<DataSensitivity> = [
  DataSensitivity.Restricted,
  DataSensitivity.Confidential,
  DataSensitivity.Internal,
  DataSensitivity.Public,
];

export const DATA_SENSITIVITY_DESCRIPTION: Readonly<
  Record<DataSensitivity, string>
> = {
  [DataSensitivity.Restricted]:
    "Harm follows if it leaks: secrets, card numbers, health records, government IDs.",
  [DataSensitivity.Confidential]:
    "Personal data, and documents marked confidential.",
  [DataSensitivity.Internal]: "The business's own data, not meant for outsiders.",
  [DataSensitivity.Public]: "Nothing sensitive was found.",
};

export function isDataSensitivity(value: unknown): value is DataSensitivity {
  return (
    typeof value === "string" &&
    (ALL_DATA_SENSITIVITIES as ReadonlyArray<string>).includes(value)
  );
}

// The more sensitive of two levels; an unknown level counts as Public.
export function moreSensitive(
  a: DataSensitivity | null | undefined,
  b: DataSensitivity | null | undefined,
): DataSensitivity {
  const left: DataSensitivity = a || DataSensitivity.Public;
  const right: DataSensitivity = b || DataSensitivity.Public;

  return DATA_SENSITIVITY_RANK[left] >= DATA_SENSITIVITY_RANK[right]
    ? left
    : right;
}

// Whether `level` is at least as sensitive as `atLeast`.
export function isAtLeastAsSensitive(
  level: DataSensitivity | null | undefined,
  atLeast: DataSensitivity,
): boolean {
  return (
    DATA_SENSITIVITY_RANK[level || DataSensitivity.Public] >=
    DATA_SENSITIVITY_RANK[atLeast]
  );
}
