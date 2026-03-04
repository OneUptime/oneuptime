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
      className="w-full mt-3 mb-16 sm:mt-5 sm:mb-20 h-full p-0"
    />
  );
};

export default StatusPagePage;
