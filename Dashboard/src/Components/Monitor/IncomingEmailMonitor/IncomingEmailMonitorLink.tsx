import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { INBOUND_EMAIL_DOMAIN } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";

export interface ComponentProps {
  secretKey: ObjectID;
}

const IncomingEmailMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!INBOUND_EMAIL_DOMAIN) {
    return (
      <Card
        title={`Incoming Email Address`}
        description={
          <div className="space-y-3">
            <ErrorMessage
              message={
                <span>
                  Inbound email is not configured. Please ask your OneUptime
                  administrator to set up the inbound email environment
                  variables.{" "}
                  <Link
                    to={URL.fromString(
                      "/docs/self-hosted/sendgrid-inbound-email",
                    )}
                    openInNewTab={true}
                    className="underline"
                  >
                    View Setup Documentation
                  </Link>
                </span>
              }
            />
          </div>
        }
      />
    );
  }

  const emailAddress: string = `monitor-${props.secretKey.toString()}@${INBOUND_EMAIL_DOMAIN}`;

  return (
    <>
      <Card
        title={`Incoming Email Address`}
        description={
          <div className="space-y-3">
            <p>
              Please send emails to this unique monitor email address. When
              emails are received at this address, they will be evaluated
              against your configured criteria to create or resolve alerts.
            </p>
            <div className="flex items-center space-x-2 bg-gray-50 p-3 rounded-md">
              <span className="font-mono text-sm break-all">{emailAddress}</span>
              <CopyableButton textToBeCopied={emailAddress} />
            </div>
          </div>
        }
      />
    </>
  );
};

export default IncomingEmailMonitorLink;
