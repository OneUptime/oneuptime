import AIConversationService from "../../../Server/Services/AIConversationService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import AIConversation from "../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CountBy from "../../../Server/Types/Database/CountBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Query from "../../../Server/Types/Database/Query";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Regression cover for the "Ask AI Recent Conversations shows every user's
 * chat history" report (issue #3554).
 *
 * The Ask AI panel asks for conversations with an EMPTY query — see
 * fetchConversations in
 * App/FeatureSet/Dashboard/src/Components/AIChat/useAiChat.ts, which sends
 * `query: {}` and no user filter at all. Nothing on the client scopes that
 * list, and nothing in the model's RBAC does either: AIConversation grants
 * read to plain ProjectMember, so every member of the project passes the
 * table and column permission checks for every row in it. The ONLY thing
 * standing between one member and another member's conversation titles is
 * the per-user pin these services install, which is why it is worth this
 * much test.
 *
 * The three tables are covered together because they are the three parts of
 * one leak: AIConversation carries the titles the panel lists,
 * AIConversationMessage carries the prompts and answers, and AIRunEvent
 * carries the glass-box trail of the tools a turn ran (and their arguments).
 * A pin lost on any one of them exposes the conversation.
 *
 * Assertions run against the FINAL query — after QueryUtil.serializeQuery,
 * which is the last thing to touch it before TypeORM — because that is what
 * actually reaches Postgres. Asserting on the raw hook output would pass for
 * an implementation whose pin is later dropped or overridden in
 * serialization.
 */

const CALLER: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * A real, fully-permissioned member of the project: ProjectOwner as well as
 * ProjectMember, so no test here can pass merely because the caller was
 * under-privileged. The pin is not an RBAC rule — it applies to the project's
 * owner exactly as it applies to its newest member.
 */
const memberProps: (userId: ObjectID) => DatabaseCommonInteractionProps = (
  userId: ObjectID,
): DatabaseCommonInteractionProps => {
  return {
    userId: userId,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
          },
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            labelIds: [],
          },
        ],
      },
    } as unknown as { [tenantId: string]: UserTenantAccessPermission },
  } as unknown as DatabaseCommonInteractionProps;
};

/*
 * The shape a project API key arrives in: tenant access, but no user at all
 * (ProjectAuthorization gives an API key userTenantAccessPermission and never
 * userAuthorization). A caller with no personal scope must be refused rather
 * than handed the unpinned query.
 */
const apiKeyProps: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {} as {
    [tenantId: string]: UserTenantAccessPermission;
  },
} as unknown as DatabaseCommonInteractionProps;

/*
 * Renders a (possibly nested) TypeORM FindOperator tree to text, including
 * the parameters of a Raw operator — QueryHelper.equalTo hides its value
 * there, so a render that only walked `_value` would report an empty string
 * for exactly the operator the pin produces.
 */
type RenderFunction = (value: unknown) => string;

