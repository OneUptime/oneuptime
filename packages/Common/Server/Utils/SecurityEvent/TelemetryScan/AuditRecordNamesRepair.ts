import AuditRecordNameReaders from "./AuditRecordNameReaders";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SECURITY_TELEMETRY_VENDOR_NAME,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditResourceType,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  AUDIT_LOG_SOURCE_KIND,
  AuditChangeSaying,
  getAuditChangeSayings,
  getNamedWordsNeedle,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld";

/*
 * THE SECURITY EVENTS THE AUDIT LOG'S SCAN STORED BEFORE #10663, SAID
 * WITHOUT THE NAMES THEIR READERS MAY NOT READ - one ClickHouse mutation
 * (Workers/DataMigrations/WithholdAuditRecordNamesInSecurityEvents).
 *
 * Each such event named its record in `message`, `targetResource` and
 * `audit.resource_name`. The mutation rewrites the three as a new event
 * says them (Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld,
 * whose rewording this is, in SQL): the attribute taken out (and its key
 * out of `attributeKeys`), the message reworded by the words its change was
 * said with - chosen by the event's type and action, its last place in the
 * message, a quoted name to the end - and the target by its type and id.
 *
 * Why one mutation rather than hiding the names as events are read: the
 * events are read by a dozen readers that are not the table's generic one
 * (a rule's match, a correlation, a case's story, the forwarder, a
 * retrohunt...), searched, grouped, and listed by an attribute's values;
 * hiding the names in each would leave the next reader to remember it. The
 * mutation's cost is bounded:
 *
 *   - by time: the audit log's scan shipped on 2026-10-27, so no event of it
 *     is older, and the table is partitioned by day: every partition before
 *     EARLIEST_EVENT_TIME is skipped without being read;
 *   - by part: ClickHouse rewrites only the parts that hold a row the
 *     condition matches - an audit log event that still names its record -
 *     and of those only the four columns it updates; the rest are linked as
 *     they are, and the projection reads none of the four;
 *   - by row: the cheap columns are asked first (vendorName and productName
 *     are LowCardinality), the attributes only of what they leave.
 *
 * Safe to run twice, and while events arrive: a rewritten row names no
 * record, so it no longer matches, and new events are written without
 * names. Queued asynchronously, as RepairGoogleSecOpsDetectionSeverity is.
 */

// A week before the audit log's security scan shipped (2026-10-27).
export const AUDIT_RECORD_NAMES_EARLIEST_EVENT_TIME: string =
  "2026-10-20 00:00:00";

