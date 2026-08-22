import crypto from "crypto";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Attribution, { UtmAttribution } from "Common/Server/Utils/Attribution";
import { EnterpriseSalesEmail } from "Common/Server/EnvironmentConfig";
import MailService from "Common/Server/Services/MailService";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import MarketingFormRateLimit, {
  MarketingFormRateLimitDecision,
  MarketingFormRateLimitOutcome,
} from "Common/Server/Middleware/MarketingFormRateLimit";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import logger from "Common/Server/Utils/Logger";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import Email from "Common/Types/Email";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";

/*
 * POST /api/enterprise-license-request — the enterprise half of the funnel.
 *
 * WHY THIS ENDPOINT EXISTS
 *
 * The enterprise path used to end at `mailto:enterprise@oneuptime.com`. A
 * mailto is unattributable by construction: no request reaches OneUptime, so
 * there is no click id, no campaign, no row, and no way to answer what an ad
 * spend produced at the one step of the funnel where the deals are. This is
 * the same moment expressed as a request the server can see.
 *
 * WHAT IT IS AND IS NOT
 *
 * It writes ONE MarketingConversion of type EnterpriseLicenseRequested and
 * emails the lead to sales. It does not create a contact, an account, a deal
 * or a pipeline stage — Revenue owns those, and a form submission is not
 * qualification. See Docs/analytics/enterprise-conversion-tracking.md.
 *
 * The name, company and message the person typed are emailed and deliberately
 * NOT stored on the conversion row: every column of that table is a candidate
 * for forwarding to an ad platform, and free-text from a prospect is not.
 *
 * TRUST
 *
 * Unauthenticated, like the Cal webhook — but unlike the Cal webhook there is
 * no signature to verify, because the caller is a browser and any secret it
 * held would be public. So everything the body carries is treated as hostile:
 * fields are whitelisted and length-bounded, attribution goes through the same
 * sanitisers the signup path uses, and the row's primary key is derived from
 * the email so a caller cannot inflate the ledger by resubmitting.
 */

const router: ExpressRouter = Express.getRouter();

/*
 * Namespace for the deterministic conversion id. Changing it re-keys every
 * future request, so requests already in the ledger would be insertable a
 * second time — never change it.
 */
const ENTERPRISE_REQUEST_SOURCE_NAMESPACE: string =
  "oneuptime/enterprise-license-request";

const MAX_NAME_LENGTH: number = 200;
const MAX_COMPANY_LENGTH: number = 200;
const MAX_MESSAGE_LENGTH: number = 4000;
// Matches the ShortText width of MarketingConversion.email.
const MAX_EMAIL_LENGTH: number = 100;

export interface EnterpriseLicenseRequestInput {
  email: string;
  name?: string | undefined;
  company?: string | undefined;
  message?: string | undefined;
  clickIds: JSONObject;
  utm: UtmAttribution;
  firstTouchAttribution?: JSONObject | undefined;
}

type ReadBoundedStringFunction = (
  value: JSONValue | undefined,
  maxLength: number,
) => string | undefined;

const readBoundedString: ReadBoundedStringFunction = (
  value: JSONValue | undefined,
  maxLength: number,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
};

type ObjectValueFunction = (value: JSONValue | undefined) => JSONObject;

const objectValue: ObjectValueFunction = (
  value: JSONValue | undefined,
): JSONObject => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
};

export type ParseEnterpriseLicenseRequestFunction = (
  body: JSONObject,
) => EnterpriseLicenseRequestInput | null;

/*
 * Null means the body is unusable — in practice, no valid email, which is the
 * one field without which neither the lead nor the conversion means anything.
 *
 * Attribution may arrive either nested (`{ utm: {...}, clickIds: {...} }`, what
 * the form posts) or flat alongside the contact fields, because a hand-rolled
 * integration will reasonably do the latter. Both are read; sanitisation is
 * identical either way.
 */
