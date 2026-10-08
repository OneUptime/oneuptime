import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readDashboardSource(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length || 0;
}

const MANAGER_CODE: string = readDashboardSource(
  "Components",
  "CallSMS",
  "PhoneNumberPurchase.tsx",
);
const OVERVIEW_CODE: string = readDashboardSource(
  "Pages",
  "OnCallDuty",
  "IncomingCallPolicy",
  "Index.tsx",
);
const POLICIES_TABLE_CODE: string = readDashboardSource(
  "Pages",
  "OnCallDuty",
  "IncomingCallPolicies.tsx",
);
const LOGS_CODE: string = readDashboardSource(
  "Pages",
  "OnCallDuty",
  "IncomingCallPolicy",
  "Logs.tsx",
);

describe("the incoming-call phone-number manager", () => {
  test("accepts a list and one refresh callback instead of scalar state", () => {
    expect(MANAGER_CODE).toContain(
      "phoneNumbers: Array<IncomingCallPolicyPhoneNumber>",
    );
    expect(MANAGER_CODE).toContain("onPhoneNumbersChanged?: () => void");
    expect(MANAGER_CODE).not.toContain("currentPhoneNumber");
    expect(MANAGER_CODE).not.toContain("onPhoneNumberPurchased");
    expect(MANAGER_CODE).not.toContain("onPhoneNumberReleased");
  });

  test("renders zero, one, and many attached-number states from the array", () => {
    expect(MANAGER_CODE).toContain("props.phoneNumbers.length === 0");
    // One and many are the two forms of one translated plural sentence.
    expect(MANAGER_CODE).toMatch(
      /translatePlural\(\s*\{\s*one: "\{\{count\}\} phone number routes calls to this policy\.",\s*other: "\{\{count\}\} phone numbers route calls to this policy\.",\s*\},\s*props\.phoneNumbers\.length,\s*\)/,
    );
    expect(MANAGER_CODE).toContain("props.phoneNumbers.map(");
    expect(MANAGER_CODE).toContain("No Phone Numbers Configured");
    expect(MANAGER_CODE).toContain("phone numbers route calls to this policy");
  });

  /*
   * On the policy page the phone numbers are step 2 of 3. "Add Phone Number"
   * is the primary button while the policy has none - it is the next step -
   * and plain once it has one, when the next step is step 3's "Manage Rules".
   * Both used to be filled at once.
   */
  test("Add Phone Number is the primary step only while the policy has no number", () => {
    expect(MANAGER_CODE).toMatch(
      /title="Add Phone Number"\s*buttonStyle=\{\s*props\.phoneNumbers\.length === 0\s*\?\s*ButtonStyleType\.PRIMARY\s*:\s*ButtonStyleType\.NORMAL\s*\}/,
    );
    expect(OVERVIEW_CODE).toMatch(
      /title="Manage Rules"\s*buttonStyle=\{\s*hasEscalationRules\s*\?\s*ButtonStyleType\.SECONDARY_LINK\s*:\s*ButtonStyleType\.PRIMARY\s*\}/,
    );
  });

  test("a number to pick from a list is a plain button, and its confirmation the primary one", () => {
    expect(MANAGER_CODE).not.toContain("ButtonStyleType.SUCCESS");
    expect(MANAGER_CODE).toMatch(
      /title=\{isAlreadyAttached \? "Attached" : "Select"\}\s*buttonStyle=\{ButtonStyleType\.NORMAL\}/,
    );
    expect(MANAGER_CODE).toMatch(
      /title="Reserve"\s*buttonStyle=\{ButtonStyleType\.NORMAL\}/,
    );
    expect(MANAGER_CODE).toMatch(
      /submitButtonText="Reserve"\s*submitButtonType=\{ButtonStyleType\.PRIMARY\}/,
    );
    expect(MANAGER_CODE).toMatch(
      /submitButtonText="Assign Number"\s*submitButtonType=\{ButtonStyleType\.PRIMARY\}/,
    );
  });

  test("offers another addition even when numbers are already attached", () => {
    expect(MANAGER_CODE).toContain('title="Add Phone Number"');
    expect(MANAGER_CODE).toContain('title: "Add Phone Number"');
    expect(MANAGER_CODE).not.toMatch(
      /props\.phoneNumbers\.length === 0\s*&&\s*renderButtons/,
    );
  });

  test("releases a normalized child by id and an id-less legacy row through the policy route", () => {
    expect(MANAGER_CODE).toContain("setPhoneNumberToRelease(phoneNumber)");
    expect(MANAGER_CODE).toContain(
      "const phoneNumberId: ObjectID | null = selectedPhoneNumber.id",
    );
    expect(MANAGER_CODE).toContain(
      'phoneNumberId ? `/${phoneNumberId.toString()}` : ""',
    );
    expect(MANAGER_CODE).toContain(
      "`/phone-number/release/${props.incomingCallPolicyId.toString()}${",
    );
  });

  test("tenant-scopes every raw provider request with common headers", () => {
    const rawRequestCount: number = countMatches(
      MANAGER_CODE,
      /await API\.(?:post|delete)\(\{/g,
    );
    const commonHeaderCount: number = countMatches(
      MANAGER_CODE,
      /headers: ModelAPI\.getCommonHeaders\(\)/g,
    );

    expect(rawRequestCount).toBe(5);
    expect(commonHeaderCount).toBe(rawRequestCount);
  });

  test("refreshes the child list after purchase, assignment, and release", () => {
    expect(
      countMatches(MANAGER_CODE, /props\.onPhoneNumbersChanged\?\.\(\)/g),
    ).toBe(3);
  });

  test("prevents selecting the same owned provider number twice", () => {
    expect(MANAGER_CODE).toContain(
      "attachedPhoneNumber.callProviderPhoneNumberId ===",
    );
    expect(MANAGER_CODE).toContain("disabled={isAlreadyAttached}");
    expect(MANAGER_CODE).toContain("Already attached to this policy");
  });

  test("keeps row-level release controls available in both card modes", () => {
    expect(MANAGER_CODE).toContain(
      'data-testid="incoming-call-policy-phone-number-list"',
    );
    expect(MANAGER_CODE).toContain(
      'data-testid="incoming-call-policy-phone-number"',
    );
    expect(countMatches(MANAGER_CODE, /renderPhoneNumbers\(\)/g)).toBe(2);
  });

  test("keeps legacy rows visible without a config but disables both Add controls", () => {
    expect(MANAGER_CODE).toContain(
      "!props.projectCallSMSConfigId && props.phoneNumbers.length === 0",
    );
    /*
     * Both Add controls - the inline button and the card's - are disabled
     * without a config, and for someone the phone-number routes would
     * refuse (IncomingCallPhoneNumberLock), and say why through one helper.
     */
    expect(MANAGER_CODE).toContain(
      "disabled={!props.projectCallSMSConfigId || addLock.isLocked}",
    );
    expect(MANAGER_CODE).toContain(
      "disabled: !props.projectCallSMSConfigId || addLock.isLocked",
    );
    expect(countMatches(MANAGER_CODE, /getAddButtonTooltip\(\)/g)).toBe(2);
    expect(
      countMatches(
        MANAGER_CODE,
        /Link a Twilio configuration before adding another number\./g,
      ),
    ).toBe(1);
  });

  test("locks Release for someone who may not change the policy's numbers", () => {
    expect(MANAGER_CODE).toContain("disabled={releaseLock.isLocked}");
    expect(MANAGER_CODE).toContain("tooltip={releaseLock.tooltip}");
  });
});

describe("the incoming-call policy overview", () => {
  test("fetches child records alongside policy and rule data", () => {
    expect(OVERVIEW_CODE).toContain(
      "ModelAPI.getList<IncomingCallPolicyPhoneNumber>({",
    );
    expect(OVERVIEW_CODE).toContain("incomingCallPolicyId: modelId");
    expect(OVERVIEW_CODE).toContain("projectId: projectId");
    expect(OVERVIEW_CODE).toContain("phoneNumberPurchasedAt: true");
    expect(OVERVIEW_CODE).toContain("await Promise.all([");
  });

  test("selects every legacy scalar and merges it with detail child rows", () => {
    for (const field of [
      "routingPhoneNumber",
      "callProviderPhoneNumberId",
      "phoneNumberCountryCode",
      "phoneNumberAreaCode",
      "phoneNumberPurchasedAt",
    ]) {
      expect(OVERVIEW_CODE).toContain(`${field}: true`);
    }
    expect(OVERVIEW_CODE).toContain(
      "includeLegacyIncomingCallPolicyPhoneNumber(",
    );
    expect(OVERVIEW_CODE).toContain("fetchedPhoneNumbers.data");
    expect(OVERVIEW_CODE).toContain("fetchedPolicy");
  });

  test("derives setup completion from one-or-more child rows", () => {
    expect(OVERVIEW_CODE).toContain(
      "const hasPhoneNumbers: boolean = phoneNumbers.length > 0",
    );
    expect(OVERVIEW_CODE).toContain(
      "hasTwilioConfig && hasPhoneNumbers && hasEscalationRules",
    );
    expect(OVERVIEW_CODE).not.toContain("policy?.routingPhoneNumber");
  });

  test("passes the full list and unified refresh callback to both setup modes", () => {
    expect(countMatches(OVERVIEW_CODE, /phoneNumbers=\{phoneNumbers\}/g)).toBe(
      2,
    );
    expect(
      countMatches(
        OVERVIEW_CODE,
        /onPhoneNumbersChanged=\{handlePhoneNumberChange\}/g,
      ),
    ).toBe(2);
  });

  test("blocks Twilio configuration changes while any number exists", () => {
    expect(OVERVIEW_CODE).toContain("hasPhoneNumbers ? (");
    expect(
      countMatches(OVERVIEW_CODE, /Remove all phone numbers to change/g),
    ).toBe(2);
  });

  test("uses plural phone-number labels in the completed state", () => {
    expect(OVERVIEW_CODE).toContain("Phone Numbers & Twilio Configuration");
    expect(OVERVIEW_CODE).toContain("{/* Phone Numbers Row */}");
  });
});

describe("the incoming-call policies table", () => {
  test("fetches phone numbers once for the visible policy batch", () => {
    expect(POLICIES_TABLE_CODE).toContain(
      "incomingCallPolicyId: new Includes(policyIds)",
    );
    expect(
      countMatches(
        POLICIES_TABLE_CODE,
        /ModelAPI\.getList<IncomingCallPolicyPhoneNumber>/g,
      ),
    ).toBe(1);
    expect(POLICIES_TABLE_CODE).toContain(
      "void fetchPhoneNumbersForPolicies(data)",
    );
  });

  test("groups the batch result by policy for constant-time cell rendering", () => {
    expect(POLICIES_TABLE_CODE).toContain(
      "groupIncomingCallPolicyPhoneNumbers(result.data)",
    );
    expect(POLICIES_TABLE_CODE).toContain(
      "phoneNumbersByPolicyId[policyId] || []",
    );
  });

  test("shows the first number with a compact overflow count", () => {
    expect(POLICIES_TABLE_CODE).toContain(
      "getCompactPhoneNumberSummary(phoneNumbers)",
    );
    // "+2 more" is one translated sentence, filled with the overflow count.
    expect(POLICIES_TABLE_CODE).toMatch(
      /translatePlural\(\s*\{\s*one: "\+\{\{count\}\} more",\s*other: "\+\{\{count\}\} more",?\s*\},\s*summary\.additionalPhoneNumbersCount,?\s*\)/,
    );
    expect(POLICIES_TABLE_CODE).toContain('title: "Phone Numbers"');
  });

  test("selects and merges legacy scalar rows for every visible policy", () => {
    for (const field of [
      "routingPhoneNumber",
      "callProviderPhoneNumberId",
      "phoneNumberCountryCode",
      "phoneNumberAreaCode",
      "phoneNumberPurchasedAt",
    ]) {
      expect(POLICIES_TABLE_CODE).toContain(`${field}: true`);
    }
    expect(POLICIES_TABLE_CODE).toContain("for (const policy of policies)");
    expect(POLICIES_TABLE_CODE).toContain(
      "includeLegacyIncomingCallPolicyPhoneNumber(",
    );
    expect(POLICIES_TABLE_CODE).toContain(
      "groupedPhoneNumbers[policyId] || []",
    );
  });

  test("ignores stale batch responses after the visible page changes", () => {
    expect(POLICIES_TABLE_CODE).toContain(
      "requestId !== phoneNumberRequestId.current",
    );
  });

  test("exports the numbers themselves and does not sort by the ids it selects", () => {
    /*
     * The cell renders from a second request, so the ids this column declares
     * are plumbing: the CSV must not export them and the header must not
     * offer to sort by them.
     */
    expect(POLICIES_TABLE_CODE).toContain("disableSort: true");
    expect(POLICIES_TABLE_CODE).toContain(
      "getExportValue: (item: IncomingCallPolicy): string =>",
    );
    expect(POLICIES_TABLE_CODE).toContain('phoneNumberTexts.join("; ")');
  });

  test("falls back to the legacy scalar while the batch is loading or failed", () => {
    expect(POLICIES_TABLE_CODE).toContain(
      "(isLoadingPhoneNumbers || phoneNumbersError) &&",
    );
    expect(POLICIES_TABLE_CODE).toContain("if (legacyPhoneNumber) {");
  });
});

describe("incoming-call logs", () => {
  test("shows and filters by the actual number called", () => {
    expect(countMatches(LOGS_CODE, /routingPhoneNumber: true/g)).toBe(2);
    expect(countMatches(LOGS_CODE, /title: "Number Called"/g)).toBe(2);
  });

  test("keeps the caller number separate from the routing number", () => {
    expect(countMatches(LOGS_CODE, /callerPhoneNumber: true/g)).toBe(2);
    expect(LOGS_CODE).toContain('title: "Caller"');
    expect(LOGS_CODE).toContain('title: "Caller Phone"');
  });
});
