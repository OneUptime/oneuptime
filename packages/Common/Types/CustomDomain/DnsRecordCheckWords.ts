import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "./DnsRecordCheck";
import { fillTemplate, translationKey } from "../Translator";

/*
 * A DNS record check in plain words: what OneUptime looked up, what came
 * back, and what to change. #1664 asked "I don't understand how OneUptime
 * reads CNAME records": this answers it by showing it.
 *
 * One set of sentences for every place that says it - the Dashboard's DNS
 * Setup (in the reader's language: the templates are keys of the
 * Dashboard's locales, and this file is a "keys" root of its extractor), the
 * verify-cname route's English refusal, and an installation health check.
 * React-free and server-safe.
 */

export interface DnsRecordCheckSentence {
  template: string;
  values: Record<string, string>;
}

export interface DnsRecordCheckDescription {
  // What OneUptime looked up, and what came back.
  lookedUp: DnsRecordCheckSentence;
  // What to change, when there is something to change.
  whatToDo?: DnsRecordCheckSentence | undefined;
  /*
   * A CNAME that is right, whose requests still do not reach OneUptime: a
   * proxy in front of a self-hosted server that does not pass the name on
   * (#1521). The record is verified; its certificate cannot be issued.
   */
  warning?: DnsRecordCheckSentence | undefined;
}

// The status beside each record, one or two words.
export const DNS_RECORD_STATUS: Record<DnsRecordCheckOutcome, string> = {
  [DnsRecordCheckOutcome.Found]: translationKey("Found"),
  [DnsRecordCheckOutcome.WrongValue]: translationKey("Wrong value"),
  [DnsRecordCheckOutcome.NotFound]: translationKey("Not found yet"),
  [DnsRecordCheckOutcome.NameNotFound]: translationKey("Not found yet"),
  [DnsRecordCheckOutcome.LookupFailed]: translationKey("Could not check"),
  [DnsRecordCheckOutcome.NotCheckedYet]: translationKey("Not checked yet"),
};

export const DnsRecordCheckWords: {
  cnameFound: string;
  cnameReachesOneUptime: string;
  txtFound: string;
  cnameNotFound: string;
  cnameNotFoundWithAddresses: string;
  txtNotFound: string;
  cnameWrongValue: string;
  txtWrongValue: string;
  nameNotFound: string;
  lookupFailed: string;
  notCheckedYet: string;
  addCname: string;
  addCnameInsteadOfAddress: string;
  addTxt: string;
  changeCname: string;
  addAnotherTxt: string;
  txtNameNotFound: string;
  tryAgain: string;
  notReachedWithStatus: string;
  notReachedNoAnswer: string;
} = {
  cnameFound: translationKey(
    "We looked up the CNAME record of {{name}} and found {{found}}.",
  ),
  cnameReachesOneUptime: translationKey(
    "Requests to {{name}} reach OneUptime.",
  ),
  txtFound: translationKey(
    "We looked up the TXT records of {{name}} and found {{expectedValue}}.",
  ),
  cnameNotFound: translationKey(
    "We looked up the CNAME record of {{name}} and got nothing.",
  ),
  cnameNotFoundWithAddresses: translationKey(
    "We looked up the CNAME record of {{name}} and got nothing, but the name answers with the address {{addresses}}.",
  ),
  txtNotFound: translationKey(
    "We looked up the TXT records of {{name}} and got nothing.",
  ),
  cnameWrongValue: translationKey(
    "We looked up the CNAME record of {{name}} and got {{found}}, but expected {{expectedValue}}.",
  ),
  txtWrongValue: translationKey(
    "We looked up the TXT records of {{name}} and got {{found}}, but none of them is {{expectedValue}}.",
  ),
  nameNotFound: translationKey(
    "We looked up {{name}}, and it does not exist in DNS yet.",
  ),
  lookupFailed: translationKey(
    "We could not look up the {{type}} record of {{name}}: the DNS server did not answer.",
  ),
  notCheckedYet: translationKey(
    "Not checked yet: we check it once the TXT record is found.",
  ),
  /*
   * Each says the whole record, name and value: the same words are the
   * verify-cname route's refusal, where nothing is drawn "above" them.
   */
  addCname: translationKey(
    "Add a CNAME record with the name {{name}} and the value {{expectedValue}} at your DNS provider. A new record usually shows up within minutes, and at most within 48 hours.",
  ),
  addCnameInsteadOfAddress: translationKey(
    "Either {{name}} has an A record, or your DNS provider proxies or flattens it (Cloudflare's orange cloud does), which hides the CNAME record. Replace the A record with a CNAME record whose value is {{expectedValue}}, or set the name to DNS only.",
  ),
  addTxt: translationKey(
    "Add a TXT record with the name {{name}} and the value {{expectedValue}} at your DNS provider. A new record usually shows up within minutes, and at most within 48 hours.",
  ),
  changeCname: translationKey(
    "Change the record's value to {{expectedValue}}.",
  ),
  addAnotherTxt: translationKey(
    "Add a TXT record with the value {{expectedValue}}. The TXT records already there can stay.",
  ),
  txtNameNotFound: translationKey(
    "Check that {{name}} is your domain, and add a TXT record with the value {{expectedValue}} at its DNS provider.",
  ),
  tryAgain: translationKey("Try again in a few minutes."),
  notReachedWithStatus: translationKey(
    "But a request to {{name}} did not reach OneUptime: it answered with HTTP {{status}}. If a proxy or load balancer is in front of OneUptime, it must pass requests for {{name}} on to OneUptime.",
  ),
  notReachedNoAnswer: translationKey(
    "But a request to {{name}} got no answer. {{name}} must reach OneUptime on port 80 for its certificate to be issued.",
  ),
};

