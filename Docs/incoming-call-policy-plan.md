# Incoming Call Policy Feature - Implementation Plan

## Overview

Create a standalone **Incoming Call Policy** that handles incoming calls to a phone number. The policy has its own escalation rules where each rule can route to either an On-Call Schedule OR a specific User (never both).

**Use Case:** Instead of giving customers multiple phone numbers for different on-call engineers, provide a single phone number. When called, OneUptime automatically routes the call to whoever is currently on-call, with automatic escalation if unanswered.

---

## Call Provider Abstraction Layer

The system is designed to be **provider-agnostic**. Twilio is the initial implementation, but the architecture supports swapping to any other provider (Vonage, Bandwidth, Plivo, etc.) without changing business logic.

### Environment Variable

```bash
# Select which call provider to use
CALL_PROVIDER=twilio (by default, if no call provider is mentioned)
```

### Provider Interface

**File:** `/Common/Types/Call/CallProvider.ts`

```typescript
// Available call providers
enum CallProviderType {
  Twilio = "twilio"
}

// Phone number from provider search
interface AvailablePhoneNumber {
  phoneNumber: string;           // "+14155550123"
  friendlyName: string;          // "(415) 555-0123"
  locality?: string;             // "San Francisco"
  region?: string;               // "CA"
  country: string;               // "US"
  providerCostPerMonthInUSDCents: number;
  customerCostPerMonthInUSDCents: number;
}

// Purchased phone number details
interface PurchasedPhoneNumber {
  phoneNumberId: string;         // Provider's ID (e.g., Twilio SID)
  phoneNumber: string;
  providerCostPerMonthInUSDCents: number;
}

// Call provider interface - all providers must implement this
interface ICallProvider {
  // Phone number management
  searchAvailableNumbers(options: SearchNumberOptions): Promise<AvailablePhoneNumber[]>;
  purchaseNumber(phoneNumber: string, webhookUrl: string): Promise<PurchasedPhoneNumber>;
  releaseNumber(phoneNumberId: string): Promise<void>;
  updateWebhookUrl(phoneNumberId: string, webhookUrl: string): Promise<void>;

  // Pricing
  getPhoneNumberPricing(countryCode: string): Promise<{ basePricePerMonth: number }>;

  // Voice response generation (provider-specific markup)
  generateGreetingResponse(message: string): string;
  generateDialResponse(options: DialOptions): string;
  generateHangupResponse(message?: string): string;

  // Webhook parsing
  parseIncomingCallWebhook(request: Request): IncomingCallData;
  parseDialStatusWebhook(request: Request): DialStatusData;
}

interface SearchNumberOptions {
  countryCode: string;
  areaCode?: string;
  contains?: string;
  limit?: number;
}

interface DialOptions {
  toPhoneNumber: string;
  fromPhoneNumber: string;
  timeoutSeconds: number;
  statusCallbackUrl: string;
}

interface IncomingCallData {
  callId: string;              // Provider's call ID
  callerPhoneNumber: string;
  calledPhoneNumber: string;
}

interface DialStatusData {
  callId: string;
  dialStatus: "completed" | "busy" | "no-answer" | "failed" | "canceled";
  dialDurationSeconds?: number;
}
```

### Twilio Implementation

**File:** `/App/FeatureSet/Notification/Providers/TwilioCallProvider.ts`

```typescript
class TwilioCallProvider implements ICallProvider {
  private client: Twilio.Twilio;

  constructor(config: TwilioConfig) {
    this.client = new Twilio.Twilio(config.accountSid, config.authToken);
  }

  async searchAvailableNumbers(options: SearchNumberOptions): Promise<AvailablePhoneNumber[]> {
    const pricing = await this.getPhoneNumberPricing(options.countryCode);
    const numbers = await this.client
      .availablePhoneNumbers(options.countryCode)
      .local.list({
        areaCode: options.areaCode,
        contains: options.contains,
        limit: options.limit || 10,
        voiceEnabled: true,
      });

    return numbers.map(n => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      country: options.countryCode,
      providerCostPerMonthInUSDCents: Math.round(pricing.basePricePerMonth * 100),
      customerCostPerMonthInUSDCents: this.applyMarkup(pricing.basePricePerMonth),
    }));
  }

  async purchaseNumber(phoneNumber: string, webhookUrl: string): Promise<PurchasedPhoneNumber> {
    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceUrl: webhookUrl,
      voiceMethod: 'POST',
    });

    return {
      phoneNumberId: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      providerCostPerMonthInUSDCents: /* from pricing */,
    };
  }

  async releaseNumber(phoneNumberId: string): Promise<void> {
    await this.client.incomingPhoneNumbers(phoneNumberId).remove();
  }

  // Generate TwiML for Twilio
  generateGreetingResponse(message: string): string {
    const response = new Twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice' }, message);
    return response.toString();
  }

  generateDialResponse(options: DialOptions): string {
    const response = new Twilio.twiml.VoiceResponse();
    response.dial({
      action: options.statusCallbackUrl,
      method: 'POST',
      timeout: options.timeoutSeconds,
      callerId: options.fromPhoneNumber,
    }).number(options.toPhoneNumber);
    return response.toString();
  }

  generateHangupResponse(message?: string): string {
    const response = new Twilio.twiml.VoiceResponse();
    if (message) {
      response.say({ voice: 'alice' }, message);
    }
    response.hangup();
    return response.toString();
  }

  parseIncomingCallWebhook(request: Request): IncomingCallData {
    return {
      callId: request.body.CallSid,
      callerPhoneNumber: request.body.From,
      calledPhoneNumber: request.body.To,
    };
  }

  parseDialStatusWebhook(request: Request): DialStatusData {
    return {
      callId: request.body.CallSid,
      dialStatus: this.mapTwilioStatus(request.body.DialCallStatus),
      dialDurationSeconds: parseInt(request.body.DialCallDuration || '0'),
    };
  }

  private mapTwilioStatus(status: string): DialStatusData['dialStatus'] {
    const map: Record<string, DialStatusData['dialStatus']> = {
      'completed': 'completed',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'failed': 'failed',
      'canceled': 'canceled',
    };
    return map[status] || 'failed';
  }
}
```

