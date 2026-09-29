import { describe, expect, test } from "@jest/globals";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingRelationSelect,
  getCustomFieldMappingSource,
  getCustomFieldMappingSources,
  hasCustomFieldMappingSource,
} from "../../../Types/CustomField/CustomFieldMappingCatalog";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";

/*
 * The catalog is the single place that says which resource pairs can map, and
 * it is read by three things that must agree: the settings picker, the
 * server-side resolver and the Custom Fields card on a resource. A pair the
 * catalog does not list is a pair the UI will never offer, so the registry
 * refuses to invent one.
 *
 * Keys are TABLE names read off the model instances rather than string
 * literals, so renaming a table breaks this test instead of silently
 * disabling the feature for that resource.
 */

describe("custom field mapping catalog", () => {
  test("alert custom fields can map from the monitor", () => {
    const sources: Array<CustomFieldMappingSourceInfo> =
      getCustomFieldMappingSources(new AlertCustomField().tableName!);

    expect(sources).toHaveLength(1);
    expect(sources[0]!.resource).toBe(CustomFieldMappingSourceResource.Monitor);
    expect(sources[0]!.sourceDefinitionTableName).toBe(
      new MonitorCustomField().tableName,
    );
  });

  /*
   * An alert has ONE monitor; an incident and a maintenance event have many.
   * That difference is what selects between "the source's value" and the
   * agreement/union rules, so it is asserted rather than assumed.
   */
  test("an alert has a single monitor and an incident has many", () => {
    expect(
      getCustomFieldMappingSources(new AlertCustomField().tableName!)[0]!
        .isManySources,
    ).toBe(false);

    expect(
      getCustomFieldMappingSources(new IncidentCustomField().tableName!)[0]!
        .isManySources,
    ).toBe(true);

    expect(
      getCustomFieldMappingSources(
        new ScheduledMaintenanceCustomField().tableName!,
      )[0]!.isManySources,
    ).toBe(true);
  });

  test("resources with nothing to inherit from list no sources", () => {
    expect(
      getCustomFieldMappingSources(new TeamCustomField().tableName!),
    ).toEqual([]);
    expect(
      getCustomFieldMappingSources(new MonitorCustomField().tableName!),
    ).toEqual([]);
  });

  test("an unknown or missing table name is answered with no sources", () => {
    expect(getCustomFieldMappingSources("NotATable")).toEqual([]);
    expect(getCustomFieldMappingSources(undefined)).toEqual([]);
  });

  test("getCustomFieldMappingSource finds a configured resource and rejects others", () => {
    expect(
      getCustomFieldMappingSource({
        definitionTableName: new AlertCustomField().tableName!,
        resource: CustomFieldMappingSourceResource.Monitor,
      }),
    ).toBeDefined();

    expect(
      getCustomFieldMappingSource({
        definitionTableName: new TeamCustomField().tableName!,
        resource: CustomFieldMappingSourceResource.Monitor,
      }),
    ).toBeUndefined();

    expect(
      getCustomFieldMappingSource({
        definitionTableName: new AlertCustomField().tableName!,
        resource: undefined,
      }),
    ).toBeUndefined();
  });

  /*
   * The relation property has to be a real column on the target, or every
   * read of it comes back undefined and mapping silently does nothing. These
   * assertions tie the catalog to the models.
   */
  test("the named relation property exists on the target model", () => {
    const alertSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(new AlertCustomField().tableName!)[0]!;

    expect(
      Object.prototype.hasOwnProperty.call(
        new Alert(),
        alertSource.targetRelationProperty,
      ),
    ).toBe(true);

    const incidentSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(new IncidentCustomField().tableName!)[0]!;

    expect(
      Object.prototype.hasOwnProperty.call(
        new Incident(),
        incidentSource.targetRelationProperty,
      ),
    ).toBe(true);

    const maintenanceSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(
        new ScheduledMaintenanceCustomField().tableName!,
      )[0]!;

    expect(
      Object.prototype.hasOwnProperty.call(
        new ScheduledMaintenance(),
        maintenanceSource.targetRelationProperty,
      ),
    ).toBe(true);
  });

  /*
   * Hooks run before TypeORM resolves the FK column and the relation object
   * into one another, so both spellings have to be listed, FK first.
   */
  test("a single relation lists both the foreign key and the relation object spelling", () => {
    const alertSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(new AlertCustomField().tableName!)[0]!;

    expect(alertSource.relationDataKeys).toEqual(["monitorId", "monitor"]);
  });

  test("builds the right select clause for each relation shape", () => {
    const alertSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(new AlertCustomField().tableName!)[0]!;
    const incidentSource: CustomFieldMappingSourceInfo =
      getCustomFieldMappingSources(new IncidentCustomField().tableName!)[0]!;

    expect(getCustomFieldMappingRelationSelect(alertSource)).toEqual({
      monitorId: true,
    });

    expect(getCustomFieldMappingRelationSelect(incidentSource)).toEqual({
      monitors: { _id: true },
    });
  });
});

describe("hasCustomFieldMappingSource", () => {
  const alertSource: CustomFieldMappingSourceInfo =
    getCustomFieldMappingSources(new AlertCustomField().tableName!)[0]!;
  const incidentSource: CustomFieldMappingSourceInfo =
    getCustomFieldMappingSources(new IncidentCustomField().tableName!)[0]!;

  test("a record with the relation set has a source", () => {
    expect(
      hasCustomFieldMappingSource({
        source: alertSource,
        record: { monitorId: "abc" },
      }),
    ).toBe(true);

    expect(
      hasCustomFieldMappingSource({
        source: incidentSource,
        record: { monitors: [{ _id: "abc" }] },
      }),
    ).toBe(true);
  });

  /*
   * SLO burn-rate alerts, security-event alerts, network-site rollup alerts
   * and AI-declared incidents are all created with no monitor. On those a
   * mapped field can never be filled in automatically, and the card keeps it
   * hand-editable rather than showing a box the operator is locked out of.
   */
  test("a record with no relation has no source", () => {
    expect(
      hasCustomFieldMappingSource({
        source: alertSource,
        record: { monitorId: null },
      }),
    ).toBe(false);

    expect(
      hasCustomFieldMappingSource({ source: alertSource, record: {} }),
    ).toBe(false);

    expect(
      hasCustomFieldMappingSource({
        source: incidentSource,
        record: { monitors: [] },
      }),
    ).toBe(false);

    expect(
      hasCustomFieldMappingSource({ source: incidentSource, record: null }),
    ).toBe(false);
  });
});
