import ErrorPage from "../../Components/ErrorPage";
import { NOT_FOUND_COPY } from "../../Components/PublicDashboardCopy";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * No dashboard here: a missing one, an archived one and one shared only
 * with its project answer alike, so the page says so once and names who can
 * give the visitor a working link.
 */
const NotFoundPage: FunctionComponent = (): ReactElement => {
  return (
    <ErrorPage
      code="404"
      title={NOT_FOUND_COPY.title}
      description={NOT_FOUND_COPY.description}
      nextStep={NOT_FOUND_COPY.nextStep}
    />
  );
};

export default NotFoundPage;
