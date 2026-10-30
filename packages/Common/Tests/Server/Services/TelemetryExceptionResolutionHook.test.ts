import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

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
