import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { getDataSecurityCheck } from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { isBuiltInDataType } from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import { DataStoreLocationKind } from "../../../DataSecurity/DataSecurityScanTypes";

/*
 * WHAT PEOPLE DECIDED ABOUT ONEUPTIME AI'S PROPOSALS, AS LABELS THE DATA
 * SECURITY EVAL CAN GROW FROM (#10365) - WITH NO INPUT THAT CAME FROM A
 * CUSTOMER.
 *
 * Every approval or dismissal of a proposal (#10364) is a verdict on what a
 * feature did with one input. The input was a customer's - a store's name,
 * its evidence, a field's name - and is never kept. What is kept is what
 * OneUptime's own catalogs name: the feature, the verdict, the check, the
 * built-in data types (a project's own type is "custom", never its id or
 * name), the kind of store and of location, and when. A maintainer reads
 * the labels - which kinds of proposals people dismiss most, for which
 * checks - and writes made-up cases of that shape into the corpus
 * (DataSecurityEvalCases), so the corpus grows from real verdicts without
 * a customer's word in it.
 *
 * A value that is not in a catalog is left out of the label, never kept as
 * given: a label can be stored and read anywhere.
 */

export enum DataSecurityEvalVerdict {
  Approved = "Approved",
  Dismissed = "Dismissed",
}

// What a project's own data type is called in a label.
export const CUSTOM_DATA_TYPE_LABEL: string = "custom";

// The most data types one label names.
const MAX_LABEL_DATA_TYPES: number = 10;

export interface DataSecurityEvalLabel {
  feature: DataSecurityAiFeature;
  verdict: DataSecurityEvalVerdict;
  // A catalog check's id, when the proposal was about one.
  checkId?: string | undefined;
  // Built-in data type ids, and "custom" for any of the project's own.
  dataTypes: Array<string>;
  storeKind?: DataStoreKind | undefined;
  locationKind?: DataStoreLocationKind | undefined;
  // When the verdict was given, as ISO 8601.
  at: string;
}

export interface DataSecurityEvalVerdictInput {
  feature: unknown;
  verdict: unknown;
  checkId?: unknown;
  dataTypeIds?: unknown;
  storeKind?: unknown;
  locationKind?: unknown;
  at: Date;
}

function oneOf<T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
): T | undefined {
  return typeof value === "string" &&
    (values as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined;
}

export default class DataSecurityEvalLabels {
  /*
   * The label of a verdict: only what OneUptime's catalogs name. Null when
   * the feature or the verdict is not one: there is nothing to label.
   */
  public static fromVerdict(
    input: DataSecurityEvalVerdictInput,
  ): DataSecurityEvalLabel | null {
    const feature: DataSecurityAiFeature | undefined = oneOf(
      input.feature,
      Object.values(DataSecurityAiFeature),
    );
    const verdict: DataSecurityEvalVerdict | undefined = oneOf(
      input.verdict,
      Object.values(DataSecurityEvalVerdict),
    );

    if (!feature || !verdict) {
      return null;
    }

    const checkId: string | undefined =
      typeof input.checkId === "string" && getDataSecurityCheck(input.checkId)
        ? input.checkId
        : undefined;
    const dataTypes: Array<string> = [];

    for (const id of Array.isArray(input.dataTypeIds)
      ? input.dataTypeIds
      : []) {
      const label: string | undefined =
        typeof id !== "string"
          ? undefined
          : isBuiltInDataType(id)
            ? id
            : CUSTOM_DATA_TYPE_LABEL;

      if (label && !dataTypes.includes(label)) {
        dataTypes.push(label);
      }

      if (dataTypes.length >= MAX_LABEL_DATA_TYPES) {
        break;
      }
    }

    return {
      feature,
      verdict,
      ...(checkId ? { checkId } : {}),
      dataTypes,
      ...(oneOf(input.storeKind, Object.values(DataStoreKind))
        ? {
            storeKind: oneOf(input.storeKind, Object.values(DataStoreKind)),
          }
        : {}),
      ...(oneOf(input.locationKind, Object.values(DataStoreLocationKind))
        ? {
            locationKind: oneOf(
              input.locationKind,
              Object.values(DataStoreLocationKind),
            ),
          }
        : {}),
      at: input.at.toISOString(),
    };
  }

  // A label as JSON, to keep beside the proposal it labels.
  public static toJSON(label: DataSecurityEvalLabel): JSONObject {
    return { ...label } as unknown as JSONObject;
  }

  /*
   * The labels counted the way a maintainer reads them: by feature, check
   * and verdict - "Explain, public-read: 12 approved, 3 dismissed".
   */
  public static tally(labels: ReadonlyArray<DataSecurityEvalLabel>): Array<{
    feature: DataSecurityAiFeature;
    checkId: string;
    approved: number;
    dismissed: number;
  }> {
    const counts: Map<
      string,
      {
        feature: DataSecurityAiFeature;
        checkId: string;
        approved: number;
        dismissed: number;
      }
    > = new Map();

    for (const label of labels) {
      const checkId: string = label.checkId || "";
      const key: string = `${label.feature}|${checkId}`;
      const count: {
        feature: DataSecurityAiFeature;
        checkId: string;
        approved: number;
        dismissed: number;
      } = counts.get(key) || {
        feature: label.feature,
        checkId,
        approved: 0,
        dismissed: 0,
      };

      if (label.verdict === DataSecurityEvalVerdict.Approved) {
        count.approved++;
      } else {
        count.dismissed++;
      }

      counts.set(key, count);
    }

    // The most dismissed first: what to write cases for first.
    return [...counts.values()].sort(
      (
        a: { dismissed: number; approved: number },
        b: { dismissed: number; approved: number },
      ): number => {
        return b.dismissed - a.dismissed || b.approved - a.approved;
      },
    );
  }
}