const render: RenderFunction = (value: unknown): string => {
  const parts: Array<string> = [];

  const walk: (node: unknown) => void = (node: unknown): void => {
    if (!(node instanceof FindOperator)) {
      if (node !== undefined && node !== null) {
        parts.push(String(node));
      }
      return;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const operator: any = node as any;

    parts.push(String(operator._type));

    if (typeof operator._getSql === "function") {
      try {
        parts.push(String(operator._getSql("COLUMN")));
      } catch {
        // Raw's sql builder only needs the alias; ignore anything that throws.
      }
    }

    const parameters: any = operator.objectLiteralParameters;

    if (parameters && typeof parameters === "object") {
      for (const key of Object.keys(parameters)) {
        parts.push(String(parameters[key]));
      }
    }

    const innerValue: any = operator._value;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (Array.isArray(innerValue)) {
      innerValue.forEach(walk);
      return;
    }

    walk(innerValue);
  };

  walk(value);

  return parts.join(" | ");
};

/*
 * One table's privacy contract: the service that reads it, the model it
 * reads, and the column the pin is supposed to land on.
 */
interface PinnedTable {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  modelType: { new (): BaseModel };
  column: string;
}

const pinnedTables: Array<PinnedTable> = [
  {
    name: "AIConversationService",
    service: AIConversationService,
    modelType: AIConversation,
    column: "createdByUserId",
  },
  {
    name: "AIConversationMessageService",
    service: AIConversationMessageService,
    modelType: AIConversationMessage,
    column: "userId",
  },
  {
    name: "AIRunEventService",
    service: AIRunEventService,
    modelType: AIRunEvent,
    column: "userId",
  },
];

/*
 * Drives the service's own onBeforeFind — the hook BaseAPI's list, count-less
 * getItem and every findOneBy/findOneById go through — and returns the query
 * as the database would see it.
 */
type PinFindFunction = (
  table: PinnedTable,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<Record<string, unknown>>;

const pinnedFindQuery: PinFindFunction = async (
  table: PinnedTable,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Record<string, unknown>> => {
  const findBy: FindBy<BaseModel> = {
    query: query as Query<BaseModel>,
    select: { _id: true },
    sort: { createdAt: SortOrder.Descending },
    limit: 25,
    skip: 0,
    props: props,
  } as unknown as FindBy<BaseModel>;

  await table.service.onBeforeFind(findBy);

  return QueryUtil.serializeQuery(
    table.modelType,
    findBy.query,
  ) as unknown as Record<string, unknown>;
};

/*
 * The pinned column must carry a plain EQUALITY against the caller — the
 * exact shape QueryHelper.equalTo emits for the ObjectID the pin assigns.
 *
 * Checking the operator's shape rather than just looking for the caller's id
 * somewhere in the query is what makes the hostile cases mean anything. The
 * sharpest attack a member can mount is to smuggle `NotEqual(<themselves>)`
 * into the request body — "every conversation that is not mine". That query
 * mentions the caller too, so a `toContain(CALLER)` assertion passes on it
 * whether or not the pin ran, and would have called the leak safe.
 */
type AssertPinFunction = (
  serialized: Record<string, unknown>,
  column: string,
) => void;

const expectPinnedToCaller: AssertPinFunction = (
  serialized: Record<string, unknown>,
  column: string,
): void => {
  const pinned: unknown = serialized[column];

  expect(pinned).toBeInstanceOf(FindOperator);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const operator: any = pinned as any;

  // An equality, not a negation, an IN, a range or an IS NULL.
  expect(String(operator.getSql("COLUMN"))).toMatch(
    /^\(COLUMN = :[A-Za-z0-9_]+\)$/,
  );

  // Against the caller, and nobody else.
  expect(Object.values(operator.objectLiteralParameters || {})).toEqual([
    CALLER.toString(),
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

describe("AI chat privacy pin — the personal-scope guarantee", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(pinnedTables)("$name", (table: PinnedTable) => {
    test(`pins the column the model actually has (${table.column})`, () => {
      /*
       * A typo'd column name would not throw anywhere: the pin would land
       * on a key the model has no metadata for, serializeQuery would leave
       * it alone, and the read would go out unscoped. Assert the contract
       * against the model itself.
       */
      const model: BaseModel = new table.modelType();

      expect(model.hasColumn(table.column)).toBe(true);
    });

    test("scopes the Ask AI panel's own unfiltered list request", async () => {
      /*
       * `query: {}` is verbatim what the panel sends. This is the report in
       * issue #3554: without the pin this read returns every row in the
       * project.
       */
      const serialized: Record<string, unknown> = await pinnedFindQuery(
        table,
        {},
        memberProps(CALLER),
      );

      expectPinnedToCaller(serialized, table.column);
    });

    test("overwrites a query that names another user outright", async () => {
      const serialized: Record<string, unknown> = await pinnedFindQuery(
        table,
        { [table.column]: OTHER_USER },
        memberProps(CALLER),
      );

      expectPinnedToCaller(serialized, table.column);
    });

    /*
     * BaseAPI.getList takes `query` straight off the request body and
     * JSONFunctions.deserializeValue rebuilds any operator named by its
     * `_type`, so each of these is reachable from an ordinary HTTP call by
     * any member. The pin is an assignment, not a merge, so every one of
     * them must be gone from the final query.
     */
    const smuggledOperators: Array<[string, () => unknown]> = [
      [
        "NotEqual",
        (): unknown => {
          return new NotEqual(CALLER.toString());
        },
      ],
      [
        "IsNull",
        (): unknown => {
          return new IsNull();
        },
      ],
      [
        "NotNull",
        (): unknown => {
          return new NotNull();
        },
      ],
      [
        "Includes",
        (): unknown => {
          return new Includes([CALLER, OTHER_USER]);
        },
      ],
      [
        "Search",
        (): unknown => {
          return new Search(OTHER_USER.toString());
        },
      ],
      [
        "LessThan",
        (): unknown => {
          return new LessThan(OTHER_USER.toString());
        },
      ],
      [
        "EqualToOrNull",
        (): unknown => {
          return new EqualToOrNull(OTHER_USER.toString());
        },
      ],
    ];

    test.each(smuggledOperators)(
      "replaces a smuggled %s operator on the pinned column",
      async (_name: string, buildOperator: () => unknown): Promise<void> => {
        const serialized: Record<string, unknown> = await pinnedFindQuery(
          table,
          { [table.column]: buildOperator() },
          memberProps(CALLER),
        );

        expectPinnedToCaller(serialized, table.column);
      },
    );

    test("leaves the caller's other filters intact", async () => {
      const serialized: Record<string, unknown> = await pinnedFindQuery(
        table,
        { projectId: PROJECT_ID },
        memberProps(CALLER),
      );

      expectPinnedToCaller(serialized, table.column);
      expect(render(serialized["projectId"])).toContain(PROJECT_ID.toString());
    });

    test("pins the list endpoint's count as well as its rows", async () => {
      /*
       * BaseAPI.getList issues findBy and countBy with the SAME client
       * query. DatabaseService has no onBeforeCount hook, so filtering in
       * onBeforeFind alone would return a correctly-scoped page beside a
       * project-wide total — which is its own disclosure ("47 conversations"
       * when you have 3) and would page the user into other people's rows.
       */
      const forwardedToSuper: Array<CountBy<BaseModel>> = [];

      /*
       * The override's job is to re-apply the pin and hand the result to
       * DatabaseService.countBy, so intercept exactly there: it keeps the
       * test off the database while still running the real override.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest
        .spyOn(DatabaseService.prototype as any, "countBy")
        .mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((countBy: CountBy<BaseModel>): Promise<PositiveNumber> => {
            forwardedToSuper.push(countBy);
            return Promise.resolve(new PositiveNumber(0));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        );

      await table.service.countBy({
        query: {} as Query<BaseModel>,
        props: memberProps(CALLER),
      });

      expect(forwardedToSuper).toHaveLength(1);

      const forwarded: CountBy<BaseModel> = forwardedToSuper[0]!;

      const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
        table.modelType,
        forwarded.query,
      ) as unknown as Record<string, unknown>;

      expectPinnedToCaller(serialized, table.column);
    });

    test("refuses a caller with no user rather than reading unscoped", async () => {
      await expect(pinnedFindQuery(table, {}, apiKeyProps)).rejects.toThrow(
        NotAuthorizedException,
      );

      await expect(
        table.service.countBy({
          query: {},
          props: apiKeyProps,
        }),
      ).rejects.toThrow(NotAuthorizedException);
    });

    test("leaves root and master-admin reads unpinned", async () => {
      const asRoot: Record<string, unknown> = await pinnedFindQuery(table, {}, {
        isRoot: true,
      } as DatabaseCommonInteractionProps);

      expect(asRoot[table.column]).toBeUndefined();

      const asMasterAdmin: Record<string, unknown> = await pinnedFindQuery(
        table,
        {},
        { isMasterAdmin: true } as DatabaseCommonInteractionProps,
      );

      expect(asMasterAdmin[table.column]).toBeUndefined();
    });

    test("installs a non-stock onBeforeFind hook", () => {
      /*
       * BaseAPI.getList compares the service's onBeforeFind against
       * DatabaseService's to decide whether findBy and countBy may run in
       * parallel against SHARED query/props objects. These services rewrite
       * the query in place, so they must not be mistaken for stock ones —
       * and the identity check is also the cheapest proof that the hook is
       * installed at all.
       */
      expect(table.service.onBeforeFind).not.toBe(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (DatabaseService.prototype as any).onBeforeFind,
      );
    });
  });
});

/*
 * AIConversation is the one of the three that members may WRITE through the
 * generated CRUD (delete is granted to ProjectMember; the title/provider
 * updates come from the chat endpoints as root). So its update and delete
 * paths carry the pin too — without it, any member could rename or delete
 * every conversation in the project, which is the same isolation failure as
 * the read with a worse blast radius.
 *
 * The other two tables need no such cover because they are write-closed
 * entirely — AIChatModelACL.test.ts holds their create/update/delete
 * permissions at zero, which is what stands in for a write pin they do not
 * install.
 */
describe("AIConversationService write paths are personal too", () => {
  test("pins an update to the caller's own conversations", async () => {
    const updateBy: UpdateBy<AIConversation> = {
      query: { _id: new ObjectID("44444444-4444-4444-8444-444444444444") },
      data: { title: "renamed" },
      limit: 1,
      skip: 0,
      props: memberProps(CALLER),
    } as unknown as UpdateBy<AIConversation>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (AIConversationService as any).onBeforeUpdate(updateBy);

    const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
      AIConversation,
      updateBy.query,
    ) as unknown as Record<string, unknown>;

    expectPinnedToCaller(serialized, "createdByUserId");
  });

  test("pins a delete to the caller's own conversations", async () => {
    const deleteBy: DeleteBy<AIConversation> = {
      query: { createdByUserId: OTHER_USER },
      limit: 100,
      skip: 0,
      props: memberProps(CALLER),
    } as unknown as DeleteBy<AIConversation>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (AIConversationService as any).onBeforeDelete(deleteBy);

    const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
      AIConversation,
      deleteBy.query,
    ) as unknown as Record<string, unknown>;

    expectPinnedToCaller(serialized, "createdByUserId");
  });

  test("refuses an update or delete from a caller with no user", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AIConversationService as any).onBeforeUpdate({
        query: {},
        data: {},
        limit: 1,
        skip: 0,
        props: apiKeyProps,
      }),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AIConversationService as any).onBeforeDelete({
        query: {},
        limit: 1,
        skip: 0,
        props: apiKeyProps,
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });
});
