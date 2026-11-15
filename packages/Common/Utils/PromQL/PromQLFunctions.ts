import { PromQLValueType } from "./PromQLAst";

/*
 * The PromQL functions OneUptime evaluates, with the argument types the
 * parser checks a call against (promql/parser/functions.go). The engine holds
 * what each one does; this list is what the parser, the editor's suggestions
 * and the docs read.
 *
 * `variadic` is how many times the last argument type may repeat beyond the
 * first: 0 for a fixed list, 1 for one optional argument (`round(v, 10)`),
 * -1 for any number (`label_join`).
 */
export interface PromQLFunctionSignature {
  name: string;
  argTypes: Array<PromQLValueType>;
  variadic: number;
  returnType: PromQLValueType;
}

const SCALAR: PromQLValueType = PromQLValueType.Scalar;
const VECTOR: PromQLValueType = PromQLValueType.InstantVector;
const MATRIX: PromQLValueType = PromQLValueType.RangeVector;
const STRING: PromQLValueType = PromQLValueType.String;

type SignatureFunction = (
  name: string,
  argTypes: Array<PromQLValueType>,
  returnType: PromQLValueType,
  variadic?: number,
) => PromQLFunctionSignature;

const signature: SignatureFunction = (
  name: string,
  argTypes: Array<PromQLValueType>,
  returnType: PromQLValueType,
  variadic: number = 0,
): PromQLFunctionSignature => {
  return { name, argTypes, variadic, returnType };
};

// One instant vector in, one out: abs, ceil, the trigonometry and the rest.
const SIMPLE_VECTOR_FUNCTIONS: ReadonlyArray<string> = [
  "abs",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atanh",
  "ceil",
  "cos",
  "cosh",
  "deg",
  "exp",
  "floor",
  "ln",
  "log10",
  "log2",
  "rad",
  "sgn",
  "sin",
  "sinh",
  "sqrt",
  "tan",
  "tanh",
];

// One range vector in, one value per series out.
const OVER_TIME_FUNCTIONS: ReadonlyArray<string> = [
  "avg_over_time",
  "count_over_time",
  "last_over_time",
  "mad_over_time",
  "max_over_time",
  "min_over_time",
  "present_over_time",
  "stddev_over_time",
  "stdvar_over_time",
  "sum_over_time",
  "changes",
  "resets",
  "deriv",
  "delta",
  "idelta",
  "increase",
  "irate",
  "rate",
];

// An optional instant vector of timestamps in, defaulting to vector(time()).
const DATE_FUNCTIONS: ReadonlyArray<string> = [
  "day_of_month",
  "day_of_week",
  "day_of_year",
  "days_in_month",
  "hour",
  "minute",
  "month",
  "year",
];

const buildSignatures: () => Map<string, PromQLFunctionSignature> = (): Map<
  string,
  PromQLFunctionSignature
> => {
  const signatures: Array<PromQLFunctionSignature> = [
    ...SIMPLE_VECTOR_FUNCTIONS.map((name: string): PromQLFunctionSignature => {
      return signature(name, [VECTOR], VECTOR);
    }),
    ...OVER_TIME_FUNCTIONS.map((name: string): PromQLFunctionSignature => {
      return signature(name, [MATRIX], VECTOR);
    }),
    ...DATE_FUNCTIONS.map((name: string): PromQLFunctionSignature => {
      return signature(name, [VECTOR], VECTOR, 1);
    }),
    signature("absent", [VECTOR], VECTOR),
    signature("absent_over_time", [MATRIX], VECTOR),
    signature("clamp", [VECTOR, SCALAR, SCALAR], VECTOR),
    signature("clamp_max", [VECTOR, SCALAR], VECTOR),
    signature("clamp_min", [VECTOR, SCALAR], VECTOR),
    signature("double_exponential_smoothing", [MATRIX, SCALAR, SCALAR], VECTOR),
    signature("holt_winters", [MATRIX, SCALAR, SCALAR], VECTOR),
    signature("histogram_quantile", [SCALAR, VECTOR], VECTOR),
    signature("label_join", [VECTOR, STRING, STRING, STRING], VECTOR, -1),
    signature(
      "label_replace",
      [VECTOR, STRING, STRING, STRING, STRING],
      VECTOR,
    ),
    signature("pi", [], SCALAR),
    signature("predict_linear", [MATRIX, SCALAR], VECTOR),
    signature("quantile_over_time", [SCALAR, MATRIX], VECTOR),
    signature("round", [VECTOR, SCALAR], VECTOR, 1),
    signature("scalar", [VECTOR], SCALAR),
    signature("sort", [VECTOR], VECTOR),
    signature("sort_desc", [VECTOR], VECTOR),
    signature("sort_by_label", [VECTOR, STRING], VECTOR, -1),
    signature("sort_by_label_desc", [VECTOR, STRING], VECTOR, -1),
    signature("time", [], SCALAR),
    signature("timestamp", [VECTOR], VECTOR),
    signature("vector", [SCALAR], VECTOR),
  ];

  const map: Map<string, PromQLFunctionSignature> = new Map();

  for (const item of signatures) {
    map.set(item.name, item);
  }

  return map;
};

export const PROMQL_FUNCTIONS: ReadonlyMap<string, PromQLFunctionSignature> =
  buildSignatures();

/*
 * Prometheus' native histogram functions. OneUptime stores OpenTelemetry
 * histograms as classic buckets, so these have nothing to read; the parser
 * names the series to use instead of saying the function is unknown.
 */
export const PROMQL_NATIVE_HISTOGRAM_FUNCTIONS: ReadonlySet<string> =
  new Set<string>([
    "histogram_avg",
    "histogram_count",
    "histogram_fraction",
    "histogram_stddev",
    "histogram_stdvar",
    "histogram_sum",
  ]);

export const getPromQLFunction: (
  name: string,
) => PromQLFunctionSignature | undefined = (
  name: string,
): PromQLFunctionSignature | undefined => {
  return PROMQL_FUNCTIONS.get(name);
};
