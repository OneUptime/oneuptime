import Navigation from "Common/UI/Utils/Navigation";
import ExceptionExplorer from "../../../Components/Exceptions/ExceptionExplorer";
import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";

const ExceptionViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const exceptionId: string = Navigation.getLastParamAsString(0);

  return (
    <Fragment>
      <ExceptionExplorer telemetryExceptionId={new ObjectID(exceptionId)} />
    </Fragment>
  );
};

export default ExceptionViewPage;
