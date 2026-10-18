import {
  STATUS_PAGE_LINK_TEST_ID,
  StatusPageOverviewCopy,
} from "../../../Components/StatusPage/StatusPageOverviewCopy";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Link from "Common/UI/Components/Link/Link";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * The status page's own address, first on its Overview: a link that looks
 * like one, opened in a new tab, with Copy link beside it - drawn as a
 * dashboard's Sharing page draws its public link. It used to be grey text
 * at the end of "Here's a link to preview your status page:".
 */
const StatusPagePreviewLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const url: URL = URL.fromString(
    `${STATUS_PAGE_URL.toString()}/${props.modelId.toString()}`,
  );

  return (
    <Card
      title={StatusPageOverviewCopy.linkCardTitle}
      description={StatusPageOverviewCopy.linkCardDescription}
    >
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid={STATUS_PAGE_LINK_TEST_ID}
      >
        <Link
          to={url}
          openInNewTab={true}
          className="min-w-0 break-all text-sm text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
        >
          {/*
           * The class sits on the text's own element: Link wraps a bare
           * string in a span, which the page's `* { font-family }` rule
           * would draw in Inter.
           */}
          <span className="font-mono">{url.toString()}</span>
        </Link>
        <CopyTextButton
          textToBeCopied={url.toString()}
          label="Copy link"
          copiedLabel="Copied!"
          size="sm"
          variant="soft"
        />
      </div>
    </Card>
  );
};

export default StatusPagePreviewLink;
