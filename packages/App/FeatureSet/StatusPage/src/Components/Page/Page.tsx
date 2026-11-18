import StatusPageUtil from "../../Utils/StatusPage";
import Page, {
  ComponentProps as PageComponentProps,
} from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

const StatusPagePage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      {...props}
      className="w-full p-0 mt-3 mb-10 sm:mt-5 sm:mb-12"
      /*
       * The browser tab is named after the status page, never OneUptime:
       * "Acme Status | Overview - Incidents", and the Overview "Acme
       * Status" (#7467).
       */
      documentTitleName={
        props.documentTitleName ||
        StatusPageUtil.getStatusPageName() ||
        undefined
      }
    />
  );
};

export default StatusPagePage;
