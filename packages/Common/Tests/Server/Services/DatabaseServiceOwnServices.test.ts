import "../TestingUtils/Init";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import IncidentService from "../../../Server/Services/IncidentService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { describe, expect, test } from "@jest/globals";

/*
 * EACH MODEL'S OWN SERVICE (DatabaseService.getServiceOf).
 *
 * What must answer as a record's own read does - the audit log holding an
 * entry's values to what its reader may read of the record (#10642,
 * AuditLogReadAccess) - asks the record's service, its read hooks and all:
 * a private incident is kept to its owners by IncidentService, not by the
 * permission check. Each service of a class of its own is kept as it is
 * built, the first for its model; a plain DatabaseService, as a lookup
 * makes one, is none. So every service of the registry is its model's own,
 * and no other service of a model gets in first.
 */

type AnyService = DatabaseService<BaseModel>;

describe("DatabaseService.getServiceOf", () => {
  test("is the service a model's records are read through: IncidentService for Incident", () => {
    expect(DatabaseService.getServiceOf(Incident)).toBe(IncidentService);
  });

  test("every service of the registry is its model's own, and the first built for it", () => {
    const notOwn: Array<string> = [];

    for (const service of Services as Array<unknown>) {
      if (!(service instanceof DatabaseService)) {
        continue;
      }

      const own: AnyService | null = DatabaseService.getServiceOf(
        (service as AnyService).modelType,
      );

      if (own !== service) {
        notOwn.push((service as AnyService).getModel().tableName || "");
      }
    }

    expect(notOwn).toEqual([]);
  });

  test("a plain DatabaseService, as a lookup makes one, never stands for a model", () => {
    const before: AnyService | null = DatabaseService.getServiceOf(Monitor);

    new DatabaseService<Monitor>(Monitor);

    expect(DatabaseService.getServiceOf(Monitor)).toBe(before);
    expect(DatabaseService.getServiceOf(Monitor)).not.toBeNull();
    expect(DatabaseService.getServiceOf(Monitor)!.constructor).not.toBe(
      DatabaseService,
    );
  });

  test("a model whose service is not built yet has none", () => {
    class NeverServed extends BaseModel {}

    expect(DatabaseService.getServiceOf(NeverServed)).toBeNull();
  });
});
