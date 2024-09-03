import DirectoryActionProp from "./DirectoryActionProp";
import FileActionProp from "./FileActionProp";
import ExceptionActionProp from "./ExceptionActionProp";
import SpanActionProp from "./SpanActionProp";
import FunctionActionProp from "./FunctionActionProp";
import CopilotActionType from "../CopilotActionType";

type CopilotActionProp =
  | DirectoryActionProp
  | FileActionProp
  | ExceptionActionProp
  | SpanActionProp
  | FunctionActionProp;

export enum CopilotActionPropType {
  Directory = "Directory",
  File = "File",
  Exception = "Exception",
  Span = "Span",
  Metric = "Metric",
  Function = "Function",
}

export class CopilotActionPropUtil { 
  public static getCopilotActionPropByActionType(actionType: CopilotActionType): CopilotActionPropType {

    if(actionType === CopilotActionType.FIX_EXCEPTIONS){
      return CopilotActionPropType.Exception;
    }

    if(actionType === CopilotActionType.FIX_PERFORMANCE_ISSUES){
      return CopilotActionPropType.Span;
    }

    if(actionType === CopilotActionType.FIX_BUGS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.IMPROVE_LOGS){
      return CopilotActionPropType.File;
    }

    if(actionType === CopilotActionType.IMPROVE_SPANS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.IMPROVE_METRICS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.ADD_LOGS){
      return CopilotActionPropType.File;
    }

    if(actionType === CopilotActionType.ADD_SPANS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.ADD_METRICS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.REFACTOR_CODE){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.WRITE_UNIT_TESTS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.IMPROVE_UNIT_TESTS){
      return CopilotActionPropType.Function;
    }

    if(actionType === CopilotActionType.IMPROVE_COMMENTS){
      return CopilotActionPropType.File;
    }

    if(actionType === CopilotActionType.ADD_COMMENTS){
      return CopilotActionPropType.File;
    }

    if(actionType === CopilotActionType.ADD_README){
      return CopilotActionPropType.Directory;
    }

    if(actionType === CopilotActionType.IMRPOVE_README){
      return CopilotActionPropType.File;
    }

    return CopilotActionPropType.File; 

  }
}

export default CopilotActionProp;
