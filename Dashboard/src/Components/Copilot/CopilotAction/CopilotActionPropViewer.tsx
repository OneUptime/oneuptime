import React, { FunctionComponent, ReactElement } from "react";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionProp, { CopilotActionPropType, CopilotActionPropUtil } from "Common/Types/Copilot/CopilotActionProps/Index";
import DirectoryActionProp from "Common/Types/Copilot/CopilotActionProps/DirectoryActionProp";
import FileActionProp from "Common/Types/Copilot/CopilotActionProps/FileActionProp";
import SpanActionProp from "Common/Types/Copilot/CopilotActionProps/SpanActionProp";
import TraceElement from "../../Traces/TraceElement";
import TelemetryExceptionElement from "../../Exceptions/ExceptionElement";
import ExceptionActionProp from "Common/Types/Copilot/CopilotActionProps/ExceptionActionProp";
import FunctionActionProp from "Common/Types/Copilot/CopilotActionProps/FunctionActionProp";

export interface ComponentProps {
  actionType: CopilotActionType;
  actionProps: CopilotActionProp;
}

const LabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const actionPropType: CopilotActionPropType = CopilotActionPropUtil.getCopilotActionPropByActionType(props.actionType);

  if (actionPropType === CopilotActionPropType.Directory) {
    return <div>
      <p className="text-gray-900">
        Directory Path
      </p>
      <p>
        {(props.actionProps as DirectoryActionProp).directoryPath}
      </p>
    </div>
  }

  if (actionPropType === CopilotActionPropType.File) {
    return <div>
      <p className="text-gray-900">
        File Path
      </p>
      <p>
        {(props.actionProps as FileActionProp).filePath}
      </p>
    </div>
  }

  // exception

  if (actionPropType === CopilotActionPropType.Exception) {
    return <div>
      <p className="text-gray-900">
        Exception
      </p>
      <p>
        <TelemetryExceptionElement message={(props.actionProps as ExceptionActionProp).message} fingerprint={
          (props.actionProps as ExceptionActionProp).fingerprint
        } />
      </p>
    </div>
  }

  if (actionPropType === CopilotActionPropType.Span) {
    return <div>
      <p className="text-gray-900">
        Trace ID
      </p>
      <p>
        <TraceElement traceId={(props.actionProps as SpanActionProp).traceId} />
      </p>
    </div>
  }

  if (actionPropType === CopilotActionPropType.Function) {
    return <div>
      <p className="text-gray-900">
        Details
      </p>
      <p>
        <p>
          {(props.actionProps as FunctionActionProp).functionName} function
        </p>
        <p>
          {(props.actionProps as FunctionActionProp).className && ` in ${(props.actionProps as FunctionActionProp).className} Class`}
        </p>
        <p>
          {(props.actionProps as FunctionActionProp).filePath && ` in ${(props.actionProps as FunctionActionProp).filePath} File`}
        </p>
      </p>
    </div>
  }

  return <>-</>;
};

export default LabelElement;
