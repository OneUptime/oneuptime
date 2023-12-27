import Phone from "../Phone";

export default interface TwilioConfig {
    accountSid: string;
    authToken: string;
    phoneNumber: Phone;
}