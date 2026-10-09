import Entities from "../../../../Models/DatabaseModels/Index";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import { ProjectScopedReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import StatusPageSubscriberResources from "../../../../Server/Utils/StatusPage/StatusPageSubscriberResources";
import StatusPageEventType from "../../../../Types/StatusPage/StatusPageEventType";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * THE RESOURCES A SUBSCRIPTION NAMES ARE ITS OWN STATUS PAGE'S - against a
 * migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_RESOURCES_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SUBSCRIBER_RESOURCES_TESTS=true \
 *   SUBSCRIBER_RESOURCES_TEST_DATABASE_HOST=127.0.0.1 \
 *   SUBSCRIBER_RESOURCES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/StatusPage/StatusPageSubscriberResourcesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * StatusPageSubscriberResources reads what is on a page - the page's
 * StatusPageResource rows by id, with each one's monitor for a visitor - and
 * the subscriber service reads what the subscriptions an update writes name
 * already, through the subscriber's join table, then holds the update to
 * those subscriptions - the ones its caller may write, read again by id;
 * the subscriber jobs read each named resource with its page. Those reads
 * are TypeORM queries over a relation, an `IN` list and a join table, so
 * only a real driver can judge them. They run here against structure-only
 * clones of the migrated tables (LIKE ... INCLUDING ALL) in a uniquely named
 * schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_RESOURCES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Monitor",
  "StatusPageResource",
  "StatusPageSubscriber",
  "StatusPageSubscriberStatusPageResource",
];

