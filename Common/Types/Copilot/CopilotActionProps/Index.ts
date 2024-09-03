import DirectoryActionProp from "./DirectoryActionProp";
import FileActionProp from "./FileActionProp";
import ExceptionActionProp from "./ExceptionActionProp";
import SpanActionProp from "./SpanActionProp";
import FunctionActionProp from "./FunctionActionProp";

type CopilotActionProp =
  | DirectoryActionProp
  | FileActionProp
  | ExceptionActionProp
  | SpanActionProp
  | FunctionActionProp;

export default CopilotActionProp;
