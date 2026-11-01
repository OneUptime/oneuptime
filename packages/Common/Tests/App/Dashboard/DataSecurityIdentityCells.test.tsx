import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import {
  IDENTITY_NOT_READY,
  LAST_USE_NOT_REPORTED,
  NO_RECORDED_USE,
  NOT_USED_IN_90_DAYS,
  PrincipalText,
  USED_IN_90_DAYS,
  getAccessIdentityRoute,
  getTracedServiceRoute,
  lastUsedNote,
  showsPrincipal,
  splitPrincipal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IdentityCells";
import { getResponseActionIcon } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueResponseAction";
import DataSecurityIdentity from "../../../Models/DatabaseModels/DataSecurityIdentity";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import {
  DataSecurityResponseAction,
  EXPOSURE_RESPONSE_ACTIONS,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStorePrincipalType } from "../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { PROJECT_ID } from "./SideMenuHarness";
import type { SpyInstance } from "jest-mock";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * HOW AN IDENTITY, AND A GRANT OF IT, READ (Components/DataSecurity/
 * IdentityCells), as the UI review left them:
 *
 * - a principal is a second line only where it says more than the name:
 *   never "*" under Everyone, never a service's id under its name, never
 *   the principal twice when it has no name of its own;
 * - a principal is an identifier, drawn in monospace on the isolate itself
 *   (the Dashboard sets Inter on every element), left to right on any
 *   page, breaking after its ":" and "/" rather than mid-word;
 * - the Last Used tile says whether the date is inside the 90 days, or why
 *   there is none;
 * - a service seen in traces opens its service page;
 * - a grant's row opens its identity's page, found by the identity's key,
 *   and says so plainly when the identity is not worked out yet;
 * - Fix it from here marks a change that closes an exposure with a lock,
 *   and one that turns on a protection with a shield.
 */

const SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const LEGACY_ARN: string = "arn:aws:iam::123456789012:role/legacy-etl";

function identity(values: Partial<DataSecurityIdentity>): DataSecurityIdentity {
  return Object.assign(new DataSecurityIdentity(), values);
}

function grant(values: Partial<DataStoreAccess>): DataStoreAccess {
  return Object.assign(new DataStoreAccess(), values);
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which principals get a line of their own", () => {
  test("a role's ARN under its name", () => {
    expect(
      showsPrincipal(
        identity({
          principal: LEGACY_ARN,
          principalName: "legacy-etl",
          principalType: DataStorePrincipalType.Role,
          provider: DataStoreProvider.Aws,
        }),
      ),
    ).toBe(true);
  });

  test("never * under anyone on the internet, on an identity or a grant", () => {
    expect(
      showsPrincipal(
        identity({
          principal: "*",
          principalName: "Everyone",
          principalType: DataStorePrincipalType.Public,
        }),
      ),
    ).toBe(false);
    expect(
      showsPrincipal(
        grant({ principal: "*", principalName: "Everyone", isPublic: true }),
      ),
    ).toBe(false);
  });

  test("never a service's id: on its identity (OneUptime's) or on a store's grant (seen in traces)", () => {
    expect(
      showsPrincipal(
        identity({
          principal: SERVICE_ID,
          principalName: "checkout",
          principalType: DataStorePrincipalType.Service,
          provider: DataStoreProvider.OneUptime,
          isSeenInTraces: true,
        }),
      ),
    ).toBe(false);
    expect(
      showsPrincipal(
        grant({
          principal: SERVICE_ID,
          principalName: "checkout",
          principalType: DataStorePrincipalType.Service,
          isSeenInTraces: true,
        }),
      ),
    ).toBe(false);
  });

  test("never the principal twice: without a name of its own it is the name, and the name repeated is not a second line", () => {
    expect(showsPrincipal(grant({ principal: LEGACY_ARN }))).toBe(false);
    expect(
      showsPrincipal(
        grant({ principal: "210987654321", principalName: "210987654321" }),
      ),
    ).toBe(false);
  });
});

describe("a principal, drawn", () => {
  test("breaks after its colons and slashes, never inside a part", () => {
    expect(splitPrincipal(LEGACY_ARN)).toEqual([
      "arn:",
      "aws:",
      "iam::",
      "123456789012:",
      "role/",
      "legacy-etl",
    ]);
    expect(
      splitPrincipal(
        "arn:aws:iam::123456789012:role/service-role/analytics-reader",
      ).join(""),
    ).toBe("arn:aws:iam::123456789012:role/service-role/analytics-reader");
    // Nothing follows a trailing separator, and an email has none.
    expect(splitPrincipal("projects/acme/")).toEqual(["projects/", "acme/"]);
    expect(splitPrincipal("dana@acme-commerce.example")).toEqual([
      "dana@acme-commerce.example",
    ]);
  });

  test("in monospace on the isolate itself, left to right, its text whole", () => {
    const { container } = render(<PrincipalText principal={LEGACY_ARN} />);
    const isolate: HTMLElement | null = container.querySelector("bdi");

    expect(isolate).not.toBeNull();
    expect(isolate!).toHaveClass("font-mono");
    expect(isolate!).toHaveAttribute("dir", "ltr");
    expect(isolate!).toHaveTextContent(LEGACY_ARN);
    // A break between each of its six parts, and no character added.
    expect(isolate!.querySelectorAll("wbr")).toHaveLength(5);
    expect(isolate!.textContent).toBe(LEGACY_ARN);
  });
});

