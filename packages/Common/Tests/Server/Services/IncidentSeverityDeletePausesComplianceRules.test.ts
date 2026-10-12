import { Service as AlertSeverityServiceClass } from "../../../Server/Services/AlertSeverityService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { Service as IncidentSeverityServiceClass } from "../../../Server/Services/IncidentSeverityService";
import TeamComplianceSettingService, {
  SEVERITIES_DELETED_OPTION,
} from "../../../Server/Services/TeamComplianceSettingService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComplianceSeverityKind } from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubRowsCallerMayDeleteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

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
 *    TeamComplianceSettingService which rules reference any of them;
 *  - AFTER the delete has actually happened, have those rules that are left
 *    with no severity paused and marked. A delete that is refused (the
 *    permission layer, or incidents still using the severity) therefore
 *    pauses nothing.
 *
 * TeamComplianceSettingService's side - which rules, and the pause itself - is
 * pinned in TeamComplianceSettingService.test.ts; this file pins that both
 * services call it, in that order, with the right kind. A severity's place in
 * its list is kept by DatabaseService (@ListOrderColumn), so a delete no
 * longer re-ranks the severities that remain: their numbers keep their order
 * with a gap where the deleted one was.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const SEVERITY_ID: string = "5e000000-0000-4000-8000-000000000001";
const OTHER_SEVERITY_ID: string = "5e000000-0000-4000-8000-000000000002";
const SCOPED_RULE_ID: string = "77777777-7777-4777-8777-000000000001";

type SeverityModel = IncidentSeverity | AlertSeverity;

type OnBeforeDeleteFunction = (
  deleteBy: DeleteBy<SeverityModel>,
) => Promise<OnDelete<SeverityModel>>;

type OnDeleteSuccessFunction = (
  onDelete: OnDelete<SeverityModel>,
  itemIdsBeforeDelete: Array<ObjectID>,
) => Promise<OnDelete<SeverityModel>>;

type InternalFindFunction = (
  findBy: JSONObject,
) => Promise<Array<SeverityModel>>;

interface SeverityServiceInternals {
  onBeforeDelete: OnBeforeDeleteFunction;
  onDeleteSuccess: OnDeleteSuccessFunction;
  _findBy: InternalFindFunction;
}

interface SeverityServiceCase {
  label: string;
  kind: ComplianceSeverityKind;
  // A rule type scoped by this kind of severity.
  ruleType: ComplianceRuleType;
  build: () => DatabaseService<SeverityModel>;
  row: () => SeverityModel;
}

