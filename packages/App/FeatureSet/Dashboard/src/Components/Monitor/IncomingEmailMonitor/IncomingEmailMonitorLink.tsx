import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { INBOUND_EMAIL_DOMAIN } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import IncomingEmailMonitorAddress from "Common/Utils/Monitor/IncomingEmailMonitorAddress";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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

/*
 * The address, its copy button and the verification hint are the card's
 * body, not its description: Card hides the description below md, and puts
 * it in a <p>, which cannot hold them. A phone used to get the title over an
 * empty card - on the Overview's setup card, where the address is the whole
 * point - and React warned about <div> and <p> inside <p>.
 */
const IncomingEmailMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const emailAddress: string | null = getIncomingEmailAddress(
    props.secretKey,
    props.customLocalPart,
  );

  if (!emailAddress) {
    return (
      <Card title={`Incoming Email Address`}>
        <ErrorMessage
          message={
            <span>
              {translator.translateText(
                "Inbound email is not configured. Please ask your OneUptime administrator to set up the inbound email environment variables.",
              )}{" "}
              <Link
                to={Route.fromString(
                  "/docs/self-hosted/sendgrid-inbound-email",
                )}
                openInNewTab={true}
                className="underline"
              >
                {translator.translateText("View Setup Documentation")}
              </Link>
            </span>
          }
        />
      </Card>
    );
  }

  return (
    <Card
      title={`Incoming Email Address`}
      description="Please send emails to this unique monitor email address. When emails are received at this address, they will be evaluated against your configured criteria to create or resolve alerts."
    >
      <div data-testid="incoming-email-setup" className="space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-500">
            {translator.translateText("Email address")}
          </p>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span
              data-testid="incoming-email-address"
              className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
            >
              {emailAddress}
            </span>
            <CopyTextButton
              textToBeCopied={emailAddress}
              size="sm"
              variant="soft"
              title="Copy email address"
            />
          </div>
        </div>
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "Some services, such as Azure Monitor action groups, send a verification email before they deliver any alerts. It shows up on this monitor's Overview page like any other email.",
          )}{" "}
          <Link
            to={Route.fromString(VERIFY_ADDRESS_DOCS_ROUTE)}
            openInNewTab={true}
            className="underline"
          >
            {translator.translateText("How to verify the address")}
          </Link>
        </p>
      </div>
    </Card>
  );
};

export default IncomingEmailMonitorLink;
