import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";

export type IncomingCallPolicyPhoneNumbersByPolicyId = Record<
  string,
  Array<IncomingCallPolicyPhoneNumber>
>;

export interface CompactPhoneNumberSummary {
  visiblePhoneNumbers: Array<string>;
  additionalPhoneNumbersCount: number;
}

export const getIncomingCallPolicyPhoneNumberText: (
  phoneNumber: IncomingCallPolicyPhoneNumber,
) => string = (phoneNumber: IncomingCallPolicyPhoneNumber): string => {
  return phoneNumber.phoneNumber?.toString() || "";
};

export const groupIncomingCallPolicyPhoneNumbers: (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
) => IncomingCallPolicyPhoneNumbersByPolicyId = (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
): IncomingCallPolicyPhoneNumbersByPolicyId => {
  const grouped: IncomingCallPolicyPhoneNumbersByPolicyId = {};

  for (const phoneNumber of phoneNumbers) {
    const policyId: string | undefined =
      phoneNumber.incomingCallPolicyId?.toString();

    if (!policyId) {
      continue;
    }

    if (!grouped[policyId]) {
      grouped[policyId] = [];
    }

    grouped[policyId]!.push(phoneNumber);
  }

  return grouped;
};

export const getCompactPhoneNumberSummary: (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
  maximumVisiblePhoneNumbers?: number,
) => CompactPhoneNumberSummary = (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
  maximumVisiblePhoneNumbers: number = 1,
): CompactPhoneNumberSummary => {
  const visibleLimit: number = Math.max(0, maximumVisiblePhoneNumbers);
  const phoneNumberTexts: Array<string> = phoneNumbers
    .map(getIncomingCallPolicyPhoneNumberText)
    .filter((phoneNumber: string): boolean => {
      return Boolean(phoneNumber);
    });

  return {
    visiblePhoneNumbers: phoneNumberTexts.slice(0, visibleLimit),
    additionalPhoneNumbersCount: Math.max(
      0,
      phoneNumberTexts.length - visibleLimit,
    ),
  };
};

/*
 * Keep a scalar-only legacy number visible (and releasable through the legacy
 * route) until the first additional-number mutation preserves it as a child.
 */
export const includeLegacyIncomingCallPolicyPhoneNumber: (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
  policy: IncomingCallPolicy,
) => Array<IncomingCallPolicyPhoneNumber> = (
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
  policy: IncomingCallPolicy,
): Array<IncomingCallPolicyPhoneNumber> => {
  if (!policy.routingPhoneNumber) {
    return phoneNumbers;
  }

  const legacyPhoneNumberText: string = policy.routingPhoneNumber.toString();
  const isAlreadyNormalized: boolean = phoneNumbers.some(
    (phoneNumber: IncomingCallPolicyPhoneNumber): boolean => {
      return (
        getIncomingCallPolicyPhoneNumberText(phoneNumber) ===
        legacyPhoneNumberText
      );
    },
  );

  if (isAlreadyNormalized) {
    return phoneNumbers;
  }

  const legacyPhoneNumber: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();

  if (policy.projectId) {
    legacyPhoneNumber.projectId = policy.projectId;
  }
  if (policy.id) {
    legacyPhoneNumber.incomingCallPolicyId = policy.id;
  }
  if (policy.projectCallSMSConfigId) {
    legacyPhoneNumber.projectCallSMSConfigId = policy.projectCallSMSConfigId;
  }

  legacyPhoneNumber.phoneNumber = policy.routingPhoneNumber;

  if (policy.callProviderPhoneNumberId !== undefined) {
    legacyPhoneNumber.callProviderPhoneNumberId =
      policy.callProviderPhoneNumberId;
  }
  if (policy.phoneNumberCountryCode !== undefined) {
    legacyPhoneNumber.countryCode = policy.phoneNumberCountryCode;
  }
  if (policy.phoneNumberAreaCode !== undefined) {
    legacyPhoneNumber.areaCode = policy.phoneNumberAreaCode;
  }
  if (policy.phoneNumberPurchasedAt !== undefined) {
    legacyPhoneNumber.phoneNumberPurchasedAt = policy.phoneNumberPurchasedAt;
  }

  return [legacyPhoneNumber, ...phoneNumbers];
};
