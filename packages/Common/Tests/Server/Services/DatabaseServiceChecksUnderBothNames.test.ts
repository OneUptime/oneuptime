import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import StatusPageFooterLink from "../../../Models/DatabaseModels/StatusPageFooterLink";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "../../../Models/DatabaseModels/StatusPageHeaderLink";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import type { SpyInstance } from "jest-mock";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * DatabaseService's own checks of a create - a status page holds at most
 * three header and three footer links (TotalItemsBy), a group's name is
 * unique on its status page (UniqueColumnBy), an owner row is unique for
 * its record (UniqueColumnsTogether) - read the reference they are scoped
 * by under either of its names. A write that named the status page only by
 * the relation used to reach the first two as a write naming no page: the
 * link limit was skipped, and the name was checked among the groups of no
 * page. Two names that disagree are refused.
 */

const STATUS_PAGE_ID: string = "0193c0de-d0d0-4aaa-8bbb-0000000000a1";
const OTHER_STATUS_PAGE_ID: string = "0193c0de-d0d0-4aaa-8bbb-0000000000b2";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-000000000001",
);

type Checks = {
  checkTotalItemsBy: (createBy: unknown) => Promise<void>;
  checkUniqueColumnBy: (createBy: unknown) => Promise<unknown>;
  checkUniqueColumnsTogether: (data: unknown) => Promise<void>;
};

function checksOf(service: unknown): Checks {
  return service as Checks;
}