### Provider Factory

**File:** `/App/FeatureSet/Notification/Providers/CallProviderFactory.ts`

```typescript
class CallProviderFactory {
  private static instance: ICallProvider | null = null;

  static getProvider(): ICallProvider {
    if (this.instance) {
      return this.instance;
    }

    const providerType = process.env.CALL_PROVIDER || 'twilio';

    switch (providerType) {
      case 'twilio':
        this.instance = new TwilioCallProvider(getTwilioConfig());
        break;
      case 'vonage':
        // Future: this.instance = new VonageCallProvider(getVonageConfig());
        throw new Error('Vonage provider not yet implemented');
      case 'bandwidth':
        // Future: this.instance = new BandwidthCallProvider(getBandwidthConfig());
        throw new Error('Bandwidth provider not yet implemented');
      default:
        throw new Error(`Unknown call provider: ${providerType}`);
    }

    return this.instance;
  }
}
```

### Future Provider Template (Vonage Example)

**File:** `/App/FeatureSet/Notification/Providers/VonageCallProvider.ts` (Future)

```typescript
class VonageCallProvider implements ICallProvider {
  // Vonage uses NCCO (Nexmo Call Control Objects) instead of TwiML

  generateDialResponse(options: DialOptions): string {
    // Return NCCO JSON instead of TwiML
    return JSON.stringify([
      {
        action: 'connect',
        timeout: options.timeoutSeconds,
        from: options.fromPhoneNumber,
        endpoint: [{ type: 'phone', number: options.toPhoneNumber }],
        eventUrl: [options.statusCallbackUrl],
      }
    ]);
  }

  // ... other methods
}
```

---

## Database Models

### 1. IncomingCallPolicy

The main policy model that stores configuration for a routing phone number.

**File:** `/Common/Models/DatabaseModels/IncomingCallPolicy.ts`

| Field | Type | Description |
|-------|------|-------------|
| `name` | ShortText | Policy name |
| `description` | LongText | Optional description |
| `slug` | Slug | URL-friendly identifier |
| `projectId` | ObjectID | Reference to project |
| `projectCallSMSConfigId` | ObjectID | **Optional:** Reference to project-level Twilio config. If set, uses project's own Twilio account and billing does not apply. |
| `routingPhoneNumber` | Phone | Phone number for incoming calls |
| `callProviderPhoneNumberId` | ShortText | Provider's ID for the number (e.g., Twilio SID) |
| `phoneNumberCountryCode` | ShortText | Country code (US, GB, etc.) |
| `phoneNumberAreaCode` | ShortText | Area code if applicable |
| `callProviderCostPerMonthInUSDCents` | Number | Call provider's base cost (for accounting). Null when using project config. |
| `customerCostPerMonthInUSDCents` | Number | Customer price (with markup). Null when using project config. |
| `phoneNumberPurchasedAt` | Date | When number was purchased |
| `greetingMessage` | LongText | Custom TTS greeting (default: "Please wait while we connect you to the on-call engineer.") |
| `noAnswerMessage` | LongText | Message when escalation exhausted (default: "No one is available. Please try again later.") |
| `isEnabled` | Boolean | Enable/disable policy |
| `repeatPolicyIfNoOneAnswers` | Boolean | Restart from first rule if all fail |
| `repeatPolicyIfNoOneAnswersTimes` | Number | Max repeat attempts (default: 1) |
| `labels` | EntityArray | Labels for organization |

### 2. IncomingCallPolicyEscalationRule

