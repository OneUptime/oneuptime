import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a Health screen shows when the Health API answers 402: this
 * installation's Enterprise license is missing, expired past its grace period
 * or does not include instance health. The server's own message is written for
 * enterprise configuration in general, so the screens show this instead - what
 * is locked, how to unlock it, what else is off while the license is missing
 * or expired (single sign-on, SCIM and audit logging), and what keeps working.
 *
 * On OneUptime Cloud (billing on) the license never locks these screens, and
 * the only 402 is the query console's Cloud refusal, which keeps its own
 * message.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them when a locale has an entry under the same English key.
 */

export const HEALTH_LICENSE_REQUIRED_TITLE: string =
  "Enterprise license required.";

export const HEALTH_LICENSE_REQUIRED_DESCRIPTION: string =
  "The live OneUptime Health dashboards and the query console need an Enterprise license that includes instance health, and this installation's license is missing, expired or does not include it. Activate or renew the license from the Enterprise Edition badge at the top of the Admin Dashboard. While the license is missing or expired, single sign-on, SCIM provisioning and audit logging are off too; they come back with these screens as soon as a license is activated. ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle keep working without it; find them in the menu on the left.";

// A failed Health API request, as a screen keeps it in state.
export interface HealthRequestError {
  // The Health API answered 402 because of the license.
  isLicenseRequired: boolean;
  // What to show for any other failure.
  message: string;
}

export const isHealthLicenseRequiredError: (err: unknown) => boolean = (
  err: unknown,
): boolean => {
  return (
    err instanceof HTTPErrorResponse &&
    err.statusCode === 402 &&
    !BILLING_ENABLED
  );
};

export const toHealthRequestError: (err: unknown) => HealthRequestError = (
  err: unknown,
): HealthRequestError => {
  return {
    isLicenseRequired: isHealthLicenseRequiredError(err),
    message: API.getFriendlyMessage(err),
  };
};

export interface ComponentProps {
  className?: string | undefined;
}

const HealthLicenseRequired: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle={HEALTH_LICENSE_REQUIRED_TITLE}
      title={HEALTH_LICENSE_REQUIRED_DESCRIPTION}
      dataTestId="health-license-required"
      className={props.className}
    />
  );
};

export default HealthLicenseRequired;
