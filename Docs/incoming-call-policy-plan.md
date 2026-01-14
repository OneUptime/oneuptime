# Incoming Call Policy Feature - Implementation Plan

## Overview

Create a standalone **Incoming Call Policy** that handles incoming calls to a Twilio phone number. The policy has its own escalation rules where each rule can route to either an On-Call Schedule OR a specific User (never both).

**Use Case:** Instead of giving customers multiple phone numbers for different on-call engineers, provide a single phone number. When called, OneUptime automatically routes the call to whoever is currently on-call, with automatic escalation if unanswered.

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
| `routingPhoneNumber` | Phone | Twilio number for incoming calls |
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
| `twilioCallSid` | ShortText | Twilio call identifier |
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

## API Endpoints

### Twilio Webhook Endpoints

**File:** `/App/FeatureSet/Notification/API/IncomingCall.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/incoming-call/voice/:policyId` | POST | Handle incoming calls from Twilio |
| `/incoming-call/dial-status/:logId` | POST | Handle dial completion/no-answer callbacks |
| `/incoming-call/call-complete/:logId` | POST | Final call completion callback |

### Admin CRUD Endpoints

Auto-generated via model decorators:

**IncomingCallPolicy:**
- `POST /incoming-call-policy` - Create policy
- `GET /incoming-call-policy/:id` - Get policy
- `PUT /incoming-call-policy/:id` - Update policy
- `DELETE /incoming-call-policy/:id` - Delete policy
- `GET /incoming-call-policy` - List policies

**IncomingCallPolicyEscalationRule:**
- `POST /incoming-call-policy-escalation-rule` - Create rule
- `GET /incoming-call-policy-escalation-rule/:id` - Get rule
- `PUT /incoming-call-policy-escalation-rule/:id` - Update rule
- `DELETE /incoming-call-policy-escalation-rule/:id` - Delete rule

---

## Services

### 1. IncomingCallService

Core routing logic for handling incoming calls.

**File:** `/App/FeatureSet/Notification/Services/IncomingCallService.ts`

```typescript
class IncomingCallService {
  // Look up policy by Twilio phone number
  getIncomingCallPolicyByPhoneNumber(phone: Phone): Promise<IncomingCallPolicy | null>

  // Get user phone for an escalation rule
  // If rule has scheduleId -> get current on-call user from schedule
  // If rule has userId -> get that user's phone directly
  getUserPhoneForEscalationRule(rule: IncomingCallPolicyEscalationRule): Promise<{user: User, phone: Phone} | null>

  // Generate TwiML for incoming call (greeting + first dial)
  generateIncomingCallTwiml(policy: IncomingCallPolicy, userPhone: Phone, logId: ObjectID, ruleId: ObjectID): string

  // Generate TwiML for escalation (message + next dial)
  generateEscalationTwiml(policy: IncomingCallPolicy, userPhone: Phone, logId: ObjectID, ruleId: ObjectID): string

  // Generate TwiML for no users available
  generateNoAnswerTwiml(policy: IncomingCallPolicy): string

  // Handle dial status and return next action
  handleDialStatus(logId: ObjectID, dialStatus: string): Promise<{twiml: string, completed: boolean}>

  // Get next escalation rule in order
  getNextEscalationRule(policyId: ObjectID, currentOrder: number): Promise<IncomingCallPolicyEscalationRule | null>
}
```

### 2. IncomingCallPolicyService

**File:** `/Common/Server/Services/IncomingCallPolicyService.ts`

Standard DatabaseService with:
- Phone number uniqueness validation per project
- `getByPhoneNumber(phone)` helper method

### 3. IncomingCallPolicyEscalationRuleService

**File:** `/Common/Server/Services/IncomingCallPolicyEscalationRuleService.ts`

Standard DatabaseService with:
- **Validation:** Ensure exactly one of `onCallDutyPolicyScheduleId` or `userId` is set
- Order management helpers

### 4. IncomingCallLogService

**File:** `/Common/Server/Services/IncomingCallLogService.ts`

Standard DatabaseService with logging helpers.

