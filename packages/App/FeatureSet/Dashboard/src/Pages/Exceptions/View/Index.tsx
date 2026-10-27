import ExceptionDetailSection from "../../../Components/Exceptions/ExceptionDetailSection";
import ExceptionExplorer from "../../../Components/Exceptions/ExceptionExplorer";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import SecurityEventsForException from "../../../Components/SecurityEvents/SecurityEventsForException";

export interface ComponentProps extends PageComponentProps {
  section?: ExceptionDetailSection | undefined;
}

const ExceptionViewPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { id } = useParams();
  const section: ExceptionDetailSection =
    props.section || ExceptionDetailSection.Overview;

  return (
    <>
      {/*
       * Above the exception's overview: the attacks that keep throwing it,
       * for a reader who may read security events.
       */}
      {section === ExceptionDetailSection.Overview && (
        <SecurityEventsForException
          telemetryExceptionId={new ObjectID(id || "")}
          className="mb-4"
        />
      )}
      <ExceptionExplorer
        key={`${id || "unknown"}-${section}`}
        telemetryExceptionId={new ObjectID(id || "")}
        section={section}
      />
    </>
  );
};

export default ExceptionViewPage;
