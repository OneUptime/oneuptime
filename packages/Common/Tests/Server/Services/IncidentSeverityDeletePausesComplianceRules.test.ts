import { Service as AlertSeverityServiceClass } from "../../../Server/Services/AlertSeverityService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { Service as IncidentSeverityServiceClass } from "../../../Server/Services/IncidentSeverityService";
import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComplianceSeverityKind } from "../../../Types/Team/ComplianceRule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Deleting an incident or alert severity must not silently widen a team
 * compliance rule scoped only to it.
 *
 * A rule's severity scope is stored only as join rows, which the database
 * deletes with the severity (ON DELETE CASCADE), and a rule with no severity
 * left reads exactly like one created for every severity of its kind: "Call
 * for Critical incidents" became "Call for every incident severity" and the
 * whole team failed a rule nobody wrote. So the two severity services, which
 * own the delete:
 *
 *  - BEFORE the delete - the only moment the join rows still say what each
 *    rule was scoped to - read the severities the delete will remove and ask
 *    TeamComplianceSettingService which enabled rules are scoped only to them;
 *  - AFTER the delete has actually happened, have those rules that are left
 *    with no severity paused. A delete that is refused (the permission layer,
 *    or incidents still using the severity) therefore pauses nothing.
 *
 * TeamComplianceSettingService's side - which rules, and the pause itself - is
 * pinned in TeamComplianceSettingService.test.ts; this file pins that both
 * services call it, in that order, with the right kind, and that the ordering
 * work the hooks already did is unchanged.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const SEVERITY_ID: string = "5e000000-0000-4000-8000-000000000001";
const SCOPED_RULE_ID: string = "77777777-7777-4777-8777-000000000001";

type SeverityModel = IncidentSeverity | AlertSeverity;

type OnBeforeDeleteFunction = (
  deleteBy: DeleteBy<SeverityModel>,
) => Promise<OnDelete<SeverityModel>>;

type OnDeleteSuccessFunction = (
  onDelete: OnDelete<SeverityModel>,
  itemIdsBeforeDelete: Array<ObjectID>,
) => Promise<OnDelete<SeverityModel>>;

type RearrangeOrderFunction = (
  currentOrder: number,
  projectId: ObjectID,
  increaseOrder: boolean,
) => Promise<void>;

type InternalFindFunction = (
  findBy: JSONObject,
) => Promise<Array<SeverityModel>>;

interface SeverityServiceInternals {
  onBeforeDelete: OnBeforeDeleteFunction;
  onDeleteSuccess: OnDeleteSuccessFunction;
  rearrangeOrder: RearrangeOrderFunction;
  _findBy: InternalFindFunction;
}

interface SeverityServiceCase {
  label: string;
  kind: ComplianceSeverityKind;
  build: () => DatabaseService<SeverityModel>;
  row: () => SeverityModel;
}

const CASES: Array<SeverityServiceCase> = [
  {
    label: "IncidentSeverityService",
    kind: ComplianceSeverityKind.Incident,
    build: (): DatabaseService<SeverityModel> => {
      return new IncidentSeverityServiceClass() as unknown as DatabaseService<SeverityModel>;
    },
    row: (): SeverityModel => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID;
      severity.order = 2;
      severity.projectId = PROJECT_ID;
      return severity;
    },
  },
  {
    label: "AlertSeverityService",
    kind: ComplianceSeverityKind.Alert,
    build: (): DatabaseService<SeverityModel> => {
      return new AlertSeverityServiceClass() as unknown as DatabaseService<SeverityModel>;
    },
    row: (): SeverityModel => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = SEVERITY_ID;
      severity.order = 2;
      severity.projectId = PROJECT_ID;
      return severity;
    },
  },
];

const SIGNED_IN: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

