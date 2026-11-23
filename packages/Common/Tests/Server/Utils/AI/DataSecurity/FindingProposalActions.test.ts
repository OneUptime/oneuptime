import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecuritySetting from "../../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import Queue from "../../../../../Server/Infrastructure/Queue";
import DataSecuritySettingService from "../../../../../Server/Services/DataSecuritySettingService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ConfirmFindingsAction, {
  CONFIRM_FINDINGS_PERMISSION_MESSAGE,
  ConfirmFindingsPlan,
  planConfirmFindings,
  readConfirmFindingsPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ConfirmFindingsAction";
import {
  ADD_SCAN_EXCLUSION_PERMISSION_MESSAGE,
  AddScanExclusionAction,
  planAddScanExclusion,
  planTurnOffDataType,
  TURN_OFF_DATA_TYPE_PERMISSION_MESSAGE,
  TurnOffDataTypeAction,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ScanTuningActions";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import { DataSecurityAiPlannedChange } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import {
  DATA_SECURITY_AI_ALWAYS_ASKS,
  DATA_SECURITY_AI_FINDING_PROPOSAL_KINDS,
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI MAY CHANGE ABOUT FINDINGS AND SCANS (#10372), AND HOW
 * EACH IS MADE AND UNDONE.
 *
 *   - ConfirmFindings: its own confirmations, only without asking where a
 *     rule says so; made as High, as OneUptime AI's own, and undone only
 *     while it stands as it was left. There is no kind that marks a finding
 *     not sensitive.
 *   - TurnOffDataType and AddScanExclusion: what the team's decisions say
 *     of the scans, always asked, made with the approver's own permission.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const FINDING_A: string = "33333333-3333-4333-8333-000000000001";
const FINDING_B: string = "33333333-3333-4333-8333-000000000002";
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const ONE_UPTIME_AI: { props: DatabaseCommonInteractionProps } = {
  props: { isRoot: true },
};

function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
          };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function confirmPlan(): ConfirmFindingsPlan {
  return {
    dataStoreId: STORE_ID.toString(),
    storeName: "orders-eu",
    findings: [FINDING_A, FINDING_B].map((findingId: string) => {
      return {
        findingId,
        dataTypeId: "email-address",
        dataTypeName: "Email address",
        location: `crm.contacts.email_${findingId.slice(-1)}`,
        reason: "Your team confirmed contact_email on two stores.",
      };
    }),
  };
}

function proposalOf(
  change: DataSecurityAiPlannedChange,
  more: Partial<DataSecurityAiProposal> = {},
): DataSecurityAiProposal {
  const proposal: DataSecurityAiProposal = new DataSecurityAiProposal(
    ObjectID.generate(),
  );
  proposal.projectId = PROJECT_ID;
  proposal.dataStoreId = STORE_ID;
  proposal.plan = change.plan;
  Object.assign(proposal, more);
  return proposal;
}

let rows: Map<string, DataStoreFinding>;
let updateSpy: jest.SpyInstance;
let writeSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;

function findingRow(id: string, more: Partial<DataStoreFinding> = {}): void {
  const row: DataStoreFinding = new DataStoreFinding(new ObjectID(id));
  row.isSuppressed = false;
  row.isConfirmed = false;
  row.isConfirmedByAi = false;
  Object.assign(row, more);
  rows.set(id, row);
}

beforeEach(() => {
  rows = new Map();
  jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async (findOneBy: { query: JSONObject }) => {
      return rows.get(String(findOneBy.query["_id"])) || null;
    }) as never);
  updateSpy = jest
    .spyOn(DataStoreFindingService, "updateOneById")
    .mockImplementation((async (updateOneBy: {
      id: ObjectID;
      data: JSONObject;
    }) => {
      const row: DataStoreFinding | undefined = rows.get(
        updateOneBy.id.toString(),
      );

      if (row) {
        Object.assign(row, updateOneBy.data);
      }
    }) as never);
  writeSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (write: { id: ObjectID; data: JSONObject }) => {
      const row: DataStoreFinding | undefined = rows.get(write.id.toString());

      if (row) {
        Object.assign(row, write.data);
      }
    }) as never);
  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the kinds about findings and scans", () => {
  test("are Judge work: a confirmation is a judgement, tuning always asks", () => {
    expect(DATA_SECURITY_AI_FINDING_PROPOSAL_KINDS).toEqual([
      DataSecurityAiProposalKind.ConfirmFindings,
      DataSecurityAiProposalKind.TurnOffDataType,
      DataSecurityAiProposalKind.AddScanExclusion,
    ]);
    expect(
      DATA_SECURITY_AI_PROPOSAL_KINDS[DataSecurityAiProposalKind.ConfirmFindings],
    ).toEqual({
      kind: DataSecurityAiProposalKind.ConfirmFindings,
      work: DataSecurityAiWork.Judge,
      safety: DataSecurityAiChangeSafety.RecordsJudgement,
    });

    for (const kind of [
      DataSecurityAiProposalKind.TurnOffDataType,
      DataSecurityAiProposalKind.AddScanExclusion,
    ]) {
      expect(DATA_SECURITY_AI_PROPOSAL_KINDS[kind].safety).toBe(
        DataSecurityAiChangeSafety.ChangesWhatScansLookFor,
      );
    }

    expect(DATA_SECURITY_AI_ALWAYS_ASKS).toContain(
      DataSecurityAiChangeSafety.ChangesWhatScansLookFor,
    );
  });

  test("no kind marks a finding not sensitive", () => {
    for (const kind of Object.values(DataSecurityAiProposalKind)) {
      expect(kind.toLowerCase()).not.toContain("notsensitive");
      expect(kind.toLowerCase()).not.toContain("suppress");
      expect(kind.toLowerCase()).not.toContain("dismiss");
    }
  });

  test("each is registered, and none is ever planned for an issue", async () => {
    for (const kind of DATA_SECURITY_AI_FINDING_PROPOSAL_KINDS) {
      const action: ReturnType<typeof DataSecurityAiActions.get> =
        DataSecurityAiActions.get(kind);

      expect(action?.kind).toBe(kind);
      expect(action?.appliesToCheck("any-check")).toBe(false);
      expect(await action?.plan({} as never)).toEqual({
        kind: "nothing",
        detail: "not-for-an-issue",
      });
    }
  });

  test("a scan's tuning asks a person even where a rule says Without asking", () => {
    for (const change of [
      planTurnOffDataType({
        dataTypeId: "uk-nino",
        dataTypeName: "UK National Insurance number",
        findings: 4,
        stores: 3,
      }),
      planAddScanExclusion({
        dataStoreId: STORE_ID.toString(),
        storeName: "orders-eu",
        location: "attributes.debug.payload",
        exclusion: "attributes.debug.payload",
        findings: 2,
        dataTypeIds: ["email-address", "phone-number"],
      }),
    ]) {
      expect(change.canRunWithoutAsking).toBe(false);
      expect(
        getDataSecurityAiWithoutAskingVerdict({
          work: {
            autonomy: DataSecurityAiAutonomy.WithoutAsking,
            fromDefaults: false,
          },
          safety: DataSecurityAiChangeSafety.ChangesWhatScansLookFor,
          meetsDefaultConditions: true,
          canRunWithoutAsking: change.canRunWithoutAsking,
          isNamedByRule: true,
          requireTwoApprovalsForRiskierChanges: false,
          changesWithoutAskingThisHour: 0,
        }).runWithoutAsking,
      ).toBe(false);
    }
  });
});

