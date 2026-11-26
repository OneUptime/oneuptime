import "../../../TestingUtils/Init";
import { describe, expect, test } from "@jest/globals";
import AuditRecordNamesRepair, {
  AUDIT_RECORD_NAMES_EARLIEST_EVENT_TIME,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNamesRepair";
import {
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditResourceType,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  AuditChangeSaying,
  getAuditChangeSayings,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld";

/*
 * THE MUTATION THAT SAYS STORED AUDIT LOG EVENTS WITHOUT THEIR RECORDS'
 * NAMES (#10663), AS A STATEMENT.
 *
 * What it computes is pinned against a real ClickHouse in
 * AuditRecordNamesRepairClickhouseIntegration: every stored event reads as
 * the scan writes it now. Here: which rows it may touch - so its cost stays
 * bounded to the audit log's events since its scan shipped - and that it
 * says every change the scan reports, by the same words.
 */

const STATEMENT: string = AuditRecordNamesRepair.repairStatement({
  storageTable: "oneuptime.SecurityEventLocal",
  onCluster: " ON CLUSTER 'oneuptime'",
});

describe("the repair of stored audit log events", () => {
  test("is one mutation of the local storage table, on the cluster, rewriting the four columns that hold the name", () => {
    expect(
      STATEMENT.startsWith(
        "ALTER TABLE oneuptime.SecurityEventLocal ON CLUSTER 'oneuptime' UPDATE message = multiIf(",
      ),
    ).toBe(true);
    expect(STATEMENT).toContain(
      "attributes = mapFilter((key, value) -> key != 'audit.resource_name', attributes)",
    );
    expect(STATEMENT).toContain(
      "attributeKeys = arrayFilter(key -> key != 'audit.resource_name', attributeKeys)",
    );
    expect(STATEMENT).toContain(
      "targetResource = if(attributes['audit.resource_id'] != '', concat(attributes['audit.resource_type'], ': ', attributes['audit.resource_id']), attributes['audit.resource_type'])",
    );
    // Nothing else is written: not the time, not the severity, not the projection's columns.
    expect(STATEMENT.match(/(\w+) = /g)?.slice(0, 1)).toEqual(["message = "]);
    expect(STATEMENT).not.toMatch(
      /\b(severityName|className|time|projectId) = /,
    );
  });

  test("touches only the audit log's events since its scan shipped that still name a record", () => {
    const where: string = STATEMENT.slice(STATEMENT.indexOf(" WHERE ") + 7);

    expect(where).toBe(
      AuditRecordNamesRepair.condition(
        AuditRecordNamesRepair.getWithheldResourceTypes(),
      ),
    );
    // The partitions before the scan shipped are never read.
    expect(
      where.startsWith(`time >= '${AUDIT_RECORD_NAMES_EARLIEST_EVENT_TIME}'`),
    ).toBe(true);
    expect(AUDIT_RECORD_NAMES_EARLIEST_EVENT_TIME).toBe("2026-10-20 00:00:00");
    // The cheap LowCardinality columns are asked before the attributes.
    expect(where.indexOf("vendorName = 'OneUptime'")).toBeLessThan(
      where.indexOf("attributes["),
    );
    expect(where).toContain("productName = 'OneUptime Audit Log'");
    expect(where).toContain("attributes['oneuptime.source'] = 'audit-log'");
    expect(where).toContain("attributes['audit.resource_name'] != ''");
  });

  test("today every type the scan reports is withheld, so every one is reworded", () => {
    expect(AuditRecordNamesRepair.getWithheldResourceTypes()).toEqual([
      ...AUDIT_SECURITY_RESOURCE_TYPES,
    ]);

    for (const resourceType of AUDIT_SECURITY_RESOURCE_TYPES) {
      expect(STATEMENT).toContain(`'${resourceType}'`);
    }
  });

  test("says every change the scan reports by the words it was said with, and without the name", () => {
    for (const saying of getAuditChangeSayings()) {
      expect([saying.resourceType, saying.action]).toEqual([
        saying.resourceType,
        saying.action,
      ]);
      expect(STATEMENT).toContain(
        `attributes['audit.resource_type'] = '${saying.resourceType}' AND attributes['audit.action'] = '${saying.action}' AND endsWith(message, concat(' ${saying.named}', `,
      );
      expect(STATEMENT).toContain(`' ${saying.unnamed}'`);
      expect(STATEMENT).toContain(`' ${saying.named} "'`);
    }
  });

  test("an MCP client's authorization naming the client it was made through keeps its message", () => {
    const message: string = AuditRecordNamesRepair.messageExpression([
      ...AUDIT_SECURITY_RESOURCE_TYPES,
    ]);

    expect(
      message.startsWith(
        `multiIf(attributes['audit.resource_type'] = '${AuditResourceType.McpClientAuthorization}' AND attributes['audit.mcp_client_name'] != '', message, `,
      ),
    ).toBe(true);
    expect(message.endsWith(", message)")).toBe(true);
  });

  test("a type still named is neither matched nor reworded", () => {
    const withheld: Array<string> = AUDIT_SECURITY_RESOURCE_TYPES.filter(
      (resourceType: string): boolean => {
        return resourceType !== AuditResourceType.SecurityPlaybook;
      },
    );
    const statement: string = AuditRecordNamesRepair.repairStatement({
      storageTable: "SecurityEvent",
      onCluster: "",
      withheldTypes: withheld,
    });
    const playbook: Array<AuditChangeSaying> = getAuditChangeSayings().filter(
      (saying: AuditChangeSaying): boolean => {
        return saying.resourceType === AuditResourceType.SecurityPlaybook;
      },
    );

    expect(playbook.length).toBeGreaterThan(0);
    expect(statement).not.toContain(`'${AuditResourceType.SecurityPlaybook}'`);
    expect(AuditRecordNamesRepair.getSayings(withheld)).not.toContainEqual(
      playbook[0],
    );
  });

  test("a literal is quoted as ClickHouse reads it", () => {
    expect(AuditRecordNamesRepair.literal("O'Brien\\ops")).toBe(
      "'O\\'Brien\\\\ops'",
    );
  });
});