Escalation rules that define who to call and in what order.

**File:** `/Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule.ts`

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | ObjectID | Reference to project |
| `incomingCallPolicyId` | ObjectID | Parent policy reference |
| `name` | ShortText | Rule name (e.g., "Primary On-Call", "Backup Engineer") |
| `description` | LongText | Optional description |
| `order` | Number | Execution order (1, 2, 3...) |
| `escalateAfterSeconds` | Number | Seconds before escalating to next rule (default: 30) |
| `onCallDutyPolicyScheduleId` | ObjectID | **EITHER** this: Reference to on-call schedule |
| `userId` | ObjectID | **OR** this: Direct user reference |

**Important:** Exactly one of `onCallDutyPolicyScheduleId` or `userId` must be set, never both.

### 3. IncomingCallLog

Parent log for each incoming call instance. Groups all escalation attempts together.

**File:** `/Common/Models/DatabaseModels/IncomingCallLog.ts`

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | ObjectID | Project reference |
| `incomingCallPolicyId` | ObjectID | Policy reference |
| `callerPhoneNumber` | Phone | Incoming caller number |
| `routingPhoneNumber` | Phone | The routing number called |
| `callProviderCallId` | ShortText | Call provider's call identifier |
| `status` | Enum | Initiated/Connected/NoAnswer/Failed/Completed/CallerHungUp |
| `callDurationInSeconds` | Number | Total call duration |
| `callCostInUSDCents` | Number | Total cost for this call |
| `incomingCallCostInUSDCents` | Number | Cost for incoming leg |
| `outgoingCallCostInUSDCents` | Number | Cost for all forwarding attempts |
| `startedAt` | Date | When call started |
| `endedAt` | Date | When call ended |

### 4. IncomingCallLogItem

Child log for each escalation attempt / user ring within a call.

**File:** `/Common/Models/DatabaseModels/IncomingCallLogItem.ts`

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | ObjectID | Project reference |
| `incomingCallLogId` | ObjectID | Parent call log reference |
| `incomingCallPolicyEscalationRuleId` | ObjectID | Which escalation rule was used |
| `userId` | ObjectID | User who was called |
| `userPhoneNumber` | Phone | Phone number dialed |
| `status` | Enum | Ringing/Answered/NoAnswer/Busy/Failed |
| `statusMessage` | LongText | Additional status info |
| `dialDurationInSeconds` | Number | How long this dial lasted |
| `callCostInUSDCents` | Number | Cost for this dial attempt |
| `startedAt` | Date | When dial started |
| `endedAt` | Date | When dial ended |
| `isAnswered` | Boolean | Whether this user answered |

### 5. IncomingCallStatus Enum

**File:** `/Common/Types/IncomingCall/IncomingCallStatus.ts`

```typescript
enum IncomingCallStatus {
  Initiated = "Initiated",
  Ringing = "Ringing",
  Connected = "Connected",
  Escalated = "Escalated",
  NoAnswer = "NoAnswer",
  Failed = "Failed",
  Completed = "Completed",
  CallerHungUp = "CallerHungUp"
}
```

---

## Call Flow

```
Incoming Call to Routing Number
              │
              ▼
┌──────────────────────────────┐
│  Look up IncomingCallPolicy  │
│  by phone number             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  <Say> Greeting Message      │
│  "Please wait while we..." (custom from incoming call policy)  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Get Escalation Rule #1      │
│  (order = 1)                 │
└──────────────┬───────────────┘
               │
       ┌───────┴───────┐
       │               │
   Has Schedule     Has User
       │               │
       ▼               ▼
┌─────────────┐  ┌─────────────┐
│ Get current │  │ Get user's  │
│ on-call     │  │ phone       │
│ from sched  │  │ directly    │
└──────┬──────┘  └──────┬──────┘
       │                │
       └───────┬────────┘
               │
               ▼
┌──────────────────────────────┐
│  <Dial timeout="30 (custom from esclaation policy)">         │
│    User's Phone Number       │
│  action="/dial-status/:logId"│
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        │             │
     Answered     No Answer
        │             │
        ▼             ▼
   Connected     Get Next Rule
   <Hangup>      (order + 1)
                      │
               ┌──────┴──────┐
               │             │
            Found         No More
            Rule          Rules
               │             │
               ▼             ▼
        <Say> "Next      <Say> No Answer
        engineer..."      Message
        <Dial>           <Hangup>
```

---

## UI Components

**Location:** On Call Duty → Advanced section

### 1. Incoming Call Policies List Page

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx`

- ModelTable listing all IncomingCallPolicy entries
- Columns: Name, Phone Number, Enabled, Created At
- Create/Edit/Delete actions

### 2. Incoming Call Policy View Page

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/View.tsx`

- Policy details (name, description, phone number)
- Enable/disable toggle
- Greeting message editor

