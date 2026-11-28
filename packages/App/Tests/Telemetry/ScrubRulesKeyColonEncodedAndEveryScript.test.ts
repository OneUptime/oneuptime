import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import SessionReplayScrubService, {
  CompiledScrubRule,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import {
  buildScrubPatternForDataType,
  CoveringScrubRule,
  isFindingScrubbed,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import {
  findSensitiveValues,
  TextMatch,
} from "Common/Utils/DataSecurity/TextScanner";
import { maskKeepingEnds } from "Common/Utils/Telemetry/ScrubMask";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SCRUB RULES HIDE WHAT DATA SECURITY NOW FINDS, WHEREVER THEY RUN.
 *
 *   - an IPv6 address right after a key's colon, as logfmt and syslog
 *     lines write one (peer ip:2a00:..., remote:2606:..., #10936), by an
 *     IP Address rule - the address alone, not the key's last letters;
 *   - an email address in a percent-encoded URL
 *     (/signup?email=jane.doe%40acmecorp.io, #10935) and one in any script
 *     (张伟@acmecorp.io, почта@пример.рф, #10960), by an Email Address rule
 *     - the encoded address as written, and the rest of the URL kept;
 *   - a card in fullwidth, Arabic-Indic or Persian digits, or typed in two
 *     scripts (#10960), by a Credit Card rule;
 *   - an international phone number in the groups people write it in - its
 *     calling code in parentheses, its trunk prefix, no-break spaces - one
 *     in a percent-encoded URL, and one in another script's digits (#11025,
 *     #11030), by a Phone Number rule; and a Social Security number set
 *     apart by dots or in another script's digits, by an SSN rule;
 *   - a phone number, a Social Security number, a card or a CPF typed
 *     wholly in fullwidth, its plus sign, hyphens, parentheses, full stops
 *     and ideographic spaces too (#11115), and a national phone number or
 *     nine digits in a row beside the word that names them in the same
 *     value (#11114), by the rule of their type - and what no word names,
 *     or is no number, kept.
 *
 * Every place a rule runs compiles its pattern in one place
 * (Common/Utils/Telemetry/ScrubBuiltInPatterns, on Data Security's own
 * detectors through TextReadings.findDetectorRanges), so each change
 * reaches each place, and these tests read each one under Redact, Mask and
 * Hash - Hash giving the token of the value written plainly: logs (body,
 * attributes, lists, JSON texts), spans (name, status message, attributes,
 * events, links), exceptions, AI calls, session replays, and OTLP ingest.
 * Data Security's coverage of each is true: the rule leaves no finding.
 * Metrics: DataSecurityMetricScrubRuleIngest.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10935",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10960",
);
const SERVICE_NAME: string = "checkout-api";
const IPV6_MASK: string = "****:****:****:****:****:****:****:****";

// A value as it is written, what reads before it, what its token is made of, and its mask.
interface Written {
  label: string;
  patternType: string;
  dataTypeId: string;
  before: string;
  written: string;
  reads: string;
  mask: string;
  // A Custom Regex rule's pattern: the one "Scrub it" makes for the type (#11031, #11033).
  customRegex?: string | undefined;
}

// The Custom Regex rule "Scrub it" makes for a data type, from its own patterns.
function scrubItPatternOf(dataTypeId: string): string {
  const pattern: string | null = buildScrubPatternForDataType(dataTypeId);

  expect(pattern).not.toBeNull();

  return pattern!;
}

// A made-up GitHub token, put together where it is used.
const GITHUB_TOKEN: string = [
  "ghp",
  "Zx8Kq2Lm9Pw4Rt6Hy3Nc8Vb5Jm1Df7Gs0AeQ",
].join("_");

// Made-up numbers each check digit proves: an IBAN, a CPF, a TC Kimlik number.
const IBAN: string = "DE47370400440532013077";
const CPF: string = "471.392.865-82";
const TCKN: string = "17492638550";

// A digit string written in the digits of the script whose zero is given.
function inScriptOf(digits: string, zero: number): string {
  return digits.replace(/[0-9]/g, (digit: string): string => {
    return String.fromCharCode(zero + Number(digit));
  });
}

const WRITTEN: Array<Written> = [
  {
    label: "an IPv6 address right after a key's colon",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "peer ip:",
    written: "2a00:1450:4001:82a::200e",
    reads: "2a00:1450:4001:82a::200e",
    mask: IPV6_MASK,
  },
  {
    label: "one after a key that ends in a hex letter",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "remote:",
    written: "2606:4700:4700::1111",
    reads: "2606:4700:4700::1111",
    mask: IPV6_MASK,
  },
  {
    label: "one after a key that ends in a digit",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "ip6:",
    written: "2a02:6b8::feed:0ff",
    reads: "2a02:6b8::feed:0ff",
    mask: IPV6_MASK,
  },
  {
    label: "an email address in a percent-encoded URL",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /signup?email=",
    written: "jane.doe%40acmecorp.io",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "one with its plus sign encoded too",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "next=/welcome?to=",
    written: "jane%2Bnews%40acmecorp.io",
    reads: "jane+news@acmecorp.io",
    mask: "j***@***.io",
  },
  // #11032
  {
    label: "an email address whose accented name's bytes are percent-encoded",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /signup?email=",
    written: "jos%C3%A9%40acmecorp.io",
    reads: "josé@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "an email address whose domain in another script is percent-encoded",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /verify?address=",
    written: "jane%40%E4%BE%8B%E3%81%88.jp",
    reads: "jane@例え.jp",
    mask: "j***@***.jp",
  },
  {
    label: "an email address in Han letters",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "invite sent to ",
    written: "张伟@acmecorp.io",
    reads: "张伟@acmecorp.io",
    mask: "张***@***.io",
  },
  {
    label: "an email address in Cyrillic, its domain too",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "invite sent to ",
    written: "почта@пример.рф",
    reads: "почта@пример.рф",
    mask: "п***@***.рф",
  },
  {
    label: "a card in fullwidth digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "card ",
    written: "４５３２ ０１５１ １２８３ ０３６６",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in Arabic-Indic digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "رقم البطاقة ",
    written: "٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
    reads: "4532015112830366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in Persian digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "شماره کارت ",
    written: "۴۵۳۲-۰۱۵۱-۱۲۸۳-۰۳۶۶",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card typed in two scripts",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "card ",
    written: "４５３２ 0151 1283 0366",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  // #11025, #11030
  {
    label: "an international phone number",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "SMS to ",
    written: "+49 30 81234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "one the US pattern only half hid",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "SMS to ",
    written: "+44 161 321 4567",
    reads: "+44 161 321 4567",
    mask: "***-***-4567",
  },
  {
    label: "one with its calling code in parentheses and its trunk prefix",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "call ",
    written: "+44 (0)20 8123 4567",
    reads: "+44 (0)20 8123 4567",
    mask: "***-***-4567",
  },
  {
    label: "one set apart by no-break spaces",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "call ",
    written: "+33\u00A06\u00A081\u00A023\u00A045\u00A067",
    reads: "+33\u00A06\u00A081\u00A023\u00A045\u00A067",
    mask: "***-***-4567",
  },
  {
    label: "a phone number in a percent-encoded URL",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: "%2B49%2030%2081234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a phone number in Arabic-Indic digits",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "رقم الهاتف ",
    written: "+٤٩ ٣٠ ٨١٢٣٤٥٦٧",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  // #11032: each fullwidth digit's UTF-8 bytes percent-encoded.
  {
    label: "a phone number in fullwidth digits, percent-encoded",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: encodeURIComponent("+４９ ３０ ８１２３４５６７"),
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a North American number in fullwidth digits",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "(４１５) ３２１-８７３１",
    reads: "(415) 321-8731",
    mask: "***-***-8731",
  },
  {
    label: "a Social Security number set apart by dots",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "ssn ",
    written: "536.22.8731",
    reads: "536.22.8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number in Arabic-Indic digits",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN: ",
    written: "٥٣٦-٢٢-٨٧٣١",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  // #11031: Scrub It's Custom Regex rule for a token reads a value's escapes.
  {
    label: "a GitHub token after an encoded = (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "github-token",
    before: "GET /cb?next=%2Fhome%3Ftoken%3D",
    written: GITHUB_TOKEN,
    reads: GITHUB_TOKEN,
    mask: maskKeepingEnds(GITHUB_TOKEN),
    customRegex: scrubItPatternOf("github-token"),
  },
  {
    label: "a GitHub token whose own _ is escaped (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "github-token",
    before: "GET /cb?state=",
    written: GITHUB_TOKEN.replace(/_/g, "%5F"),
    reads: GITHUB_TOKEN,
    mask: maskKeepingEnds(GITHUB_TOKEN),
    customRegex: scrubItPatternOf("github-token"),
  },
  // #11033: and every script's digits, for an IBAN or a national ID number.
  {
    label: "an IBAN in Arabic-Indic digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "iban",
    before: "IBAN ",
    written: inScriptOf(IBAN, 0x0660),
    reads: IBAN,
    mask: maskKeepingEnds(IBAN),
    customRegex: scrubItPatternOf("iban"),
  },
  {
    label: "a CPF in fullwidth digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "br-cpf",
    before: "CPF ",
    written: inScriptOf(CPF, 0xff10),
    reads: CPF,
    mask: maskKeepingEnds(CPF),
    customRegex: scrubItPatternOf("br-cpf"),
  },
  {
    label: "a TC Kimlik number in Persian digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "tr-tckn",
    before: "TC Kimlik No ",
    written: inScriptOf(TCKN, 0x06f0),
    reads: TCKN,
    mask: maskKeepingEnds(TCKN),
    customRegex: scrubItPatternOf("tr-tckn"),
  },
  /*
   * #11199: a value written in groups, in a URL - its groups apart by an
   * escaped space, by the "+" a form writes a space as, or by that "+"
   * escaped again in a URL inside a query string - hidden whole, as it is
   * written, and masked and hashed as the value written plainly.
   */
  {
    label: "a card in a URL with %20 between its groups",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "GET /pay?card=",
    written: "4532%200151%201283%200366",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card typed into a form, + between its groups",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "GET /pay?card=",
    written: "4532+0151+1283+0366",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in a URL inside a query string, its +s escaped",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "GET /login?next=%2Fpay%3Fcard%3D",
    written: "4532%2B0151%2B1283%2B0366",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in Arabic-Indic digits typed into a form",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "GET /pay?card=",
    written: "٤٥٣٢+٠١٥١+١٢٨٣+٠٣٦٦",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a phone number a form wrote, its own + escaped",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: "%2B49+30+81234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a phone number a form wrote, its own + as it is",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: "+49+30+81234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a Social Security number with %20 between its groups",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "GET /verify?ssn=",
    written: "536%2022%208731",
    reads: "536 22 8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number typed into a form",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "GET /verify?ssn=",
    written: "536+22+8731",
    reads: "536 22 8731",
    mask: "***-**-8731",
  },
  {
    label: "an IBAN with %20 between its groups (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "iban",
    before: "GET /payout?iban=",
    written: "DE47%203704%200044%200532%200130%2077",
    reads: "DE47 3704 0044 0532 0130 77",
    mask: maskKeepingEnds("DE47 3704 0044 0532 0130 77"),
    customRegex: scrubItPatternOf("iban"),
  },
  {
    label: "an IBAN typed into a form (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "iban",
    before: "GET /payout?iban=",
    written: "DE47+3704+0044+0532+0130+77",
    reads: "DE47 3704 0044 0532 0130 77",
    mask: maskKeepingEnds("DE47 3704 0044 0532 0130 77"),
    customRegex: scrubItPatternOf("iban"),
  },
  {
    label: "an IBAN in a URL inside a query string (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "iban",
    before: "GET /login?next=%2Fpayout%3Fiban%3D",
    written: "DE47%2B3704%2B0044%2B0532%2B0130%2B77",
    reads: "DE47 3704 0044 0532 0130 77",
    mask: maskKeepingEnds("DE47 3704 0044 0532 0130 77"),
    customRegex: scrubItPatternOf("iban"),
  },
  {
    label: "an Aadhaar number typed into a form (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "in-aadhaar",
    before: "GET /kyc?aadhaar=",
    written: "2345+6789+0124",
    reads: "2345 6789 0124",
    mask: maskKeepingEnds("2345 6789 0124"),
    customRegex: scrubItPatternOf("in-aadhaar"),
  },
  /*
   * #11200: a postcode, a card's code and its expiry, and a bank's code in
   * another script's digits - and #11199, in a URL - by the Custom Regex
   * rules Scrub It makes for them, which read every reading the
   * detectors do.
   */
  {
    label: "a UK postcode with fullwidth digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "postal-code",
    before: "Postcode: ",
    written: "EC１A １BB",
    reads: "EC1A 1BB",
    mask: maskKeepingEnds("EC1A 1BB"),
    customRegex: scrubItPatternOf("postal-code"),
  },
  {
    label: "a UK postcode typed into a form (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "postal-code",
    before: "GET /lookup?postcode=",
    written: "EC1A+1BB",
    reads: "EC1A 1BB",
    mask: maskKeepingEnds("EC1A 1BB"),
    customRegex: scrubItPatternOf("postal-code"),
  },
  {
    label: "a card's security code in Arabic-Indic digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "card-verification-code",
    before: "cvv: ",
    written: "٤٨٢",
    reads: "482",
    mask: maskKeepingEnds("482"),
    customRegex: scrubItPatternOf("card-verification-code"),
  },
  {
    label: "a card's expiry in a URL, its slash escaped (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "card-expiration-date",
    before: "GET /pay?exp=",
    written: "04%2F27",
    reads: "04/27",
    mask: maskKeepingEnds("04/27"),
    customRegex: scrubItPatternOf("card-expiration-date"),
  },
  {
    label: "a card's expiry in Persian digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "card-expiration-date",
    before: "expiry: ",
    written: "۰۴/۲۷",
    reads: "04/27",
    mask: maskKeepingEnds("04/27"),
    customRegex: scrubItPatternOf("card-expiration-date"),
  },
  {
    label: "an IFSC with its branch in Persian digits (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "in-ifsc",
    before: "IFSC ",
    written: "HDFC۰۰۰۰۱۲۳",
    reads: "HDFC0000123",
    mask: maskKeepingEnds("HDFC0000123"),
    customRegex: scrubItPatternOf("in-ifsc"),
  },
  /*
   * #11115: a number typed wholly in fullwidth, as Japanese and Chinese
   * text writes one - its plus sign, hyphens, parentheses, full stops and
   * ideographic spaces too - hidden as written, and masked and hashed as
   * the number written in ASCII.
   */
  {
    label: "a phone number typed wholly in fullwidth",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "＋８１ ３－１２３４－５６７８",
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "one with ideographic spaces between its groups",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "手机 ",
    written: "＋８６　１３８　００１３　８２４１",
    reads: "+86 138 0013 8241",
    mask: "***-***-8241",
  },
  {
    label: "a North American number in fullwidth parentheses and hyphens",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "（４１５）３２１－８７３１",
    reads: "(415)321-8731",
    mask: "***-***-8731",
  },
  {
    label: "a Social Security number typed wholly in fullwidth",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN ",
    written: "５３６－２２－８７３１",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a card typed wholly in fullwidth",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "カード ",
    written: "４５３２－０１５１－１２８３－０３６６",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a CPF typed wholly in fullwidth (Scrub It's rule)",
    patternType: LogScrubPatternType.Custom,
    dataTypeId: "br-cpf",
    before: "CPF ",
    written: "４７１．３９２．８６５－８２",
    reads: "471.392.865-82",
    mask: maskKeepingEnds("471.392.865-82"),
    customRegex: scrubItPatternOf("br-cpf"),
  },
  /*
   * #11114: a national phone number, or nine digits in a row, beside the
   * word that names it in the same value - as Data Security finds it - by
   * the Phone Number or SSN rule.
   */
  {
    label: "a national phone number beside tel",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "tel ",
    written: "02012345678",
    reads: "02012345678",
    mask: "***-***-5678",
  },
  {
    label: "one in a URL, its = escaped",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /notify?phone%3D",
    written: "02012345678",
    reads: "02012345678",
    mask: "***-***-5678",
  },
  {
    label: "nine digits in a row beside SSN",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN ",
    written: "536221234",
    reads: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "nine digits beside the words of an SSN a form wrote",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "GET /apply?social+security+number=",
    written: "536221234",
    reads: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "nine fullwidth digits beside ssn",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "ssn：",
    written: "５３６２２１２３４",
    reads: "536221234",
    mask: "***-**-1234",
  },
];

const ACTIONS: Array<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

const CASES: Array<[string, string, Written]> = ACTIONS.flatMap(
  (action: string): Array<[string, string, Written]> => {
    return WRITTEN.map((written: Written): [string, string, Written] => {
      return [written.label, action, written];
    });
  },
);

// What each rule keeps: no one's data, written the same ways.
const KEPT: Array<[string, string]> = [
  [LogScrubPatternType.IPAddress, "time:12:30:45"],
  [LogScrubPatternType.IPAddress, "mac:00:1a:2b:3c:4d:5e"],
  [LogScrubPatternType.IPAddress, "ip:fe80::1"],
  [LogScrubPatternType.Email, "GET /search?q=jane%40&n=1"],
  [LogScrubPatternType.Email, "@用户 你好"],
  // UTF-8 escapes that spell no address (#11032).
  [LogScrubPatternType.Email, "GET /assets/%E5%BC%A0%402x.png"],
  [LogScrubPatternType.Email, "GET /q?name=caf%C3%A9%40%C3"],
  [LogScrubPatternType.CreditCard, "order ４１１１ １１１１"],
  [LogScrubPatternType.CreditCard, "رقم ٤٢"],
  // What only looks like a phone or Social Security number (#11025, #11030).
  [LogScrubPatternType.PhoneNumber, "delta +51.507217 out of range"],
  [LogScrubPatternType.PhoneNumber, "at UTC +1 2026-11-24 10:15:00"],
  [LogScrubPatternType.PhoneNumber, "build v1.2.3+build.5"],
  [LogScrubPatternType.PhoneNumber, "counted +1 2 3 4 5 6 7 8"],
  [LogScrubPatternType.PhoneNumber, "دلتا +٥١.٥٠٧٢١٧"],
  [LogScrubPatternType.PhoneNumber, "GET /assets/logo%2B2x.png"],
  [LogScrubPatternType.SSN, "ref 536.22.8731.01"],
  [LogScrubPatternType.SSN, "ssn 666.22.8731"],
  [LogScrubPatternType.SSN, "ref ٥٣٦.٢٢.٨٧٣١.٠١"],
  // #11199: a form's "+" that spells no value of the rule's - a sum, a near miss.
  [LogScrubPatternType.CreditCard, "GET /calc?q=1234+5678"],
  [LogScrubPatternType.PhoneNumber, "GET /contact?tel=%28718%29+487-63058"],
  [LogScrubPatternType.PhoneNumber, "call ++44 20 7946 0958 failed"],
  [LogScrubPatternType.SSN, "GET /verify?ssn=666+22+8731"],
  [LogScrubPatternType.SSN, "GET /verify?ssn=536+22+8731+01"],
  // #11115: what is no phone or Social Security number, typed in fullwidth.
  [LogScrubPatternType.PhoneNumber, "差分 ＋５１．５０７２１７ の範囲外"],
  [LogScrubPatternType.PhoneNumber, "件数 ＋１　２　３　４　５　６　７　８"],
  [LogScrubPatternType.PhoneNumber, "（注）設定を確認してください。　以上"],
  [LogScrubPatternType.SSN, "SSN ６６６．２２．８７３１"],
  [LogScrubPatternType.CreditCard, "注文 ４１１１－１１１１"],
  // #11114: a national number or nine digits no word names, or a word inside another.
  [LogScrubPatternType.PhoneNumber, "order 02012345678 shipped"],
  [LogScrubPatternType.PhoneNumber, "telemetry 02012345678 ok"],
  [LogScrubPatternType.SSN, "ref 536221234 ok"],
  [LogScrubPatternType.SSN, "SSN 666221234"],
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

function regexOf(
  service: unknown,
  patternType: string,
  customRegex?: string | undefined,
): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType, customRegex);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
}

function logRules(
  patternType: string,
  action: string,
  fields: string = LogScrubField.Both,
  customRegex?: string | undefined,
): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub";
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  if (customRegex) {
    rule.customRegex = customRegex;
  }

  return [
    {
      rule: rule,
      regex: regexOf(LogScrubRuleService, patternType, customRegex),
    },
  ] as never;
}

function traceRules(
  patternType: string,
  action: string,
  fields: string = TraceScrubField.All,
  customRegex?: string | undefined,
): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub";
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  if (customRegex) {
    rule.customRegex = customRegex;
  }

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, patternType, customRegex),
    },
  ] as never;
}

function tokenOf(written: Written): string {
  return written.patternType === LogScrubPatternType.IPAddress
    ? ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: written.reads,
      })
    : ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: written.reads });
}

// What a rule of PROJECT_ID leaves of a value, however it is written.
function expectedOf(written: Written, action: string): string {
  if (action === LogScrubAction.Redact) {
    return "[REDACTED]";
  }

  return action === LogScrubAction.Mask ? written.mask : tokenOf(written);
}

function findingsOf(text: string, dataTypeId: string): Array<TextMatch> {
  return findSensitiveValues(text).filter((match: TextMatch): boolean => {
    return match.dataTypeId === dataTypeId;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Data Security finds each value, on its written characters", () => {
  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )("%s", (_label: string, written: Written) => {
    const text: string = `${written.before}${written.written} done`;

    expect(
      findingsOf(text, written.dataTypeId).map((match: TextMatch) => {
        return text.slice(match.start, match.end);
      }),
    ).toEqual([written.written]);
  });
});

describe("the log engine", () => {
  test.each(CASES)(
    "hides %s under %s in the body, the attributes, a list and a JSON text",
    (_label: string, action: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: `${value} done`,
          attributes: {
            "event.detail": value,
            "http.request.header.referer": [value, "kept"],
            "http.request.body": JSON.stringify({ note: value, n: 1 }),
          },
        },
        logRules(
          written.patternType,
          action,
          LogScrubField.Both,
          written.customRegex,
        ),
      );
      const hidden: string = `${written.before}${expectedOf(written, action)}`;

      expect(row["body"]).toBe(`${hidden} done`);
      expect(row["attributes"]).toEqual({
        "event.detail": hidden,
        "http.request.header.referer": [hidden, "kept"],
        "http.request.body": JSON.stringify({ note: hidden, n: 1 }),
      });
    },
  );

  test.each(KEPT)(
    "a %s rule keeps %s, under every action",
    (patternType: string, kept: string) => {
      for (const action of ACTIONS) {
        const record: () => JSONObject = (): JSONObject => {
          return { body: kept, attributes: { "event.detail": kept } };
        };

        expect(
          LogScrubRuleService.scrubLog(record(), logRules(patternType, action)),
        ).toEqual(record());
      }
    },
  );

  test("hides exactly the encoded address of a URL, and keeps the rest of it", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "GET /signup?email=jane.doe%40acmecorp.io&next=%2Fhome%3Ftab%3D2 200",
        attributes: {},
      },
      logRules(LogScrubPatternType.Email, LogScrubAction.Redact),
    );

    expect(row["body"]).toBe(
      "GET /signup?email=[REDACTED]&next=%2Fhome%3Ftab%3D2 200",
    );
  });

  test("an address after a key ending in hex letters keeps its key whole", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "remote:2a00:1450::1 node:2606:4700::1111 src:2001:db8::7",
        attributes: {},
      },
      logRules(LogScrubPatternType.IPAddress, LogScrubAction.Mask),
    );

    expect(row["body"]).toBe(
      `remote:${IPV6_MASK} node:${IPV6_MASK} src:${IPV6_MASK}`,
    );
  });
});

