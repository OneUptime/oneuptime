import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseValues from "../../Server/Utils/SecurityCase/SecurityCaseValues";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "./SecurityCaseValues";
import { jest } from "@jest/globals";

/*
 * The server's reads of a project's case priorities and statuses
 * (SecurityCaseValues), answered from lists the test holds - the defaults,
 * unless it passes its own - so a suite that stubs the case and playbook
 * services stubs these the same way. Every caller goes through
 * getPriorities and getStatuses (getForProject and the open and closed
 * status ids read through them), so those two are the whole stub.
 */
export interface StubbedSecurityCaseValues {
  priorities: Array<SecurityCasePriority>;
  statuses: Array<SecurityCaseStatus>;
}

export function stubSecurityCaseValues(
  values: Partial<StubbedSecurityCaseValues> = {},
): StubbedSecurityCaseValues {
  const stubbed: StubbedSecurityCaseValues = {
    priorities: values.priorities || buildDefaultTestPriorities(),
    statuses: values.statuses || buildDefaultTestStatuses(),
  };

  jest
    .spyOn(SecurityCaseValues, "getPriorities")
    .mockImplementation(async (): Promise<Array<SecurityCasePriority>> => {
      return stubbed.priorities;
    });

  jest
    .spyOn(SecurityCaseValues, "getStatuses")
    .mockImplementation(async (): Promise<Array<SecurityCaseStatus>> => {
      return stubbed.statuses;
    });

  return stubbed;
}
