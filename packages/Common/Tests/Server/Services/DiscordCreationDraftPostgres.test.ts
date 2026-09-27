import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import {
  Service,
  DiscordDraftScope,
  DiscordDraftView,
  DiscordDraftRead,
  DiscordDraftClaim,
} from "../../../Server/Services/DiscordCreationDraftService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Failure inventory precedes persistence: two final clicks can both acquire;
 * restart or receipt failure can retry creation; edits can preserve stale review;
 * stale bindings can disclose content; expiry erasure can roll back on refusal;
 * unsafe terminal text can persist credentials; foreign actors can cancel drafts.
 * These tests require the runner's disposable migrated PostgreSQL, never production.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DISCORD_OBSERVATION_TESTS"] === "true"
    ? describe
    : describe.skip;

function requiredEnvironment(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) {
    throw new Error(`Disposable database setting missing: ${name}`);
  }
  return value;
}

describePostgres(
  "Discord creation drafts, durable PostgreSQL contract",
  (): void => {
    let database: DataSource;
    let service: Service;
    let scope: DiscordDraftScope;
    let projectBindingId: string;

    beforeAll(async (): Promise<void> => {
      database = new DataSource({
        type: "postgres",
        host: requiredEnvironment("DATABASE_HOST"),
        port: Number(requiredEnvironment("DATABASE_PORT")),
        username: requiredEnvironment("DATABASE_USERNAME"),
        password: requiredEnvironment("DATABASE_PASSWORD"),
        database: requiredEnvironment("DATABASE_NAME"),
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    beforeEach(async (): Promise<void> => {
      service = new Service();
      scope = {
        applicationId: "100000000000000001",
        projectId: ObjectID.generate(),
        userId: ObjectID.generate(),
        guildId: "100000000000000002",
        channelId: "100000000000000003",
        discordUserId: "100000000000000004",
      };
      projectBindingId = ObjectID.generate().toString();
      await database.query(
        'INSERT INTO "Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $2, 1)',
        [scope.projectId.toString(), `draft-${scope.projectId}`],
      );
      await database.query(
        'INSERT INTO "User" ("_id", "email", "slug", "version") VALUES ($1, $2, $3, 1)',
        [
          scope.userId.toString(),
          `draft-${scope.userId}@example.invalid`,
          `draft-${scope.userId}`,
        ],
      );
      await database.query(
        'INSERT INTO "WorkspaceProjectAuthToken" ("_id", "projectId", "workspaceType", "workspaceProjectId", "authToken", "version", "miscData") VALUES ($1, $2, $3, $4, $5, 1, $6)',
        [
          projectBindingId,
          scope.projectId.toString(),
          "Discord",
          scope.guildId,
          "fixture-bot",
          {},
        ],
      );
      await database.query(
        'INSERT INTO "WorkspaceUserAuthToken" ("_id", "projectId", "userId", "workspaceType", "workspaceUserId", "authToken", "version", "miscData") VALUES ($1, $2, $3, $4, $5, $6, 1, $7)',
        [
          ObjectID.generate().toString(),
          scope.projectId.toString(),
          scope.userId.toString(),
          "Discord",
          scope.discordUserId,
          "discord-verified-identity",
          {},
        ],
      );
    });

    afterEach(async (): Promise<void> => {
      if (database?.isInitialized && scope) {
        await database.query(
          'DELETE FROM "DiscordCreationDraft" WHERE "projectId" = $1',
          [scope.projectId.toString()],
        );
        await database.query('DELETE FROM "Project" WHERE "_id" = $1', [
          scope.projectId.toString(),
        ]);
        await database.query('DELETE FROM "User" WHERE "_id" = $1', [
          scope.userId.toString(),
        ]);
      }
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.destroy();
      }
    });

    async function opened(): Promise<DiscordDraftView> {
      return service.open({
        scope,
        content: { title: "Private draft", selections: [] },
      });
    }

    async function reviewed(): Promise<DiscordDraftView> {
      const draft: DiscordDraftView = await opened();
      const result: DiscordDraftRead = await service.change({
        id: draft.id,
        scope,
        revision: draft.revision,
        content: draft.content,
        review: true,
      });
      expect(result.kind).toBe("open");
      if (result.kind !== "open") {
        throw new Error("Expected an open reviewed draft");
      }
      return result.draft;
    }

    async function storedContent(id: ObjectID): Promise<unknown> {
      const rows: Array<{ content: unknown }> = await database.query(
        'SELECT "content" FROM "DiscordCreationDraft" WHERE "_id" = $1',
        [id.toString()],
      );
      return rows[0]?.content;
    }

    test("twelve concurrent final clicks have one durable owner and erase content", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      const results: Array<DiscordDraftClaim> = await Promise.all(
        Array.from({ length: 12 }, (): Promise<DiscordDraftClaim> => {
          return new Service().claim({
            id: draft.id,
            scope,
            revision: draft.revision,
          });
        }),
      );
      expect(
        results.filter((item: DiscordDraftClaim): boolean => {
          return item.kind === "acquired";
        }),
      ).toHaveLength(1);
      expect(
        results.filter((item: DiscordDraftClaim): boolean => {
          return item.kind === "in_progress";
        }),
      ).toHaveLength(11);
      expect(await storedContent(draft.id)).toBeNull();
      expect(
        (
          await new Service().claim({
            id: draft.id,
            scope,
            revision: draft.revision,
          })
        ).kind,
      ).toBe("in_progress");
    });

    test("claim without review is refused; editing invalidates a previous review", async (): Promise<void> => {
      const fresh: DiscordDraftView = await opened();
      expect(
        (await service.claim({ id: fresh.id, scope, revision: fresh.revision }))
          .kind,
      ).toBe("rejected");
      const draft: DiscordDraftView = await reviewed();
      const change: DiscordDraftRead = await service.change({
        id: draft.id,
        scope,
        revision: draft.revision,
        content: { title: "Changed" },
        review: false,
      });
      expect(change.kind).toBe("open");
      if (change.kind !== "open") {
        throw new Error("Expected changed draft");
      }
      expect(change.draft.reviewedRevision).toBeUndefined();
      expect(
        (await service.claim({ id: draft.id, scope, revision: draft.revision }))
          .kind,
      ).toBe("rejected");
      expect(
        (
          await service.claim({
            id: draft.id,
            scope,
            revision: change.draft.revision,
          })
        ).kind,
      ).toBe("rejected");
    });

    test("racing edits cannot overwrite the winner or extend absolute expiry", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      const results: Array<DiscordDraftRead> = await Promise.all(
        ["First", "Second"].map((title: string): Promise<DiscordDraftRead> => {
          return service.change({
            id: draft.id,
            scope,
            revision: draft.revision,
            content: { title },
            review: false,
          });
        }),
      );
      expect(
        results.filter((item: DiscordDraftRead): boolean => {
          return item.kind === "open";
        }),
      ).toHaveLength(1);
      expect(
        results.filter((item: DiscordDraftRead): boolean => {
          return item.kind === "rejected";
        }),
      ).toHaveLength(1);
      const current: DiscordDraftRead = await service.read({
        id: draft.id,
        scope,
      });
      if (current.kind !== "open") {
        throw new Error("Expected open draft");
      }
      expect(current.draft.expiresAt.getTime()).toBe(draft.expiresAt.getTime());
    });

    test.each([
      "applicationId",
      "projectId",
      "userId",
      "guildId",
      "channelId",
      "discordUserId",
    ] as const)(
      "foreign %s cannot disclose, change, claim, or cancel the draft",
      async (key: keyof DiscordDraftScope): Promise<void> => {
        const draft: DiscordDraftView = await reviewed();
        const other: DiscordDraftScope = {
          ...scope,
          [key]:
            key === "projectId" || key === "userId"
              ? ObjectID.generate()
              : "999999999999999999",
        };
        expect((await service.read({ id: draft.id, scope: other })).kind).toBe(
          "rejected",
        );
        expect(
          (
            await service.change({
              id: draft.id,
              scope: other,
              revision: draft.revision,
              content: {},
              review: true,
            })
          ).kind,
        ).toBe("rejected");
        expect(
          (
            await service.claim({
              id: draft.id,
              scope: other,
              revision: draft.revision,
            })
          ).kind,
        ).toBe("rejected");
        expect(
          (await service.cancel({ id: draft.id, scope: other })).kind,
        ).toBe("rejected");
        expect(await storedContent(draft.id)).toEqual(draft.content);
      },
    );

    test("same binding row and guild with a new version refuses claim and commits erasure", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      await database.query(
        'UPDATE "WorkspaceProjectAuthToken" SET "version" = "version" + 1 WHERE "_id" = $1',
        [projectBindingId],
      );
      expect(
        (await service.claim({ id: draft.id, scope, revision: draft.revision }))
          .kind,
      ).toBe("rejected");
      expect(await storedContent(draft.id)).toBeNull();
    });

    test("relink or disconnect refuses content access and commits erasure", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      await database.query(
        'UPDATE "WorkspaceUserAuthToken" SET "deletedAt" = now(), "version" = "version" + 1 WHERE "projectId" = $1',
        [scope.projectId.toString()],
      );
      expect((await service.read({ id: draft.id, scope })).kind).toBe(
        "rejected",
      );
      expect(await storedContent(draft.id)).toBeNull();
    });

    test("expired clicks erase content even when the cleanup worker has not run", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      await database.query(
        'UPDATE "DiscordCreationDraft" SET "expiresAt" = now() - interval \'1 second\' WHERE "_id" = $1',
        [draft.id.toString()],
      );
      expect(
        (await service.claim({ id: draft.id, scope, revision: draft.revision }))
          .kind,
      ).toBe("rejected");
      expect(await storedContent(draft.id)).toBeNull();
    });

    test("cleanup erases expired drafts without a click and preserves live content", async (): Promise<void> => {
      const expired: DiscordDraftView = await opened();
      const live: DiscordDraftView = await opened();
      await database.query(
        'UPDATE "DiscordCreationDraft" SET "expiresAt" = now() - interval \'1 second\' WHERE "_id" = $1',
        [expired.id.toString()],
      );
      await service.clearExpiredContent();
      expect(await storedContent(expired.id)).toBeNull();
      expect(await storedContent(live.id)).toEqual(live.content);
    });

    test("cancel erases content, and a new service instance cannot claim it", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      expect((await service.cancel({ id: draft.id, scope })).kind).toBe(
        "terminal",
      );
      expect(await storedContent(draft.id)).toBeNull();
      expect(
        (
          await new Service().claim({
            id: draft.id,
            scope,
            revision: draft.revision,
          })
        ).kind,
      ).toBe("terminal");
    });

    test("wrong completion owner and unsafe response cannot complete or reacquire", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      const claim: DiscordDraftClaim = await service.claim({
        id: draft.id,
        scope,
        revision: draft.revision,
      });
      if (claim.kind !== "acquired") {
        throw new Error("Expected claim");
      }
      expect(
        await service.finish({
          id: draft.id,
          scope,
          claimId: ObjectID.generate(),
          outcome: { kind: "ambiguous" },
        }),
      ).toBe(false);
      await expect(
        service.finish({
          id: draft.id,
          scope,
          claimId: claim.claimId,
          outcome: {
            kind: "ambiguous",
            content: "private draft token @everyone",
          } as never,
        }),
      ).rejects.toThrow();
      expect(
        (
          await new Service().claim({
            id: draft.id,
            scope,
            revision: draft.revision,
          })
        ).kind,
      ).toBe("in_progress");
    });

    test("safe terminal resource identity survives restart without allowing creation again", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      const claim: DiscordDraftClaim = await service.claim({
        id: draft.id,
        scope,
        revision: draft.revision,
      });
      if (claim.kind !== "acquired") {
        throw new Error("Expected claim");
      }
      const outcome: {
        kind: "created";
        resourceType: "Incident";
        resourceId: string;
      } = {
        kind: "created",
        resourceType: "Incident",
        resourceId: ObjectID.generate().toString(),
      };
      expect(
        await service.finish({
          id: draft.id,
          scope,
          claimId: claim.claimId,
          outcome,
        }),
      ).toBe(true);
      expect(
        await new Service().claim({
          id: draft.id,
          scope,
          revision: draft.revision,
        }),
      ).toMatchObject({ kind: "terminal", outcome });
      expect(await storedContent(draft.id)).toBeNull();
    });

    test("same-owner completion retry is independent of JSON object key order", async (): Promise<void> => {
      const draft: DiscordDraftView = await reviewed();
      const claim: DiscordDraftClaim = await service.claim({
        id: draft.id,
        scope,
        revision: draft.revision,
      });
      if (claim.kind !== "acquired") {
        throw new Error("Expected claim");
      }
      const resourceId: string = ObjectID.generate().toString();
      expect(
        await service.finish({
          id: draft.id,
          scope,
          claimId: claim.claimId,
          outcome: { kind: "created", resourceType: "Incident", resourceId },
        }),
      ).toBe(true);
      expect(
        await new Service().finish({
          id: draft.id,
          scope,
          claimId: claim.claimId,
          outcome: { resourceId, resourceType: "Incident", kind: "created" },
        }),
      ).toBe(true);
      expect(
        await service.finish({
          id: draft.id,
          scope,
          claimId: claim.claimId,
          outcome: {
            kind: "created",
            resourceType: "Incident",
            resourceId: ObjectID.generate().toString(),
          },
        }),
      ).toBe(false);
      expect(await new Service().read({ id: draft.id, scope })).toMatchObject({
        kind: "terminal",
        outcome: { resourceId },
      });
    });

    test("invalid context or oversized content is refused before insertion", async (): Promise<void> => {
      await expect(
        service.open({ scope: { ...scope, channelId: "" }, content: {} }),
      ).rejects.toThrow();
      await expect(
        service.open({ scope, content: { text: "x".repeat(65537) } }),
      ).rejects.toThrow();
      const rows: Array<{ count: string }> = await database.query(
        'SELECT count(*) FROM "DiscordCreationDraft" WHERE "projectId" = $1',
        [scope.projectId.toString()],
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });
  },
);
