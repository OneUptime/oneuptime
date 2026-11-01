/*
 * HOW SURE DATA SECURITY IS THAT A FINDING IS REAL.
 *
 *  - High: the value passed its validator (a checksum, the format's own
 *    rules) and either words around it or the column it sits in say what it
 *    is - or, for a column, most of its sampled values are that type.
 *  - Medium: the value passed its validator with nothing around it to
 *    confirm it, or the column's name says what it holds and some values
 *    agree.
 *  - Low: the shape matches but nothing confirms it.
 *
 * Only High and Medium findings make a store sensitive and can open an
 * issue; Low findings are shown on the store, folded away, for a person to
 * judge.
 */
enum DataConfidence {
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

export default DataConfidence;

export const DATA_CONFIDENCE_RANK: Readonly<Record<DataConfidence, number>> = {
  [DataConfidence.Low]: 0,
  [DataConfidence.Medium]: 1,
  [DataConfidence.High]: 2,
};

export const ALL_DATA_CONFIDENCES: ReadonlyArray<DataConfidence> = [
  DataConfidence.High,
  DataConfidence.Medium,
  DataConfidence.Low,
];

export function isDataConfidence(value: unknown): value is DataConfidence {
  return (
    typeof value === "string" &&
    (ALL_DATA_CONFIDENCES as ReadonlyArray<string>).includes(value)
  );
}

export function higherConfidence(
  a: DataConfidence,
  b: DataConfidence,
): DataConfidence {
  return DATA_CONFIDENCE_RANK[a] >= DATA_CONFIDENCE_RANK[b] ? a : b;
}

// Whether a finding at this confidence counts toward a store's sensitivity.
export function isConfidentEnough(confidence: DataConfidence): boolean {
  return DATA_CONFIDENCE_RANK[confidence] >= DATA_CONFIDENCE_RANK.Medium;
}
