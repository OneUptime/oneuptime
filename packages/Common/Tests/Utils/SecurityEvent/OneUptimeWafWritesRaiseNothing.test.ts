import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { getDetectionDefinitionRules } from "../../../Types/SecurityEvent/RealTimeDetection";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { azureActivityExport } from "./Connectors/EntraIdFixtures";
import { googleAuditEntry } from "./LogParsers/GoogleCloudAuditFixtures";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * ONEUPTIME'S OWN WAF WRITES RAISE NO SECURITY EVENT (#10348, #10349,
 * #10613).
 *
 * Every pass that changes the blocklist writes the customer's cloud:
 * Resource Manager PUTs of an Application Gateway or Front Door WAF
 * policy, Compute's addRule / patchRule / removeRule on a Cloud Armor
 * policy, and Network Security's address group calls. Each lands in the
 * Azure Activity Log or the Google Cloud audit log, and from there in
 * Security Events, as the connection's app or service account. Read the
 * way the engine reads them (SecurityLogParser, then every rule of the
 * library as its ClickHouse query matches), not one of them fires: they
 * are changes on record, never a detection to work.
 *
 * A library rule that starts watching WAF policy or security policy
 * writes fails here, and has to leave OneUptime's own out first.
 */

const SUBSCRIPTION: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const APP_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SERVICE_ACCOUNT: string =
  "oneuptime-read-only@acme-prod.iam.gserviceaccount.com";

// What the engine reads of a record: an Activity Log write's Start makes none, its Success one.
function fromLog(record: JSONObject): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(logLine(JSON.stringify(record)));
}

