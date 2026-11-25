import AIService from "../../../../Server/Services/AIService";
import DataSecuritySettingService from "../../../../Server/Services/DataSecuritySettingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import AuditEvidenceDrafter, {
  EVIDENCE_CHANGE_REFUSED_MESSAGE,
} from "../../../../Server/Utils/AI/DataSecurity/AuditEvidenceDrafter";
import DataSecurityAiCall from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import ImpactAssessmentDrafter, {
  STORE_CHANGE_REFUSED_MESSAGE,
} from "../../../../Server/Utils/AI/DataSecurity/ImpactAssessmentDrafter";
import RecordOfProcessingReader from "../../../../Server/Utils/DataSecurity/RecordOfProcessingReader";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ComplianceFramework from "../../../../Types/DataSecurity/ComplianceFramework";
import { ImpactAssessmentPart } from "../../../../Types/DataSecurity/ImpactAssessment";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO MAY CHANGE THE COMPLIANCE PAPERWORK (#10375), DECIDED FOR WHAT IT
 * CHANGES.
 *
 * Holding an edit permission somewhere in the project (the table half,
 * CallerPermission.holdsModelPermission) never says whether it reaches a
 * given store: a grant limited to the "staging" label does not reach a
 * store labelled "production", nor one scoped to Owned a store nobody on
 * the caller's teams owns (TableHalfWriteGuard). So:
 *
 *   - a store's impact assessment is drafted and edited, and its page
 *     offers to, only for who may change that store - its own row, as an
 *     update of it is (RecordOfProcessingReader.mayChangeStore);
 *   - the record of processing offers changes when the reader may change
 *     one of the stores it lists (mayChangeAnyStore), and each change is
 *     decided for its own store (RecordOfProcessingWriter);
 *   - the project's audit evidence speaks for every issue in it, so it is
 *     drafted and edited by who may change Data Security issues across the
 *     whole project (AuditEvidenceDrafter.mayChange).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10375000-0000-4000-8000-0000000000e1",
);
const STORE_ID: ObjectID = new ObjectID("10375000-0000-4000-8000-0000000000e2");
const LABEL_ID: ObjectID = new ObjectID("10375000-0000-4000-8000-0000000000e3");

