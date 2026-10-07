import DatabaseService from "../../../../Server/Services/DatabaseService";
import AnalyticsDatabaseService from "../../../../Server/Services/AnalyticsDatabaseService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIInsightService from "../../../../Server/Services/AIInsightService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import { RealtimeReader } from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import DatabaseModels from "../../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * EVERY LIVE UPDATE GOES THROUGH THE ONE CHECK.
 *
 * A model event leaves the server in one place - Realtime.sendToSockets,
 * called only by Realtime.deliver, which works out first who may read each
 * record (RealtimeAudience, with the record's own read). These scan the
 * server source for any other way out, and pin that every event is queued
 * with the read access of the service that wrote the record.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");
const COMMON_SERVER: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Server",
);
const REALTIME_FILE: string = path.join(COMMON_SERVER, "Utils/Realtime.ts");
const SOCKET_IO_FILE: string = path.join(
  COMMON_SERVER,
  "Infrastructure/SocketIO.ts",
);

const SCANNED_ROOTS: Array<string> = [
  COMMON_SERVER,
  path.join(REPOSITORY_ROOT, "packages/App"),
  path.join(REPOSITORY_ROOT, "ee/Server"),
];

// An import of socket.io itself: a socket server of one's own.
const SOCKET_IO_IMPORT: RegExp = /from "socket\.io"/;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  ".git",
  // Browser code: its sockets are clients of this server.
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
  "Docs",
  "Home",
]);

function serverSourceFiles(): Array<string> {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    if (!fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(full);
        }
        continue;
      }

      if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        files.push(full);
      }
    }
  };

  for (const root of SCANNED_ROOTS) {
    walk(root);
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file);
}