### 5. IncomingCallLogItemService

**File:** `/Common/Server/Services/IncomingCallLogItemService.ts`

Standard DatabaseService for individual escalation attempt logs.

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
│  "Please wait while we..."   │
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
│  <Dial timeout="30">         │
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
        engineer..."     Message
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

## Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `/Common/Models/DatabaseModels/IncomingCallPolicy.ts` | Main policy model |
| `/Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule.ts` | Escalation rules model |
| `/Common/Models/DatabaseModels/IncomingCallLog.ts` | Parent call log model |
| `/Common/Models/DatabaseModels/IncomingCallLogItem.ts` | Child log for each escalation attempt |
| `/Common/Types/IncomingCall/IncomingCallStatus.ts` | Status enum |
| `/Common/Server/Services/IncomingCallPolicyService.ts` | Policy service |
| `/Common/Server/Services/IncomingCallPolicyEscalationRuleService.ts` | Escalation service |
| `/Common/Server/Services/IncomingCallLogService.ts` | Parent log service |
| `/Common/Server/Services/IncomingCallLogItemService.ts` | Child log item service |
| `/App/FeatureSet/Notification/Services/IncomingCallService.ts` | Core routing logic |
| `/App/FeatureSet/Notification/API/IncomingCall.ts` | Webhook endpoints |
| `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx` | List page |
| `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/View.tsx` | View page |
| `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/EscalationRules.tsx` | Rules page |
| `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx` | Logs page |
| `/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/SideMenu.tsx` | Policy sub-menu |

### Files to Modify

| File | Changes |
|------|---------|
| `/Common/Types/Permission.ts` | Add incoming call policy permissions |
| `/App/FeatureSet/Notification/Index.ts` | Register IncomingCall API |
| `/Dashboard/src/Pages/OnCallDuty/SideMenu.tsx` | Add "Incoming Call Policy" under Advanced section |
| `/Dashboard/src/Utils/PageMap.ts` | Add page entries |
| `/Dashboard/src/Utils/RouteMap.ts` | Add route entries |
| `/Common/Models/DatabaseModels/Index.ts` | Export new models |

---

## Billing

### Cost Components

Twilio charges for two things:
1. **Phone Number** - Monthly fee (~$1-2/month per number)
2. **Call Minutes** - Per-minute charges for:
   - Incoming leg (caller → OneUptime Twilio number)
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

Options for handling phone number fees:

**Option A: Include in Platform Fee**
- OneUptime absorbs phone number cost
- Simpler for customers

**Option B: Pass-through Cost**
- Add `phoneNumberMonthlyCostInUSDCents` field to `IncomingCallPolicy`
- Charge monthly via existing Stripe billing
- Create scheduled job to bill monthly

**Recommendation:** Start with Option A (include in platform fee) for simplicity. Can add pass-through later if needed.

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

### UI: Balance Display

Add to existing **Project Settings → Billing** page:
- Show balance usage breakdown (SMS vs Calls vs Incoming Call Routing)
- No new UI needed - uses existing balance display

---

## Comparison with OnCallDutyPolicy

| Aspect | OnCallDutyPolicy | IncomingCallPolicy |
|--------|------------------|-------------------|
| Purpose | Alert notifications (SMS, Email, Call) | Incoming call routing only |
| Escalation Target | Schedule + Team + User (all three) | Schedule OR User (one only) |
| Trigger | Incident/Alert created | Incoming phone call |
| Time Unit | Minutes | Seconds |
| Repeat Logic | Based on acknowledgment | Based on call answer |

---

## Testing Plan

### Unit Tests
- Test escalation rule validation (either schedule or user, not both)
- Test TwiML generation
- Test user phone lookup for both schedule and direct user

### Integration Tests
- Mock Twilio webhooks
- Test full routing flow with schedule target
- Test full routing flow with user target
- Test escalation through multiple rules

### Manual Testing
1. Create policy with routing number
2. Add escalation rule with schedule
3. Add escalation rule with specific user
4. Make test call and verify routing
5. Test escalation by not answering
6. Verify logs are recorded