const CASES: Array<SeverityServiceCase> = [
  {
    label: "IncidentSeverityService",
    kind: ComplianceSeverityKind.Incident,
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
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
    ruleType: ComplianceRuleType.HasAlertOnCallRules,
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
  severityId?: string,
) => DeleteBy<SeverityModel> = (
  props: DatabaseCommonInteractionProps,
  severityId?: string,
): DeleteBy<SeverityModel> => {
  return {
    query: { _id: severityId || SEVERITY_ID },
    limit: 1,
    skip: 0,
    props: props,
  } as DeleteBy<SeverityModel>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "$label - deleting a severity pauses the compliance rules it leaves with no severity",
  (testCase: SeverityServiceCase) => {
    let service: DatabaseService<SeverityModel>;
    let internals: SeverityServiceInternals;
    let findBy: jest.SpyInstance;
    let getRulesScopedToAnyOf: jest.SpyInstance;
    let pauseRules: jest.SpyInstance;
    let events: Array<string>;

    beforeEach(() => {
      events = [];
      service = testCase.build();
      internals = service as unknown as SeverityServiceInternals;

      findBy = jest
        .spyOn(service, "findBy")
        .mockResolvedValue([testCase.row()] as never);
      // The severities a signed-in caller may delete: those the read reaches.
      stubRowsCallerMayDeleteLikeFindBy(service, findBy);

      getRulesScopedToAnyOf = jest
        .spyOn(TeamComplianceSettingService, "getRulesScopedToAnyOf")
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
    });

    test("before the delete, the severities it removes are read as root and the rules that reference them are looked up", async () => {
      const onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN),
      );

      expect(findBy).toHaveBeenCalledTimes(1);

      const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
      expect(read["query"]).toEqual({ _id: SEVERITY_ID });
      expect(read["select"]).toEqual({
        _id: true,
        projectId: true,
      });
      expect(read["limit"]).toBe(1);
      expect(read["skip"]).toBe(0);
      expect(read["props"]).toEqual({ isRoot: true, ignoreHooks: true });

      expect(getRulesScopedToAnyOf).toHaveBeenCalledTimes(1);

      const lookup: {
        severityKind: ComplianceSeverityKind;
        severities: Array<SeverityModel>;
      } = getRulesScopedToAnyOf.mock.calls[0]![0] as {
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

    test("a root delete is looked up too", async () => {
      await internals.onBeforeDelete(deleteByFor({ isRoot: true }));

      expect(getRulesScopedToAnyOf).toHaveBeenCalledTimes(1);
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

    test("with no rule referencing the severity, nothing is paused", async () => {
      getRulesScopedToAnyOf.mockResolvedValue([] as never);

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

    test("a delete leaves the other severities where they are: nothing is re-ranked", async () => {
      const updateOneBy: jest.SpyInstance = jest
        .spyOn(service, "updateOneBy")
        .mockResolvedValue(1 as never);
      const updateColumns: jest.SpyInstance = jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined as never);

      for (const props of [SIGNED_IN, { isRoot: true }]) {
        const onDelete: OnDelete<SeverityModel> =
          await internals.onBeforeDelete(deleteByFor(props));
        await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);
      }

      expect(updateOneBy).not.toHaveBeenCalled();
      expect(updateColumns).not.toHaveBeenCalled();
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

        expect(getRulesScopedToAnyOf).toHaveBeenCalledTimes(1);
        expect(pauseRules).not.toHaveBeenCalled();
      });
    });
  },
);

/*
 * Two deletes side by side - Terraform destroys resources in parallel, or two
 * admins clean up at once - of the two severities of a rule scoped to both.
 * Both look the rule up before either deletes, so each sees the other's
 * severity still attached. Carrying forward only rules scoped to nothing but
 * what one delete removes carried the rule in neither, and it was left
 * enabled with no severities: a rule for EVERY severity that nobody wrote.
 * Here TeamComplianceSettingService runs for real over an in-memory rule
 * whose join rows cascade away as each delete commits.
 */
describe.each(CASES)(
  "$label - two deletes of one rule's severities, side by side",
  (testCase: SeverityServiceCase) => {
    let service: DatabaseService<SeverityModel>;
    let internals: SeverityServiceInternals;
    let attached: Array<string>;
    let settingsUpdateBy: jest.SpyInstance;

    const severityRow: (id: string) => SeverityModel = (
      id: string,
    ): SeverityModel => {
      const severity: SeverityModel = testCase.row();
      severity._id = id;
      return severity;
    };

    // The rule as the settings reads see it: its join rows as they stand.
    const storedRule: () => TeamComplianceSetting =
      (): TeamComplianceSetting => {
        const rule: TeamComplianceSetting = new TeamComplianceSetting();
        rule._id = SCOPED_RULE_ID;
        rule.projectId = PROJECT_ID;
        rule.ruleType = testCase.ruleType;
        rule.enabled = true;

        const severities: Array<SeverityModel> = attached.map(
          (id: string): SeverityModel => {
            return severityRow(id);
          },
        );

        if (testCase.kind === ComplianceSeverityKind.Incident) {
          rule.incidentSeverities = severities as Array<IncidentSeverity>;
          rule.alertSeverities = [];
        } else {
          rule.alertSeverities = severities as Array<AlertSeverity>;
          rule.incidentSeverities = [];
        }

        return rule;
      };

    beforeEach(() => {
      attached = [SEVERITY_ID, OTHER_SEVERITY_ID];
      service = testCase.build();
      internals = service as unknown as SeverityServiceInternals;

      const findBy: jest.SpyInstance = jest
        .spyOn(service, "findBy")
        .mockImplementation(((read: { query: JSONObject }) => {
          return Promise.resolve([severityRow(String(read.query["_id"]))]);
        }) as never);
      // The severities a signed-in caller may delete: those the read reaches.
      stubRowsCallerMayDeleteLikeFindBy(service, findBy);

      jest
        .spyOn(TeamComplianceSettingService, "findBy")
        .mockImplementation((() => {
          return Promise.resolve([storedRule()]);
        }) as never);

      settingsUpdateBy = jest
        .spyOn(TeamComplianceSettingService, "updateBy")
        .mockResolvedValue(1 as never);
    });

    // What the database does when the delete of `id` commits.
    const cascade: (id: string) => void = (id: string): void => {
      attached = attached.filter((attachedId: string): boolean => {
        return attachedId !== id;
      });
    };

    test("the rule is carried by both, and paused and marked once - by whichever delete commits last", async () => {
      const first: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN, SEVERITY_ID),
      );
      const second: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN, OTHER_SEVERITY_ID),
      );

      for (const onDelete of [first, second]) {
        expect(
          (onDelete.carryForward as { complianceSettingIds: Array<string> })
            .complianceSettingIds,
        ).toEqual([SCOPED_RULE_ID]);
      }

      cascade(SEVERITY_ID);
      await internals.onDeleteSuccess(first, [new ObjectID(SEVERITY_ID)]);

      // The other severity is still attached: nothing to pause yet.
      expect(settingsUpdateBy).not.toHaveBeenCalled();

      cascade(OTHER_SEVERITY_ID);
      await internals.onDeleteSuccess(second, [
        new ObjectID(OTHER_SEVERITY_ID),
      ]);

      expect(settingsUpdateBy).toHaveBeenCalledTimes(1);

      const write: JSONObject = settingsUpdateBy.mock
        .calls[0]![0] as JSONObject;
      expect(write["data"]).toEqual({
        enabled: false,
        options: { [SEVERITIES_DELETED_OPTION]: true },
      });
      expect(write["props"]).toEqual({ isRoot: true });
    });

    test("deleting only one of the two leaves the rule alone", async () => {
      const onDelete: OnDelete<SeverityModel> = await internals.onBeforeDelete(
        deleteByFor(SIGNED_IN, SEVERITY_ID),
      );

      cascade(SEVERITY_ID);
      await internals.onDeleteSuccess(onDelete, [new ObjectID(SEVERITY_ID)]);

      expect(settingsUpdateBy).not.toHaveBeenCalled();
    });
  },
);