describe("the trace engine", () => {
  function spanRow(value: string): JSONObject {
    return {
      name: `GET ${value}`,
      statusMessage: `refused ${value}`,
      attributes: { "event.detail": value },
      events: [
        {
          name: `retrying ${value}`,
          attributes: { "exception.message": `failed ${value}` },
        },
      ],
      links: [{ attributes: { "peer.detail": value } }],
    };
  }

  test.each(CASES)(
    "hides %s under %s in the name, status message, attributes, events and links",
    (_label: string, action: string, written: Written) => {
      const hidden: string = `${written.before}${expectedOf(written, action)}`;

      expect(
        TraceScrubRuleService.scrubSpan(
          spanRow(`${written.before}${written.written}`),
          traceRules(
            written.patternType,
            action,
            TraceScrubField.All,
            written.customRegex,
          ),
        ),
      ).toEqual(spanRow(hidden));
    },
  );

  test.each(CASES)(
    "hides %s under %s in an exception's message, stack trace, type and attributes",
    (_label: string, action: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const hidden: string = `${written.before}${expectedOf(written, action)}`;
      const content: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          {
            message: `failed ${value}`,
            stackTrace: `at handle (app.js:1) ${value}`,
            exceptionType: `Error ${value}`,
            attributes: { "event.detail": value },
          },
          traceRules(
            written.patternType,
            action,
            TraceScrubField.Events,
            written.customRegex,
          ),
        );

      expect(content).toEqual({
        message: `failed ${hidden}`,
        stackTrace: `at handle (app.js:1) ${hidden}`,
        exceptionType: `Error ${hidden}`,
        attributes: { "event.detail": hidden },
      });
    },
  );

  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )(
    "an AI call's messages stay JSON, %s hidden in them",
    (_label: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const row: JSONObject = TraceScrubRuleService.scrubSpan(
        {
          name: "chat",
          attributes: {
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: `look up ${value} please` },
            ]),
          },
          events: [],
          links: [],
        },
        traceRules(
          written.patternType,
          LogScrubAction.Redact,
          TraceScrubField.All,
          written.customRegex,
        ),
      );

      expect(
        JSON.parse(
          (row["attributes"] as JSONObject)["gen_ai.input.messages"] as string,
        ),
      ).toEqual([
        { role: "user", content: `look up ${written.before}[REDACTED] please` },
      ]);
    },
  );
});

