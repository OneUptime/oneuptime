import DirectoryActionProp from "./DirectoryActionProp";
import FileActionProp from "./FileActionProp";
import ExceptionActionProp from "./ExceptionActionProp";
import SpanActionProp from "./SpanActionProp";

type CopilotActionProp = DirectoryActionProp | FileActionProp | ExceptionActionProp | SpanActionProp;

export default CopilotActionProp;
