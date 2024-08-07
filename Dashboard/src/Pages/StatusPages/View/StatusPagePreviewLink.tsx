import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/src/Components/Card/Card";
import Link from "Common/UI/src/Components/Link/Link";
import { STATUS_PAGE_URL } from "Common/UI/src/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const StatusPagePreviewLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <>
      <Card
        title={`Status Page Preview URL`}
        description={
          <span>
            Here&apos;s a link to preview your status page:{" "}
            <Link
              openInNewTab={true}
              to={URL.fromString(
                `${STATUS_PAGE_URL.toString()}/${props.modelId}`,
              )}
            >
              <span>{`${STATUS_PAGE_URL.toString()}/${props.modelId}`}</span>
            </Link>
          </span>
        }
      />
    </>
  );
};

export default StatusPagePreviewLink;