describe("a session replay, which the log rules scrub", () => {
  test.each(CASES)(
    "hides %s under %s",
    async (_label: string, action: string, written: Written) => {
      const events: Array<JSONValue> = [
        { text: `visit ${written.before}${written.written}` },
      ];
      const rules: Array<CompiledScrubRule> = logRules(
        written.patternType,
        action,
        LogScrubField.Both,
        written.customRegex,
      ) as unknown as Array<CompiledScrubRule>;

      await SessionReplayScrubService.scrubEvents(events, rules);

      expect((events[0] as JSONObject)["text"]).toBe(
        `visit ${written.before}${expectedOf(written, action)}`,
      );
    },
  );
});

describe("Data Security's coverage is true for each", () => {
  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )(
    "a log body's finding of %s is covered, and the rule leaves no finding",
    (_label: string, written: Written) => {
      const rule: CoveringScrubRule = {
        id: "rule",
        name: "Scrub",
        signal: "log",
        patternType: written.patternType,
        fieldsToScrub: LogScrubField.Both,
        ...(written.customRegex ? { customRegex: written.customRegex } : {}),
      };
      const body: string = `${written.before}${written.written} done`;
      const found: Array<TextMatch> = findingsOf(body, written.dataTypeId);

      expect(found).toHaveLength(1);
      expect(
        isFindingScrubbed(
          { rules: [rule] },
          {
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: written.dataTypeId,
            location: "body",
            /*
             * How the finding was found, as the scan writes it on the row
             * (#11502): a Custom Regex of the type's patterns counts only
             * for values those patterns found.
             */
            isFoundByContext: found.some((match: TextMatch): boolean => {
              return match.fromContext === true;
            }),
            isFoundByModel: false,
          },
        ),
      ).toBe(true);

      for (const action of ACTIONS) {
        const row: JSONObject = LogScrubRuleService.scrubLog(
          { body, attributes: {} },
          logRules(
            written.patternType,
            action,
            LogScrubField.Both,
            written.customRegex,
          ),
        );

        expect([
          action,
          findingsOf(row["body"] as string, written.dataTypeId),
        ]).toEqual([action, []]);
      }
    },
  );
});