function queries(countBy: SpyInstance): Array<Record<string, unknown>> {
  return countBy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { query: Record<string, unknown> }).query;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  [
    "header",
    StatusPageHeaderLinkService,
    (): StatusPageHeaderLink => {
      return new StatusPageHeaderLink();
    },
    "This status page cannot have more than 3 header links",
  ],
  [
    "footer",
    StatusPageFooterLinkService,
    (): StatusPageFooterLink => {
      return new StatusPageFooterLink();
    },
    "This status page cannot have more than 3 footer links",
  ],
])(
  "a status page's %s links are limited on the page named either way",
  (
    _which: string,
    service: unknown,
    makeLink: () => StatusPageHeaderLink | StatusPageFooterLink,
    limitMessage: string,
  ) => {
    function link(names: Record<string, unknown>): Record<string, unknown> {
      return Object.assign(makeLink(), {
        title: "Docs",
        projectId: PROJECT_ID,
        ...names,
      }) as unknown as Record<string, unknown>;
    }

    test("a page named by the relation counts toward its limit", async () => {
      const countBy: SpyInstance = jest
        .spyOn(service as never, "countBy")
        .mockResolvedValue(new PositiveNumber(3) as never);

      await expect(
        checksOf(service).checkTotalItemsBy({
          data: link({ statusPage: { _id: STATUS_PAGE_ID } }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(new BadDataException(limitMessage));

      expect(String(queries(countBy)[0]!["statusPageId"])).toBe(
        STATUS_PAGE_ID,
      );
    });

    test("a page named by its ID column counts the same", async () => {
      jest
        .spyOn(service as never, "countBy")
        .mockResolvedValue(new PositiveNumber(3) as never);

      await expect(
        checksOf(service).checkTotalItemsBy({
          data: link({ statusPageId: new ObjectID(STATUS_PAGE_ID) }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(new BadDataException(limitMessage));
    });

    test("a page under its limit takes another link, whichever name it comes by", async () => {
      jest
        .spyOn(service as never, "countBy")
        .mockResolvedValue(new PositiveNumber(2) as never);

      await expect(
        checksOf(service).checkTotalItemsBy({
          data: link({ statusPage: { _id: STATUS_PAGE_ID } }),
          props: { isRoot: true },
        }),
      ).resolves.toBeUndefined();
    });

    test("a page named differently under its two names is refused before counting", async () => {
      const countBy: SpyInstance = jest.spyOn(service as never, "countBy");

      await expect(
        checksOf(service).checkTotalItemsBy({
          data: link({
            statusPageId: new ObjectID(STATUS_PAGE_ID),
            statusPage: { _id: OTHER_STATUS_PAGE_ID },
          }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        RelationIdUtil.getConflictMessage("Status Page", [
          "statusPageId",
          "statusPage",
        ]),
      );
      expect(countBy).not.toHaveBeenCalled();
    });

    test("a link naming no page is not counted", async () => {
      const countBy: SpyInstance = jest.spyOn(service as never, "countBy");

      await checksOf(service).checkTotalItemsBy({
        data: link({}),
        props: { isRoot: true },
      });

      expect(countBy).not.toHaveBeenCalled();
    });
  },
);

describe("a group's name is unique on the status page named either way", () => {
  function group(names: Record<string, unknown>): StatusPageGroup {
    return Object.assign(new StatusPageGroup(), {
      name: "Payments",
      projectId: PROJECT_ID,
      ...names,
    }) as StatusPageGroup;
  }

  test("the name is looked for among the groups of a page named by the relation", async () => {
    const countBy: SpyInstance = jest
      .spyOn(StatusPageGroupService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    await expect(
      checksOf(StatusPageGroupService).checkUniqueColumnBy({
        data: group({ statusPage: { _id: STATUS_PAGE_ID } }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      new BadDataException("Status Page Group with the same name already exists."),
    );

    expect(String(queries(countBy)[0]!["statusPageId"])).toBe(STATUS_PAGE_ID);
  });

  test("the same name on a page named by the relation goes on when the page has none", async () => {
    jest
      .spyOn(StatusPageGroupService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await expect(
      checksOf(StatusPageGroupService).checkUniqueColumnBy({
        data: group({ statusPage: { _id: STATUS_PAGE_ID } }),
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  test("a page named differently under its two names is refused", async () => {
    await expect(
      checksOf(StatusPageGroupService).checkUniqueColumnBy({
        data: group({
          statusPageId: new ObjectID(STATUS_PAGE_ID),
          statusPage: { _id: OTHER_STATUS_PAGE_ID },
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Conflicting Status Page references were provided.");
  });

  test("a workflow named by the relation scopes the name, and the project is read as it is", async () => {
    const countBy: SpyInstance = jest
      .spyOn(WorkflowVariableService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const variable: WorkflowVariable = Object.assign(new WorkflowVariable(), {
      name: "API_TOKEN",
      projectId: PROJECT_ID,
      workflow: { _id: STATUS_PAGE_ID },
    }) as WorkflowVariable;

    await checksOf(WorkflowVariableService).checkUniqueColumnBy({
      data: variable,
      props: { isRoot: true },
    });

    // The workflow, named by the relation, scopes the name; the project as it is.
    expect(String(queries(countBy)[0]!["workflowId"])).toBe(STATUS_PAGE_ID);
    expect(String(queries(countBy)[0]!["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });
});

describe("an owner row is unique for its record, its team named either way", () => {
  const INCIDENT_ID: ObjectID = new ObjectID(
    "0193c0de-d0d0-4aaa-8bbb-0000000000c1",
  );
  const TEAM_ID: string = "0193c0de-d0d0-4aaa-8bbb-0000000000d1";

  function owner(names: Record<string, unknown>): IncidentOwnerTeam {
    return Object.assign(new IncidentOwnerTeam(), {
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      ...names,
    }) as IncidentOwnerTeam;
  }

  test("a team named by the relation is the team looked for", async () => {
    const countBy: SpyInstance = jest
      .spyOn(IncidentOwnerTeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    await expect(
      checksOf(IncidentOwnerTeamService).checkUniqueColumnsTogether(
        owner({ team: { _id: TEAM_ID } }),
      ),
    ).rejects.toThrow("This team is already an owner of this incident.");

    expect(String(queries(countBy)[0]!["teamId"])).toBe(TEAM_ID);
  });

  test("a team named differently under its two names is refused", async () => {
    await expect(
      checksOf(IncidentOwnerTeamService).checkUniqueColumnsTogether(
        owner({
          teamId: new ObjectID(TEAM_ID),
          team: { _id: STATUS_PAGE_ID },
        }),
      ),
    ).rejects.toThrow("Conflicting Team references were provided.");
  });
});
