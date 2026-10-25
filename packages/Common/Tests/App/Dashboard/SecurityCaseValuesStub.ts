import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../Helpers/SecurityCaseValues";
import { jest } from "@jest/globals";

/*
 * The Dashboard's read of a project's case priorities and statuses
 * (Components/SecurityCase/SecurityCaseValues reads them through
 * ModelListCache), answered from the lists the test holds - a new
 * project's, unless it passes its own. Every other list ModelListCache
 * serves is read as it would be, so a page's other lists keep the stubs
 * its suite gave them.
 *
 * The lists are the test's own: change one (rename a status, add one) and
 * the next read, and every page that reads it, sees the change.
 */
export interface StubbedDashboardSecurityCaseValues {
  priorities: Array<SecurityCasePriority>;
  statuses: Array<SecurityCaseStatus>;
  // How often each list was read.
  reads: { priorities: number; statuses: number };
}

function toListResult<T extends BaseModel>(data: Array<T>): ListResult<T> {
  return { data: [...data], count: data.length, skip: 0, limit: data.length };
}

export function stubDashboardSecurityCaseValues(
  values: Partial<
    Pick<StubbedDashboardSecurityCaseValues, "priorities" | "statuses">
  > = {},
): StubbedDashboardSecurityCaseValues {
  const stubbed: StubbedDashboardSecurityCaseValues = {
    priorities: values.priorities || buildDefaultTestPriorities(),
    statuses: values.statuses || buildDefaultTestStatuses(),
    reads: { priorities: 0, statuses: 0 },
  };

  /*
   * What answers every other list: the real cache, or - laid over a stub
   * already in place (a suite's own, or an earlier call of this) - that
   * stub's answer.
   */
  type GetList = (data: unknown) => Promise<unknown>;
  const current: unknown = ModelListCache.getList;
  const otherLists: GetList | undefined = jest.isMockFunction(current)
    ? ((
        current as unknown as { getMockImplementation: () => unknown }
      ).getMockImplementation() as GetList | undefined)
    : (current as GetList).bind(ModelListCache);

  jest.spyOn(ModelListCache, "getList").mockImplementation((async (data: {
    modelType: { new (): BaseModel };
  }): Promise<unknown> => {
    const tableName: string | null = new data.modelType().tableName;

    if (tableName === "SecurityCasePriority") {
      stubbed.reads.priorities++;
      return toListResult(stubbed.priorities);
    }

    if (tableName === "SecurityCaseStatus") {
      stubbed.reads.statuses++;
      return toListResult(stubbed.statuses);
    }

    return otherLists ? otherLists(data) : undefined;
  }) as never);

  return stubbed;
}
