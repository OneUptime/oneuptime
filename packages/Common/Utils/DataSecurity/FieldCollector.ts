/*
 * RECORDS, TURNED INTO FIELDS AND THEIR VALUES.
 *
 * Structured data - JSON documents, NDJSON lines, CSV rows, database rows,
 * log attributes - is classified field by field (FieldClassifier.ts), so the
 * records a scan reads are first gathered here: every leaf value under the
 * dotted path that leads to it, with array positions folded into "[]" so
 * the 500 items of `orders[]` are one field, not 500.
 *
 * Everything is bounded - fields, values per field, depth and value length -
 * because a record is whatever the store holds, and one document can be
 * deeper or wider than any scan should follow.
 */

export interface FieldCollectorLimits {
  maxFields: number;
  maxValuesPerField: number;
  maxDepth: number;
  maxValueLength: number;
}

export const DEFAULT_FIELD_COLLECTOR_LIMITS: FieldCollectorLimits = {
  maxFields: 500,
  maxValuesPerField: 200,
  maxDepth: 12,
  maxValueLength: 16_384,
};

export interface CollectedField {
  path: string;
  values: Array<unknown>;
}

export default class FieldCollector {
  private readonly limits: FieldCollectorLimits;
  private readonly fields: Map<string, Array<unknown>> = new Map();
  private recordCount: number = 0;

  public constructor(limits: Partial<FieldCollectorLimits> = {}) {
    this.limits = { ...DEFAULT_FIELD_COLLECTOR_LIMITS, ...limits };
  }

  public get records(): number {
    return this.recordCount;
  }

  public addRecord(record: unknown, prefix: string = ""): void {
    this.recordCount++;
    this.walk(record, prefix, 0);
  }

  // One value under one path, for a source that is already flat.
  public addValue(path: string, value: unknown): void {
    this.push(path, value);
  }

  public getFields(): Array<CollectedField> {
    return [...this.fields.entries()].map(
      ([path, values]: [string, Array<unknown>]) => {
        return { path, values };
      },
    );
  }

  private walk(value: unknown, path: string, depth: number): void {
    if (depth > this.limits.maxDepth) {
      return;
    }

    if (Array.isArray(value)) {
      const itemPath: string = path + "[]";

      for (const item of value.slice(0, this.limits.maxValuesPerField)) {
        this.walk(item, itemPath, depth + 1);
      }

      return;
    }

    if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [key, child] of Object.entries(value as object)) {
        this.walk(child, path ? path + "." + key : key, depth + 1);
      }

      return;
    }

    this.push(path || "value", value);
  }

  private push(path: string, value: unknown): void {
    let values: Array<unknown> | undefined = this.fields.get(path);

    if (!values) {
      if (this.fields.size >= this.limits.maxFields) {
        return;
      }

      values = [];
      this.fields.set(path, values);
    }

    if (values.length >= this.limits.maxValuesPerField) {
      return;
    }

    values.push(
      typeof value === "string" && value.length > this.limits.maxValueLength
        ? value.slice(0, this.limits.maxValueLength)
        : value,
    );
  }
}
