import { ON_CALL_SETUP_COPY } from "../../Components/GuidedSetup/OnCall/OnCallSetup";
import OnCallGuidedSetup from "../../Components/GuidedSetup/OnCall/OnCallGuidedSetup";
import { getOnCallDutyBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * GUIDED SETUP: PAGE THE RIGHT PERSON, AND ESCALATE (issue #6805), at
 * /on-call-duty/setup: from "how do you reach me" to an acknowledged test
 * page on one page. A page of its own, outside On-Call Duty's side menu,
 * as #6804's setup is outside Monitors': nothing else on screen asks for
 * attention while the job is done. Home's Welcome checklist and Search lead
 * here.
 */
const OnCallDutyGuidedSetup: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={ON_CALL_SETUP_COPY.pageTitle}
      description={ON_CALL_SETUP_COPY.pageDescription}
      breadcrumbLinks={getOnCallDutyBreadcrumbs(
        (
          props.pageRoute ||
          (RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route)
        ).toString(),
      )}
    >
      <OnCallGuidedSetup />
    </Page>
  );
};

export default OnCallDutyGuidedSetup;