describe("through log and trace ingest", () => {
  const AUTO_DISCOVERY_METHODS: Array<string> = [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverProxmoxCluster",
    "autoDiscoverVMwareVCenter",
    "autoDiscoverCephCluster",
    "autoDiscoverStorageArray",
    "autoDiscoverDockerSwarmCluster",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
    "autoDiscoverDatabaseServer",
  ];

  let logRows: Array<JSONObject> = [];
  let spanRows: Array<JSONObject> = [];
  let exceptionRows: Array<JSONObject> = [];

  function attribute(key: string, value: string): OtlpAttribute {
    return { key: key, value: { stringValue: value } };
  }

  function setupIngest(data: {
    logRules?: never | undefined;
    traceRules?: never | undefined;
  }): void {
    for (const ingestService of [
      OtelLogsIngestService,
      OtelTracesIngestService,
    ]) {
      const service: IngestTestMethods =
        ingestService as unknown as IngestTestMethods;

      for (const method of AUTO_DISCOVERY_METHODS) {
        jest.spyOn(service, method).mockResolvedValue(null);
      }

      jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
        serviceName: SERVICE_NAME,
        primaryEntityId: new ObjectID(SERVICE_ID.toString()),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      });
    }

    jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      .mockResolvedValue(data.logRules || ([] as never));
    jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      .mockResolvedValue(data.traceRules || ([] as never));
    jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(
        async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
          if (target === LogService) {
            logRows.push(...batch);
          } else if (target === SpanService) {
            spanRows.push(...batch);
          } else if (target === ExceptionInstanceService) {
            exceptionRows.push(...batch);
          } else {
            throw new Error(
              `unexpected fan-in target ${target.model.tableName}`,
            );
          }

          return { flushed: Promise.resolve() };
        },
      );
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
          // The exception's group: not what these tests read.
        },
      );
    // No exceptions table here: its lookup fails at once, tried again at once.
    jest.spyOn(ExceptionUtil, "pauseBeforeLookupRetry").mockResolvedValue();
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  }

  function request(body: JSONObject): TelemetryRequest {
    return {
      projectId: new ObjectID(PROJECT_ID.toString()),
      body: body,
      headers: {},
    } as unknown as TelemetryRequest;
  }

  beforeEach(() => {
    logRows = [];
    spanRows = [];
    exceptionRows = [];
  });

  test("a log's encoded and other-script addresses are stored as the tokens of the addresses they read as", async () => {
    setupIngest({
      logRules: logRules(LogScrubPatternType.Email, LogScrubAction.Hash),
    });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "GET /signup?email=jane.doe%40acmecorp.io&next=%2Fhome 200",
                    },
                    attributes: [
                      attribute("user.email", "张伟@acmecorp.io"),
                      attribute("url.query", "to=jane.doe@acmecorp.io"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    const row: JSONObject = logRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;
    const plain: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "jane.doe@acmecorp.io",
    });

    // One token for the address, however it is written.
    expect(row["body"]).toBe(`GET /signup?email=${plain}&next=%2Fhome 200`);
    expect(attributes["url.query"]).toBe(`to=${plain}`);
    expect(attributes["user.email"]).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "张伟@acmecorp.io",
      }),
    );
    expect(JSON.stringify(row)).not.toContain("jane.doe%40acmecorp.io");
    expect(JSON.stringify(row)).not.toContain("张伟");
  });

  test("a span's and its exception's keyed IPv6 addresses and other-script cards are hidden", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.IPAddress,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.CreditCard,
          LogScrubAction.Mask,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    parentSpanId: "",
                    name: "POST /pay",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: {
                      code: 2,
                      message: "declined peer ip:2a00:1450:4001:82a::200e",
                    },
                    attributes: [
                      attribute("http.request.method", "POST"),
                      attribute(
                        "payment.card",
                        "カード ４５３２ ０１５１ １２８３ ０３６６",
                      ),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "declined remote:2606:4700:4700::1111 card ٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
                          ),
                          attribute("exception.type", "PaymentError"),
                          attribute(
                            "exception.stacktrace",
                            "PaymentError\n    at pay (pay.js:10:5)",
                          ),
                        ],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(spanRows).toHaveLength(1);

    const row: JSONObject = spanRows[0]!;

    expect(row["statusMessage"]).toBe("declined peer ip:[REDACTED]");
    expect((row["attributes"] as JSONObject)["payment.card"]).toBe(
      "カード ****-****-****-0366",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "declined remote:[REDACTED] card ****-****-****-0366",
    );
    expect(JSON.stringify(row)).not.toContain("2a00:1450");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("٤٥٣٢");
  });

  test("Scrub It's rules hide a log's token after an encoded = and its IBAN in Arabic-Indic digits, the token hashed as the token it reads as (#11031, #11033)", async () => {
    setupIngest({
      logRules: [
        ...(logRules(
          LogScrubPatternType.Custom,
          LogScrubAction.Hash,
          LogScrubField.Both,
          scrubItPatternOf("github-token"),
        ) as unknown as Array<unknown>),
        ...(logRules(
          LogScrubPatternType.Custom,
          LogScrubAction.Redact,
          LogScrubField.Both,
          scrubItPatternOf("iban"),
        ) as unknown as Array<unknown>),
      ] as never,
    });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue: `GET /login?next=%2Fcb%3Ftoken%3D${GITHUB_TOKEN}&x=1 302`,
                    },
                    attributes: [
                      attribute("payout.iban", inScriptOf(IBAN, 0x0660)),
                      attribute(
                        "oauth.state",
                        GITHUB_TOKEN.replace(/_/g, "%5F"),
                      ),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    const row: JSONObject = logRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;
    const token: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: GITHUB_TOKEN,
    });

    // One token for the key, however it is written.
    expect(row["body"]).toBe(
      `GET /login?next=%2Fcb%3Ftoken%3D${token}&x=1 302`,
    );
    expect(attributes["oauth.state"]).toBe(token);
    expect(attributes["payout.iban"]).toBe("[REDACTED]");
    expect(JSON.stringify(row)).not.toContain(GITHUB_TOKEN.slice(4, 20));
  });

  test("a log's international, encoded and other-script phone numbers are stored as the token of the number they read as (#11025, #11030)", async () => {
    setupIngest({
      logRules: logRules(LogScrubPatternType.PhoneNumber, LogScrubAction.Hash),
    });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "GET /callback?phone=%2B49%2030%2081234567&step=2 200",
                    },
                    attributes: [
                      attribute("user.phone", "+٤٩ ٣٠ ٨١٢٣٤٥٦٧"),
                      attribute("sms.to", "+49 30 81234567"),
                      attribute("geo.delta", "+51.507217"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    const row: JSONObject = logRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;
    const plain: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "+49 30 81234567",
    });

    // One token for the number, however it is written.
    expect(row["body"]).toBe(`GET /callback?phone=${plain}&step=2 200`);
    expect(attributes["user.phone"]).toBe(plain);
    expect(attributes["sms.to"]).toBe(plain);
    // And a decimal is no phone number.
    expect(attributes["geo.delta"]).toBe("+51.507217");
    expect(JSON.stringify(row)).not.toContain("81234567");
    expect(JSON.stringify(row)).not.toContain("٨١٢٣٤٥٦٧");
  });

  test("a span's and its exception's international phone numbers and Social Security numbers are hidden (#11025, #11030)", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Mask,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203332",
                    parentSpanId: "",
                    name: "POST /notify",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: {
                      code: 2,
                      message: "SMS to +44 161 321 4567 failed",
                    },
                    attributes: [
                      attribute("http.request.method", "POST"),
                      attribute("customer.ssn", "536.22.8731"),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "SMS to +44 (0)20 8123 4567 for ssn ٥٣٦-٢٢-٨٧٣١ failed",
                          ),
                          attribute("exception.type", "SmsDeliveryError"),
                          attribute(
                            "exception.stacktrace",
                            "SmsDeliveryError\n    at notify (notify.js:10:5)",
                          ),
                        ],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(spanRows).toHaveLength(1);

    const row: JSONObject = spanRows[0]!;

    // The whole number, where the US pattern alone hid "161 321 4567".
    expect(row["statusMessage"]).toBe("SMS to [REDACTED] failed");
    expect((row["attributes"] as JSONObject)["customer.ssn"]).toBe(
      "***-**-8731",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "SMS to [REDACTED] for ssn ***-**-8731 failed",
    );
    expect(JSON.stringify(row)).not.toContain("+44");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("8123");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("٥٣٦");
  });

  test("a log's phone and Social Security numbers typed in fullwidth or beside their words are stored as the tokens of the plain numbers, and what no word names is kept (#11114, #11115)", async () => {
    setupIngest({
      logRules: [
        ...(logRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Hash,
        ) as unknown as Array<unknown>),
        ...(logRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Hash,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "SMS sent to ＋８１ ３－１２３４－５６７８, callback tel 02012345678 queued",
                    },
                    attributes: [
                      attribute("user.phone", "＋81　3－1234－5678"),
                      attribute("note", "verified ssn 536221234 today"),
                      attribute("customer.ssn", "５３６－２２－８７３１"),
                      attribute("order.ref", "order 02012345678"),
                      attribute("ticket", "ref 536221234"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    const row: JSONObject = logRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;
    const tokenOfPlain: (value: string) => string = (value: string): string => {
      return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
    };

    // One token for the number, however it is typed.
    expect(row["body"]).toBe(
      `SMS sent to ${tokenOfPlain("+81 3-1234-5678")}, callback tel ${tokenOfPlain("02012345678")} queued`,
    );
    expect(attributes["user.phone"]).toBe(tokenOfPlain("+81 3-1234-5678"));
    expect(attributes["note"]).toBe(
      `verified ssn ${tokenOfPlain("536221234")} today`,
    );
    expect(attributes["customer.ssn"]).toBe(tokenOfPlain("536-22-8731"));
    // Digits no word names are no one's number: kept.
    expect(attributes["order.ref"]).toBe("order 02012345678");
    expect(attributes["ticket"]).toBe("ref 536221234");
  });

  test("a span's and its exception's numbers typed in fullwidth or beside their words are hidden (#11114, #11115)", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Mask,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319d",
                    spanId: "b7ad6b7169203333",
                    parentSpanId: "",
                    name: "POST /notify",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: {
                      code: 2,
                      message:
                        "SMS to ＋８６　１３８　００１３　８２４１ failed",
                    },
                    attributes: [
                      attribute("http.request.method", "POST"),
                      attribute("customer.ssn", "ssn 536221234"),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "call to phone 201234567 for SSN ５３６．２２．８７３１ failed",
                          ),
                          attribute("exception.type", "SmsDeliveryError"),
                          attribute(
                            "exception.stacktrace",
                            "SmsDeliveryError\n    at notify (notify.js:10:5)",
                          ),
                        ],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(spanRows).toHaveLength(1);

    const row: JSONObject = spanRows[0]!;

    expect(row["statusMessage"]).toBe("SMS to [REDACTED] failed");
    expect((row["attributes"] as JSONObject)["customer.ssn"]).toBe(
      "ssn ***-**-1234",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "call to phone [REDACTED] for SSN ***-**-8731 failed",
    );
    expect(JSON.stringify(row)).not.toContain("８２４１");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("201234567");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("８７３１");
  });
});