describePostgres(
  "a subscription's resources against a migrated Postgres",
  () => {
    const schema: string = `subscriber_resources_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const pageA: ObjectID = ObjectID.generate();
    const pageB: ObjectID = ObjectID.generate();
    const otherProjectPage: ObjectID = ObjectID.generate();

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SUBSCRIBER_RESOURCES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SUBSCRIBER_RESOURCES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SUBSCRIBER_RESOURCES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    beforeEach(async () => {
      await database.query(
        [...TABLES]
          .reverse()
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedMonitor(data: {
      projectId?: ObjectID;
      isArchived?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Monitor"
           ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "isArchived", "version")
         VALUES ($1, $2, $3, $4, 'Manual', $5, $6, 1)`,
        [
          id.toString(),
          (data.projectId || projectId).toString(),
          `Monitor ${id.toString()}`,
          `monitor-${id.toString()}`,
          ObjectID.generate().toString(),
          data.isArchived === true,
        ],
      );
      return id;
    }

    // A resource of `statusPageId`: a monitor's, or a monitor group's.
    async function seedResource(data: {
      statusPageId: ObjectID;
      projectId?: ObjectID;
      monitorId?: ObjectID;
      monitorGroupId?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."StatusPageResource"
           ("_id", "projectId", "statusPageId", "monitorId", "monitorGroupId", "displayName", "order", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 1, 1)`,
        [
          id.toString(),
          (data.projectId || projectId).toString(),
          data.statusPageId.toString(),
          data.monitorId?.toString() || null,
          data.monitorGroupId?.toString() || null,
          `Resource ${id.toString()}`,
        ],
      );
      return id;
    }

    // A confirmed subscriber of `statusPageId` naming `resources`.
    async function seedSubscriber(data: {
      statusPageId: ObjectID;
      projectId?: ObjectID;
      resources: Array<ObjectID>;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber"
           ("_id", "projectId", "statusPageId", "subscriberEmail", "isSubscribedToAllResources",
            "isUnsubscribed", "isSubscriptionConfirmed", "unsubscribeToken", "version")
         VALUES ($1, $2, $3, $4, false, false, true, $5, 1)`,
        [
          id.toString(),
          (data.projectId || projectId).toString(),
          data.statusPageId.toString(),
          `subscriber-${id.toString()}@example.com`,
          `${id.toString().replace(/-/g, "")}${id.toString().replace(/-/g, "")}`,
        ],
      );

      for (const resourceId of data.resources) {
        await database.query(
          `INSERT INTO "${schema}"."StatusPageSubscriberStatusPageResource"
             ("statusPageSubscriberId", "statusPageResourceId")
           VALUES ($1, $2)`,
          [id.toString(), resourceId.toString()],
        );
      }

      return id;
    }

    function sorted(ids: Iterable<string | ObjectID>): Array<string> {
      return [...ids]
        .map((id: string | ObjectID): string => {
          return id.toString().toLowerCase();
        })
        .sort();
    }

    async function refusalOf(promise: Promise<unknown>): Promise<Error> {
      try {
        await promise;
      } catch (error) {
        return error as Error;
      }

      throw new Error("Expected the write to be refused, but it was allowed.");
    }

    test("finds the page's own resources, and not another page's, another project's or an unknown id", async () => {
      const monitorId: ObjectID = await seedMonitor({});
      const own: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId,
      });
      const ownGroup: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorGroupId: ObjectID.generate(),
      });
      const otherPage: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId,
      });
      const otherProject: ObjectID = await seedResource({
        statusPageId: otherProjectPage,
        projectId: otherProjectId,
        monitorId: await seedMonitor({ projectId: otherProjectId }),
      });

      const found: Set<string> =
        await StatusPageSubscriberResources.findIdsOnPage({
          statusPageId: pageA,
          ids: [
            own.toString(),
            ownGroup.toString().toUpperCase(),
            otherPage.toString(),
            otherProject.toString(),
            ObjectID.generate().toString(),
            "not-an-id",
          ],
          shownToVisitorsOnly: false,
        });

      expect(sorted(found)).toEqual(sorted([own, ownGroup]));
    });

    test("for a visitor, leaves out a resource whose monitor is archived, and keeps a monitor group's", async () => {
      const shown: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const archived: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({ isArchived: true }),
      });
      const group: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorGroupId: ObjectID.generate(),
      });
      const ids: Array<string> = [shown, archived, group].map(
        (id: ObjectID): string => {
          return id.toString();
        },
      );

      expect(
        sorted(
          await StatusPageSubscriberResources.findIdsOnPage({
            statusPageId: pageA,
            ids,
            shownToVisitorsOnly: true,
          }),
        ),
      ).toEqual(sorted([shown, group]));

      // The team may name any resource of the page.
      expect(
        sorted(
          await StatusPageSubscriberResources.findIdsOnPage({
            statusPageId: pageA,
            ids,
            shownToVisitorsOnly: false,
          }),
        ),
      ).toEqual(sorted([shown, archived, group]));
    });

    test("refuses another page's resource with the answer an unknown id gets", async () => {
      const otherPage: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const unknown: string = ObjectID.generate().toString();

      const refused: Error = await refusalOf(
        StatusPageSubscriberResources.assertOnPage({
          statusPageId: pageA,
          ids: [otherPage.toString()],
          shownToVisitorsOnly: false,
        }),
      );
      const missing: Error = await refusalOf(
        StatusPageSubscriberResources.assertOnPage({
          statusPageId: pageA,
          ids: [unknown],
          shownToVisitorsOnly: false,
        }),
      );

      expect(refused).toBeInstanceOf(ProjectScopedReferenceException);
      expect(missing).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refused.message.split(otherPage.toString()).join("<id>")).toBe(
        missing.message.split(unknown).join("<id>"),
      );
    });

    test("an update reads what each subscription names already through its join table, and is held to the subscriptions read", async () => {
      const own: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({ isArchived: true }),
      });
      const legacyForeign: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const first: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [own, legacyForeign],
      });
      const second: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [],
      });
      // Another project's subscriber, which an update of this project's does not reach.
      await seedSubscriber({
        statusPageId: otherProjectPage,
        projectId: otherProjectId,
        resources: [],
      });

      const updateBy: UpdateBy<StatusPageSubscriber> = {
        query: { projectId: projectId },
        data: {
          statusPageResources: [own, legacyForeign].map(
            (id: ObjectID): StatusPageResource => {
              const resource: StatusPageResource = new StatusPageResource();
              resource._id = id.toString();
              return resource;
            },
          ),
        },
        props: { isRoot: true, tenantId: projectId },
        skip: 0,
        limit: 10,
      } as unknown as UpdateBy<StatusPageSubscriber>;

      /*
       * The first subscription names both already; the second names
       * neither, and another page's resource is not one it may add.
       */
      const refused: Error = await refusalOf(
        (
          StatusPageSubscriberService as unknown as {
            checkResourcesOnPages: (
              updateBy: UpdateBy<StatusPageSubscriber>,
            ) => Promise<void>;
          }
        ).checkResourcesOnPages(updateBy),
      );

      expect(refused).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refused.message).toContain(legacyForeign.toString());
      expect(refused.message).not.toContain(own.toString());

      // The update now names the project's two subscriptions, and no other.
      const held: unknown = (
        updateBy.query as unknown as Record<string, unknown>
      )["_id"];
      const heldIds: Array<string> = Object.values(
        (held as { objectLiteralParameters: Record<string, unknown> })
          .objectLiteralParameters,
      ).flat() as Array<string>;

      expect(sorted(heldIds)).toEqual(sorted([first, second]));
      expect(updateBy.skip).toBe(0);
      expect(updateBy.limit).toBe(2);
    });

    function namingResources(ids: Array<ObjectID>): Array<StatusPageResource> {
      return ids.map((id: ObjectID): StatusPageResource => {
        const resource: StatusPageResource = new StatusPageResource();
        resource._id = id.toString();
        return resource;
      });
    }

    // The ids an update's query names by _id: a plain id, or an "any of".
    function heldIdsOf(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Array<string> {
      const held: unknown = (
        updateBy.query as unknown as Record<string, unknown>
      )["_id"];

      if (typeof held === "string") {
        return [held];
      }

      return Object.values(
        (held as { objectLiteralParameters: Record<string, unknown> })
          .objectLiteralParameters,
      ).flat() as Array<string>;
    }

    async function checkResourcesOnPages(
      updateBy: UpdateBy<StatusPageSubscriber>,
    ): Promise<void> {
      await (
        StatusPageSubscriberService as unknown as {
          checkResourcesOnPages: (
            updateBy: UpdateBy<StatusPageSubscriber>,
          ) => Promise<void>;
        }
      ).checkResourcesOnPages(updateBy);
    }

    test("an update over subscriptions of two pages reads both pages at once, and adds to each only its own page's resources", async () => {
      const ofA: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const ofB: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const onA: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [],
      });
      const onB: ObjectID = await seedSubscriber({
        statusPageId: pageB,
        resources: [ofA],
      });

      const update: (ids: Array<ObjectID>) => UpdateBy<StatusPageSubscriber> = (
        ids: Array<ObjectID>,
      ): UpdateBy<StatusPageSubscriber> => {
        return {
          query: {},
          data: { statusPageResources: namingResources(ids) },
          props: { isRoot: true, tenantId: projectId },
          skip: 0,
          limit: 10,
        } as unknown as UpdateBy<StatusPageSubscriber>;
      };

      /*
       * Page A's resource is page A's subscription's to add, and page B's
       * subscription names it already; page B's resource is page B's
       * subscription's to add, and not page A's.
       */
      const refused: Error = await refusalOf(
        checkResourcesOnPages(update([ofA, ofB])),
      );

      expect(refused).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refused.message).toContain(ofB.toString());
      expect(refused.message).not.toContain(ofA.toString());

      // Page A's resource alone: every subscription keeps or adds it rightly.
      const allowed: UpdateBy<StatusPageSubscriber> = update([ofA]);

      await expect(checkResourcesOnPages(allowed)).resolves.toBeUndefined();
      expect(sorted(heldIdsOf(allowed))).toEqual(sorted([onA, onB]));
    });

    test("a teammate's update checks, and is held to, only the subscriptions they may write", async () => {
      const ofA: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const theirs: Array<ObjectID> = [
        await seedSubscriber({ statusPageId: pageA, resources: [] }),
        await seedSubscriber({ statusPageId: pageA, resources: [] }),
      ];
      // Not theirs to write - and on another page, where ofA is not a resource.
      await seedSubscriber({
        statusPageId: pageB,
        resources: [],
      });

      /*
       * What the caller may write is decided by their permissions; here they
       * reach the two subscriptions of page A, and the update, which names
       * no subscription, is left scoped to the project.
       */
      const updatableQuery: jest.SpyInstance = jest
        .spyOn(ModelPermission, "getUpdatableQuery")
        .mockImplementation(
          async (
            _modelType: unknown,
            query: Query<StatusPageSubscriber>,
          ): Promise<Query<StatusPageSubscriber>> => {
            return {
              ...query,
              projectId: projectId,
              _id: QueryHelper.any(
                theirs.map((id: ObjectID): string => {
                  return id.toString();
                }),
              ),
            } as unknown as Query<StatusPageSubscriber>;
          },
        );

      try {
        const updateBy: UpdateBy<StatusPageSubscriber> = {
          query: {},
          data: { statusPageResources: namingResources([ofA]) },
          props: {
            tenantId: projectId,
            userId: ObjectID.generate(),
          },
          skip: 0,
          limit: 10,
        } as unknown as UpdateBy<StatusPageSubscriber>;

        // The update path reads the rows the caller may write first.
        await expect(
          (
            StatusPageSubscriberService as unknown as {
              keepRowsCallerMayWrite: (
                write: UpdateBy<StatusPageSubscriber>,
                type: DatabaseRequestType.Update,
              ) => Promise<boolean>;
            }
          ).keepRowsCallerMayWrite(updateBy, DatabaseRequestType.Update),
        ).resolves.toBe(true);

        // The other page's subscription, which they may not write, says nothing.
        await expect(checkResourcesOnPages(updateBy)).resolves.toBeUndefined();

        expect(sorted(heldIdsOf(updateBy))).toEqual(sorted(theirs));
        expect(updateBy.skip).toBe(0);
        expect(updateBy.limit).toBe(2);
      } finally {
        updatableQuery.mockRestore();
      }
    });

    test("a visitor's change adds only what the page shows, and keeps a hidden resource it names already", async () => {
      const shown: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const hidden: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({ isArchived: true }),
      });
      const hiddenToo: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({ isArchived: true }),
      });
      const subscriberId: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [hidden],
      });

      // The visitor's change runs the update hook alone, as the write would.
      const updateBySpy: jest.SpyInstance = jest
        .spyOn(StatusPageSubscriberService, "updateBy")
        .mockImplementation(
          async (updateBy: UpdateBy<StatusPageSubscriber>): Promise<number> => {
            await (
              StatusPageSubscriberService as unknown as {
                onBeforeUpdate: (
                  updateBy: UpdateBy<StatusPageSubscriber>,
                ) => Promise<unknown>;
              }
            ).onBeforeUpdate(updateBy);
            return 1;
          },
        );

      const change: (ids: Array<ObjectID>) => Promise<number> = (
        ids: Array<ObjectID>,
      ): Promise<number> => {
        return StatusPageSubscriberService.updateFromManageSubscriptionPage({
          subscriberId: subscriberId,
          data: {
            statusPageResources: ids.map((id: ObjectID): StatusPageResource => {
              const resource: StatusPageResource = new StatusPageResource();
              resource._id = id.toString();
              return resource;
            }),
          } as unknown as UpdateBy<StatusPageSubscriber>["data"],
        });
      };

      try {
        // It keeps the hidden resource it names, and adds a shown one.
        await expect(change([hidden, shown])).resolves.toBe(1);

        // It may not add another hidden one.
        const refused: Error = await refusalOf(change([hidden, hiddenToo]));
        expect(refused).toBeInstanceOf(ProjectScopedReferenceException);
        expect(refused.message).toContain(hiddenToo.toString());
        expect(refused.message).not.toContain(hidden.toString());
      } finally {
        updateBySpy.mockRestore();
      }
    });

    test("an update adds only the subscriber's page's resources, keeps what it names already, and reads only the rows its query names", async () => {
      const ownArchived: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({ isArchived: true }),
      });
      const ownNew: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const legacyForeign: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const otherPage: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const subscriberId: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [ownArchived, legacyForeign],
      });
      const otherProjectSubscriber: ObjectID = await seedSubscriber({
        statusPageId: otherProjectPage,
        projectId: otherProjectId,
        resources: [],
      });

      /*
       * OneUptime's update of one subscriber, made in this project: its
       * query names the project unless `inAnyProject` says it does not.
       */
      const checkUpdate: (data: {
        id: ObjectID;
        resources: Array<ObjectID>;
        inAnyProject?: boolean;
      }) => Promise<void> = async (data: {
        id: ObjectID;
        resources: Array<ObjectID>;
        inAnyProject?: boolean;
      }): Promise<void> => {
        const updateBy: UpdateBy<StatusPageSubscriber> = {
          query: data.inAnyProject
            ? { _id: data.id.toString() }
            : { _id: data.id.toString(), projectId: projectId },
          data: {
            statusPageResources: data.resources.map(
              (id: ObjectID): StatusPageResource => {
                const resource: StatusPageResource = new StatusPageResource();
                resource._id = id.toString();
                return resource;
              },
            ),
          },
          props: { isRoot: true, tenantId: projectId },
          skip: 0,
          limit: 1,
        } as unknown as UpdateBy<StatusPageSubscriber>;

        await (
          StatusPageSubscriberService as unknown as {
            checkResourcesOnPages: (
              updateBy: UpdateBy<StatusPageSubscriber>,
            ) => Promise<void>;
          }
        ).checkResourcesOnPages(updateBy);
      };

      // Everything it named stays, and a resource of its page is added.
      await expect(
        checkUpdate({
          id: subscriberId,
          resources: [ownArchived, legacyForeign, ownNew],
        }),
      ).resolves.toBeUndefined();

      // Another page's resource is not added.
      const refused: Error = await refusalOf(
        checkUpdate({
          id: subscriberId,
          resources: [ownArchived, otherPage],
        }),
      );
      expect(refused).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refused.message).toContain(otherPage.toString());
      expect(refused.message).not.toContain(ownArchived.toString());

      /*
       * An update that names this project does not reach another project's
       * subscriber: nothing is read, and the update is held to nothing.
       */
      await expect(
        checkUpdate({
          id: otherProjectSubscriber,
          resources: [otherPage],
        }),
      ).resolves.toBeUndefined();

      /*
       * OneUptime's update by id alone writes that subscriber, in whatever
       * project it is, so it is checked against the subscriber's own page.
       */
      const refusedElsewhere: Error = await refusalOf(
        checkUpdate({
          id: otherProjectSubscriber,
          resources: [otherPage],
          inAnyProject: true,
        }),
      );
      expect(refusedElsewhere).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refusedElsewhere.message).toContain(otherPage.toString());
    });

    test("the subscriber jobs read each named resource with its page, and tell a subscriber only through its own page's", async () => {
      const own: ObjectID = await seedResource({
        statusPageId: pageA,
        monitorId: await seedMonitor({}),
      });
      const legacyForeign: ObjectID = await seedResource({
        statusPageId: pageB,
        monitorId: await seedMonitor({}),
      });
      const subscriberId: ObjectID = await seedSubscriber({
        statusPageId: pageA,
        resources: [own, legacyForeign],
      });

      const subscribers: Array<StatusPageSubscriber> =
        await StatusPageSubscriberService.getSubscribersByStatusPage(pageA, {
          isRoot: true,
        });

      expect(
        subscribers.map((subscriber: StatusPageSubscriber): string => {
          return subscriber._id!.toString();
        }),
      ).toEqual([subscriberId.toString()]);

      const named: Array<StatusPageResource> =
        subscribers[0]!.statusPageResources || [];

      expect(
        named
          .map((resource: StatusPageResource): string => {
            return `${resource._id!.toString()}:${resource.statusPageId!.toString()}`;
          })
          .sort(),
      ).toEqual(
        [
          `${own.toString()}:${pageA.toString()}`,
          `${legacyForeign.toString()}:${pageB.toString()}`,
        ].sort(),
      );

      // A page whose subscribers choose their resources.
      const statusPage: StatusPage = new StatusPage();
      statusPage.id = pageA;
      statusPage.allowSubscribersToChooseResources = true;

      const eventResource: (
        id: ObjectID,
        statusPageId?: ObjectID,
      ) => StatusPageResource = (
        id: ObjectID,
        statusPageId?: ObjectID,
      ): StatusPageResource => {
        const resource: StatusPageResource = new StatusPageResource();
        resource.id = id;
        if (statusPageId) {
          resource.statusPageId = statusPageId;
        }
        return resource;
      };

      // An event on its own page's resource reaches it.
      expect(
        StatusPageSubscriberService.shouldSendNotification({
          subscriber: subscribers[0]!,
          statusPageResources: [eventResource(own, pageA)],
          statusPage,
          eventType: StatusPageEventType.Incident,
        }),
      ).toBe(true);

      // An event on the other page's resource it named before does not.
      expect(
        StatusPageSubscriberService.shouldSendNotification({
          subscriber: subscribers[0]!,
          statusPageResources: [eventResource(legacyForeign, pageB)],
          statusPage,
          eventType: StatusPageEventType.Incident,
        }),
      ).toBe(false);

      /*
       * Nor when the event's resource comes without its page: the
       * subscriber's own list, read with each resource's page, decides.
       */
      expect(
        StatusPageSubscriberService.shouldSendNotification({
          subscriber: subscribers[0]!,
          statusPageResources: [eventResource(legacyForeign)],
          statusPage,
          eventType: StatusPageEventType.Incident,
        }),
      ).toBe(false);

      // And its own page's resource reaches it as the sender hands it over.
      expect(
        StatusPageSubscriberService.shouldSendNotification({
          subscriber: subscribers[0]!,
          statusPageResources: [eventResource(own)],
          statusPage,
          eventType: StatusPageEventType.Incident,
        }),
      ).toBe(true);
    });
  },
);