// A WAF policy write in the Activity Log's export (Event Hubs, diagnostic settings), by the connection's app.
function azurePolicyWrite(data: {
  type: string;
  group: string;
  name: string;
  resultType: string;
}): Array<NormalizedSecurityEvent> {
  const id: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/${data.group}/providers/Microsoft.Network/${data.type}/${data.name}`;

  return fromLog(
    azureActivityExport({
      resourceId: id.toUpperCase(),
      operationName: `MICROSOFT.NETWORK/${data.type.toUpperCase()}/WRITE`,
      category: "Administrative",
      resultType: data.resultType,
      resultSignature:
        data.resultType === "Start" ? "Started." : "Succeeded.OK",
      callerIpAddress: "20.50.2.10",
      identity: {
        authorization: {
          scope: id,
          action: `Microsoft.Network/${data.type}/write`,
          evidence: {
            role: "OneUptime WAF Blocklist",
            principalType: "ServicePrincipal",
          },
        },
        claims: {
          appid: APP_ID,
          idtyp: "app",
          "http://schemas.microsoft.com/identity/claims/objectidentifier":
            "9a8b7c6d-0000-4000-8000-00000000000a",
        },
      },
      properties: {
        statusCode: data.resultType === "Start" ? "Created" : "OK",
        eventCategory: "Administrative",
        entity: id,
        message: `Microsoft.Network/${data.type}/write`,
      },
    }),
  );
}

// A Cloud Armor or address group write in the Admin Activity audit log, by the connection's service account.
function googleWrite(data: {
  serviceName: string;
  methodName: string;
  resourceName: string;
  permission: string;
}): Array<NormalizedSecurityEvent> {
  return fromLog(
    googleAuditEntry(
      "activity",
      {
        authenticationInfo: { principalEmail: SERVICE_ACCOUNT },
        requestMetadata: {
          callerIp: "34.118.0.10",
          callerSuppliedUserAgent: "OneUptime",
        },
        serviceName: data.serviceName,
        methodName: data.methodName,
        authorizationInfo: [
          {
            resource: data.resourceName,
            permission: data.permission,
            granted: true,
          },
        ],
        resourceName: data.resourceName,
      },
      {
        resource: {
          type: "audited_resource",
          labels: {
            project_id: "acme-prod",
            service: data.serviceName,
            method: data.methodName,
          },
        },
      },
    ),
  );
}

const WRITES: Array<[string, () => Array<NormalizedSecurityEvent>]> = [
  ...(["Start", "Success"] as Array<string>).flatMap(
    (
      resultType: string,
    ): Array<[string, () => Array<NormalizedSecurityEvent>]> => {
      return [
        [
          `an Application Gateway WAF policy written (${resultType})`,
          (): Array<NormalizedSecurityEvent> => {
            return azurePolicyWrite({
              type: "ApplicationGatewayWebApplicationFirewallPolicies",
              group: "rg-prod",
              name: "prod-waf",
              resultType,
            });
          },
        ],
        [
          `a Front Door WAF policy written (${resultType})`,
          (): Array<NormalizedSecurityEvent> => {
            return azurePolicyWrite({
              type: "FrontDoorWebApplicationFirewallPolicies",
              group: "rg-edge",
              name: "edgewaf",
              resultType,
            });
          },
        ],
      ];
    },
  ),
  ...(["addRule", "patchRule", "removeRule"] as Array<string>).flatMap(
    (method: string): Array<[string, () => Array<NormalizedSecurityEvent>]> => {
      return [
        [
          `a Cloud Armor rule written (${method})`,
          (): Array<NormalizedSecurityEvent> => {
            return googleWrite({
              serviceName: "compute.googleapis.com",
              methodName: `v1.compute.securityPolicies.${method}`,
              resourceName:
                "projects/acme-prod/global/securityPolicies/prod-lb",
              permission: "compute.securityPolicies.update",
            });
          },
        ],
        [
          `a regional Cloud Armor rule written (${method})`,
          (): Array<NormalizedSecurityEvent> => {
            return googleWrite({
              serviceName: "compute.googleapis.com",
              methodName: `v1.compute.regionSecurityPolicies.${method}`,
              resourceName:
                "projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb",
              permission: "compute.regionSecurityPolicies.update",
            });
          },
        ],
      ];
    },
  ),
  ...(
    [
      ["CreateAddressGroup", "networksecurity.addressGroups.create"],
      ["AddAddressGroupItems", "networksecurity.addressGroups.update"],
      ["RemoveAddressGroupItems", "networksecurity.addressGroups.update"],
      ["DeleteAddressGroup", "networksecurity.addressGroups.delete"],
    ] as Array<[string, string]>
  ).map(
    ([method, permission]: [string, string]): [
      string,
      () => Array<NormalizedSecurityEvent>,
    ] => {
      return [
        `an address group written (${method})`,
        (): Array<NormalizedSecurityEvent> => {
          return googleWrite({
            serviceName: "networksecurity.googleapis.com",
            methodName: `google.cloud.networksecurity.v1.AddressGroupService.${method}`,
            resourceName:
              "projects/acme-prod/locations/global/addressGroups/oneuptime-1a2b3c4d-block-ipv4",
            permission,
          });
        },
      ];
    },
  ),
];

// Every rule of the library, a correlation's own rules each: whatever one counts, one event of it would.
const RULES: Array<{ title: string; rule: SigmaRule }> =
  DETECTION_RULE_LIBRARY.flatMap(
    (
      entry: DetectionRuleLibraryEntry,
    ): Array<{ title: string; rule: SigmaRule }> => {
      return getDetectionDefinitionRules(
        SigmaRuleSetParser.parse(entry.sigmaRuleYaml),
      ).map((rule: SigmaRule): { title: string; rule: SigmaRule } => {
        return { title: entry.title, rule };
      });
    },
  );

describe("OneUptime's own WAF writes", () => {
  test("are read as the audit logs they are: the connection's identity, the method, the policy", () => {
    const write: Array<NormalizedSecurityEvent> = WRITES[2]![1]();

    expect(write).toHaveLength(1);
    expect(JSON.stringify(write[0])).toContain(APP_ID);
    expect(JSON.stringify(write[0]).toLowerCase()).toContain(
      "applicationgatewaywebapplicationfirewallpolicies",
    );

    const rule: Array<NormalizedSecurityEvent> = WRITES[4]![1]();

    expect(rule).toHaveLength(1);
    expect(JSON.stringify(rule[0])).toContain(SERVICE_ACCOUNT);
    expect(JSON.stringify(rule[0])).toContain("securityPolicies.addRule");
  });

  test.each(WRITES)(
    "%s fires no rule of the library",
    (_name: string, make: () => Array<NormalizedSecurityEvent>) => {
      const fired: Array<string> = make().flatMap(
        (event: NormalizedSecurityEvent): Array<string> => {
          return RULES.filter(
            (candidate: { title: string; rule: SigmaRule }): boolean => {
              return sigmaRuleMatchesEvent(candidate.rule, event);
            },
          ).map((candidate: { title: string }): string => {
            return candidate.title;
          });
        },
      );

      expect(fired).toEqual([]);
    },
  );

  test("the library is read whole: every entry gives at least one rule, so none is skipped", () => {
    const titles: Set<string> = new Set(
      RULES.map((candidate: { title: string }): string => {
        return candidate.title;
      }),
    );

    expect(titles.size).toBe(DETECTION_RULE_LIBRARY.length);
    expect(titles.size).toBeGreaterThan(50);
  });
});
