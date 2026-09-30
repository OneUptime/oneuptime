import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { INBOUND_EMAIL_DOMAIN } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import IncomingEmailMonitorAddress from "Common/Utils/Monitor/IncomingEmailMonitorAddress";

export interface ComponentProps {
  secretKey: ObjectID;
  // The monitor's custom address name, when it has one. It replaces the generated address.
  customLocalPart?: string | undefined;
}

/*
 * Where the docs explain reading a sender's verification email (Azure Monitor
 * action groups, Amazon SNS) off the monitor. Exported so the docs tests can
 * check the section is still there.
 */
export const VERIFY_ADDRESS_DOCS_ROUTE: string =
  "/docs/monitor/incoming-email-monitor#verifying-the-address-with-the-sender";

/*
 * The address an incoming-email monitor receives on, or null when this
 * server has no inbound email domain configured (so there is no address to
 * show). A custom address, when set, is the live one: the generated
 * monitor-{secretKey} address stops working. Shared with the monitor
 * overview's connection card and the settings page.
 */
export function getIncomingEmailAddress(
  secretKey: ObjectID | undefined,
  customLocalPart?: string | undefined,
): string | null {
  return IncomingEmailMonitorAddress.getAddress({
    secretKey: secretKey,
    customLocalPart: customLocalPart,
    inboundDomain: INBOUND_EMAIL_DOMAIN,
  });
}

const IncomingEmailMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const emailAddress: string | null = getIncomingEmailAddress(
    props.secretKey,
    props.customLocalPart,
  );

  if (!emailAddress) {
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
                    to={Route.fromString(
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
              <span className="font-mono text-sm break-all">
                {emailAddress}
              </span>
              <CopyableButton textToBeCopied={emailAddress} />
            </div>
            <p>
              Some services, such as Azure Monitor action groups, send a
              verification email before they deliver any alerts. It shows up on
              this monitor&apos;s Overview page like any other email.{" "}
              <Link
                to={Route.fromString(VERIFY_ADDRESS_DOCS_ROUTE)}
                openInNewTab={true}
                className="underline"
              >
                How to verify the address
              </Link>
            </p>
          </div>
        }
      />
    </>
  );
};

export default IncomingEmailMonitorLink;
