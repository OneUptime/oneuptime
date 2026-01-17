import { JSONObject } from "../JSON";

// Phone number from provider search
export interface AvailablePhoneNumber {
  phoneNumber: string; // "+14155550123"
  friendlyName: string; // "(415) 555-0123"
  locality?: string; // "San Francisco"
  region?: string; // "CA"
  country: string; // "US"
  providerCostPerMonthInUSDCents: number;
  customerCostPerMonthInUSDCents: number;
}

// Purchased phone number details
export interface PurchasedPhoneNumber {
  phoneNumberId: string; // Provider's ID (e.g., Twilio SID)
  phoneNumber: string;
  providerCostPerMonthInUSDCents: number;
}

// Search options for available numbers
export interface SearchNumberOptions {
  countryCode: string;
  areaCode?: string;
  contains?: string;
  limit?: number;
}

// Options for dial operation
export interface DialOptions {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  timeoutSeconds: number;
  statusCallbackUrl: string;
}

// Parsed incoming call data from webhook
export interface IncomingCallData {
  callId: string; // Provider's call ID
  callerPhoneNumber: string;
  calledPhoneNumber: string;
}

// Parsed dial status data from webhook
export interface DialStatusData {
  callId: string;
  dialStatus: "completed" | "busy" | "no-answer" | "failed" | "canceled";
  dialDurationSeconds?: number;
}

// Express Request type for webhook parsing
export interface WebhookRequest {
  body: JSONObject;
  headers: { [key: string]: string | string[] | undefined };
  originalUrl: string;
  url: string;
  protocol: string;
  get: (name: string) => string | undefined;
}

// Call provider interface - all providers must implement this
export interface ICallProvider {
  // Phone number management
  searchAvailableNumbers(
    options: SearchNumberOptions,
  ): Promise<AvailablePhoneNumber[]>;
  purchaseNumber(
    phoneNumber: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber>;
  releaseNumber(phoneNumberId: string): Promise<void>;
  updateWebhookUrl(phoneNumberId: string, webhookUrl: string): Promise<void>;

  // Pricing
  getPhoneNumberPricing(
    countryCode: string,
  ): Promise<{ basePricePerMonthInUSDCents: number }>;

  // Voice response generation (provider-specific markup)
  generateGreetingResponse(message: string): string;
  generateDialResponse(options: DialOptions): string;
  generateHangupResponse(message?: string): string;
  generateEscalationResponse(
    message: string,
    nextDialOptions: DialOptions,
  ): string;

  // Webhook parsing
  parseIncomingCallWebhook(request: WebhookRequest): IncomingCallData;
  parseDialStatusWebhook(request: WebhookRequest): DialStatusData;

  // Webhook signature validation
  validateWebhookSignature(request: WebhookRequest, signature: string): boolean;
}
