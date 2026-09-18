import Phone from "../Phone";

export default interface TwilioConfig {
  accountSid: string;
  authToken: string;
  primaryPhoneNumber: Phone;
  secondaryPhoneNumbers: Phone[];
}