### 3. Escalation Rules Page

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/EscalationRules.tsx`

- Ordered list of escalation rules
- Each rule shows:
  - Order number
  - Name
  - Target: Either "Schedule: [Schedule Name]" or "User: [User Name]"
  - Escalate after X seconds
- Drag to reorder
- Add/Edit/Delete rules

### 4. Escalation Rule Form

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/EscalationRuleForm.tsx`

- Name field
- **Radio button selection:**
  - "Route to On-Call Schedule" → Shows schedule dropdown
  - "Route to Specific User" → Shows user dropdown
- Escalate after (seconds) field

### 5. Incoming Call Logs Page

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx`

- Table of all incoming calls for this policy
- Columns: Caller, Status, Answered By, Duration, Time
- Expandable row to show escalation attempts

### 6. Side Menu (On Call Duty - Advanced Section)

**File to Modify:** `/Dashboard/src/Pages/OnCallDuty/SideMenu.tsx`

Add under "Advanced" section:
```typescript
<SideMenuItem
  link={{
    title: "Incoming Call Policy",
    to: RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES],
  }}
  icon={IconProp.Phone}
/>
```

---

## Phone Number Purchasing Flow

### Overview

Customers search for available phone numbers by country and area code, see a list of options, and select the one they want. OneUptime then purchases it via the configured call provider's API.

### UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Get Routing Phone Number                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Country:  [United States ▼]                                │
│                                                             │
│  Area Code (optional): [415]                                │
│                                                             │
│  [Search Available Numbers]                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Available Numbers:                                         │
│                                                             │
│  ○ +1 (415) 555-0123    San Francisco, CA    $1.20/month   │
│  ○ +1 (415) 555-0456    San Francisco, CA    $1.20/month   │
│  ○ +1 (415) 555-0789    San Francisco, CA    $1.20/month   │
│  ○ +1 (415) 555-0321    San Francisco, CA    $1.20/month   │
│                                                             │
│  (Price includes all fees)                                  │
│                                                             │
│  [Purchase Selected Number]                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Note:** UI shows `customerCostPerMonthInUSDCents` (with markup), not the provider's base cost. If billing is not enabled do not show cost. 

### API Endpoints (New)

**File:** `/App/FeatureSet/Notification/API/PhoneNumber.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/phone-number/search` | POST | Search available numbers by country/area code |
| `/phone-number/purchase` | POST | Purchase a specific phone number |
| `/phone-number/release/:id` | DELETE | Release a phone number back to provider |

### Search Request/Response

**POST `/phone-number/search`**

Request:
```typescript
{
  projectId: ObjectID;
  countryCode: string;      // "US", "GB", "CA", etc.
  areaCode?: string;        // "415", "212", etc. (optional)
  contains?: string;        // Search for numbers containing digits (optional)
}
```

Response:
```typescript
{
  availableNumbers: Array<{
    phoneNumber: string;      // "+14155550123"
    friendlyName: string;     // "(415) 555-0123"
    locality: string;         // "San Francisco"
    region: string;           // "CA"
    country: string;          // "US"
    callProviderCostPerMonthInUSDCents: number;    // 100 (Twilio's cost)
    customerCostPerMonthInUSDCents: number;  // 120 (with markup)
  }>;
}
```

### Purchase Request/Response

**POST `/phone-number/purchase`**

Request:
```typescript
{
  projectId: ObjectID;
  phoneNumber: string;              // "+14155550123"
  incomingCallPolicyId: ObjectID;   // Link to policy
}
```

Response:
```typescript
{
  success: boolean;
  phoneNumberId: string;   // Provider's ID for the purchased number
  phoneNumber: string;
}
```

### Pricing & Markup

**Environment Variable:**
```bash
# Markup multiplier for phone number costs
# 1.0 = no markup (charge exactly Twilio cost)
# 1.2 = 20% markup
# 1.5 = 50% markup
PHONE_NUMBER_PRICE_MULTIPLIER=1.2
```

**Pricing Flow:**
```
Provider Base Price (e.g., $1.00/month)
         │
         ▼
  × PHONE_NUMBER_PRICE_MULTIPLIER (e.g., 1.2)
         │
         ▼
  Customer Price (e.g., $1.20/month)
