import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Realtime from "../../../Server/Utils/Realtime";
import { NO_READER_ACCESS } from "../../../Server/Utils/Realtime/RealtimeReadAccess";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

describe("DatabaseService relation-only rule rollout writes", () => {
  let service: DatabaseService<AlertReminderRule>;
  let findByMock: MockFunction;
  let updateMock: MockFunction;
  let saveMock: MockFunction;
  let workflowMock: MockFunction;
  let realtimeMock: MockFunction;
  let ruleId: ObjectID;
  let foundRule: AlertReminderRule;

  beforeEach(() => {
    jest.restoreAllMocks();
    ruleId = ObjectID.generate();
    service = new DatabaseService<AlertReminderRule>(AlertReminderRule);
    foundRule = new AlertReminderRule();
    foundRule._id = ruleId.toString();
    foundRule.projectId = ObjectID.generate();
    foundRule.isEnabled = true;

    findByMock = jest
      .spyOn(
        service as unknown as { _findBy: () => Promise<unknown> },
        "_findBy",
      )
      .mockResolvedValue([foundRule] as never) as unknown as MockFunction;

    updateMock = getJestMockFunction();
    updateMock.mockResolvedValue({ affected: 1 });
    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown): Promise<unknown> => {
      return Promise.resolve(item);
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ save: saveMock, update: updateMock } as never);

    workflowMock = jest
      .spyOn(
        service as unknown as {
          onTriggerWorkflow: () => Promise<void>;
        },
        "onTriggerWorkflow",
      )
      .mockResolvedValue(undefined) as unknown as MockFunction;
    realtimeMock = jest
      .spyOn(
        service as unknown as {
          onTriggerRealtime: () => Promise<void>;
        },
        "onTriggerRealtime",
      )
      .mockResolvedValue(undefined) as unknown as MockFunction;

    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((
        _modelType: unknown,
        query: unknown,
      ): Promise<unknown> => {
        return Promise.resolve(query);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [true, null],
    [false, false],
  ])(
    "encodes a criteria-backed enabled-only update from %p to %p",
    async (logicalEnabled: boolean, physicalEnabled: boolean | null) => {
      foundRule.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [ObjectID.generate().toString()],
          },
        ],
        isEnabled: true,
      };

      await service.updateOneById({
        id: ruleId,
        data: { isEnabled: logicalEnabled },
        props: { isRoot: true },
      });

      const setPayload: JSONObject = updateMock.mock.calls[0]![1] as JSONObject;
      const findRequest: { select: JSONObject } = findByMock.mock
        .calls[0]![0] as { select: JSONObject };

      expect(findRequest.select["criteria"]).toBe(true);
      expect(setPayload["isEnabled"]).toBe(physicalEnabled);

      if (logicalEnabled) {
        expect(workflowMock).not.toHaveBeenCalled();
      } else {
        expect(workflowMock).toHaveBeenCalledTimes(1);
      }
    },
  );

  test.each([true, false])(
    "keeps a legacy enabled-only update at physical %p",
    async (isEnabled: boolean) => {
      foundRule.criteria = null;

      await service.updateOneById({
        id: ruleId,
        data: { isEnabled: isEnabled },
        props: { isRoot: true },
      });

      const setPayload: JSONObject = updateMock.mock.calls[0]![1] as JSONObject;
      expect(setPayload["isEnabled"]).toBe(isEnabled);
    },
  );

  test("encodes mixed bulk updates per row without changing legacy semantics", async () => {
    const criteriaRule: AlertReminderRule = new AlertReminderRule();
    criteriaRule._id = ObjectID.generate().toString();
    criteriaRule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    };
    criteriaRule.isEnabled = false;

    const legacyRule: AlertReminderRule = new AlertReminderRule();
    legacyRule._id = ObjectID.generate().toString();
    legacyRule.criteria = null;
    legacyRule.isEnabled = false;
    findByMock.mockResolvedValue([criteriaRule, legacyRule]);

    await service.updateBy({
      query: {},
      data: { isEnabled: true },
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(
      (updateMock.mock.calls[0]![1] as JSONObject)["isEnabled"],
    ).toBeNull();
    expect((updateMock.mock.calls[1]![1] as JSONObject)["isEnabled"]).toBe(
      true,
    );
  });

  test("triggers update workflows and realtime when only JSON criteria change", async () => {
    const originalLabelId: string = ObjectID.generate().toString();
    const updatedLabelId: string = ObjectID.generate().toString();

    foundRule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [originalLabelId],
        },
      ],
    };

    await service.updateOneById({
      id: ruleId,
      data: {
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "labels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [updatedLabelId],
            },
          ],
        },
        // Required rollout shadow; the logical enabled state is unchanged.
        isEnabled: true,
      },
      props: { isRoot: true },
    });

    expect(workflowMock).toHaveBeenCalledTimes(1);
    expect(realtimeMock).toHaveBeenCalledTimes(1);
  });

  test("uses repository.update for criteria edits that include legacy relation arrays", async () => {
    const originalLabelId: string = ObjectID.generate().toString();
    const updatedLabelId: string = ObjectID.generate().toString();
    const severityId: string = ObjectID.generate().toString();

    foundRule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [originalLabelId],
        },
      ],
      isEnabled: true,
    };

    await service.updateOneById({
      id: ruleId,
      data: {
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "labels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [updatedLabelId],
            },
          ],
          isEnabled: true,
        },
        isEnabled: false,
        labels: [updatedLabelId],
        alertSeverities: [severityId],
      } as never,
      props: { isRoot: true },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();

    const updatePayload: JSONObject = updateMock.mock
      .calls[0]![1] as JSONObject;
    expect(updatePayload["labels"]).toBeUndefined();
    expect(updatePayload["alertSeverities"]).toBeUndefined();
  });

  test("keeps a disabled rule disabled across a later criteria-only update", async () => {
    const originalLabelId: string = ObjectID.generate().toString();
    const updatedLabelId: string = ObjectID.generate().toString();

    foundRule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [originalLabelId],
        },
      ],
      isEnabled: true,
    };

    await service.updateOneById({
      id: ruleId,
      data: { isEnabled: false },
      props: { isRoot: true },
    });

    const disablePayload: JSONObject = updateMock.mock
      .calls[0]![1] as JSONObject;
    const disabledCriteria: JSONObject = disablePayload[
      "criteria"
    ] as JSONObject;

    expect(disablePayload["isEnabled"]).toBe(false);
    expect(disabledCriteria["isEnabled"]).toBe(false);

    foundRule.criteria = disabledCriteria as unknown as RuleCriteria;
    foundRule.isEnabled = false;

    await service.updateOneById({
      id: ruleId,
      data: {
        criteria: {
          ...disabledCriteria,
          filters: [
            {
              field: "labels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [updatedLabelId],
            },
          ],
        },
      },
      props: { isRoot: true },
    });

    const criteriaUpdatePayload: JSONObject = updateMock.mock
      .calls[1]![1] as JSONObject;

    expect(criteriaUpdatePayload["isEnabled"]).toBe(false);
    expect(criteriaUpdatePayload["criteria"]).toMatchObject({
      isEnabled: false,
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  /*
   * A rule whose stored criteria say it is off while its switch says on:
   * writing the switch alone, as it stands, brings the criteria back in step
   * with it. That is a change of the criteria column, and the one rule that
   * decides whether a write changed a row (getChangedColumns) says so to the
   * workflow, and to the decision taken before the write, alike.
   */
  describe("a switch written alone over criteria out of step with it", () => {
    beforeEach(() => {
      foundRule.isEnabled = true;
      foundRule.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [ObjectID.generate().toString()],
          },
        ],
        isEnabled: false,
      };
    });

    test("tells the workflow the criteria changed, never an empty list that skips Listen on", async () => {
      await service.updateOneById({
        id: ruleId,
        data: { isEnabled: true },
        props: { isRoot: true },
      });

      expect(workflowMock).toHaveBeenCalledTimes(1);

      const updatedFields: JSONObject = (
        workflowMock.mock.calls[0]![3] as { updatedFields: JSONObject }
      ).updatedFields;

      expect(Object.keys(updatedFields)).toEqual(["criteria"]);
      expect(updatedFields["criteria"]).toMatchObject({ isEnabled: true });
    });

    test("and the decision before the write judges the row the same way: it changes", async () => {
      jest
        .spyOn(
          service as unknown as { sendsRealtimeUpdateEvents: () => boolean },
          "sendsRealtimeUpdateEvents",
        )
        .mockReturnValue(true);
      jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
      const snapshot: MockFunction = jest
        .spyOn(Realtime, "snapshotReadAccess")
        .mockResolvedValue(NO_READER_ACCESS) as unknown as MockFunction;

      await service.updateOneById({
        id: ruleId,
        data: { isEnabled: true },
        props: { isRoot: true },
      });

      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(
        (
          snapshot.mock.calls[0]![0] as { modelIds: Array<ObjectID> }
        ).modelIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([ruleId.toString()]);
    });

    test("while a rule already in step, written back as it stands, is told nothing and decides nothing", async () => {
      (foundRule.criteria as RuleCriteria).isEnabled = true;
      jest
        .spyOn(
          service as unknown as { sendsRealtimeUpdateEvents: () => boolean },
          "sendsRealtimeUpdateEvents",
        )
        .mockReturnValue(true);
      jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
      const snapshot: MockFunction = jest
        .spyOn(Realtime, "snapshotReadAccess")
        .mockResolvedValue(NO_READER_ACCESS) as unknown as MockFunction;

      await service.updateOneById({
        id: ruleId,
        data: { isEnabled: true },
        props: { isRoot: true },
      });

      expect(workflowMock).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
    });
  });
});