describe("the Last Used tile", () => {
  const recently: Date = new Date("2026-10-27T03:00:00Z");

  test("a date inside the 90 days says so; one outside says it is not used", () => {
    expect(lastUsedNote(identity({ lastUsedAt: recently }))).toBe(
      USED_IN_90_DAYS,
    );
    expect(
      lastUsedNote(identity({ lastUsedAt: recently, isUnused: true })),
    ).toBe(NOT_USED_IN_90_DAYS);
  });

  test("without a date it says why: no record of use, or a cloud that does not say", () => {
    expect(lastUsedNote(identity({ isUnused: true }))).toBe(NO_RECORDED_USE);
    expect(lastUsedNote(identity({ isUnused: false }))).toBe(
      LAST_USE_NOT_REPORTED,
    );
  });
});

describe("a service seen in traces", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  test("opens its service page", () => {
    expect(
      getTracedServiceRoute(
        identity({
          principal: SERVICE_ID,
          principalName: "checkout",
          principalType: DataStorePrincipalType.Service,
          isSeenInTraces: true,
        }),
      )?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/service/${SERVICE_ID}`);
  });

  test("one OneUptime holds no record of, a role, or anything not seen in traces opens none", () => {
    expect(
      getTracedServiceRoute(
        identity({
          principal: "service:legacy-batch",
          principalType: DataStorePrincipalType.Service,
          isSeenInTraces: true,
        }),
      ),
    ).toBeNull();
    expect(
      getTracedServiceRoute(
        identity({
          principal: LEGACY_ARN,
          principalType: DataStorePrincipalType.Role,
        }),
      ),
    ).toBeNull();
    expect(
      getTracedServiceRoute(
        identity({
          principal: SERVICE_ID,
          principalType: DataStorePrincipalType.Service,
          isSeenInTraces: false,
        }),
      ),
    ).toBeNull();
  });
});

describe("a grant's row opens its identity", () => {
  let listSpy: SpyInstance<typeof ModelAPI.getList>;
  let found: Array<DataSecurityIdentity>;

  beforeEach(() => {
    found = [];
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    listSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
      const result: ListResult<DataSecurityIdentity> = {
        data: found,
        count: found.length,
        skip: 0,
        limit: 1,
      };

      return result;
    }) as unknown as typeof ModelAPI.getList);
  });

  test("found by the identity's key in the project, one read of its id", async () => {
    const identityId: string = "1a000000-0000-4000-8000-000000000004";
    found = [identity({ _id: identityId })];

    const route: string = (
      await getAccessIdentityRoute(grant({ principal: `  ${LEGACY_ARN} ` }))
    ).toString();

    expect(route).toBe(
      `/dashboard/${PROJECT_ID}/data-security/access/${identityId}`,
    );
    expect(listSpy).toHaveBeenCalledTimes(1);

    const asked: Parameters<typeof ModelAPI.getList>[0] = listSpy.mock
      .calls[0]![0] as Parameters<typeof ModelAPI.getList>[0];

    expect(asked.modelType).toBe(DataSecurityIdentity);
    expect(asked.limit).toBe(1);
    expect(asked.select).toEqual({ _id: true });
    expect(String(asked.query["projectId" as never])).toBe(PROJECT_ID);
    // The key the evaluator writes: the principal, trimmed.
    expect(asked.query["identityKey" as never]).toBe(LEGACY_ARN);
  });

  test("an identity not worked out yet says when it will be, rather than opening nothing", async () => {
    await expect(
      getAccessIdentityRoute(grant({ principal: LEGACY_ARN })),
    ).rejects.toThrow(IDENTITY_NOT_READY);
  });
});

describe("Fix it from here's mark", () => {
  test("a lock on the changes that close an exposure, a shield on the ones that turn on a protection", () => {
    for (const action of Object.values(DataSecurityResponseAction)) {
      expect({
        action,
        icon: getResponseActionIcon(action),
      }).toEqual({
        action,
        icon: EXPOSURE_RESPONSE_ACTIONS.includes(action)
          ? IconProp.Lock
          : IconProp.ShieldCheck,
      });
    }

    expect(
      getResponseActionIcon(DataSecurityResponseAction.BlockPublicAccess),
    ).toBe(IconProp.Lock);
    expect(
      getResponseActionIcon(DataSecurityResponseAction.TurnOnVersioning),
    ).toBe(IconProp.ShieldCheck);
  });
});
