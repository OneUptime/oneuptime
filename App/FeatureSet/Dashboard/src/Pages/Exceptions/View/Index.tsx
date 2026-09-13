import ExceptionDetailSection from "../../../Components/Exceptions/ExceptionDetailSection";
import ExceptionExplorer from "../../../Components/Exceptions/ExceptionExplorer";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";

export interface ComponentProps extends PageComponentProps {
  section?: ExceptionDetailSection | undefined;
}

const ExceptionViewPage: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const { id } = useParams();

  return (
    <ExceptionExplorer
      key={`${id || "unknown"}-${props.section || ExceptionDetailSection.Overview}`}
      telemetryExceptionId={new ObjectID(id || "")}
      section={props.section || ExceptionDetailSection.Overview}
    />
  );
};

export default ExceptionViewPage;