function caller(
  permissions: Array<Permission>,
  labelIds?: Array<ObjectID> | undefined,
): DatabaseCommonInteractionProps {
  return customDomainCaller({
    permissions,
    projectId: PROJECT_ID,
    labelIds,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a store's record and impact assessment are changed by who may change that store", () => {
  test("asked of the store's own row, with the caller's own props", async () => {
    const props: DatabaseCommonInteractionProps = caller([
      Permission.EditDataStore,
    ]);
    const updatable: SpyInstance<typeof DataStoreService.findOneUpdatableById> =
      jest
        .spyOn(DataStoreService, "findOneUpdatableById")
        .mockResolvedValue(new DataStore(STORE_ID));

    expect(
      await RecordOfProcessingReader.mayChangeStore({
        dataStoreId: STORE_ID,
        props,
      }),
    ).toBe(true);
    expect(updatable).toHaveBeenCalledWith({
      id: STORE_ID,
      select: { _id: true },
      props,
    });
  });

  test("a store out of the caller's reach, or no edit of stores at all, is changed by nobody", async () => {
    const props: DatabaseCommonInteractionProps = caller(
      [Permission.EditDataStore],
      [LABEL_ID],
    );

    jest
      .spyOn(DataStoreService, "findOneUpdatableById")
      // Another label's, or another team's: no row an update of it reaches.
      .mockResolvedValueOnce(null)
      // No update of stores at all.
      .mockRejectedValueOnce(
        new NotAuthorizedException("You may not edit data stores."),
      );

    for (let ask: number = 0; ask < 2; ask++) {
      expect(
        await RecordOfProcessingReader.mayChangeStore({
          dataStoreId: STORE_ID,
          props,
        }),
      ).toBe(false);
    }
  });

  test("anything else is no answer about the store, and is thrown", async () => {
    jest
      .spyOn(DataStoreService, "findOneUpdatableById")
      .mockRejectedValue(new Error("The database is away."));

    await expect(
      RecordOfProcessingReader.mayChangeStore({
        dataStoreId: STORE_ID,
        props: caller([Permission.EditDataStore]),
      }),
    ).rejects.toThrow("The database is away.");
  });

  test("OneUptime changes any store, and nothing is asked", async () => {
    const updatable: SpyInstance<typeof DataStoreService.findOneUpdatableById> =
      jest.spyOn(DataStoreService, "findOneUpdatableById");

    expect(
      await RecordOfProcessingReader.mayChangeStore({
        dataStoreId: STORE_ID,
        props: { isRoot: true },
      }),
    ).toBe(true);
    expect(updatable).not.toHaveBeenCalled();
  });
});

describe("a page of many stores offers changes when the reader may change one of them", () => {
  test("the rows an update of them is narrowed to, read a batch at a time, as OneUptime", async () => {
    const props: DatabaseCommonInteractionProps = caller(
      [Permission.EditDataStore],
      [LABEL_ID],
    );
    const narrowed: SpyInstance<typeof ModelPermission.getUpdatableQuery> = jest
      .spyOn(ModelPermission, "getUpdatableQuery")
      .mockImplementation((async (
        _modelType: unknown,
        query: unknown,
      ): Promise<unknown> => {
        return query;
      }) as never);
    const finds: SpyInstance<typeof DataStoreService.findOneBy> = jest
      .spyOn(DataStoreService, "findOneBy")
      // None of the first 500 is the reader's to change; one of the rest is.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new DataStore(STORE_ID));
    const ids: Array<string> = Array.from({ length: 501 }, (): string => {
      return ObjectID.generate().toString();
    });

    expect(
      await RecordOfProcessingReader.mayChangeAnyStore({
        projectId: PROJECT_ID,
        dataStoreIds: ids,
        props,
      }),
    ).toBe(true);
    expect(narrowed).toHaveBeenCalledTimes(2);
    expect(narrowed.mock.calls[0]![1]).toMatchObject({ projectId: PROJECT_ID });
    expect(narrowed.mock.calls[0]![2]).toBe(props);
    expect(finds).toHaveBeenCalledTimes(2);
    expect(finds.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("none of them the reader's to change, no update of stores at all, or no store: none", async () => {
    const props: DatabaseCommonInteractionProps = caller([
      Permission.SecurityViewer,
    ]);
    const narrowed: SpyInstance<typeof ModelPermission.getUpdatableQuery> = jest
      .spyOn(ModelPermission, "getUpdatableQuery")
      .mockImplementationOnce((async (
        _modelType: unknown,
        query: unknown,
      ): Promise<unknown> => {
        return query;
      }) as never)
      .mockRejectedValueOnce(
        new NotAuthorizedException("You may not edit data stores."),
      );
    const finds: SpyInstance<typeof DataStoreService.findOneBy> = jest
      .spyOn(DataStoreService, "findOneBy")
      .mockResolvedValue(null);

    for (let ask: number = 0; ask < 2; ask++) {
      expect(
        await RecordOfProcessingReader.mayChangeAnyStore({
          projectId: PROJECT_ID,
          dataStoreIds: [STORE_ID.toString()],
          props,
        }),
      ).toBe(false);
    }

    expect(finds).toHaveBeenCalledTimes(1);
    expect(
      await RecordOfProcessingReader.mayChangeAnyStore({
        projectId: PROJECT_ID,
        dataStoreIds: [],
        props,
      }),
    ).toBe(false);
    expect(narrowed).toHaveBeenCalledTimes(2);
  });

  test("OneUptime changes them all, and nothing is asked", async () => {
    const narrowed: SpyInstance<typeof ModelPermission.getUpdatableQuery> =
      jest.spyOn(ModelPermission, "getUpdatableQuery");

    expect(
      await RecordOfProcessingReader.mayChangeAnyStore({
        projectId: PROJECT_ID,
        dataStoreIds: [STORE_ID.toString()],
        props: { isRoot: true },
      }),
    ).toBe(true);
    expect(narrowed).not.toHaveBeenCalled();
  });
});

describe("a store's impact assessment is drafted and edited only by who may change the store", () => {
  test("a caller who may not change it is refused, and nothing is asked or written", async () => {
    const props: DatabaseCommonInteractionProps = caller(
      [Permission.EditDataStore, Permission.ReadDataSecurityIssue],
      [LABEL_ID],
    );

    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockResolvedValue(undefined as never);
    // The store as the caller reads it: they may read it, not change it.
    jest
      .spyOn(ImpactAssessmentDrafter as never, "readContext")
      .mockResolvedValue({
        store: new DataStore(STORE_ID),
        row: { dataStoreId: STORE_ID.toString() },
        triggers: [],
        assessment: null,
        built: { facts: [] },
      } as never);

    const mayChange: SpyInstance<
      typeof RecordOfProcessingReader.mayChangeStore
    > = jest
      .spyOn(RecordOfProcessingReader, "mayChangeStore")
      .mockResolvedValue(false);
    const asked: SpyInstance<typeof DataSecurityAiCall.ask> = jest.spyOn(
      DataSecurityAiCall,
      "ask",
    );
    const writes: SpyInstance<
      typeof DataStoreService.updateColumnsByIdWithoutHooks
    > = jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    for (const change of [
      (): Promise<unknown> => {
        return ImpactAssessmentDrafter.draftForPerson({
          projectId: PROJECT_ID,
          dataStoreId: STORE_ID,
          props,
        });
      },
      (): Promise<unknown> => {
        return ImpactAssessmentDrafter.editPart({
          projectId: PROJECT_ID,
          dataStoreId: STORE_ID,
          props,
          part: ImpactAssessmentPart.Risks,
          markdown: "Our own words.",
        });
      },
    ]) {
      const refusal: unknown = await change().catch((error: unknown) => {
        return error;
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(STORE_CHANGE_REFUSED_MESSAGE);
    }

    expect(mayChange).toHaveBeenCalledTimes(2);
    expect(mayChange.mock.calls[0]![0]).toMatchObject({
      dataStoreId: STORE_ID,
      props,
    });
    expect(asked).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("the project's audit evidence is drafted and edited by who may change every issue in it", () => {
  test.each([
    ["a Project Owner", true, [Permission.ProjectOwner], undefined],
    ["a Security Member", true, [Permission.SecurityMember], undefined],
    [
      "an editor of every issue",
      true,
      [Permission.EditDataSecurityIssue],
      undefined,
    ],
    [
      "an editor of the issues of some labels",
      false,
      [Permission.EditDataSecurityIssue],
      [LABEL_ID],
    ],
    ["a Security Viewer", false, [Permission.SecurityViewer], undefined],
    [
      "a reader of every issue",
      false,
      [Permission.ReadDataSecurityIssue],
      undefined,
    ],
  ])(
    "%s may change it: %s",
    (
      _who: string,
      mayChange: boolean,
      permissions: Array<Permission>,
      labelIds: Array<ObjectID> | undefined,
    ) => {
      expect(
        AuditEvidenceDrafter.mayChange(caller(permissions, labelIds)),
      ).toBe(mayChange);
    },
  );

  test("OneUptime may", () => {
    expect(AuditEvidenceDrafter.mayChange({ isRoot: true })).toBe(true);
  });

  test("an editor of some labels' issues is refused before anything is read or asked", async () => {
    const props: DatabaseCommonInteractionProps = caller(
      [
        Permission.EditDataSecurityIssue,
        Permission.ReadDataSecurityIssue,
        Permission.ReadDataStore,
      ],
      [LABEL_ID],
    );
    const settings: SpyInstance<typeof DataSecuritySettingService.findOneBy> =
      jest.spyOn(DataSecuritySettingService, "findOneBy");
    const aiSwitch: SpyInstance<typeof AIService.assertProjectAIEnabled> =
      jest.spyOn(AIService, "assertProjectAIEnabled");

    for (const change of [
      (): Promise<unknown> => {
        return AuditEvidenceDrafter.draftForPerson({
          projectId: PROJECT_ID,
          framework: ComplianceFramework.SOC2,
          periodInDays: 90,
          props,
        });
      },
      (): Promise<unknown> => {
        return AuditEvidenceDrafter.editParagraph({
          projectId: PROJECT_ID,
          framework: ComplianceFramework.SOC2,
          periodInDays: 90,
          requirement: "CC6.1",
          text: "Our own words.",
          props,
        });
      },
    ]) {
      const refusal: unknown = await change().catch((error: unknown) => {
        return error;
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(EVIDENCE_CHANGE_REFUSED_MESSAGE);
    }

    expect(settings).not.toHaveBeenCalled();
    expect(aiSwitch).not.toHaveBeenCalled();
  });
});