export default class AuditRecordNamesRepair {
  // A string as a ClickHouse literal.
  public static literal(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  private static attribute(key: string): string {
    return `attributes[${AuditRecordNamesRepair.literal(key)}]`;
  }

  // The types whose events no longer name their records: today, every one.
  public static getWithheldResourceTypes(): Array<string> {
    return AUDIT_SECURITY_RESOURCE_TYPES.filter(
      (resourceType: string): boolean => {
        return !AuditRecordNameReaders.isNameWritten(resourceType);
      },
    );
  }

  /*
   * The rows the repair rewrites: the audit log's events, since its scan
   * shipped, that still name a record of a type whose name is withheld.
   */
  public static condition(withheldTypes: Array<string>): string {
    const product: string = getSecurityTelemetrySourceDefinition(
      SecurityTelemetrySourceKind.AuditLog,
    ).productName;

    return [
      `time >= ${AuditRecordNamesRepair.literal(AUDIT_RECORD_NAMES_EARLIEST_EVENT_TIME)}`,
      `vendorName = ${AuditRecordNamesRepair.literal(SECURITY_TELEMETRY_VENDOR_NAME)}`,
      `productName = ${AuditRecordNamesRepair.literal(product)}`,
      `${AuditRecordNamesRepair.attribute(SECURITY_LOG_SOURCE_ATTRIBUTE)} = ${AuditRecordNamesRepair.literal(AUDIT_LOG_SOURCE_KIND)}`,
      `${AuditRecordNamesRepair.attribute(AUDIT_ATTRIBUTES.resourceName)} != ''`,
      `${AuditRecordNamesRepair.attribute(AUDIT_ATTRIBUTES.resourceType)} IN (${withheldTypes
        .map((resourceType: string): string => {
          return AuditRecordNamesRepair.literal(resourceType);
        })
        .join(", ")})`,
    ].join(" AND ");
  }

  /*
   * Where, counted from 1 in bytes, the last place `needle` is in the
   * message begins: the message and the needle read backwards (byte by
   * byte, as length and substring count) find it first.
   */
  private static lastPosition(needle: string): string {
    const literal: string = AuditRecordNamesRepair.literal(needle);

    return `(length(message) - position(reverse(message), reverse(${literal})) - length(${literal}) + 2)`;
  }

  /*
   * The record's name as the message quotes it (quoteAuditRecordName):
   * trimmed, cut to 120 characters with an ellipsis, in quotes.
   */
  private static quotedNameExpression(): string {
    const name: string = `trimBoth(${AuditRecordNamesRepair.attribute(AUDIT_ATTRIBUTES.resourceName)})`;

    return `concat(' "', if(lengthUTF8(${name}) <= 120, ${name}, concat(substringUTF8(${name}, 1, 119), '…')), '"')`;
  }

  /*
   * The message, said as withholdAuditRecordNameInMessage says it: where it
   * ends with the change's words and the record's name as it quoted it, the
   * words of a record it does not name in their place; failing that, the
   * last place it says the words, with a quoted name to its end.
   */
  public static messageExpression(withheldTypes: Array<string>): string {
    const type: string = AuditRecordNamesRepair.attribute(
      AUDIT_ATTRIBUTES.resourceType,
    );
    const action: string = AuditRecordNamesRepair.attribute(
      AUDIT_ATTRIBUTES.action,
    );
    const quotedName: string = AuditRecordNamesRepair.quotedNameExpression();
    const branches: Array<string> = [
      // An MCP client's authorization that names the client it was made through: the actor's, kept.
      `${type} = ${AuditRecordNamesRepair.literal(AuditResourceType.McpClientAuthorization)} AND ${AuditRecordNamesRepair.attribute(AUDIT_ATTRIBUTES.mcpClientName)} != ''`,
      "message",
    ];

    for (const saying of getAuditChangeSayings()) {
      if (!withheldTypes.includes(saying.resourceType)) {
        continue;
      }

      const isThisChange: string = [
        `${type} = ${AuditRecordNamesRepair.literal(saying.resourceType)}`,
        `${action} = ${AuditRecordNamesRepair.literal(saying.action)}`,
      ].join(" AND ");
      const unnamed: string = AuditRecordNamesRepair.literal(
        ` ${saying.unnamed}`,
      );
      const tail: string = `concat(${AuditRecordNamesRepair.literal(` ${saying.named}`)}, ${quotedName})`;

      branches.push(
        `${isThisChange} AND endsWith(message, ${tail})`,
        `concat(substring(message, 1, length(message) - length(${tail})), ${unnamed})`,
      );

      const needle: string = getNamedWordsNeedle(saying);
      const literal: string = AuditRecordNamesRepair.literal(needle);
      const at: string = AuditRecordNamesRepair.lastPosition(needle);

      branches.push(
        [
          isThisChange,
          `endsWith(message, '"')`,
          `position(message, ${literal}) > 0`,
          // A quoted name follows the words: something before the last quote.
          `length(message) > ${at} - 1 + length(${literal})`,
        ].join(" AND "),
        `concat(substring(message, 1, ${at} - 1), ${unnamed})`,
      );
    }

    return `multiIf(${[...branches, "message"].join(", ")})`;
  }

  // The target by the record's type and id, as describeAuditTarget says one with no name.
  public static targetExpression(): string {
    const type: string = AuditRecordNamesRepair.attribute(
      AUDIT_ATTRIBUTES.resourceType,
    );
    const id: string = AuditRecordNamesRepair.attribute(
      AUDIT_ATTRIBUTES.resourceId,
    );

    return `if(${id} != '', concat(${type}, ': ', ${id}), ${type})`;
  }

  public static repairStatement(data: {
    storageTable: string;
    onCluster: string;
    withheldTypes?: Array<string> | undefined;
  }): string {
    const withheldTypes: Array<string> =
      data.withheldTypes || AuditRecordNamesRepair.getWithheldResourceTypes();
    const name: string = AuditRecordNamesRepair.literal(
      AUDIT_ATTRIBUTES.resourceName,
    );

    /*
     * The message and the target are worked out from the attributes before
     * the attributes lose the name: a mutation's expressions read the row
     * as it was.
     */
    return `ALTER TABLE ${data.storageTable}${data.onCluster} UPDATE message = ${AuditRecordNamesRepair.messageExpression(withheldTypes)}, targetResource = ${AuditRecordNamesRepair.targetExpression()}, attributes = mapFilter((key, value) -> key != ${name}, attributes), attributeKeys = arrayFilter(key -> key != ${name}, attributeKeys) WHERE ${AuditRecordNamesRepair.condition(withheldTypes)}`;
  }

  // The sayings the repair rewords, for whoever reads it back.
  public static getSayings(
    withheldTypes: Array<string>,
  ): Array<AuditChangeSaying> {
    return getAuditChangeSayings().filter(
      (saying: AuditChangeSaying): boolean => {
        return withheldTypes.includes(saying.resourceType);
      },
    );
  }
}