describe("OneUptime AI's own confirmations", () => {
  test("its plan names the findings, and the same set is the same change", () => {
    const change: DataSecurityAiPlannedChange = planConfirmFindings(
      confirmPlan(),
    );

    expect(change.title).toBe("Confirm 2 findings of orders-eu");
    expect(readConfirmFindingsPlan(change.plan)).toEqual(confirmPlan());
    expect(change.planKey).toBe(
      planConfirmFindings({
        ...confirmPlan(),
        findings: [...confirmPlan().findings].reverse(),
      }).planKey,
    );
    expect(change.changeMarkdown).toContain("crm.contacts.email_1");
  });

  test("made without asking: High, OneUptime AI's own, decided now", async () => {
    findingRow(FINDING_A, { confidence: DataConfidence.Low });
    findingRow(FINDING_B, { confidence: DataConfidence.Low });

    const made: { result: JSONObject } = await ConfirmFindingsAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalOf(planConfirmFindings(confirmPlan())),
      actor: ONE_UPTIME_AI,
    });

    expect(made.result).toEqual({
      confirmedFindingIds: [FINDING_A, FINDING_B],
      byOneUptimeAi: true,
    });

    for (const id of [FINDING_A, FINDING_B]) {
      expect(rows.get(id)).toMatchObject({
        isConfirmed: true,
        isConfirmedByAi: true,
        confidence: DataConfidence.High,
      });
      expect(rows.get(id)!.decidedAt).toBeInstanceOf(Date);
    }

    expect(updateSpy.mock.calls[0]![0]).toMatchObject({
      data: { isConfirmed: true },
      props: { isRoot: true },
    });
    // Never a mark of not sensitive.
    for (const call of [...updateSpy.mock.calls, ...writeSpy.mock.calls]) {
      expect((call[0] as { data: JSONObject }).data["isSuppressed"]).toBeUndefined();
    }
    // The store is evaluated again with them.
    expect(
      queueSpy.mock.calls.some((call: Array<unknown>): boolean => {
        return call[2] === "DataSecurity:EvaluateProject";
      }),
    ).toBe(true);
  });

  test("a finding a person decided in between is left as they decided it", async () => {
    findingRow(FINDING_A, { isSuppressed: true });
    findingRow(FINDING_B, { isConfirmed: true });

    const made: { result: JSONObject } = await ConfirmFindingsAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalOf(planConfirmFindings(confirmPlan())),
      actor: ONE_UPTIME_AI,
    });

    expect(made.result["confirmedFindingIds"]).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("approved by a person, it is their confirmation, made with their permission", async () => {
    findingRow(FINDING_A);
    const person: DatabaseCommonInteractionProps = personWith([
      Permission.EditDataStoreFinding,
    ]);

    await ConfirmFindingsAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalOf(
        planConfirmFindings({
          ...confirmPlan(),
          findings: [confirmPlan().findings[0]!],
        }),
      ),
      actor: { props: person, userId: USER_ID },
    });

    expect(updateSpy.mock.calls[0]![0]).toMatchObject({ props: person });
    // Not OneUptime AI's own: the service makes it High as a person's.
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("approving or undoing takes the permission to change findings", () => {
    const proposal: DataSecurityAiProposal = proposalOf(
      planConfirmFindings(confirmPlan()),
    );

    expect(
      ConfirmFindingsAction.getApproveRefusal({
        props: personWith([Permission.ReadDataStoreFinding]),
        proposal,
      }),
    ).toBe(CONFIRM_FINDINGS_PERMISSION_MESSAGE);
    expect(
      ConfirmFindingsAction.getApproveRefusal({
        props: personWith([Permission.EditDataStoreFinding]),
        proposal,
      }),
    ).toBeNull();
    expect(
      ConfirmFindingsAction.getUndoRefusal({
        props: personWith([Permission.SecurityViewer]),
        proposal,
      }),
    ).not.toBeNull();
  });

  test("Undo takes back only what still stands as it was left", async () => {
    findingRow(FINDING_A, {
      isConfirmed: true,
      isConfirmedByAi: true,
    });
    // A person confirmed this one since: it is theirs now.
    findingRow(FINDING_B, { isConfirmed: true, isConfirmedByAi: false });

    const person: DatabaseCommonInteractionProps = personWith([
      Permission.EditDataStoreFinding,
    ]);
    const undone: { summaryMarkdown: string } = await ConfirmFindingsAction.undo(
      {
        projectId: PROJECT_ID,
        proposal: proposalOf(planConfirmFindings(confirmPlan()), {
          result: {
            confirmedFindingIds: [FINDING_A, FINDING_B],
            byOneUptimeAi: true,
          },
        }),
        actor: { props: person, userId: USER_ID },
      },
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(FINDING_A),
      data: { isConfirmed: false },
      props: person,
    });
    expect(rows.get(FINDING_B)!.isConfirmed).toBe(true);
    expect(undone.summaryMarkdown).toContain("taken back");
  });
});

