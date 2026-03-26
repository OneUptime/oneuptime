import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { PUBLIC_DASHBOARD_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import Link from "Common/UI/Components/Link/Link";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardPreviewLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <>
      <Card
        title={`Dashboard Preview URL`}
        description={
          <span>
            Here&apos;s a link to preview your public dashboard:{" "}
            <Link
              openInNewTab={true}
              to={URL.fromString(
                `${PUBLIC_DASHBOARD_URL.toString()}/${props.modelId}`,
              )}
            >
              <span>{`${PUBLIC_DASHBOARD_URL.toString()}/${props.modelId}`}</span>
            </Link>
          </span>
        }
      />
    </>
  );
};

export default DashboardPreviewLink;