// The text of a method of Realtime, from its name to its closing brace.
function methodBody(source: string, name: string): string {
  const start: number = source.search(
    new RegExp(`\\n  (?:public|private) static (?:async )?${name}\\(`),
  );

  expect([name, start >= 0]).toEqual([name, true]);

  const next: number = source
    .slice(start + 1)
    .search(/\n {2}(?:public|private|protected) (?:static |readonly )/);

  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("every live update goes through the one check", () => {
  const files: Array<string> = serverSourceFiles();
  const realtime: string = fs.readFileSync(REALTIME_FILE, "utf8");

  test("the scan reads the server source", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(REALTIME_FILE);
  });

  test("only Realtime holds the socket server", () => {
    const holders: Array<string> = files
      .filter((file: string): boolean => {
        return file !== REALTIME_FILE && file !== SOCKET_IO_FILE;
      })
      .filter((file: string): boolean => {
        const source: string = fs.readFileSync(file, "utf8");

        return (
          source.includes("Infrastructure/SocketIO") ||
          source.includes("getSocketServer(") ||
          SOCKET_IO_IMPORT.test(source)
        );
      })
      .map(relative);

    expect(holders).toEqual([]);
  });

  test("Realtime sends a model event in one place, to sockets it names", () => {
    // Every `.to(` - from the server or from a socket - however it is wrapped.
    const sends: Array<string> = realtime.match(/\.\s*to\(/g) || [];

    expect(sends).toHaveLength(1);

    const sendToSockets: string = methodBody(realtime, "sendToSockets");

    expect(sendToSockets).toMatch(/socketServer\s*\.\s*to\(/);
    // An empty list is every socket to socket.io: it is never sent.
    expect(sendToSockets).toMatch(/socketIds\.length === 0/);

    // Nothing is broadcast to a room, the namespace or every socket.
    expect(realtime).not.toMatch(
      /socketServer[!]?\s*\.\s*(?:emit|sockets\s*\.\s*emit|local\s*\.\s*emit)\(/,
    );
    expect(realtime).not.toMatch(/\.\s*in\([^)]*\)\s*\.\s*emit\(/);
    expect(realtime).not.toMatch(/\.\s*except\(/);
    expect(realtime).not.toMatch(/\.\s*broadcast\b/);
  });

  test("only deliver sends, after working out who may read each record", () => {
    const callers: Array<string> = [];
    const pattern: RegExp = /this\.sendToSockets\(/g;
    let match: RegExpExecArray | null = pattern.exec(realtime);

    while (match) {
      const before: string = realtime.slice(0, match.index);
      const owner: RegExpMatchArray | null = before
        .split(/\n {2}(?:public|private) static (?:async )?/)
        .pop()!
        .match(/^(\w+)\(/);

      callers.push(owner ? owner[1]! : "?");
      match = pattern.exec(realtime);
    }

    expect(callers.length).toBeGreaterThan(0);
    expect(Array.from(new Set(callers))).toEqual(["deliver"]);

    const deliver: string = methodBody(realtime, "deliver");
    const audience: number = deliver.indexOf(
      "RealtimeAudience.getReadableIds(",
    );
    const firstSend: number = deliver.indexOf("this.sendToSockets(");

    expect(audience).toBeGreaterThan(0);
    expect(firstSend).toBeGreaterThan(audience);
  });

  test("a model event cannot be queued without the record's read access", () => {
    const emitModelEvent: string = methodBody(realtime, "emitModelEvent");

    expect(emitModelEvent).toMatch(/\n\s+access: RealtimeReadAccess;\n/);
    expect(emitModelEvent).not.toMatch(/access\?:/);
  });

  test("every model event is queued by the service that wrote the record, with its access", () => {
    const callers: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      const pattern: RegExp = /Realtime\.emitModelEvent\(\{([\s\S]*?)\}\)/g;
      let match: RegExpExecArray | null = pattern.exec(source);

      while (match) {
        callers.push(relative(file));
        expect([relative(file), match[1]!]).toEqual([
          relative(file),
          expect.stringMatching(/\baccess: /),
        ]);
        match = pattern.exec(source);
      }
    }

    expect(callers.sort()).toEqual([
      "packages/Common/Server/Services/AnalyticsDatabaseService.ts",
      "packages/Common/Server/Services/DatabaseService.ts",
    ]);

    const database: string = fs.readFileSync(
      path.join(COMMON_SERVER, "Services/DatabaseService.ts"),
      "utf8",
    );
    expect(database).toMatch(
      /access: options\?\.access \|\| this\.getRealtimeReadAccess\(\)/,
    );

    const analytics: string = fs.readFileSync(
      path.join(COMMON_SERVER, "Services/AnalyticsDatabaseService.ts"),
      "utf8",
    );
    const emit: RegExpMatchArray | null = analytics.match(
      /Realtime\.emitModelEvent\(\{([\s\S]*?)\}\)/,
    );

    expect(emit).not.toBeNull();
    // The one access of the service, so every insert's events merge...
    expect(emit![1]).toMatch(/access: this\.getRealtimeReadAccess\(\),/);
    // ...and the resource each row belongs to, sent with its event.
    expect(emit![1]).toMatch(/ownerId: this\.getRealtimeOwnerId\(item\),/);
  });

  test("an update event carries who could read the rows before the write, when it may change that", () => {
    const database: string = fs.readFileSync(
      path.join(COMMON_SERVER, "Services/DatabaseService.ts"),
      "utf8",
    );

    const updates: Array<string> =
      database.match(
        /onTriggerRealtime\(([^;]*?ModelEventType\.Update[^;]*?)\);/g,
      ) || [];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/access:\s*\n?\s*realtimeUpdateAccess\.get\(/);

    // Decided before the first row is written.
    const decided: number = database.indexOf(
      "await this.getRealtimeAccessBeforeUpdate(",
    );
    const updateBy: number = database.indexOf(
      "private async _updateBy(updateBy: UpdateBy<TBaseModel>)",
    );
    const firstWrite: number = database.indexOf(
      "await this.getRepository().save(savedItem);",
      updateBy,
    );

    expect(updateBy).toBeGreaterThan(0);
    expect(decided).toBeGreaterThan(updateBy);
    expect(firstWrite).toBeGreaterThan(decided);
  });

  test("anywhere else, an event is decided by the service's own read: no access of its own is handed over", () => {
    const callers: Array<string> = [];

    for (const file of files) {
      if (file.endsWith(path.join("Services", "DatabaseService.ts"))) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");
      const pattern: RegExp = /\.onTriggerRealtime\(([^;]*?)\);/g;
      let match: RegExpExecArray | null = pattern.exec(source);

      while (match) {
        callers.push(relative(file));
        // The record, its project and the kind of event - nothing more.
        expect([relative(file), match[1]!]).toEqual([
          relative(file),
          expect.not.stringMatching(/access/),
        ]);
        match = pattern.exec(source);
      }
    }

    expect(callers.length).toBeGreaterThan(0);
  });

  test("a delete event carries who could read the rows before they went", () => {
    const deletes: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      const pattern: RegExp =
        /onTriggerRealtime\(([^;]*?ModelEventType\.Delete[^;]*?)\);/g;
      let match: RegExpExecArray | null = pattern.exec(source);

      while (match) {
        deletes.push(relative(file));
        expect([relative(file), match[1]!]).toEqual([
          relative(file),
          expect.stringMatching(/access:\s*\n?\s*realtimeDeleteAccess\.get\(/),
        ]);
        match = pattern.exec(source);
      }
    }

    expect(deletes).toEqual([
      "packages/Common/Server/Services/DatabaseService.ts",
    ]);
  });
});

describe("every model that sends live updates is read the way its service reads it", () => {
  const SERVER_ADMIN: DatabaseCommonInteractionProps = {
    userId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
    tenantId: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  };

  function readerOf(props: DatabaseCommonInteractionProps): RealtimeReader {
    return {
      key: "server-admin",
      props: props,
      remember: <T>(_name: string, work: () => Promise<T>): Promise<T> => {
        return work();
      },
    };
  }

  const databaseModels: Array<{ new (): BaseModel }> = DatabaseModels.filter(
    (modelType: { new (): BaseModel }): boolean => {
      return Boolean(new modelType().enableRealtimeEventsOn);
    },
  );

  const analyticsModels: Array<{ new (): AnalyticsBaseModel }> =
    AnalyticsModels.filter((modelType: { new (): AnalyticsBaseModel }) => {
      return Boolean(new modelType().enableRealtimeEventsOn);
    });

  /*
   * The services that write the models sending live updates. A model that
   * starts sending them is added here with its service, and so meets the
   * checks below.
   */
  const DATABASE_SERVICES: Array<DatabaseService<BaseModel>> = [
    IncidentService,
    AlertService,
    IncidentEpisodeService,
    AlertEpisodeService,
    ServiceLevelObjectiveService,
    AIRunService,
    AIRunEventService,
    AIConversationMessageService,
    AIInsightService,
  ] as unknown as Array<DatabaseService<BaseModel>>;

  const ANALYTICS_SERVICES: Array<
    AnalyticsDatabaseService<AnalyticsBaseModel>
  > = [ExceptionInstanceService] as unknown as Array<
    AnalyticsDatabaseService<AnalyticsBaseModel>
  >;

  test("every model that sends live updates is written by a service listed here", () => {
    expect(
      databaseModels
        .map((modelType: { new (): BaseModel }): string => {
          return modelType.name;
        })
        .sort(),
    ).toEqual(
      DATABASE_SERVICES.map((service: DatabaseService<BaseModel>): string => {
        return service.modelType.name;
      }).sort(),
    );
    expect(
      analyticsModels.map((modelType: { new (): AnalyticsBaseModel }) => {
        return modelType.name;
      }),
    ).toEqual(
      ANALYTICS_SERVICES.map(
        (service: AnalyticsDatabaseService<AnalyticsBaseModel>): string => {
          return service.modelType.name;
        },
      ),
    );
  });

  test.each(
    DATABASE_SERVICES.map((service: DatabaseService<BaseModel>) => {
      return [service.modelType.name, service];
    }) as Array<[string, DatabaseService<BaseModel>]>,
  )(
    "%s: its service decides, and someone who reads everything hears every event without a read",
    async (_model: string, service: DatabaseService<BaseModel>) => {
      await expect(
        service.readsEveryRecordInProject(SERVER_ADMIN),
      ).resolves.toBe(true);
    },
  );

  test.each(
    ANALYTICS_SERVICES.map(
      (service: AnalyticsDatabaseService<AnalyticsBaseModel>) => {
        return [service.modelType.name, service];
      },
    ) as Array<[string, AnalyticsDatabaseService<AnalyticsBaseModel>]>,
  )(
    "%s: its service decides by the read check and the read scope alone",
    async (
      _model: string,
      service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    ) => {
      await expect(
        service
          .getRealtimeReadAccess()
          .readsEveryRecord(readerOf(SERVER_ADMIN)),
      ).resolves.toBe(true);
    },
  );
});
