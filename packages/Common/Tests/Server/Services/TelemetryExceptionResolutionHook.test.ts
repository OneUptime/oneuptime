import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Resolving or reopening an exception through the API - the exception's
 * page, a row's menu, Bulk Actions, a script - goes through
 * TelemetryExceptionService.onBeforeUpdate, which writes what the switch
 * means besides itself (ExceptionIssueState.applyManualResolutionChange):
 * the Regressed mark is cleared, and a release to wait out is kept only on a
 * resolve that names one. Pinned at the hook, so no caller can turn the
 * switch without it.
 */

const props: DatabaseCommonInteractionProps = { isRoot: true };

type BeforeUpdate = (
  updateBy: UpdateBy<TelemetryException>,
) => Promise<OnUpdate<TelemetryException>>;

async function hookWrite(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const onBeforeUpdate: BeforeUpdate = (
    TelemetryExceptionService as unknown as { onBeforeUpdate: BeforeUpdate }
  ).onBeforeUpdate.bind(TelemetryExceptionService);

  const result: OnUpdate<TelemetryException> = await onBeforeUpdate({
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: props,
  } as unknown as UpdateBy<TelemetryException>);

  return result.updateBy.data as unknown as Record<string, unknown>;
}

/*
 * A triage or an assignment reads the rows it writes as they are, for the
 * exception's activity timeline (TelemetryExceptionActivityHook.test.ts):
 * read from the database, which these tests do not have - none here.
 */
beforeEach(() => {
  jest
    .spyOn(TelemetryExceptionService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryExceptionService resolving and reopening", () => {
  test("Resolve clears the Regressed mark and any release to wait out", async () => {
    expect(await hookWrite({ isResolved: true })).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("Resolve in next release keeps the release it names", async () => {
    expect(
      await hookWrite({ isResolved: true, resolvedInReleaseAfter: "v1.4.0" }),
    ).toEqual({
      isResolved: true,
      regressedAt: null,
      resolvedInReleaseAfter: "v1.4.0",
    });
  });

  test("Reopen clears both, so a manual reopen never reads as a regression", async () => {
    expect(await hookWrite({ isResolved: false })).toEqual({
      isResolved: false,
      regressedAt: null,
      resolvedInReleaseAfter: null,
    });
  });

  test("Archive leaves resolution alone", async () => {
    expect(await hookWrite({ isArchived: true })).toEqual({
      isArchived: true,
    });
  });
});

describe("TelemetryExceptionService assigning", () => {
  /*
   * A write that names a person or a team is first checked against the
   * project by ProjectReferencesService (the person a member, the team the
   * project's own) - with the database, which these tests do not have. That
   * check is the platform's and is tested with it; here it lets the write
   * through, so what is pinned is the rule this service adds after it.
   */
  beforeEach(() => {
    jest
      .spyOn(
        ProjectReferencesService.prototype as unknown as {
          onBeforeUpdate: BeforeUpdate;
        },
        "onBeforeUpdate",
      )
      .mockImplementation(async (updateBy: UpdateBy<TelemetryException>) => {
        return { updateBy, carryForward: null };
      });
  });

  test("assigning a person clears the team: one assignee", async () => {
    const userId: ObjectID = ObjectID.generate();

    expect(await hookWrite({ assignToUserId: userId })).toEqual({
      assignToUserId: userId,
      assignToTeamId: null,
    });
  });

  test("assigning a team clears the person", async () => {
    const teamId: ObjectID = ObjectID.generate();

    expect(await hookWrite({ assignToTeamId: teamId })).toEqual({
      assignToUserId: null,
      assignToTeamId: teamId,
    });
  });
});