export const parseEnterpriseLicenseRequest: ParseEnterpriseLicenseRequestFunction =
  (body: JSONObject): EnterpriseLicenseRequestInput | null => {
    const email: string | undefined = readBoundedString(
      body["email"],
      MAX_EMAIL_LENGTH,
    )?.toLowerCase();

    if (!email || !Email.isValid(email)) {
      return null;
    }

    const clickIds: JSONObject =
      Attribution.sanitizeClickIds(body["clickIds"]) ||
      Attribution.sanitizeClickIds(body) ||
      {};

    const nestedUtm: UtmAttribution = Attribution.sanitizeUtm(body["utm"]);
    const utm: UtmAttribution =
      Object.keys(nestedUtm).length > 0
        ? nestedUtm
        : Attribution.sanitizeUtm(body);

    const firstTouchAttribution: JSONObject | undefined =
      Attribution.sanitizeFirstTouchAttribution(
        body["firstTouchAttribution"] ?? body["firstTouch"],
      );

    return {
      email: email,
      name: readBoundedString(body["name"], MAX_NAME_LENGTH),
      company: readBoundedString(body["company"], MAX_COMPANY_LENGTH),
      message: readBoundedString(body["message"], MAX_MESSAGE_LENGTH),
      clickIds: clickIds,
      utm: utm,
      ...(firstTouchAttribution
        ? { firstTouchAttribution: firstTouchAttribution }
        : {}),
    };
  };

export type GetEnterpriseLicenseRequestConversionIdFunction = (
  email: string,
) => ObjectID;

/*
 * A UUIDv5-shaped id derived from the normalised email, so resubmitting
 * resolves to the row that already exists.
 *
 * One person asking twice is one lead, not two conversions: counting the
 * second would inflate whatever the ad platforms are told, and the ledger's
 * job is to be the count. The same construction as the Cal webhook uses for
 * bookings — SHA-256 truncated to 16 bytes rather than RFC 4122's SHA-1, with
 * the version and variant nibbles set so the value is a well-formed UUID that
 * Postgres and ObjectID accept.
 */
