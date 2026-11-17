import ErrorPage from "../../Components/ErrorPage";
import { FORBIDDEN_COPY } from "../../Components/PublicDashboardCopy";
import PublicDashboardUtil from "../../Utils/PublicDashboard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The dashboard's IP allowlist does not let this visitor in. It says who
 * can let them in, and Try again opens the dashboard's own address afresh,
 * for a visitor who has moved to a network it allows - this page's address
 * would only draw this page again.
 */
const ForbiddenPage: FunctionComponent = (): ReactElement => {
  // With the link's own theme kept on it, as the app keeps it on every page it loads anew.
  const dashboardAddress: string = PublicDashboardUtil.withLinkTheme(
    PublicDashboardUtil.isPreviewPage()
      ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString() || ""}`
      : "/",
  );

  return (
    <ErrorPage
      code="403"
      title={FORBIDDEN_COPY.title}
      description={FORBIDDEN_COPY.description}
      nextStep={FORBIDDEN_COPY.nextStep}
      tryAgain={{
        text: FORBIDDEN_COPY.tryAgain,
        address: dashboardAddress,
      }}
    />
  );
};

export default ForbiddenPage;
