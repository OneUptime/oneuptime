import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import XcpNgDocumentationCard from "../../Components/XcpNg/DocumentationCard";

/*
 * How to connect XCP-ng, for anyone: Xen Orchestra's OpenMetrics plugin,
 * then the agent beside Xen Orchestra. The guide's words are
 * Utils/DocumentationMarkdown.ts, in the reader's language.
 */
const XcpNgDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <XcpNgDocumentationCard
        title="Connect XCP-ng Pools"
        description="Turn on Xen Orchestra's OpenMetrics plugin, then install the OneUptime XCP-ng Agent next to Xen Orchestra. Every pool it manages appears automatically once data arrives."
      />
    </Fragment>
  );
};

export default XcpNgDocumentation;