describe("turning off a data type every finding of which was marked not sensitive", () => {
  let setting: DataSecuritySetting;
  let settingUpdate: jest.SpyInstance;

  beforeEach(() => {
    setting = new DataSecuritySetting(ObjectID.generate());
    setting.disabledDataTypeIds = ["iban"];
    jest
      .spyOn(DataSecuritySettingService, "getOrCreateForProject")
      .mockImplementation((async () => {
        return setting;
      }) as never);
    settingUpdate = jest
      .spyOn(DataSecuritySettingService, "updateOneById")
      .mockImplementation((async (updateOneBy: { data: JSONObject }) => {
        Object.assign(setting, updateOneBy.data);
      }) as never);
  });

  const change: () => DataSecurityAiPlannedChange = () => {
    return planTurnOffDataType({
      dataTypeId: "uk-nino",
      dataTypeName: "UK National Insurance number",
      findings: 4,
      stores: 3,
    });
  };

  test("says what it changes and why, by the team's decisions", () => {
    expect(change().title).toBe(
      "Turn off UK National Insurance number in your scans",
    );
    expect(change().reasonMarkdown).toContain("4 findings, on 3 stores");
    expect(change().planKey).toBe("turn-off:uk-nino");
  });

  test("is made with the approver's own permission, and undone while it stands", async () => {
    const person: DatabaseCommonInteractionProps = personWith([
      Permission.EditDataSecuritySetting,
    ]);
    const proposal: DataSecurityAiProposal = proposalOf(change());

    expect(
      TurnOffDataTypeAction.getApproveRefusal({
        props: personWith([Permission.EditDataStoreFinding]),
        proposal,
      }),
    ).toBe(TURN_OFF_DATA_TYPE_PERMISSION_MESSAGE);
    expect(
      TurnOffDataTypeAction.getApproveRefusal({ props: person, proposal }),
    ).toBeNull();

    const made: { result: JSONObject } = await TurnOffDataTypeAction.apply({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: person, userId: USER_ID },
    });

    expect(setting.disabledDataTypeIds).toEqual(["iban", "uk-nino"]);
    expect(settingUpdate.mock.calls[0]![0]).toMatchObject({ props: person });
    expect(made.result).toEqual({ dataTypeId: "uk-nino", turnedOff: true });

    proposal.result = made.result;
    await TurnOffDataTypeAction.undo({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: person, userId: USER_ID },
    });

    expect(setting.disabledDataTypeIds).toEqual(["iban"]);
  });

  test("a type turned off already changes nothing, and Undo leaves it off", async () => {
    setting.disabledDataTypeIds = ["uk-nino"];
    const proposal: DataSecurityAiProposal = proposalOf(change());
    const made: { result: JSONObject } = await TurnOffDataTypeAction.apply({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: personWith([Permission.ProjectAdmin]), userId: USER_ID },
    });

    expect(made.result["turnedOff"]).toBe(false);
    expect(settingUpdate).not.toHaveBeenCalled();

    proposal.result = made.result;
    await TurnOffDataTypeAction.undo({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: personWith([Permission.ProjectAdmin]), userId: USER_ID },
    });

    expect(setting.disabledDataTypeIds).toEqual(["uk-nino"]);
  });

  test("only a built-in type is ever turned off this way", async () => {
    await expect(
      TurnOffDataTypeAction.apply({
        projectId: PROJECT_ID,
        proposal: proposalOf({
          ...change(),
          plan: { dataTypeId: "custom:abc", findings: 3, stores: 2 },
        }),
        actor: ONE_UPTIME_AI,
      }),
    ).rejects.toThrow("no longer says which data type");
  });
});