const sentence: (
  template: string,
  values: Record<string, string>,
) => DnsRecordCheckSentence = (
  template: string,
  values: Record<string, string>,
): DnsRecordCheckSentence => {
  return { template, values };
};

// A CNAME chain hop by hop, or TXT values one after the other.
const joinFound: (check: DnsRecordCheck) => string = (
  check: DnsRecordCheck,
): string => {
  if (check.type === DnsRecordType.CNAME) {
    return check.foundValues.join(" → ");
  }

  return check.foundValues
    .map((value: string): string => {
      return `"${value}"`;
    })
    .join(", ");
};

export const describeDnsRecordCheck: (
  check: DnsRecordCheck,
) => DnsRecordCheckDescription = (
  check: DnsRecordCheck,
): DnsRecordCheckDescription => {
  const isCname: boolean = check.type === DnsRecordType.CNAME;

  const values: Record<string, string> = {
    name: check.name,
    expectedValue: check.expectedValue,
    found: joinFound(check),
    type: check.type,
    addresses: (check.addresses || []).join(", "),
  };

  switch (check.outcome) {
    case DnsRecordCheckOutcome.Found: {
      if (!isCname) {
        return { lookedUp: sentence(DnsRecordCheckWords.txtFound, values) };
      }

      const lookedUp: DnsRecordCheckSentence =
        check.foundValues.length > 0
          ? sentence(DnsRecordCheckWords.cnameFound, values)
          : sentence(DnsRecordCheckWords.cnameReachesOneUptime, values);

      if (check.reachedOneUptime === false) {
        return {
          lookedUp,
          warning:
            check.httpStatus !== undefined
              ? sentence(DnsRecordCheckWords.notReachedWithStatus, {
                  ...values,
                  status: String(check.httpStatus),
                })
              : sentence(DnsRecordCheckWords.notReachedNoAnswer, values),
        };
      }

      return { lookedUp };
    }

    case DnsRecordCheckOutcome.WrongValue: {
      return isCname
        ? {
            lookedUp: sentence(DnsRecordCheckWords.cnameWrongValue, values),
            whatToDo: sentence(DnsRecordCheckWords.changeCname, values),
          }
        : {
            lookedUp: sentence(DnsRecordCheckWords.txtWrongValue, values),
            whatToDo: sentence(DnsRecordCheckWords.addAnotherTxt, values),
          };
    }

    case DnsRecordCheckOutcome.NotFound: {
      if (!isCname) {
        return {
          lookedUp: sentence(DnsRecordCheckWords.txtNotFound, values),
          whatToDo: sentence(DnsRecordCheckWords.addTxt, values),
        };
      }

      if (check.addresses && check.addresses.length > 0) {
        return {
          lookedUp: sentence(
            DnsRecordCheckWords.cnameNotFoundWithAddresses,
            values,
          ),
          whatToDo: sentence(
            DnsRecordCheckWords.addCnameInsteadOfAddress,
            values,
          ),
        };
      }

      return {
        lookedUp: sentence(DnsRecordCheckWords.cnameNotFound, values),
        whatToDo: sentence(DnsRecordCheckWords.addCname, values),
      };
    }

    case DnsRecordCheckOutcome.NameNotFound: {
      return {
        lookedUp: sentence(DnsRecordCheckWords.nameNotFound, values),
        whatToDo: sentence(
          isCname
            ? DnsRecordCheckWords.addCname
            : DnsRecordCheckWords.txtNameNotFound,
          values,
        ),
      };
    }

    case DnsRecordCheckOutcome.LookupFailed: {
      return {
        lookedUp: sentence(DnsRecordCheckWords.lookupFailed, values),
        whatToDo: sentence(DnsRecordCheckWords.tryAgain, values),
      };
    }

    case DnsRecordCheckOutcome.NotCheckedYet:
    default: {
      return { lookedUp: sentence(DnsRecordCheckWords.notCheckedYet, values) };
    }
  }
};

const fill: (part: DnsRecordCheckSentence | undefined) => string = (
  part: DnsRecordCheckSentence | undefined,
): string => {
  return part ? fillTemplate(part.template, part.values) : "";
};

/*
 * The whole description in English, one sentence after the other: for the
 * server's own messages (the verify-cname refusal) and for logs.
 */
export const describeDnsRecordCheckInEnglish: (
  check: DnsRecordCheck,
) => string = (check: DnsRecordCheck): string => {
  const description: DnsRecordCheckDescription = describeDnsRecordCheck(check);

  return [
    fill(description.lookedUp),
    fill(description.whatToDo),
    fill(description.warning),
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");
};
