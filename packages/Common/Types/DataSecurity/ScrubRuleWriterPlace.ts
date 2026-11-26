/*
 * ONE PLACE ONEUPTIME AI WRITES A SCRUB RULE FOR, AS IT IS TOLD IT (#10366).
 *
 * Where no rule of Scrub It's can hide a telemetry finding's data - a
 * person's name in a log body, one of the project's own types with no
 * pattern, a value told apart only by its context - OneUptime AI is asked
 * for the narrowest pattern, or the attributes to hide, from this: the data
 * type, where it sits, the names of the attributes around it and the shapes
 * of its values (AA-9999 for AB-1234, Utils/DataSecurity/UnplacedFields).
 * Never a value, a masked sample or a record: plain code read the records
 * and kept only their shapes (Server/Utils/DataSecurity/Telemetry/
 * TelemetryScrubShapes), and plain code proves what comes back on those
 * records before anything is offered (TelemetryScrubProof).
 */

export interface ScrubRuleWriterShape {
  // Letters as a or A, digits as 9, everything else as it is.
  shape: string;
  // The share of the values read with this shape, 0 to 1.
  share: number;
}

export interface ScrubRuleWriterPlace {
  // The place's reference in the prompt and the answer: "P1".
  ref: string;
  dataTypeId: string;
  // The data type as the project names it.
  dataTypeName: string;
  // Its category (DataCategory): a secret, personal data.
  category: string;
  // Whether the scan finds it by its values or by the field's name.
  foundBy: "value" | "name";
  signal: "log" | "trace";
  // Where it sits, as the finding names it: attributes.customer.ref, body.
  location: string;
  // The attribute's key, for an attribute: the only key a rule for it may name.
  attributeKey?: string | undefined;
  // "Attribute" or "Body", as the finding says.
  locationKind: string;
  // The names of the attributes beside it in the records read.
  neighbours: Array<string>;
  shapes: Array<ScrubRuleWriterShape>;
  // How many values were read, and how long they are on average.
  valueCount: number;
  averageLength: number;
}

// The most places one call is asked about: an issue's places, and some.
export const MAX_SCRUB_RULE_WRITER_PLACES: number = 20;

// What OneUptime AI may answer for a place: a pattern, or the attributes to hide whole.
export enum ScrubRuleWriterRuleKind {
  Pattern = "pattern",
  Keys = "keys",
}

export interface ScrubRuleWriterRule {
  ref: string;
  kind: ScrubRuleWriterRuleKind;
  // A pattern: a regular expression without slashes or flags.
  pattern?: string | undefined;
  // The attributes to hide whole: only the place's own key is taken.
  keys?: Array<string> | undefined;
}
