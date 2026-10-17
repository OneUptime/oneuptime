import { VerifiedSamlResponse } from "./SSO";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import ObjectID from "Common/Types/ObjectID";
import crypto from "crypto";

/*
 * ---------------------------------------------------------------------------
 * A SAML ASSERTION SIGNS SOMEONE IN ONCE.
 *
 * A signed SAML response is a bearer credential, so SAML 2.0 Profiles 4.1.4.5
 * has the service provider remember the assertions it has used, for as long
 * as each could still be accepted, and refuse them a second time. Without
 * that, a response kept from any sign-in - from the browser's history, a
 * proxy, an extension, or simply by its owner - signs its holder in again
 * for as long as it is valid.
 *
 * SSOUtil.getSamlResponseFromXML has already checked the response: signed by
 * the provider's identity provider, made for this provider, inside its time.
 * `claim` is the last step before anything is created or signed in. It
 * records the assertion's ID in the cache shared by every app server - Redis
 * SET NX, so of two posts of the same response arriving together exactly one
 * gets through - until the assertion's own time is up, after which the time
 * rules refuse it without help.
 *
 * Each provider remembers its own assertions: the key names the provider, so
 * one provider's identity provider cannot use up IDs another provider's will
 * send.
 *
 * If the cache cannot be reached, nobody is signed in with SAML until it can:
 * this is part of checking who someone is, and letting responses through
 * unremembered would quietly turn the check off. Other ways of signing in are
 * unaffected.
 * ---------------------------------------------------------------------------
 */

export enum SamlProviderKind {
  ProjectSso = "project-sso",
  StatusPageSso = "status-page-sso",
  GlobalSso = "global-sso",
}

export const SAML_RESPONSE_ALREADY_USED_MESSAGE: string =
  "SAML response was already used. Sign in again.";

export const SAML_SIGN_IN_UNAVAILABLE_MESSAGE: string =
  "SAML sign-in is unavailable right now. Please try again in a minute.";

export default class SamlAssertionOneTimeUse {
  public static readonly CACHE_NAMESPACE: string = "saml-assertion-used";

  /*
   * Kept this much longer than the assertion's own time. Every app server
   * checks that time by its own clock, and they need not agree to the second:
   * this covers a server whose clock is behind the one that recorded the use.
   */
  public static readonly CLOCK_MARGIN_IN_SECONDS: number = 3 * 60;

  // Where a provider's used assertion is remembered.
  public static getCacheKey(data: {
    providerKind: SamlProviderKind;
    providerId: ObjectID | string;
    assertionId: string;
  }): string {
    const assertionIdHash: string = crypto
      .createHash("sha256")
      .update(data.assertionId, "utf8")
      .digest("hex");

    return `${data.providerKind}:${data.providerId
      .toString()
      .toLowerCase()}:${assertionIdHash}`;
  }

  /*
   * Records this provider's use of the assertion. Returns when this is its
   * first use; throws BadRequestException when it was used before, and
   * ServiceUnavailableException when the cache cannot be reached.
   */
  public static async claim(data: {
    providerKind: SamlProviderKind;
    providerId: ObjectID | string;
    assertion: VerifiedSamlResponse;
    now?: Date | undefined;
  }): Promise<void> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const secondsLeft: number = Math.ceil(
      (data.assertion.acceptableUntil.getTime() - now.getTime()) / 1000,
    );

    const expiresInSeconds: number =
      Math.max(secondsLeft, 0) +
      SamlAssertionOneTimeUse.CLOCK_MARGIN_IN_SECONDS;

    let isFirstUse: boolean;

    try {
      isFirstUse = await GlobalCache.setStringIfNotExists(
        SamlAssertionOneTimeUse.CACHE_NAMESPACE,
        SamlAssertionOneTimeUse.getCacheKey({
          providerKind: data.providerKind,
          providerId: data.providerId,
          assertionId: data.assertion.assertionId,
        }),
        now.toISOString(),
        { expiresInSeconds },
      );
    } catch (err) {
      logger.error(
        "SAML sign-in refused: used assertions cannot be remembered while the cache is unavailable.",
      );
      logger.error(err);

      throw new ServiceUnavailableException(SAML_SIGN_IN_UNAVAILABLE_MESSAGE);
    }

    if (!isFirstUse) {
      throw new BadRequestException(SAML_RESPONSE_ALREADY_USED_MESSAGE);
    }
  }
}