export const getEnterpriseLicenseRequestConversionId: GetEnterpriseLicenseRequestConversionIdFunction =
  (email: string): ObjectID => {
    const normalized: string = Attribution.normalizeEmail(email) || "";

    const bytes: Buffer = crypto
      .createHash("sha256")
      .update(`${ENTERPRISE_REQUEST_SOURCE_NAMESPACE}:${normalized}`)
      .digest()
      .subarray(0, 16);

    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex: string = bytes.toString("hex");

    return new ObjectID(
      [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-"),
    );
  };

/*
 * The lead itself, to sales.
 *
 * Every caller-supplied value travels in `vars` and is referenced with a
 * Handlebars `{{ }}` expression, which HTML-escapes. Interpolating them into
 * the body string instead would hand a stranger both an HTML injection into
 * the sales inbox and a Handlebars template that the notification service
 * would then compile.
 */
type SendLeadEmailFunction = (
  input: EnterpriseLicenseRequestInput,
) => Promise<void>;

const sendLeadEmail: SendLeadEmailFunction = async (
  input: EnterpriseLicenseRequestInput,
): Promise<void> => {
  const vars: Dictionary<string> = {
    email: input.email,
    name: input.name || "(not given)",
    company: input.company || "(not given)",
    message: input.message || "(none)",
    utmSource: input.utm.utmSource || "(none)",
    utmMedium: input.utm.utmMedium || "(none)",
    utmCampaign: input.utm.utmCampaign || "(none)",
    landingUrl: input.utm.utmUrl || "(none)",
  };

  await MailService.sendMail({
    toEmail: new Email(EnterpriseSalesEmail),
    subject: `Enterprise licence request: ${
      input.company || input.email
    }`.slice(0, 200),
    vars: vars,
    body: [
      "<p>A new enterprise licence request came in.</p>",
      "<ul>",
      "<li><b>Name:</b> {{name}}</li>",
      "<li><b>Email:</b> {{email}}</li>",
      "<li><b>Company:</b> {{company}}</li>",
      "</ul>",
      "<p><b>Message</b></p>",
      "<p>{{message}}</p>",
      "<p><b>Attribution</b></p>",
      "<ul>",
      "<li><b>Source:</b> {{utmSource}}</li>",
      "<li><b>Medium:</b> {{utmMedium}}</li>",
      "<li><b>Campaign:</b> {{utmCampaign}}</li>",
      "<li><b>Landing URL:</b> {{landingUrl}}</li>",
      "</ul>",
    ].join("\n"),
  });
};

export type EnterpriseLicenseRequestRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

export const enterpriseLicenseRequestRouteHandler: EnterpriseLicenseRequestRouteHandler =
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const parsed: EnterpriseLicenseRequestInput | null =
        parseEnterpriseLicenseRequest(objectValue(req.body as JSONValue));

      if (!parsed) {
        res.status(400).json({ error: "A valid email address is required" });
        return;
      }

      const decision: MarketingFormRateLimitDecision =
        await MarketingFormRateLimit.consume({
          emailKey: MarketingFormRateLimit.resolveEmailKey(parsed.email),
          clientIp: MarketingFormRateLimit.resolveClientIp(req),
        });

      if (decision.outcome === MarketingFormRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }

        res.status(429).json({
          error:
            "Too many requests. Please try again shortly, or email us directly.",
        });
        return;
      }

      const conversionId: ObjectID = getEnterpriseLicenseRequestConversionId(
        parsed.email,
      );

      const existing: MarketingConversion | null =
        await MarketingConversionService.findOneById({
          id: conversionId,
          select: { _id: true },
          props: { isRoot: true },
        });

      let isDuplicate: boolean = Boolean(existing);

      if (!existing) {
        const conversion: MarketingConversion = new MarketingConversion();
        conversion.id = conversionId;
        conversion.conversionType =
          MarketingConversionType.EnterpriseLicenseRequested;
        conversion.conversionAt = new Date();
        conversion.email = parsed.email;
        conversion.clickIds = parsed.clickIds;

        const emailHash: string | null = Attribution.hashEmail(parsed.email);

        if (emailHash) {
          conversion.emailHash = emailHash;
        }

        conversion.utmSource = parsed.utm.utmSource;
        conversion.utmMedium = parsed.utm.utmMedium;
        conversion.utmCampaign = parsed.utm.utmCampaign;
        conversion.utmTerm = parsed.utm.utmTerm;
        conversion.utmContent = parsed.utm.utmContent;
        conversion.utmUrl = parsed.utm.utmUrl;
        conversion.firstTouchAttribution = parsed.firstTouchAttribution;

        try {
          await MarketingConversionService.create({
            data: conversion,
            props: { isRoot: true },
          });
        } catch (err) {
          /*
           * The read above and this insert are two statements, so two
           * concurrent submissions can both miss and both insert. The loser
           * collides on the derived primary key, which means the request IS
           * recorded — the whole point of deriving the key.
           */
          if (!PostgresErrorTranslator.isUniqueViolation(err)) {
            throw err;
          }

          isDuplicate = true;
        }
      }

      /*
       * The email is sent even for a duplicate submission. The ledger row is
       * the conversion and must not be counted twice; the message is how a
       * human hears about it, and someone resubmitting usually means the first
       * one was missed or something changed. The rate limiter is what bounds
       * this, not the duplicate check.
       *
       * It is also best-effort: a mail outage must not turn into a 500 that
       * loses the lead the ledger has already accepted.
       */
      try {
        await sendLeadEmail(parsed);
      } catch (err) {
        logger.error("Failed to email enterprise licence request to sales");
        logger.error(err);
      }

      res.status(200).json({ accepted: true, duplicate: isDuplicate });
    } catch (err) {
      return next(err);
    }
  };

router.post(
  "/enterprise-license-request",
  enterpriseLicenseRequestRouteHandler,
);

export default router;