const deleteByFor: (
  props: DatabaseCommonInteractionProps,
) => DeleteBy<SeverityModel> = (
  props: DatabaseCommonInteractionProps,
): DeleteBy<SeverityModel> => {
  return {
    query: { _id: SEVERITY_ID },
    limit: 1,
    skip: 0,
    props: props,
  } as DeleteBy<SeverityModel>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "$label - deleting a severity pauses the compliance rules scoped only to it",
  (testCase: SeverityServiceCase) => {
    let service: DatabaseService<SeverityModel>;
    let internals: SeverityServiceInternals;
    let findBy: jest.SpyInstance;
    let getRulesScopedOnlyTo: jest.SpyInstance;
    let pauseRules: jest.SpyInstance;
    let rearrangeOrder: jest.SpyInstance;
    let events: Array<string>;

    beforeEach(() => {
      events = [];
      service = testCase.build();
      internals = service as unknown as SeverityServiceInternals;

      findBy = jest
        .spyOn(service, "findBy")
        .mockResolvedValue([testCase.row()] as never);

      getRulesScopedOnlyTo = jest
        .spyOn(TeamComplianceSettingService, "getRulesScopedOnlyTo")
        .mockImplementation((): Promise<Array<string>> => {
          events.push("find scoped rules");
          return Promise.resolve([SCOPED_RULE_ID]);
        });

      pauseRules = jest
        .spyOn(TeamComplianceSettingService, "pauseRulesLeftWithoutSeverities")
        .mockImplementation((): Promise<Array<string>> => {
          events.push("pause rules");
          return Promise.resolve([SCOPED_RULE_ID]);
        });

      rearrangeOrder = jest
        .spyOn(internals, "rearrangeOrder")
        .mockResolvedValue(undefined as never);
    });

    test("before the delete, the severities it removes are read as root and the rules scoped only to them are looked up", async () => {
      const onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN),
      );

      expect(findBy).toHaveBeenCalledTimes(1);

      const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
      expect(read["query"]).toEqual({ _id: SEVERITY_ID });
      expect(read["select"]).toEqual({
        _id: true,
        order: true,
        projectId: true,
      });
      expect(read["limit"]).toBe(1);
      expect(read["skip"]).toBe(0);
      expect(read["props"]).toEqual({ isRoot: true });

      expect(getRulesScopedOnlyTo).toHaveBeenCalledTimes(1);

      const lookup: {
        severityKind: ComplianceSeverityKind;
        severities: Array<SeverityModel>;
      } = getRulesScopedOnlyTo.mock.calls[0]![0] as {
        severityKind: ComplianceSeverityKind;
        severities: Array<SeverityModel>;
      };
      expect(lookup.severityKind).toBe(testCase.kind);
      expect(
        lookup.severities.map((severity: SeverityModel): string => {
          return String(severity._id);
        }),
      ).toEqual([SEVERITY_ID]);

      // Nothing is paused yet: the delete may still be refused.
      expect(pauseRules).not.toHaveBeenCalled();
      expect(
        (onDelete.carryForward as { complianceSettingIds: Array<string> })
          .complianceSettingIds,
      ).toEqual([SCOPED_RULE_ID]);
    });

    test("a root delete is looked up too - it only skips the re-ranking", async () => {
      await internals.onBeforeDelete(deleteByFor({ isRoot: true }));

      expect(getRulesScopedOnlyTo).toHaveBeenCalledTimes(1);
    });

    test("after the delete, the rules carried forward are handed over to be paused", async () => {
      const deleteBy: DeleteBy<SeverityModel> = deleteByFor(SIGNED_IN);
      const onDelete: OnDelete<SeverityModel> =
        await internals.onBeforeDelete(deleteBy);

      await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);

      expect(pauseRules).toHaveBeenCalledTimes(1);
      expect(pauseRules.mock.calls[0]![0]).toEqual({
        severityKind: testCase.kind,
        settingIds: [SCOPED_RULE_ID],
      });
    });

    test("with no rule scoped only to the severity, nothing is paused", async () => {
      getRulesScopedOnlyTo.mockResolvedValue([] as never);

      const onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN),
      );

      await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);

      expect(pauseRules).not.toHaveBeenCalled();
    });

    test("a pause that fails is logged, not reported as a failed delete - the severity is already gone", async () => {
      pauseRules.mockRejectedValue(new Error("database went away") as never);
      const loggerError: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {
          return undefined;
        });

      const onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN),
      );

      await expect(
        internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]),
      ).resolves.toBeDefined();

      expect(loggerError).toHaveBeenCalled();
    });

    test("a signed-in delete still re-ranks the severities that remain, and a root delete still does not", async () => {
      let onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN),
      );
      await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);

      expect(rearrangeOrder).toHaveBeenCalledTimes(1);
      expect(rearrangeOrder.mock.calls[0]).toEqual([2, PROJECT_ID, false]);

      rearrangeOrder.mockClear();

      onDelete = await internals.onBeforeDelete(deleteByFor({ isRoot: true }));
      await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);

      expect(rearrangeOrder).not.toHaveBeenCalled();
    });

    describe("through deleteOneById", () => {
      let repositoryDelete: jest.Mock;

      beforeEach(() => {
        repositoryDelete = jest.fn((): Promise<{ affected: number }> => {
          events.push("delete severity");
          return Promise.resolve({ affected: 1 });
        });

        jest.spyOn(service, "getRepository").mockReturnValue({
          delete: repositoryDelete,
        } as never);
        jest
          .spyOn(internals, "_findBy")
          .mockResolvedValue([testCase.row()] as never);
        jest
          .spyOn(ModelPermission, "checkDeleteQueryPermission")
          .mockImplementation(((_modelType: unknown, query: unknown) => {
            return Promise.resolve(query);
          }) as never);
        jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
        jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
      });

      test("the rules are looked up before the severity is deleted and paused after", async () => {
        await service.deleteOneById({
          id: new ObjectID(SEVERITY_ID),
          props: { isRoot: true },
        });

        expect(events).toEqual([
          "find scoped rules",
          "delete severity",
          "pause rules",
        ]);
      });

      test("a delete the database refuses - incidents still use the severity - pauses nothing", async () => {
        repositoryDelete.mockRejectedValue(
          new Error(
            'update or delete on table "IncidentSeverity" violates foreign key constraint',
          ) as never,
        );

        await expect(
          service.deleteOneById({
            id: new ObjectID(SEVERITY_ID),
            props: { isRoot: true },
          }),
        ).rejects.toThrow();

        expect(getRulesScopedOnlyTo).toHaveBeenCalledTimes(1);
        expect(pauseRules).not.toHaveBeenCalled();
      });
    });
  },
);
