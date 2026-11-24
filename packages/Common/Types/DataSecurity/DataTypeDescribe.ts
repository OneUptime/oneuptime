import { JSONObject } from "../JSON";

/*
 * DESCRIBE IT, ON THE DATA TYPE FORM (#10371): what the form sends and
 * what it gets back.
 *
 * The form sends a sentence and the shapes of the person's examples -
 * never the examples, which Test It runs in the browser - and gets the
 * form's values back, filled in by OneUptime AI's draft, for the person to
 * test and save. Nothing is saved by the request.
 */

export const DESCRIBE_DATA_TYPE_ROUTE: string =
  "/data-security-custom-data-type/draft-with-ai";

// The longest sentence a person's description may be.
export const MAX_DESCRIBE_SENTENCE_LENGTH: number = 1_000;

export interface DescribeDataTypeRequest extends JSONObject {
  sentence: string;
  // Each example's shape (UnplacedFields.valueShape): EMP-123456 is AAA-999999.
  exampleShapes: Array<string>;
}

export interface DescribeDataTypeResponse extends JSONObject {
  // The form's values: a saved type's columns (toCustomDataTypeFormValues).
  dataType: JSONObject;
  // Why OneUptime AI drafted it so, in a sentence.
  reason: string;
}
