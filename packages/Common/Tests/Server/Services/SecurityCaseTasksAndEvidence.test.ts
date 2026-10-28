import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import User from "../../../Models/DatabaseModels/User";
import FileService from "../../../Server/Services/FileService";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCaseEvidenceService, {
  EVIDENCE_FILE_NOT_FOUND,
  MAX_EVIDENCE_DESCRIPTION_LENGTH,
  normalizeEvidenceName,
  readEvidenceFileFacts,
  readEvidenceUrl,
} from "../../../Server/Services/SecurityCaseEvidenceService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCasePriorityService, {
  checkResponseTargets,
} from "../../../Server/Services/SecurityCasePriorityService";
import SecurityCaseTaskService, {
  normalizeTaskTitle,
} from "../../../Server/Services/SecurityCaseTaskService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import StateOrderGuard from "../../../Server/Utils/Database/StateOrderGuard";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Green500, Red500 } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseEvidenceKind from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import { DEFAULT_SECURITY_CASE_PRIORITIES } from "../../../Utils/SecurityCase/SecurityCasePriorities";

/*
 * A security case's tasks and evidence on the server, and its priorities'
 * response targets.
 *
 *   - A task: a title of a line, its assignee read from either spelling,
 *     who ticked it off and when written by OneUptime (and cleared when it
 *     is opened again), its timeline entries, and its assignee told -
 *     never a person about a task they handed themselves.
 *   - Evidence: a File from the case's own project, measured once (name,
 *     type, size, SHA-256) as it is added; a Link with an http or https
 *     address and nothing else; only its name and description change
 *     afterwards; the timeline says what was added and removed.
 *   - A priority's targets: whole minutes from 1 to a year, or empty for
 *     none; and a new project's defaults.
 *
 * No database: the services' reads and writes are spied, the hooks are
 * called as DatabaseService calls them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TASK_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const EVIDENCE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const FILE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MAYA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const ANA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000002");
const DIEGO_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000003");
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

// sha256("hello") - the bytes of the file below.
const HELLO_SHA256: string =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

const NAMES: Record<string, string> = {
  [MAYA_ID.toString()]: "Maya",
  [ANA_ID.toString()]: "Ana",
  [DIEGO_ID.toString()]: "Diego",
};

type Hooks<TModel extends DatabaseBaseModel> = {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onCreateSuccess: (
    onCreate: OnCreate<TModel>,
    createdItem: TModel,
  ) => Promise<TModel>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<TModel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<TModel>>;
  onBeforeDelete: (deleteBy: DeleteBy<TModel>) => Promise<OnDelete<TModel>>;
  onDeleteSuccess: (
    onDelete: OnDelete<TModel>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<TModel>>;
  findRowsAndHoldUpdateToThem: (...args: Array<unknown>) => Promise<unknown>;
  findRowsAndHoldDeleteToThem: (...args: Array<unknown>) => Promise<unknown>;
  updateColumnsByIdWithoutHooks: (...args: Array<unknown>) => Promise<unknown>;
};

const taskHooks: Hooks<SecurityCaseTask> =
  SecurityCaseTaskService as unknown as Hooks<SecurityCaseTask>;
const evidenceHooks: Hooks<SecurityCaseEvidence> =
  SecurityCaseEvidenceService as unknown as Hooks<SecurityCaseEvidence>;

// Maya, working the case.
const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

let feedItems: Array<JSONObject>;
let tasksHandedOver: Array<JSONObject>;
let columnWrites: Array<{ id: string; data: JSONObject }>;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });

  feedItems = [];
  tasksHandedOver = [];
  columnWrites = [];

  // The project check of every reference is its own suite's.
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
      return undefined as never;
    });

  jest
    .spyOn(SecurityCaseNotifications, "taskAssigned")
    .mockImplementation(async (args: unknown): Promise<void> => {
      tasksHandedOver.push(args as JSONObject);
    });

  jest
    .spyOn(UserService, "findOneById")
    .mockImplementation(async (args: unknown) => {
      const name: string | undefined =
        NAMES[(args as { id: ObjectID }).id.toString()];

      if (!name) {
        return null;
      }

      const user: User = new User();
      user.name = name as never;
      return user;
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function feedTexts(): Array<string> {
  return feedItems.map((item: JSONObject): string => {
    return String(item["feedInfoInMarkdown"]);
  });
}

describe("a task's title", () => {
  test("is kept trimmed", () => {
    expect(normalizeTaskTitle("  Reset the admin password \n")).toBe(
      "Reset the admin password",
    );
  });

  test("is never empty", () => {
    for (const value of ["", "   ", undefined, null, 12]) {
      expect(() => {
        return normalizeTaskTitle(value);
      }).toThrow(
        new BadDataException("A task needs a title: what has to be done."),
      );
    }
  });

  test("is a line: at most 500 characters, the details go in a note", () => {
    expect(normalizeTaskTitle("x".repeat(500))).toHaveLength(500);
    expect(() => {
      return normalizeTaskTitle("x".repeat(501));
    }).toThrow(
      "A task's title can be at most 500 characters. Keep it to a line, and put the details in a note.",
    );
  });
});

describe("adding a task", () => {
  function task(overrides: Partial<SecurityCaseTask> = {}): SecurityCaseTask {
    const model: SecurityCaseTask = new SecurityCaseTask();
    model.projectId = PROJECT_ID;
    model.securityCaseId = CASE_ID;
    model.title = "Reset the admin password";
    Object.assign(model, overrides);
    return model;
  }

  function created(
    overrides: Partial<SecurityCaseTask> = {},
  ): SecurityCaseTask {
    return task({ _id: TASK_ID.toString(), ...overrides });
  }

  function onCreate(data: SecurityCaseTask): OnCreate<SecurityCaseTask> {
    return {
      createBy: { data, props: MAYA },
      carryForward: null,
    };
  }

  beforeEach(() => {
    jest
      .spyOn(
        taskHooks as unknown as { updateColumnsByIdWithoutHooks: () => void },
        "updateColumnsByIdWithoutHooks",
      )
      .mockImplementation((async (args: unknown) => {
        const { id, data } = args as { id: ObjectID; data: JSONObject };
        columnWrites.push({ id: id.toString(), data });
      }) as never);
  });

  test("its title trimmed, and refused without one", async () => {
    const data: SecurityCaseTask = task({ title: "  Pull the proxy logs  " });

    await taskHooks.onBeforeCreate({ data, props: MAYA });
    expect(data.title).toBe("Pull the proxy logs");

    await expect(
      taskHooks.onBeforeCreate({ data: task({ title: "  " }), props: MAYA }),
    ).rejects.toThrow("A task needs a title: what has to be done.");
  });

  test("its assignee read from either spelling", async () => {
    const data: SecurityCaseTask = task();
    const assignee: User = new User();
    assignee._id = ANA_ID.toString();
    data.assignedToUser = assignee;

    await taskHooks.onBeforeCreate({ data, props: MAYA });

    expect(data.assignedToUserId?.toString()).toBe(ANA_ID.toString());
  });

  test("for somebody: on the timeline with who it is for, and they are told who handed it over", async () => {
    await taskHooks.onCreateSuccess(
      onCreate(task()),
      created({ assignedToUserId: ANA_ID, createdByUserId: MAYA_ID }),
    );

    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        feedInfoInMarkdown:
          "📋 Added the task **Reset the admin password**, for **Ana**.",
        eventType: SecurityCaseFeedEventType.Task,
        displayColor: Gray500,
        userId: MAYA_ID,
      },
    ]);
    expect(tasksHandedOver).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        taskId: TASK_ID,
        userId: ANA_ID,
        actorUserId: MAYA_ID,
      },
    ]);
    // Not done: nobody ticked it off.
    expect(columnWrites).toEqual([]);
  });

  test("for nobody: on the timeline, and nobody told", async () => {
    await taskHooks.onCreateSuccess(onCreate(task()), created());

    expect(feedTexts()).toEqual([
      "📋 Added the task **Reset the admin password**.",
    ]);
    expect(tasksHandedOver).toEqual([]);
  });

  test("added done: whoever added it did it, now", async () => {
    await taskHooks.onCreateSuccess(
      onCreate(task({ isDone: true })),
      created({ isDone: true }),
    );

    expect(columnWrites).toEqual([
      {
        id: TASK_ID.toString(),
        data: { doneAt: NOW, doneByUserId: MAYA_ID },
      },
    ]);
  });

  test("a title that reads as Markdown is shown as the text it is", async () => {
    await taskHooks.onCreateSuccess(
      onCreate(task()),
      created({ title: "[Reset here](https://evil.example)" }),
    );

    expect(feedTexts()[0]).not.toContain("[Reset here](https://evil.example)");
    expect(feedTexts()[0]).toContain("Reset here");
  });

  test("the task is kept when its timeline entry cannot be written", async () => {
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    const item: SecurityCaseTask = created({ assignedToUserId: ANA_ID });

    await expect(
      taskHooks.onCreateSuccess(onCreate(task()), item),
    ).resolves.toBe(item);
  });
});

describe("changing a task", () => {
  let heldRows: Array<SecurityCaseTask>;
  let rowReads: number;

  beforeEach(() => {
    rowReads = 0;
    const row: SecurityCaseTask = new SecurityCaseTask();
    row._id = TASK_ID.toString();
    row.projectId = PROJECT_ID;
    row.securityCaseId = CASE_ID;
    row.title = "Reset the admin password";
    row.isDone = false;
    row.assignedToUserId = ANA_ID;
    heldRows = [row];

    jest
      .spyOn(
        taskHooks as unknown as { findRowsAndHoldUpdateToThem: () => void },
        "findRowsAndHoldUpdateToThem",
      )
      .mockImplementation((async () => {
        rowReads++;
        return heldRows;
      }) as never);
    jest
      .spyOn(
        taskHooks as unknown as { updateColumnsByIdWithoutHooks: () => void },
        "updateColumnsByIdWithoutHooks",
      )
      .mockImplementation((async (args: unknown) => {
        const { id, data } = args as { id: ObjectID; data: JSONObject };
        columnWrites.push({ id: id.toString(), data });
      }) as never);
  });

  async function change(
    data: JSONObject,
    props: DatabaseCommonInteractionProps = MAYA,
  ): Promise<void> {
    const updateBy: UpdateBy<SecurityCaseTask> = {
      query: { _id: TASK_ID },
      data: data as never,
      props,
    };
    const onUpdate: OnUpdate<SecurityCaseTask> =
      await taskHooks.onBeforeUpdate(updateBy);
    await taskHooks.onUpdateSuccess(onUpdate, [TASK_ID]);
  }

  test("a new title alone: trimmed, nothing read, nothing said", async () => {
    const data: JSONObject = { title: "  Rotate every admin key " };

    await change(data);

    expect(data["title"]).toBe("Rotate every admin key");
    expect(rowReads).toBe(0);
    expect(feedItems).toEqual([]);
  });

  test("ticked off: who and when written by OneUptime, and on the timeline in green", async () => {
    await change({ isDone: true });

    expect(columnWrites).toEqual([
      {
        id: TASK_ID.toString(),
        data: { doneAt: NOW, doneByUserId: MAYA_ID },
      },
    ]);
    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        feedInfoInMarkdown:
          "☑️ Completed the task **Reset the admin password**.",
        eventType: SecurityCaseFeedEventType.Task,
        displayColor: Green500,
        userId: MAYA_ID,
      },
    ]);
    expect(tasksHandedOver).toEqual([]);
  });

  test("opened again: who and when cleared", async () => {
    heldRows[0]!.isDone = true;

    await change({ isDone: false });

    expect(columnWrites).toEqual([
      {
        id: TASK_ID.toString(),
        data: { doneAt: null, doneByUserId: null },
      },
    ]);
    expect(feedTexts()).toEqual([
      "↩️ Opened the task **Reset the admin password** again.",
    ]);
    expect(feedItems[0]!["displayColor"]).toEqual(Gray500);
  });

  test("saved done again while done: nothing written, nothing said", async () => {
    heldRows[0]!.isDone = true;

    await change({ isDone: true });

    expect(columnWrites).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("handed to somebody else: on the timeline, and they are told", async () => {
    await change({ assignedToUserId: DIEGO_ID });

    expect(feedTexts()).toEqual([
      "👤 Gave the task **Reset the admin password** to **Diego**.",
    ]);
    expect(tasksHandedOver).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        taskId: TASK_ID,
        userId: DIEGO_ID,
        actorUserId: MAYA_ID,
      },
    ]);
  });

  test("handed over with a new title: the timeline names it by its new title", async () => {
    await change({ assignedToUserId: DIEGO_ID, title: "Rotate the keys" });

    expect(feedTexts()).toEqual([
      "👤 Gave the task **Rotate the keys** to **Diego**.",
    ]);
  });

  test("taken off its assignee - either spelling: on the timeline, nobody told", async () => {
    await change({ assignedToUser: null });

    expect(feedTexts()).toEqual([
      "👤 Took the task **Reset the admin password** off whoever had it.",
    ]);
    expect(tasksHandedOver).toEqual([]);
  });

  test("saved with the assignee it has: nothing said", async () => {
    await change({ assignedToUserId: ANA_ID });

    expect(feedItems).toEqual([]);
    expect(tasksHandedOver).toEqual([]);
  });

  test("a change that cannot be recorded on the timeline is still made", async () => {
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(change({ isDone: true })).resolves.toBeUndefined();
  });
});

describe("deleting a task", () => {
  test("each deleted task on its case's timeline, by whoever deleted it", async () => {
    const row: SecurityCaseTask = new SecurityCaseTask();
    row._id = TASK_ID.toString();
    row.projectId = PROJECT_ID;
    row.securityCaseId = CASE_ID;
    row.title = "Reset the admin password";

    jest
      .spyOn(
        taskHooks as unknown as { findRowsAndHoldDeleteToThem: () => void },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([row] as never);

    const onDelete: OnDelete<SecurityCaseTask> = await taskHooks.onBeforeDelete(
      { query: { _id: TASK_ID }, props: MAYA },
    );
    await taskHooks.onDeleteSuccess(onDelete, [TASK_ID]);

    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        feedInfoInMarkdown: "🗑️ Deleted the task **Reset the admin password**.",
        eventType: SecurityCaseFeedEventType.Task,
        displayColor: Gray500,
        userId: MAYA_ID,
      },
    ]);
  });

  test("is not failed by a timeline entry that cannot be written", async () => {
    const row: SecurityCaseTask = new SecurityCaseTask();
    row.projectId = PROJECT_ID;
    row.securityCaseId = CASE_ID;
    row.title = "Reset the admin password";

    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(
      taskHooks.onDeleteSuccess(
        {
          deleteBy: { query: { _id: TASK_ID }, props: MAYA },
          carryForward: { rows: [row] },
        },
        [TASK_ID],
      ),
    ).resolves.toBeTruthy();
  });
});

describe("evidence: a link's address", () => {
  test("http and https, as written", () => {
    expect(
      readEvidenceUrl("  https://drive.example.com/case-12/pcap ").toString(),
    ).toBe("https://drive.example.com/case-12/pcap");
    expect(readEvidenceUrl("http://intranet.example/ticket/7").toString()).toBe(
      "http://intranet.example/ticket/7",
    );
  });

  test("nothing else gets near an href", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "ftp://files.example.com/pcap",
      "file:///etc/passwd",
      // Addresses OneUptime's URL reads, which are still not a page to open.
      "wss://evil.example/socket",
      "mongodb://db.example/cases",
      "mailto:attacker@example.com",
      "tel:5551234567",
      "",
      "   ",
      undefined,
      null,
      42,
    ]) {
      expect(() => {
        return readEvidenceUrl(value);
      }).toThrow(
        "A link needs an http or https address of where the evidence is kept.",
      );
    }
  });
});

describe("evidence: a name, and what a file is measured as", () => {
  test("a name is kept trimmed, and cut to 500 characters", () => {
    expect(normalizeEvidenceName("  proxy.pcap ")).toBe("proxy.pcap");
    expect(normalizeEvidenceName("x".repeat(600))).toHaveLength(500);
    expect(normalizeEvidenceName(undefined)).toBe("");
  });

  test("a file: its name, type, size and the SHA-256 of its bytes", () => {
    const file: File = new File();
    file.name = "proxy.pcap";
    file.fileType = MimeType.png;
    file.file = Buffer.from("hello");

    expect(readEvidenceFileFacts(file)).toEqual({
      fileName: "proxy.pcap",
      fileType: MimeType.png.toString(),
      fileSizeInBytes: 5,
      sha256: HELLO_SHA256,
    });
  });

  test("a file's name and type are cut to their columns", () => {
    const file: File = new File();
    file.name = `${"n".repeat(120)}.pcap`;
    file.file = Buffer.from("");

    const facts: ReturnType<typeof readEvidenceFileFacts> =
      readEvidenceFileFacts(file);

    expect(facts.fileName).toHaveLength(100);
    expect(facts.fileType).toBe("");
    expect(facts.fileSizeInBytes).toBe(0);
    // The SHA-256 of nothing.
    expect(facts.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("adding evidence", () => {
  let fileReads: Array<JSONObject>;
  let storedFile: File | null;

  beforeEach(() => {
    fileReads = [];
    storedFile = new File();
    storedFile._id = FILE_ID.toString();
    storedFile.name = "proxy.pcap";
    storedFile.fileType = MimeType.png;
    storedFile.file = Buffer.from("hello");
    storedFile.projectId = PROJECT_ID;

    jest
      .spyOn(FileService, "findOneById")
      .mockImplementation(async (args: unknown) => {
        fileReads.push(args as JSONObject);
        return storedFile as never;
      });
  });

  function evidence(
    overrides: Partial<SecurityCaseEvidence> = {},
  ): SecurityCaseEvidence {
    const model: SecurityCaseEvidence = new SecurityCaseEvidence();
    model.projectId = PROJECT_ID;
    model.securityCaseId = CASE_ID;
    Object.assign(model, overrides);
    return model;
  }

  async function add(
    data: SecurityCaseEvidence,
  ): Promise<SecurityCaseEvidence> {
    await evidenceHooks.onBeforeCreate({ data, props: MAYA });
    return data;
  }

  test("a file from the case's project: measured once as it is added, read as root", async () => {
    const data: SecurityCaseEvidence = await add(
      evidence({ kind: SecurityCaseEvidenceKind.File, fileId: FILE_ID }),
    );

    expect(fileReads).toHaveLength(1);
    expect(fileReads[0]!["props"]).toEqual({ isRoot: true });
    expect(data.fileName).toBe("proxy.pcap");
    expect(data.fileType).toBe(MimeType.png.toString());
    expect(data.fileSizeInBytes).toBe(5);
    expect(data.sha256).toBe(HELLO_SHA256);
    // Named after the file when nobody named it.
    expect(data.name).toBe("proxy.pcap");
  });

  test("a file named by whoever added it keeps that name, trimmed", async () => {
    const data: SecurityCaseEvidence = await add(
      evidence({
        kind: SecurityCaseEvidenceKind.File,
        fileId: FILE_ID,
        name: "  Proxy capture, 14 Oct ",
      }),
    );

    expect(data.name).toBe("Proxy capture, 14 Oct");
  });

  test("a file named in the relation spelling is read too", async () => {
    const file: File = new File();
    file._id = FILE_ID.toString();

    const data: SecurityCaseEvidence = await add(
      evidence({ kind: SecurityCaseEvidenceKind.File, file }),
    );

    expect(data.fileId?.toString()).toBe(FILE_ID.toString());
    expect(data.sha256).toBe(HELLO_SHA256);
  });

  test("another project's file answers as a file that is not there", async () => {
    storedFile!.projectId = OTHER_PROJECT_ID;

    await expect(
      add(evidence({ kind: SecurityCaseEvidenceKind.File, fileId: FILE_ID })),
    ).rejects.toThrow(new BadDataException(EVIDENCE_FILE_NOT_FOUND));

    storedFile = null;

    await expect(
      add(evidence({ kind: SecurityCaseEvidenceKind.File, fileId: FILE_ID })),
    ).rejects.toThrow(new BadDataException(EVIDENCE_FILE_NOT_FOUND));
  });

  test("a file needs a file, and no link", async () => {
    await expect(
      add(evidence({ kind: SecurityCaseEvidenceKind.File })),
    ).rejects.toThrow("File evidence needs a file: upload one.");

    await expect(
      add(
        evidence({
          kind: SecurityCaseEvidenceKind.File,
          fileId: FILE_ID,
          url: URL.fromString("https://drive.example.com/pcap"),
        }),
      ),
    ).rejects.toThrow(
      "File evidence has a file, not a link. Add the link as Link evidence.",
    );
  });

  test("a link: its address kept, and named after it when nobody named it", async () => {
    const data: SecurityCaseEvidence = await add(
      evidence({
        kind: SecurityCaseEvidenceKind.Link,
        url: " https://drive.example.com/case-12 " as never,
      }),
    );

    expect(data.url?.toString()).toBe("https://drive.example.com/case-12");
    expect(data.name).toBe("https://drive.example.com/case-12");
    expect(fileReads).toEqual([]);
  });

  test("a link needs an http or https address, and no file", async () => {
    await expect(
      add(
        evidence({
          kind: SecurityCaseEvidenceKind.Link,
          url: "javascript:alert(1)" as never,
        }),
      ),
    ).rejects.toThrow(
      "A link needs an http or https address of where the evidence is kept.",
    );

    await expect(
      add(
        evidence({
          kind: SecurityCaseEvidenceKind.Link,
          url: URL.fromString("https://drive.example.com/pcap"),
          fileId: FILE_ID,
        }),
      ),
    ).rejects.toThrow(
      "Link evidence has an address, not a file. Add the file as File evidence.",
    );
  });

  test("is a File or a Link, and nothing else", async () => {
    for (const kind of [undefined, "", "Screenshot", "file"]) {
      await expect(add(evidence({ kind: kind as never }))).rejects.toThrow(
        "Evidence is a File, uploaded to OneUptime, or a Link to where it is kept.",
      );
    }
  });

  test("a description of at most 5,000 characters", async () => {
    await expect(
      add(
        evidence({
          kind: SecurityCaseEvidenceKind.Link,
          url: URL.fromString("https://drive.example.com/pcap"),
          description: "x".repeat(MAX_EVIDENCE_DESCRIPTION_LENGTH + 1),
        }),
      ),
    ).rejects.toThrow("A description can be at most 5000 characters.");
  });

  test("on the timeline: a file with its SHA-256, a link with its address, by whoever added it", async () => {
    const onCreate: OnCreate<SecurityCaseEvidence> = {
      createBy: { data: evidence(), props: MAYA },
      carryForward: null,
    };

    await evidenceHooks.onCreateSuccess(
      onCreate,
      evidence({
        _id: EVIDENCE_ID.toString(),
        kind: SecurityCaseEvidenceKind.File,
        name: "proxy.pcap",
        sha256: HELLO_SHA256,
      }),
    );
    await evidenceHooks.onCreateSuccess(
      onCreate,
      evidence({
        _id: EVIDENCE_ID.toString(),
        kind: SecurityCaseEvidenceKind.Link,
        name: "Ticket 7",
        url: URL.fromString("https://intranet.example/ticket/7"),
        createdByUserId: ANA_ID,
      }),
    );

    expect(feedTexts()).toEqual([
      `🗄️ Added the file **proxy.pcap** as evidence. SHA-256 \`${HELLO_SHA256}\`.`,
      "🔗 Added the link **Ticket 7** as evidence: `https://intranet.example/ticket/7`.",
    ]);
    expect(feedItems[0]!["eventType"]).toBe(SecurityCaseFeedEventType.Evidence);
    expect(feedItems[0]!["userId"]).toEqual(MAYA_ID);
    expect(feedItems[1]!["userId"]).toEqual(ANA_ID);
  });

  test("is kept when its timeline entry cannot be written", async () => {
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);
    const item: SecurityCaseEvidence = evidence({
      _id: EVIDENCE_ID.toString(),
      name: "proxy.pcap",
    });

    await expect(
      evidenceHooks.onCreateSuccess(
        { createBy: { data: evidence(), props: MAYA }, carryForward: null },
        item,
      ),
    ).resolves.toBe(item);
  });
});

describe("changing and removing evidence", () => {
  async function change(data: JSONObject): Promise<void> {
    await evidenceHooks.onBeforeUpdate({
      query: { _id: EVIDENCE_ID },
      data: data as never,
      props: MAYA,
    });
  }

  test("its name: trimmed, never empty", async () => {
    const data: JSONObject = { name: "  Proxy capture " };

    await change(data);
    expect(data["name"]).toBe("Proxy capture");

    await expect(change({ name: "   " })).rejects.toThrow(
      "Evidence needs a name.",
    );
  });

  test("its description: at most 5,000 characters", async () => {
    await expect(
      change({ description: "x".repeat(MAX_EVIDENCE_DESCRIPTION_LENGTH + 1) }),
    ).rejects.toThrow("A description can be at most 5000 characters.");
    await expect(
      change({ description: "x".repeat(MAX_EVIDENCE_DESCRIPTION_LENGTH) }),
    ).resolves.toBeUndefined();
  });

  test("removed: on the timeline in red, by whoever removed it", async () => {
    const row: SecurityCaseEvidence = new SecurityCaseEvidence();
    row._id = EVIDENCE_ID.toString();
    row.projectId = PROJECT_ID;
    row.securityCaseId = CASE_ID;
    row.name = "proxy.pcap";

    jest
      .spyOn(
        evidenceHooks as unknown as { findRowsAndHoldDeleteToThem: () => void },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([row] as never);

    const onDelete: OnDelete<SecurityCaseEvidence> =
      await evidenceHooks.onBeforeDelete({
        query: { _id: EVIDENCE_ID },
        props: MAYA,
      });
    await evidenceHooks.onDeleteSuccess(onDelete, [EVIDENCE_ID]);

    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        feedInfoInMarkdown: "🗑️ Removed **proxy.pcap** from the evidence.",
        eventType: SecurityCaseFeedEventType.Evidence,
        displayColor: Red500,
        userId: MAYA_ID,
      },
    ]);
  });
});

describe("a priority's response targets", () => {
  test("whole minutes from 1 to a year, written as numbers", () => {
    const data: JSONObject = {
      acknowledgeWithinInMinutes: "15",
      containWithinInMinutes: 525600,
    };

    checkResponseTargets(data);

    expect(data).toEqual({
      acknowledgeWithinInMinutes: 15,
      containWithinInMinutes: 525600,
    });
  });

  test("empty is no target; a column left out is left alone", () => {
    const data: JSONObject = { acknowledgeWithinInMinutes: "" };

    checkResponseTargets(data);

    expect(data).toEqual({ acknowledgeWithinInMinutes: null });

    const cleared: JSONObject = { containWithinInMinutes: null };
    checkResponseTargets(cleared);
    expect(cleared).toEqual({ containWithinInMinutes: null });
  });

  test("anything else is refused, naming the target", () => {
    for (const value of [0, -5, 1.5, 525601, "soon", "1e3x", true]) {
      expect(() => {
        return checkResponseTargets({ acknowledgeWithinInMinutes: value });
      }).toThrow(
        new BadDataException(
          "Acknowledge Within must be a whole number of minutes from 1 to 525600 (a year), or empty for no target.",
        ),
      );
      expect(() => {
        return checkResponseTargets({ containWithinInMinutes: value });
      }).toThrow(
        "Contain Within must be a whole number of minutes from 1 to 525600 (a year), or empty for no target.",
      );
    }
  });

  test("are checked as a priority is added and as it is changed", async () => {
    jest
      .spyOn(StateOrderGuard, "beforeCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StateOrderGuard, "beforeUpdate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ArchivableValueGuard, "beforeCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ArchivableValueGuard, "beforeUpdate")
      .mockResolvedValue(undefined as never);

    const priorityHooks: Hooks<SecurityCasePriority> =
      SecurityCasePriorityService as unknown as Hooks<SecurityCasePriority>;
    const priority: SecurityCasePriority = new SecurityCasePriority();
    priority.projectId = PROJECT_ID;
    priority.name = "Sev 2";
    priority.acknowledgeWithinInMinutes = 0;

    await expect(
      priorityHooks.onBeforeCreate({ data: priority, props: MAYA }),
    ).rejects.toThrow("Acknowledge Within must be a whole number of minutes");

    await expect(
      priorityHooks.onBeforeUpdate({
        query: { _id: new ObjectID("66666666-6666-4666-8666-666666666666") },
        data: { containWithinInMinutes: "two hours" } as never,
        props: MAYA,
      }),
    ).rejects.toThrow("Contain Within must be a whole number of minutes");
  });

  test("a new project's priorities come with targets: the most urgent the shortest, none for Informational", async () => {
    const creates: Array<SecurityCasePriority> = [];

    jest
      .spyOn(SecurityCasePriorityService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(SecurityCasePriorityService, "create")
      .mockImplementation((async (
        createBy: CreateBy<SecurityCasePriority>,
      ): Promise<SecurityCasePriority> => {
        creates.push(createBy.data);
        return createBy.data;
      }) as never);

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();

    await ProjectService.addDefaultSecurityCasePriorities(project);

    expect(
      creates.map((priority: SecurityCasePriority) => {
        return [
          priority.name,
          priority.acknowledgeWithinInMinutes ?? null,
          priority.containWithinInMinutes ?? null,
        ];
      }),
    ).toEqual([
      ["Critical", 15, 240],
      ["High", 60, 1440],
      ["Medium", 720, 4320],
      ["Low", 1440, 10080],
      ["Informational", null, null],
    ]);
    expect(DEFAULT_SECURITY_CASE_PRIORITIES).toHaveLength(5);
  });
});