describe("leaving a location out of a store's scans", () => {
  let store: DataStore;
  let storeUpdate: jest.SpyInstance;

  beforeEach(() => {
    store = new DataStore(STORE_ID);
    store.scanExclusions = ["public.audit"];
    jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
      return store;
    }) as never);
    storeUpdate = jest
      .spyOn(DataStoreService, "updateOneById")
      .mockImplementation((async (updateOneBy: { data: JSONObject }) => {
        Object.assign(store, updateOneBy.data);
      }) as never);
  });

  const change: () => DataSecurityAiPlannedChange = () => {
    return planAddScanExclusion({
      dataStoreId: STORE_ID.toString(),
      storeName: "checkout-logs",
      location: "attributes.debug.payload",
      exclusion: "attributes.debug.payload",
      findings: 3,
      dataTypeIds: ["email-address", "phone-number", "ip-address"],
    });
  };

  test("is added as the approver, and removed by Undo while it is there", async () => {
    const person: DatabaseCommonInteractionProps = personWith([
      Permission.EditDataStore,
    ]);
    const proposal: DataSecurityAiProposal = proposalOf(change());

    expect(
      AddScanExclusionAction.getApproveRefusal({
        props: personWith([Permission.EditDataStoreFinding]),
        proposal,
      }),
    ).toBe(ADD_SCAN_EXCLUSION_PERMISSION_MESSAGE);

    const made: { result: JSONObject } = await AddScanExclusionAction.apply({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: person, userId: USER_ID },
    });

    expect(store.scanExclusions).toEqual([
      "public.audit",
      "attributes.debug.payload",
    ]);
    expect(storeUpdate.mock.calls[0]![0]).toMatchObject({ props: person });

    proposal.result = made.result;
    await AddScanExclusionAction.undo({
      projectId: PROJECT_ID,
      proposal,
      actor: { props: person, userId: USER_ID },
    });

    expect(store.scanExclusions).toEqual(["public.audit"]);
  });

  test("an exclusion that is there already changes nothing", async () => {
    store.scanExclusions = ["ATTRIBUTES.DEBUG.PAYLOAD"];

    const made: { result: JSONObject } = await AddScanExclusionAction.apply({
      projectId: PROJECT_ID,
      proposal: proposalOf(change()),
      actor: { props: personWith([Permission.ProjectOwner]), userId: USER_ID },
    });

    expect(made.result["added"]).toBe(false);
    expect(storeUpdate).not.toHaveBeenCalled();
  });
});
