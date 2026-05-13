import URL from "../API/URL";
import Phone from "../Phone";

export interface Say {
  sayMessage: string;
}

export interface OnCallInputRequest {
  [x: string]: Say; // input.
  default: Say; // what if there is no input or invalid input.
}

export interface GatherInput {
  introMessage: string;
  numDigits: number;
  timeoutInSeconds: number;
  noInputMessage: string;
  onInputCallRequest: OnCallInputRequest;
  responseUrl: URL;
}

export enum CallAction {}

export interface CallRequestMessage {
  data: Array<Say | CallAction | GatherInput>;
}

export default interface CallRequest extends CallRequestMessage {
  to: Phone;
}

type IsHighRiskPhoneNumberFunction = (phoneNumber: Phone) => boolean;

// Country dialing codes flagged as high-risk for IRSF / SMS pumping fraud.
// Twilio surfaces its current list dynamically in the Console; this set is
// drawn from publicly reported fraud patterns and should be reviewed
// periodically against Twilio Geo Permissions and Fraud Guard.
const HIGH_RISK_COUNTRY_DIALING_CODES: Array<string> = [
  "+92", // Pakistan
  "+27", // South Africa
  "+213", // Algeria
  "+371", // Latvia
  "+370", // Lithuania
  "+372", // Estonia
  "+252", // Somalia
  "+232", // Sierra Leone
  "+231", // Liberia
  "+53", // Cuba
  "+960", // Maldives
  "+992", // Tajikistan
  "+880", // Bangladesh
  "+62", // Indonesia
  "+84", // Vietnam
  "+95", // Myanmar
];

export const isHighRiskPhoneNumber: IsHighRiskPhoneNumberFunction = (
  phoneNumber: Phone,
): boolean => {
  const phoneNumberString: string = phoneNumber.toString();

  return HIGH_RISK_COUNTRY_DIALING_CODES.some((code: string) => {
    return phoneNumberString.startsWith(code);
  });
};
