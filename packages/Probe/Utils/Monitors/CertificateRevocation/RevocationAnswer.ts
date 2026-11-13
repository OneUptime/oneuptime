/*
 * What one source (a stapled OCSP response, an OCSP responder, a CRL) said
 * about one certificate. Either a signed, current answer from the issuer, or
 * the reason there is none - which is never read as "revoked".
 */
export interface SignedRevocationAnswer {
  isAnswer: true;
  isRevoked: boolean;
  revokedAt?: Date | undefined;
  // In words: "Key Compromise", "Superseded", ...
  reason?: string | undefined;
  // When the issuer will publish newer information, if it said.
  nextUpdate?: Date | undefined;
}

export interface NoRevocationAnswer {
  isAnswer: false;
  // Why there is no answer, written to follow the source's name.
  problem: string;
}

export type RevocationAnswer = SignedRevocationAnswer | NoRevocationAnswer;

/*
 * Clock difference allowed between the probe and the issuer, either way, when
 * judging whether an answer is current. Generous on purpose: a probe whose
 * clock is a few minutes off should not lose every answer.
 */
export const ALLOWED_CLOCK_SKEW_IN_MS: number = 5 * 60 * 1000;

/*
 * How old an answer that names no next update may be. RFC 5019 lets an OCSP
 * responder leave nextUpdate out; a week is the longest validity public CAs
 * give their responses.
 */
export const MAX_AGE_WITHOUT_NEXT_UPDATE_IN_MS: number =
  7 * 24 * 60 * 60 * 1000;

// CRLReason (RFC 5280 section 5.3.1), in words.
const REVOCATION_REASONS: Readonly<Record<number, string>> = {
  0: "Unspecified",
  1: "Key Compromise",
  2: "CA Compromise",
  3: "Affiliation Changed",
  4: "Superseded",
  5: "Cessation Of Operation",
  6: "Certificate Hold",
  8: "Remove From CRL",
  9: "Privilege Withdrawn",
  10: "AA Compromise",
};

export const CRL_REASON_REMOVE_FROM_CRL: number = 8;

export default class RevocationAnswerUtil {
  public static noAnswer(problem: string): NoRevocationAnswer {
    return { isAnswer: false, problem: problem };
  }

  public static reasonName(reasonCode: number | undefined): string | undefined {
    if (reasonCode === undefined) {
      return undefined;
    }

    return REVOCATION_REASONS[reasonCode] || `Reason ${reasonCode}`;
  }

  /*
   * Whether an answer issued at thisUpdate, valid until nextUpdate, can be
   * relied on now. Returns the problem when it cannot.
   */
  public static checkCurrent(data: {
    thisUpdate: Date;
    nextUpdate?: Date | undefined;
    now: Date;
  }): string | null {
    const now: number = data.now.getTime();

    if (data.thisUpdate.getTime() > now + ALLOWED_CLOCK_SKEW_IN_MS) {
      return "is dated in the future";
    }

    if (data.nextUpdate) {
      if (data.nextUpdate.getTime() + ALLOWED_CLOCK_SKEW_IN_MS < now) {
        return `is out of date (its next update was due ${data.nextUpdate.toISOString()})`;
      }

      return null;
    }

    if (data.thisUpdate.getTime() + MAX_AGE_WITHOUT_NEXT_UPDATE_IN_MS < now) {
      return `is out of date (issued ${data.thisUpdate.toISOString()})`;
    }

    return null;
  }
}