```

### Phone Number API Implementation

The `/phone-number/*` endpoints use `CallProviderFactory.getProvider()` to delegate to the configured provider:

```typescript
// In /App/FeatureSet/Notification/API/PhoneNumber.ts

router.post('/search', async (req, res) => {
  const provider = CallProviderFactory.getProvider();
  const numbers = await provider.searchAvailableNumbers({
    countryCode: req.body.countryCode,
    areaCode: req.body.areaCode,
    limit: 10,
  });
  // Apply markup from PHONE_NUMBER_PRICE_MULTIPLIER
  res.json({ availableNumbers: numbers });
});

router.post('/purchase', async (req, res) => {
  const provider = CallProviderFactory.getProvider();
  // Single webhook URL for all phone numbers - Twilio sends "To" field to identify which number was called
  const webhookUrl = `${NotificationWebhookHost}/notification/incoming-call/voice`;
  const result = await provider.purchaseNumber(req.body.phoneNumber, webhookUrl);
  res.json({ success: true, ...result });
});

router.delete('/release/:id', async (req, res) => {
  const provider = CallProviderFactory.getProvider();
  await provider.releaseNumber(req.params.id);
  res.json({ success: true });
});
```

This delegates all provider-specific logic to the `ICallProvider` implementation (e.g., `TwilioCallProvider`).

### New Fields in IncomingCallPolicy

Add to `IncomingCallPolicy` model:

| Field | Type | Description |
|-------|------|-------------|
| `callProviderPhoneNumberId` | ShortText | Provider's ID for the number |
| `phoneNumberCountryCode` | ShortText | Country code (US, GB, etc.) |
| `phoneNumberAreaCode` | ShortText | Area code if applicable |
| `callProviderCostPerMonthInUSDCents` | Number | Provider's base cost (for accounting) |
| `customerCostPerMonthInUSDCents` | Number | Customer price (with markup) |
| `phoneNumberPurchasedAt` | Date | When number was purchased |

### UI Components (New)

**File:** `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/PhoneNumberPurchase.tsx`

- Country dropdown (populated from provider's supported countries)
- Area code input field
- Search button
- Results list with radio selection
- Purchase button
- Loading states
- Error handling

### Phone Number Release Flow

When an `IncomingCallPolicy` is deleted:

1. Check if `callProviderPhoneNumberId` exists
2. Call `provider.releaseNumber(phoneNumberId)`
3. Number is released back to the provider
4. Stop monthly billing for that number

### Country Support

Common countries to support initially:
- United States (US)
- Canada (CA)
- United Kingdom (GB)
- Australia (AU)
- Germany (DE)
- France (FR)

Can be expanded based on provider availability.

### Error Handling

| Scenario | User Message |
|----------|--------------|
| No numbers available | "No phone numbers available for this area code. Try a different area code or country." |
| Purchase failed | "Failed to purchase phone number. Please try again or contact support." |
| Number already taken | "This number is no longer available. Please select another." |
| Insufficient balance | "Insufficient balance to purchase phone number. Please add funds." |

---

## Billing

### Cost Components

Call providers typically charge for two things:
1. **Phone Number** - Monthly fee (~$1-2/month per number)
2. **Call Minutes** - Per-minute charges for:
   - Incoming leg (caller → OneUptime routing number)
   - Outgoing leg (OneUptime → on-call user's phone)

### Billing Model

Use the **existing prepaid balance system** (`smsOrCallCurrentBalanceInUSDCents` on Project).

**Cost Tracking Fields in `IncomingCallLog`:**

| Field | Type | Description |
|-------|------|-------------|
| `callCostInUSDCents` | Number | Total cost for this routed call |
| `incomingCallCostInUSDCents` | Number | Cost for incoming leg |
| `outgoingCallCostInUSDCents` | Number | Cost for forwarding leg(s) |

**Cost Tracking Fields in `IncomingCallLogItem`:**

| Field | Type | Description |
|-------|------|-------------|
| `callCostInUSDCents` | Number | Cost for this specific dial attempt |

### Environment Variables (New)

```bash
# Per-minute cost for incoming calls to routing number
INCOMING_CALL_COST_IN_CENTS_PER_MINUTE=2

# Per-minute cost for forwarding/outgoing calls
INCOMING_CALL_FORWARD_COST_IN_CENTS_PER_MINUTE=2
```

### Billing Flow

```
Incoming Call Received
         │
         ▼
┌─────────────────────────┐
│ Check Project Balance   │
│ (smsOrCallCurrentBalance│
│  InUSDCents)            │
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      │           │
  Sufficient   Insufficient
      │           │
      ▼           ▼
  Route Call   Play "Service
               unavailable"
               message
            │
            ▼
┌─────────────────────────┐
│ Track Duration          │
│ - Incoming leg minutes  │
│ - Outgoing leg minutes  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Calculate & Deduct Cost │
│ from Project Balance    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Store in IncomingCallLog│
│ & IncomingCallLogItem   │
└─────────────────────────┘
```

### Phone Number Cost (Monthly)


- Add `phoneNumberMonthlyCostInUSDCents` field to `IncomingCallPolicy`
- Charge monthly via existing Stripe billing (in worker, maybe we need the payment status and last paid fields in IncomingOnCallPolicy model)
- Create scheduled job to bill monthly

### Integration with Existing Billing

1. **Balance Check** - Before routing, verify `project.smsOrCallCurrentBalanceInUSDCents >= minimum threshold`
2. **Auto-Recharge** - Trigger `NotificationService.rechargeIfBalanceIsLow()` if enabled
3. **Cost Deduction** - Deduct from same balance pool as SMS/Calls
4. **Low Balance** - If balance insufficient, play "Service temporarily unavailable" message

### Cost Calculation Logic

```typescript
// In IncomingCallService
async calculateCallCost(
  incomingDurationSeconds: number,
  outgoingDurationSeconds: number
): Promise<number> {
  const incomingMinutes = Math.ceil(incomingDurationSeconds / 60);
  const outgoingMinutes = Math.ceil(outgoingDurationSeconds / 60);

  const incomingCost = incomingMinutes * INCOMING_CALL_COST_IN_CENTS_PER_MINUTE;
  const outgoingCost = outgoingMinutes * INCOMING_CALL_FORWARD_COST_IN_CENTS_PER_MINUTE;

  return incomingCost + outgoingCost;
}
```

### Cost Deduction Timing

**Important:** Balance is checked and an estimated cost is **pre-authorized at the start of the call**, not at the end. This prevents calls from exceeding available balance.

```
Incoming Call Received
         │
         ▼
┌─────────────────────────┐
│ Check Project Balance   │
│ Pre-authorize estimated │
│ cost (e.g., 10 minutes) │
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      │           │
  Sufficient   Insufficient
      │           │
      ▼           ▼
  Route Call   Play "Service
               unavailable"
            │
            ▼
     Call Completes
            │
            ▼
┌─────────────────────────┐
│ Calculate actual cost   │
│ Adjust balance          │
│ (refund or charge diff) │
└─────────────────────────┘
```

---

## Project-Level Twilio Configuration

Projects can optionally use their own Twilio account instead of the global OneUptime Twilio account. When using a project-level config:

1. **No Billing** - OneUptime does not charge for calls; the project pays Twilio directly
2. **Own Phone Numbers** - Phone numbers are purchased in the project's Twilio account
3. **Full Control** - Project has direct access to their Twilio dashboard for monitoring and configuration

### How It Works

When creating or editing an Incoming Call Policy, users can choose:

| Option | Description |
|--------|-------------|
| **Use OneUptime's Twilio** (default) | Uses global Twilio config, billing applies |
| **Use My Own Twilio Config** | Uses project's `ProjectCallSMSConfig`, no billing |

### ProjectCallSMSConfig Model

Projects can configure their own Twilio credentials in **Settings → Call & SMS Config**:

**File:** `/Common/Models/DatabaseModels/ProjectCallSMSConfig.ts`

| Field | Type | Description |
|-------|------|-------------|
| `twilioAccountSID` | ShortText | Project's Twilio Account SID |
| `twilioAuthToken` | ShortText | Project's Twilio Auth Token |
| `twilioPrimaryPhoneNumber` | Phone | Primary phone number for outbound calls |
| `twilioSecondaryPhoneNumbers` | LongText | Comma-separated secondary numbers |

### Implementation

**IncomingCallPolicy Model:**
```typescript
// Optional reference to project's Twilio config
projectCallSMSConfigId?: ObjectID;
```

**Call Handling Logic:**
```typescript
// In IncomingCall.ts webhook handler
const isUsingProjectConfig = Boolean(policy.projectCallSMSConfigId);

let provider: ICallProvider;
if (policy.projectCallSMSConfigId) {
  const customConfig = await getProjectTwilioConfig(policy.projectCallSMSConfigId);
  provider = CallProviderFactory.getProviderWithConfig(customConfig);
} else {
  provider = await CallProviderFactory.getProvider(); // Global config
}

// Skip billing when using project config
const shouldCheckBilling = IsBillingEnabled && !isUsingProjectConfig;
```

### UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Incoming Call Policy Settings                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Twilio Configuration:                                      │
│                                                             │
│  ○ Use OneUptime's Twilio (Recommended)                     │
│    Billing applies. $X.XX/month for phone number.           │
│                                                             │
│  ○ Use My Own Twilio Config                                 │
│    Select: [My Twilio Account ▼]                            │
│    You pay Twilio directly. No billing from OneUptime.      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Webhook Security

All incoming webhooks must be validated to ensure they originate from the configured call provider and not from malicious actors.

### Webhook URL Structure

A **single webhook endpoint** is used for all phone numbers. When Twilio sends a webhook, it includes the `To` field containing the called phone number, which we use to look up the corresponding policy.

```
https://api.oneuptime.com/incoming-call/voice
https://api.oneuptime.com/incoming-call/dial-status/{callLogId}/{logItemId}
```

**Benefits of single endpoint:**
- Simpler configuration - one webhook URL for all numbers
- No need to update webhook URLs when policies change
- Easier to manage in Twilio dashboard
- The `routingPhoneNumber` field in `IncomingCallPolicy` is unique, so lookups are fast

**How it works:**
1. Twilio sends webhook with `To` field containing the called phone number
2. We look up `IncomingCallPolicy` by `routingPhoneNumber = To`
3. Continue with normal call flow

### Signature Validation

Each call provider has its own signature validation mechanism. The `ICallProvider` interface includes validation:

```typescript
interface ICallProvider {
  // ... existing methods ...

  // Webhook signature validation
  validateWebhookSignature(request: Request, signature: string): boolean;
}
```

**Twilio Implementation:**

```typescript
class TwilioCallProvider implements ICallProvider {
  validateWebhookSignature(request: Request, signature: string): boolean {
    const authToken = this.config.authToken;
    const url = request.originalUrl;
    const params = request.body;

    return Twilio.validateRequest(authToken, signature, url, params);
  }
}
```

**Webhook Validation (in route handler):**

```typescript
// In /App/FeatureSet/Notification/API/IncomingCall.ts

// Validate provider signature (Twilio signature validation is sufficient for security)
const provider = await CallProviderFactory.getProvider();
const signature = req.headers['x-twilio-signature'] as string;

if (!provider.validateWebhookSignature(req, signature)) {
  logger.error("Invalid webhook signature for incoming call");
  res.status(403).send("Forbidden");
  return;
}

// Parse incoming call data to get the called phone number
const callData = provider.parseIncomingCallWebhook(req);

// Look up policy by the called phone number (To field)
const policy = await IncomingCallPolicyService.findOneBy({
  query: { routingPhoneNumber: new Phone(callData.calledPhoneNumber) },
  // ...
});
```

---

## Subscription Cancellation Handling

When a project's subscription is cancelled or payment fails, the incoming call policy must be handled appropriately to prevent ongoing costs for OneUptime and ensure callers receive a proper response.

### Handling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Subscription Status Change                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Subscription becomes PastDue  │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Daily Job: Send Warning Email │
              │  to project owners about       │
              │  phone numbers at risk         │
              └───────────────────────────────┘
                              │
                      (14 day grace period)
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Subscription becomes Cancelled│
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Daily Job: Release & Disable  │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────────┐       ┌─────────────────────┐
    │ Global Twilio Config │       │ Project Twilio Config│
    │ (OneUptime's account)│       │ (Customer's account) │
    └─────────────────────┘       └─────────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────────┐       ┌─────────────────────┐
    │ 1. Release phone #   │       │ 1. DO NOT release #  │
    │    from Twilio       │       │    (it's theirs)     │
    │ 2. Disable policy    │       │ 2. Disable policy    │
    │ 3. Send notification │       │ 3. Send notification │
    └─────────────────────┘       └─────────────────────┘
```

### Scheduled Jobs

**1. Warning Emails for Past Due Subscriptions**

**File:** `Worker/Jobs/IncomingCallPolicy/SendWarningEmailsForPastDueSubscriptions.ts`

- Runs daily
- Finds all projects with `PastDue` subscription status
- Sends warning email for each policy with a phone number (global config only)
- Email template: `IncomingCallPhoneNumberAtRisk`

**2. Release Phone Numbers for Cancelled Subscriptions**

**File:** `Worker/Jobs/IncomingCallPolicy/ReleasePhoneNumbersForCancelledSubscriptions.ts`

- Runs daily
- Finds all projects with `Cancelled`, `Unpaid`, `Expired` subscription status
- For policies using **global Twilio config**:
  - Release phone number from Twilio (stops billing)
  - Disable the policy
  - Send notification email
- For policies using **project's Twilio config**:
  - DO NOT release phone number (it's in their account)
  - Disable the policy (stops routing through OneUptime)
  - Send notification email
- Email template: `IncomingCallPhoneNumberReleased`

### Real-Time Call Rejection

The incoming call handler also checks subscription status in real-time as a safety measure:

```typescript
// In IncomingCall.ts webhook handler
if (IsBillingEnabled && policy.projectId && !isUsingProjectConfig) {
  const project = await ProjectService.findOneById(policy.projectId);

  const cancelledStatuses = ["canceled", "unpaid", "expired", "incomplete_expired"];
  const isCancelled = cancelledStatuses.includes(
    project?.paymentProviderSubscriptionStatus?.toLowerCase()
  );

  if (isCancelled) {
    // Log and reject the call
    return provider.generateHangupResponse("Sorry, this service is currently unavailable.");
  }
}
```

---

## Edge Cases

### No One Currently On-Call

If the escalation rule points to a schedule but no one is currently on-call:

1. Skip to the next escalation rule
2. If all rules exhausted, play the **`noOneAvailableMessage`** (user-configurable in Policy Settings)

**New field in `IncomingCallPolicy`:**

| Field | Type | Description |
|-------|------|-------------|
| `noOneAvailableMessage` | LongText | Message when no one is on-call or reachable (default: "We're sorry, but no on-call engineer is currently available. Please try again later or contact support.") |

### User Has No Phone Number Configured

If an escalation rule routes to a specific user (or the on-call user from a schedule) but they have no incoming call phone number configured:

1. Log the skip in `IncomingCallLogItem` with status `Failed` and message "User has no incoming call phone number"
2. Proceed to next escalation rule
3. If all rules exhausted, play the **`noOneAvailableMessage`**

### Multiple Simultaneous Calls

When multiple calls arrive at the same routing number simultaneously:

1. **First call** - Routes normally through escalation rules
2. **Subsequent calls** - Receive a busy message

**New field in `IncomingCallPolicy`:**

| Field | Type | Description |
|-------|------|-------------|
| `busyMessage` | LongText | Message when line is busy (default: "All lines are currently busy. Please try again in a few minutes.") |
| `maxConcurrentCalls` | Number | Maximum simultaneous calls to route (default: 1) |

**Implementation:**

```typescript
// Track active calls per policy
const activeCallsCount = await IncomingCallLogService.countBy({
  incomingCallPolicyId: policy._id,
  status: { $in: ['Initiated', 'Ringing', 'Connected'] }
});

if (activeCallsCount >= policy.maxConcurrentCalls) {
  return provider.generateHangupResponse(policy.busyMessage);
}
```

### Total Call Timeout

**New field in `IncomingCallPolicy`:**

| Field | Type | Description |
|-------|------|-------------|
| `maxTotalCallDurationSeconds` | Number | Maximum duration for entire call including all escalations (default: 300 = 5 minutes) |

If the total call duration exceeds this limit, play `noAnswerMessage` and hang up.

---

## User Incoming Call Phone Number

Users must configure a dedicated phone number for receiving incoming call routing. This number must be verified via SMS before it can be used.

### User Model Changes

**File:** `/Common/Models/DatabaseModels/User.ts`

Add new fields:

| Field | Type | Description |
|-------|------|-------------|
| `incomingCallPhoneNumber` | Phone | Phone number for receiving routed calls |
| `isIncomingCallPhoneNumberVerified` | Boolean | Whether the number has been verified |
| `incomingCallPhoneNumberVerificationCode` | ShortText | 6-digit verification code (temporary) |
| `incomingCallPhoneNumberVerificationCodeExpiry` | Date | When the code expires |

### Verification Flow

```
User enters phone number in Settings
              │
              ▼
┌──────────────────────────────┐
│ Generate 6-digit code        │
│ Store with 10-minute expiry  │
│ Send SMS to phone number     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ User enters code in UI       │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        │             │
     Matches      Doesn't Match
        │             │
        ▼             ▼
   Set verified    Show error
   = true          "Invalid code"
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/user/incoming-call-phone/send-verification` | POST | Send verification SMS |
| `/user/incoming-call-phone/verify` | POST | Verify the code |
| `/user/incoming-call-phone/remove` | DELETE | Remove verified number |

### UI Location

**File:** `/Dashboard/src/Pages/Settings/UserSettings.tsx` (or similar)

Add section:
- "Incoming Call Phone Number"
- Phone number input
- "Send Verification Code" button
- Verification code input (shown after sending)
- "Verify" button
- Status indicator (Verified / Not Verified)

### Call Routing Logic

When routing a call to a user:

```typescript
async function getUserPhoneNumberForIncomingCall(userId: ObjectID): Promise<Phone | null> {
  const user = await UserService.findOneById(userId);

  if (!user.incomingCallPhoneNumber || !user.isIncomingCallPhoneNumberVerified) {
    return null; // User cannot receive incoming calls
  }

  return user.incomingCallPhoneNumber;
}
```

---

## Database Indexes

For optimal query performance, add the following indexes:

### IncomingCallPolicy

```typescript
// Lookup by routing phone number (on incoming call)
@Index({ routingPhoneNumber: 1 }, { unique: true })

// Lookup by project
@Index({ projectId: 1 })
```

### IncomingCallPolicyEscalationRule

```typescript
// Get rules for a policy in order
@Index({ incomingCallPolicyId: 1, order: 1 })

// Lookup by project
@Index({ projectId: 1 })
```

### IncomingCallLog

```typescript
// Lookup by provider call ID (on status webhook)
@Index({ callProviderCallId: 1 })

// Lookup by policy (for logs page)
@Index({ incomingCallPolicyId: 1, createdAt: -1 })

// Lookup by project
@Index({ projectId: 1, createdAt: -1 })

// Count active calls (for concurrent call check)
@Index({ incomingCallPolicyId: 1, status: 1 })
```

### IncomingCallLogItem

```typescript
// Lookup by parent log
@Index({ incomingCallLogId: 1, createdAt: 1 })

// Lookup by project
@Index({ projectId: 1 })
```

### User (new index)

```typescript
// Lookup by incoming call phone number
@Index({ incomingCallPhoneNumber: 1 }, { sparse: true })
```

---