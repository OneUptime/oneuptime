import EndsWith from "./EndsWith";
import EqualTo from "./EqualTo";
import GreaterThan from "./GreaterThan";
import GreaterThanOrEqual from "./GreaterThanOrEqual";
import Includes from "./Includes";
import IncludesNone from "./IncludesNone";
import IsNull from "./IsNull";
import LessThan from "./LessThan";
import LessThanOrEqual from "./LessThanOrEqual";
import NotContains from "./NotContains";
import NotEqual from "./NotEqual";
import NotNull from "./NotNull";
import Search from "./Search";
import StartsWith from "./StartsWith";

/*
 * One value in an attribute-filter map ("Filter by Attributes" rows and the
 * persisted `attributes` maps that mirror them).
 *
 * A row is either a bare scalar — the `equals` operator, kept bare for
 * backwards compatibility with filters saved before operators existed — or
 * one of the query-operator wrappers below.
 *
 * This lives in Types rather than next to the Dictionary UI component
 * because the persisted types (monitor steps, dashboard components) and the
 * query builders that read them are typed with it, and Types must not depend
 * on UI. `Common/UI/Components/Dictionary/DictionaryFilterOperator` re-exports
 * it for the UI callers that already import it from there.
 */
export type DictionaryEntryValue =
  | string
  | number
  | boolean
  | EqualTo<string>
  | NotEqual<string>
  | Search<string>
  | NotContains<string>
  | StartsWith<string>
  | EndsWith<string>
  | GreaterThan<number>
  | GreaterThanOrEqual<number>
  | LessThan<number>
  | LessThanOrEqual<number>
  | IsNull
  | NotNull
  | Includes
  | IncludesNone;

export default DictionaryEntryValue;
