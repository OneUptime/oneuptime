import { CustomDomainKind } from "./CustomDomainKinds";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import { CustomDomainCertificateStatus } from "Common/Types/CustomDomain/CustomDomainVerification";
import {
  CustomDomainReadinessCheck,
  CustomDomainReadinessOutcome,
  CustomDomainServerReadinessResult,
} from "Common/Types/CustomDomain/CustomDomainServerReadiness";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "Common/Types/CustomDomain/DnsRecordCheck";
import ProductEvents from "Common/UI/Utils/ProductEvents";

/*
 * The product events of putting a status page, a dashboard or a form on its
 * own domain (#7024): where people start, where they stop, and what each
 * DNS check found on the way. The four customer reports about custom
 * domains (#1521, #1664, #1692, #1774) were all about this flow, and none
 * of it was measured.
 *
 *   custom_domain/add_started           Add Custom Domain opened
 *   custom_domain/project_domain_added  the address's domain added to the
 *                                       project (its TXT record comes next)
 *   custom_domain/record_checked        one record Check now looked up
 *   custom_domain/verified              Check now verified the domain
 *   custom_domain/server_not_ready      a self-hosted server that cannot
 *                                       serve a custom domain yet said so
 *
 * No event names a domain, an address or a record's value: only which kind
 * of custom domain, which record, and what was found, as words the code
 * chose (Types/Analytics/ProductEvent's tokens). They go where every
 * Dashboard event goes (ProductEvents): to product analytics only where it
 * is set up - OneUptime Cloud - and only with the visitor's consent and
 * without Global Privacy Control.
 */

// Which kind of custom domain, as the events name it.
export type CustomDomainEventKind = "status_page" | "dashboard" | "form";

// Where the server readiness notice was shown.
export type CustomDomainEventSource = "add" | "dns_setup";

export const getCustomDomainEventKind: (
  kind: CustomDomainKind,
) => CustomDomainEventKind = (
  kind: CustomDomainKind,
): CustomDomainEventKind => {
  switch (kind.parentColumn) {
    case "dashboardId":
      return "dashboard";
    case "formId":
      return "form";
    case "statusPageId":
    default:
      return "status_page";
  }
};

// An enum's value as an event's word: "WrongValue" -> "wrong_value".
export const toCustomDomainEventToken: (value: string) => string = (
  value: string,
): string => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
};

/*
 * A CNAME a proxy or a flattened record hides: no CNAME came back, but the
 * name answers with addresses (Cloudflare's orange cloud, #1664).
 */
const isProxied: (check: DnsRecordCheck) => boolean = (
  check: DnsRecordCheck,
): boolean => {
  return (
    check.type === DnsRecordType.CNAME &&
    check.outcome === DnsRecordCheckOutcome.NotFound &&
    Boolean(check.addresses && check.addresses.length > 0)
  );
};

export default class CustomDomainEvents {
  public static addStarted(kind: CustomDomainKind): void {
    ProductEvents.send(ProductEventName.CustomDomainAddStarted, {
      kind: getCustomDomainEventKind(kind),
    });
  }

  public static projectDomainAdded(kind: CustomDomainKind): void {
    ProductEvents.send(ProductEventName.CustomDomainProjectDomainAdded, {
      kind: getCustomDomainEventKind(kind),
    });
  }

  /*
   * One record Check now looked up. A CNAME the dialog did not look up yet -
   * it waits for the TXT before it - is no check, and sends nothing.
   */
  public static recordChecked(data: {
    kind: CustomDomainKind;
    check: DnsRecordCheck | undefined;
    // Which Check now of this dialog it was, from 1.
    checkNumber: number;
  }): void {
    const check: DnsRecordCheck | undefined = data.check;

    if (!check || check.outcome === DnsRecordCheckOutcome.NotCheckedYet) {
      return;
    }

    const isCname: boolean = check.type === DnsRecordType.CNAME;

    ProductEvents.send(ProductEventName.CustomDomainRecordChecked, {
      kind: getCustomDomainEventKind(data.kind),
      record: isCname ? "cname" : "txt",
      outcome: toCustomDomainEventToken(check.outcome),
      check_number: data.checkNumber,
      // What only a CNAME's check says: a proxy, and a request's answer.
      ...(isCname ? { is_proxied: isProxied(check) } : {}),
      ...(isCname && typeof check.reachedOneUptime === "boolean"
        ? { reached_one_uptime: check.reachedOneUptime }
        : {}),
      ...(isCname &&
      check.reachedOneUptime !== true &&
      check.httpStatus !== undefined
        ? { http_status: check.httpStatus }
        : {}),
    });
  }

  public static verified(data: {
    kind: CustomDomainKind;
    certificateStatus: CustomDomainCertificateStatus;
    // 2 when the domain's TXT record had to be found first, else 1.
    recordCount: number;
    checkNumber: number;
  }): void {
    ProductEvents.send(ProductEventName.CustomDomainVerified, {
      kind: getCustomDomainEventKind(data.kind),
      certificate_status: toCustomDomainEventToken(data.certificateStatus),
      record_count: data.recordCount,
      check_number: data.checkNumber,
    });
  }

  /*
   * A server that cannot serve a custom domain yet: one with a check that
   * failed. One that only warns (no Let's Encrypt account key) serves them,
   * and sends nothing.
   */
  public static serverNotReady(data: {
    kind: CustomDomainKind;
    source: CustomDomainEventSource;
    readiness: CustomDomainServerReadinessResult;
  }): void {
    const failed: Array<CustomDomainReadinessCheck> =
      data.readiness.checks.filter(
        (check: CustomDomainReadinessCheck): boolean => {
          return check.outcome === CustomDomainReadinessOutcome.Fail;
        },
      );

    if (failed.length === 0) {
      return;
    }

    ProductEvents.send(ProductEventName.CustomDomainServerNotReady, {
      kind: getCustomDomainEventKind(data.kind),
      source: data.source,
      failed_checks: failed
        .map((check: CustomDomainReadinessCheck): string => {
          return toCustomDomainEventToken(check.id);
        })
        .join("."),
      failed_count: failed.length,
    });
  }
}
