import FileOwnership, {
  FileOwnerKind,
  FileOwners,
  FileReferenceCheck,
  FileReferenceColumn,
  FileReferenceOwner,
} from "../../../../Server/Utils/File/FileOwnership";
import FileService from "../../../../Server/Services/FileService";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import File from "../../../../Models/DatabaseModels/File";
import Form from "../../../../Models/DatabaseModels/Form";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Label from "../../../../Models/DatabaseModels/Label";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import User from "../../../../Models/DatabaseModels/User";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Which files a record may point at, and which a page may serve
 * (Server/Utils/File/FileOwnership): a project's record only files uploaded
 * in its project, a person only a picture they uploaded. Another owner's
 * file, a file with no owner and a file that does not exist are refused
 * with the same words, so a write can never tell them apart.
 *
 * No database: FileService.getFileOwners - the one query the checks make -
 * is a stand-in answering from a table of files.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// A file uploaded in PROJECT_ID by USER_ID.
const OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
// A second file of PROJECT_ID.
const SECOND_OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
// A file uploaded in OTHER_PROJECT_ID by OTHER_USER_ID.
const OTHER_PROJECT_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
// A file uploaded before files recorded their owner.
const NO_PROJECT_FILE_ID: string = "cccccccc-0000-4000-8000-000000000001";
// No file has this id.
const MISSING_FILE_ID: string = "dddddddd-0000-4000-8000-000000000001";

const FILES: Record<string, FileOwners> = {
  [OWN_FILE_ID]: { projectId: PROJECT_ID, createdByUserId: USER_ID },
  [SECOND_OWN_FILE_ID]: { projectId: PROJECT_ID, createdByUserId: USER_ID },
  [OTHER_PROJECT_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
  },
  [NO_PROJECT_FILE_ID]: { projectId: null, createdByUserId: null },
};

type GetFileOwnersMock = jest.Mock<
  (fileIds: Array<ObjectID>) => Promise<Map<string, FileOwners>>
>;

// FileService.getFileOwners answering from FILES, as the real one would.
function stubFileOwners(): GetFileOwnersMock {
  const mock: GetFileOwnersMock = jest.fn(
    async (fileIds: Array<ObjectID>): Promise<Map<string, FileOwners>> => {
      const owners: Map<string, FileOwners> = new Map();

      for (const fileId of fileIds) {
        const key: string = fileId.toString().toLowerCase();

        if (FILES[key]) {
          owners.set(key, FILES[key]!);
        }
      }

      return owners;
    },
  );

  jest.spyOn(FileService, "getFileOwners").mockImplementation(mock as never);

  return mock;
}

function columnOf(
  model: BaseModel,
  relationColumn: string,
): FileReferenceColumn {
  const column: FileReferenceColumn | undefined =
    FileOwnership.getFileReferenceColumns(model).find(
      (candidate: FileReferenceColumn): boolean => {
        return candidate.relationColumn === relationColumn;
      },
    );

  expect(column).toBeDefined();

  return column!;
}

const PROJECT_OWNER: FileReferenceOwner = {
  kind: FileOwnerKind.Project,
  projectId: PROJECT_ID,
};

async function refusalOf(promise: Promise<void>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was not refused.");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FileOwnership.getFileReferenceColumns", () => {
  /*
   * Every File column of every model, as the model declares it: the
   * relation the dashboard writes, the id column a server-side caller
   * writes, and the words a refusal uses.
   */
  const EXPECTED: Array<{
    model: BaseModel;
    columns: Array<{
      relationColumn: string;
      idColumn: string | null;
      isList: boolean;
      notFoundMessage: string;
    }>;
  }> = [
    {
      model: new StatusPage(),
      columns: [
        {
          relationColumn: "faviconFile",
          idColumn: "faviconFileId",
          isList: false,
          notFoundMessage:
            "The favicon's file could not be found. Upload the favicon again.",
        },
        {
          relationColumn: "logoFile",
          idColumn: "logoFileId",
          isList: false,
          notFoundMessage:
            "The logo's file could not be found. Upload the logo again.",
        },
        {
          relationColumn: "coverImageFile",
          idColumn: "coverImageFileId",
          isList: false,
          notFoundMessage:
            "The cover image's file could not be found. Upload the cover image again.",
        },
      ],
    },
    {
      model: new Dashboard(),
      columns: [
        {
          relationColumn: "logoFile",
          idColumn: "logoFileId",
          isList: false,
          notFoundMessage:
            "The logo's file could not be found. Upload the logo again.",
        },
        {
          relationColumn: "faviconFile",
          idColumn: "faviconFileId",
          isList: false,
          notFoundMessage:
            "The favicon's file could not be found. Upload the favicon again.",
        },
      ],
    },
    {
      model: new Form(),
      columns: [
        {
          relationColumn: "logoFile",
          idColumn: "logoFileId",
          isList: false,
          notFoundMessage:
            "The logo's file could not be found. Upload the logo again.",
        },
        {
          relationColumn: "faviconFile",
          idColumn: "faviconFileId",
          isList: false,
          notFoundMessage:
            "The favicon's file could not be found. Upload the favicon again.",
        },
      ],
    },
    {
      model: new Probe(),
      columns: [
        {
          relationColumn: "iconFile",
          idColumn: "iconFileId",
          isList: false,
          notFoundMessage:
            "The icon's file could not be found. Upload the icon again.",
        },
      ],
    },
    {
      model: new AIAgent(),
      columns: [
        {
          relationColumn: "iconFile",
          idColumn: "iconFileId",
          isList: false,
          notFoundMessage:
            "The icon's file could not be found. Upload the icon again.",
        },
      ],
    },
    {
      model: new User(),
      columns: [
        {
          relationColumn: "profilePictureFile",
          idColumn: "profilePictureId",
          isList: false,
          notFoundMessage:
            "The profile picture's file could not be found. Upload the profile picture again.",
        },
      ],
    },
    {
      model: new Incident(),
      columns: [
        {
          relationColumn: "postmortemAttachments",
          idColumn: null,
          isList: true,
          notFoundMessage:
            "One of the postmortem attachments could not be found. Upload it again.",
        },
      ],
    },
    ...[
      new IncidentPublicNote(),
      new IncidentInternalNote(),
      new IncidentEpisodePublicNote(),
      new IncidentEpisodeInternalNote(),
      new AlertInternalNote(),
      new AlertEpisodeInternalNote(),
      new ScheduledMaintenancePublicNote(),
      new ScheduledMaintenanceInternalNote(),
      new StatusPageAnnouncement(),
    ].map((model: BaseModel) => {
      return {
        model: model,
        columns: [
          {
            relationColumn: "attachments",
            idColumn: null,
            isList: true,
            notFoundMessage:
              "One of the attachments could not be found. Upload it again.",
          },
        ],
      };
    }),
  ];

  test.each(
    EXPECTED.map((entry: (typeof EXPECTED)[number]) => {
      return { ...entry, table: entry.model.tableName };
    }),
  )(
    "reads $table's File columns from its metadata",
    ({ model, columns }: (typeof EXPECTED)[number]) => {
      expect(
        FileOwnership.getFileReferenceColumns(model).map(
          (column: FileReferenceColumn) => {
            return {
              relationColumn: column.relationColumn,
              idColumn: column.idColumn,
              isList: column.isList,
              notFoundMessage: column.notFoundMessage,
            };
          },
        ),
      ).toEqual(columns);
    },
  );

  test("finds every model with a File column, and only those", () => {
    const withFiles: Array<string> = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return (
          FileOwnership.getFileReferenceColumns(new modelType()).length > 0
        );
      },
    )
      .map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      })
      .sort();

    expect(withFiles).toEqual(
      EXPECTED.map((entry: (typeof EXPECTED)[number]): string => {
        return entry.model.tableName || "";
      }).sort(),
    );
  });

  /*
   * A model of no project and no person would have nobody to hold its files
   * to, and every file would be refused: such a model needs its own owner
   * rule here before it can have a File column.
   */
  test("every model with a File column has an owner its files are held to", () => {
    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();

      if (FileOwnership.getFileReferenceColumns(model).length === 0) {
        continue;
      }

      expect({
        table: model.tableName,
        ownedBy:
          model.getTenantColumn() === "projectId" || model.tableName === "User",
      }).toEqual({ table: model.tableName, ownedBy: true });
    }
  });

  test("a model with no File column has none", () => {
    expect(FileOwnership.getFileReferenceColumns(new Label())).toEqual([]);
    expect(FileOwnership.getFileReferenceColumns(new File())).toEqual([]);
  });

  test("answers from its cache the second time", () => {
    const first: Array<FileReferenceColumn> =
      FileOwnership.getFileReferenceColumns(new StatusPage());

    expect(FileOwnership.getFileReferenceColumns(new StatusPage())).toBe(first);
  });
});

describe("FileOwnership.readWrittenFileIds", () => {
  const logo: FileReferenceColumn = columnOf(new StatusPage(), "logoFile");
  const attachments: FileReferenceColumn = columnOf(
    new IncidentPublicNote(),
    "attachments",
  );

  function ids(value: Array<ObjectID> | null): Array<string> | null {
    return value
      ? value.map((id: ObjectID): string => {
          return id.toString();
        })
      : null;
  }

  test("is null for a write that leaves the column alone", () => {
    expect(FileOwnership.readWrittenFileIds({ name: "x" }, logo)).toBeNull();
    expect(FileOwnership.readWrittenFileIds(new StatusPage(), logo)).toBeNull();
    expect(FileOwnership.readWrittenFileIds({}, attachments)).toBeNull();
    expect(FileOwnership.readWrittenFileIds(undefined, logo)).toBeNull();
  });

  test("is empty for a write that clears it", () => {
    expect(FileOwnership.readWrittenFileIds({ logoFile: null }, logo)).toEqual(
      [],
    );
    expect(
      FileOwnership.readWrittenFileIds({ logoFileId: null }, logo),
    ).toEqual([]);
    expect(FileOwnership.readWrittenFileIds({ logoFile: "" }, logo)).toEqual(
      [],
    );
    expect(
      FileOwnership.readWrittenFileIds({ attachments: null }, attachments),
    ).toEqual([]);
    expect(
      FileOwnership.readWrittenFileIds({ attachments: [] }, attachments),
    ).toEqual([]);
  });

  test("reads a single file in every shape a write carries it", () => {
    const file: File = new File();
    file._id = OWN_FILE_ID;

    for (const data of [
      { logoFileId: new ObjectID(OWN_FILE_ID) },
      { logoFileId: OWN_FILE_ID },
      { logoFile: { _id: OWN_FILE_ID } },
      { logoFile: { id: new ObjectID(OWN_FILE_ID) } },
      { logoFile: file },
      { logoFile: OWN_FILE_ID },
      { logoFile: { _id: OWN_FILE_ID }, logoFileId: OWN_FILE_ID },
    ]) {
      expect(ids(FileOwnership.readWrittenFileIds(data, logo))).toEqual([
        OWN_FILE_ID,
      ]);
    }
  });

  test("refuses a single file written as two different files", () => {
    expect(() => {
      FileOwnership.readWrittenFileIds(
        { logoFile: { _id: OWN_FILE_ID }, logoFileId: OTHER_PROJECT_FILE_ID },
        logo,
      );
    }).toThrow("Conflicting logo references were provided.");

    expect(() => {
      FileOwnership.readWrittenFileIds(
        { logoFile: { _id: OWN_FILE_ID }, logoFileId: null },
        logo,
      );
    }).toThrow("Conflicting logo references were provided.");
  });

  test("reads every file of a list, in every shape a write carries one", () => {
    const file: File = new File();
    file._id = SECOND_OWN_FILE_ID;

    expect(
      ids(
        FileOwnership.readWrittenFileIds(
          {
            attachments: [
              { _id: OWN_FILE_ID },
              file,
              new ObjectID(OTHER_PROJECT_FILE_ID),
              NO_PROJECT_FILE_ID,
              { id: MISSING_FILE_ID },
            ],
          },
          attachments,
        ),
      ),
    ).toEqual([
      OWN_FILE_ID,
      SECOND_OWN_FILE_ID,
      OTHER_PROJECT_FILE_ID,
      NO_PROJECT_FILE_ID,
      MISSING_FILE_ID,
    ]);
  });

  test("skips an entry of a list that names no file", () => {
    expect(
      ids(
        FileOwnership.readWrittenFileIds(
          { attachments: [{}, { name: "x" }, "", null, { _id: OWN_FILE_ID }] },
          attachments,
        ),
      ),
    ).toEqual([OWN_FILE_ID]);
  });

  test("reads a single entry written where a list belongs", () => {
    expect(
      ids(
        FileOwnership.readWrittenFileIds(
          { attachments: { _id: OWN_FILE_ID } },
          attachments,
        ),
      ),
    ).toEqual([OWN_FILE_ID]);
  });
});

describe("FileOwnership.readStoredFileIds", () => {
  test("reads a stored record's single file from its id column, in lower case", () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.logoFileId = new ObjectID(OWN_FILE_ID.toUpperCase());

    expect(
      Array.from(
        FileOwnership.readStoredFileIds(
          statusPage,
          columnOf(new StatusPage(), "logoFile"),
        ),
      ),
    ).toEqual([OWN_FILE_ID]);
  });

  test("reads a stored record's list of files", () => {
    const first: File = new File();
    first._id = OWN_FILE_ID;
    const second: File = new File();
    second._id = SECOND_OWN_FILE_ID;

    const note: IncidentPublicNote = new IncidentPublicNote();
    note.attachments = [first, second];

    expect(
      Array.from(
        FileOwnership.readStoredFileIds(
          note,
          columnOf(new IncidentPublicNote(), "attachments"),
        ),
      ),
    ).toEqual([OWN_FILE_ID, SECOND_OWN_FILE_ID]);
  });

  test("is empty for a record that holds none", () => {
    expect(
      FileOwnership.readStoredFileIds(
        new StatusPage(),
        columnOf(new StatusPage(), "faviconFile"),
      ).size,
    ).toBe(0);
    expect(
      FileOwnership.readStoredFileIds(
        new IncidentPublicNote(),
        columnOf(new IncidentPublicNote(), "attachments"),
      ).size,
    ).toBe(0);
  });
});

describe("FileOwnership.getOwner", () => {
  test("holds a project's record to its project", () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.projectId = PROJECT_ID;

    expect(FileOwnership.getOwner(new StatusPage(), statusPage)).toEqual({
      kind: FileOwnerKind.Project,
      projectId: PROJECT_ID,
    });

    expect(
      FileOwnership.getOwner(new IncidentPublicNote(), {
        projectId: PROJECT_ID.toString(),
      }),
    ).toEqual({
      kind: FileOwnerKind.Project,
      projectId: new ObjectID(PROJECT_ID.toString()),
    });
  });

  test("holds a record outside any project to nothing", () => {
    expect(FileOwnership.getOwner(new Probe(), new Probe())).toBeNull();
    expect(
      FileOwnership.getOwner(new AIAgent(), { projectId: null }),
    ).toBeNull();
  });

  test("holds a person to themselves", () => {
    const user: User = new User();
    user._id = USER_ID.toString();

    expect(FileOwnership.getOwner(new User(), user)).toEqual({
      kind: FileOwnerKind.User,
      userId: new ObjectID(USER_ID.toString()),
    });

    expect(FileOwnership.getOwner(new User(), new User())).toEqual({
      kind: FileOwnerKind.User,
      userId: null,
    });
  });

  test("holds a model of no project and no person to nobody", () => {
    expect(FileOwnership.getOwner(new File(), {})).toEqual({
      kind: FileOwnerKind.Nobody,
    });
  });
});

describe("FileOwnership.isFileOfProject / isFileOfUser / isOwnedBy", () => {
  test("a file is its project's, however the ids are written", () => {
    expect(FileOwnership.isFileOfProject(FILES[OWN_FILE_ID], PROJECT_ID)).toBe(
      true,
    );
    expect(
      FileOwnership.isFileOfProject(
        { projectId: PROJECT_ID.toString().toUpperCase() },
        PROJECT_ID.toString(),
      ),
    ).toBe(true);
  });

  test("a file is not another project's, and one with no project is nobody's", () => {
    expect(
      FileOwnership.isFileOfProject(FILES[OTHER_PROJECT_FILE_ID], PROJECT_ID),
    ).toBe(false);
    expect(
      FileOwnership.isFileOfProject(FILES[NO_PROJECT_FILE_ID], PROJECT_ID),
    ).toBe(false);
    expect(FileOwnership.isFileOfProject(undefined, PROJECT_ID)).toBe(false);
    expect(FileOwnership.isFileOfProject(null, PROJECT_ID)).toBe(false);
    expect(FileOwnership.isFileOfProject({ projectId: null }, null)).toBe(
      false,
    );
    expect(FileOwnership.isFileOfProject({}, undefined)).toBe(false);
  });

  test("a file is the user's who uploaded it, and nobody else's", () => {
    expect(FileOwnership.isFileOfUser(FILES[OWN_FILE_ID], USER_ID)).toBe(true);
    expect(
      FileOwnership.isFileOfUser(
        { createdByUserId: USER_ID.toString().toUpperCase() },
        USER_ID,
      ),
    ).toBe(true);
    expect(FileOwnership.isFileOfUser(FILES[OWN_FILE_ID], OTHER_USER_ID)).toBe(
      false,
    );
    expect(FileOwnership.isFileOfUser(FILES[NO_PROJECT_FILE_ID], USER_ID)).toBe(
      false,
    );
    expect(FileOwnership.isFileOfUser(FILES[OWN_FILE_ID], null)).toBe(false);
  });

  test("isOwnedBy follows the owner's kind", () => {
    expect(FileOwnership.isOwnedBy(FILES[OWN_FILE_ID], PROJECT_OWNER)).toBe(
      true,
    );
    expect(
      FileOwnership.isOwnedBy(FILES[OTHER_PROJECT_FILE_ID], PROJECT_OWNER),
    ).toBe(false);
    expect(
      FileOwnership.isOwnedBy(FILES[OWN_FILE_ID], {
        kind: FileOwnerKind.User,
        userId: USER_ID,
      }),
    ).toBe(true);
    expect(
      FileOwnership.isOwnedBy(FILES[OWN_FILE_ID], {
        kind: FileOwnerKind.User,
        userId: null,
      }),
    ).toBe(false);
    expect(
      FileOwnership.isOwnedBy(FILES[OWN_FILE_ID], {
        kind: FileOwnerKind.Nobody,
      }),
    ).toBe(false);
    expect(FileOwnership.isOwnedBy(undefined, PROJECT_OWNER)).toBe(false);
  });
});

describe("FileOwnership.assertOwned", () => {
  const logo: FileReferenceColumn = columnOf(new StatusPage(), "logoFile");
  const favicon: FileReferenceColumn = columnOf(
    new StatusPage(),
    "faviconFile",
  );
  const attachments: FileReferenceColumn = columnOf(
    new IncidentPublicNote(),
    "attachments",
  );

  function check(
    column: FileReferenceColumn,
    fileIds: Array<string>,
    owner: FileReferenceOwner = PROJECT_OWNER,
  ): FileReferenceCheck {
    return {
      owner: owner,
      column: column,
      fileIds: fileIds.map((fileId: string): ObjectID => {
        return new ObjectID(fileId);
      }),
    };
  }

  test("accepts files of the record's own project", async () => {
    stubFileOwners();

    await expect(
      FileOwnership.assertOwned([
        check(logo, [OWN_FILE_ID]),
        check(attachments, [OWN_FILE_ID, SECOND_OWN_FILE_ID]),
      ]),
    ).resolves.toBeUndefined();
  });

  test("accepts an id written in upper case", async () => {
    stubFileOwners();

    await expect(
      FileOwnership.assertOwned([check(logo, [OWN_FILE_ID.toUpperCase()])]),
    ).resolves.toBeUndefined();
  });

  test("refuses another project's file with the words it uses for a missing one", async () => {
    stubFileOwners();

    const otherProjects: string = await refusalOf(
      FileOwnership.assertOwned([check(logo, [OTHER_PROJECT_FILE_ID])]),
    );
    const missing: string = await refusalOf(
      FileOwnership.assertOwned([check(logo, [MISSING_FILE_ID])]),
    );
    const noProject: string = await refusalOf(
      FileOwnership.assertOwned([check(logo, [NO_PROJECT_FILE_ID])]),
    );

    expect(otherProjects).toBe(
      "The logo's file could not be found. Upload the logo again.",
    );
    expect(missing).toBe(otherProjects);
    expect(noProject).toBe(otherProjects);
  });

  test("refuses an id that is not one with the same words", async () => {
    stubFileOwners();

    expect(
      await refusalOf(FileOwnership.assertOwned([check(logo, ["not-an-id"])])),
    ).toBe("The logo's file could not be found. Upload the logo again.");
  });

  test("names the column that holds the file", async () => {
    stubFileOwners();

    expect(
      await refusalOf(
        FileOwnership.assertOwned([
          check(logo, [OWN_FILE_ID]),
          check(favicon, [OTHER_PROJECT_FILE_ID]),
        ]),
      ),
    ).toBe("The favicon's file could not be found. Upload the favicon again.");

    expect(
      await refusalOf(
        FileOwnership.assertOwned([
          check(attachments, [OWN_FILE_ID, OTHER_PROJECT_FILE_ID]),
        ]),
      ),
    ).toBe("One of the attachments could not be found. Upload it again.");
  });

  test("holds a person's picture to the person who uploaded it", async () => {
    stubFileOwners();

    const picture: FileReferenceColumn = columnOf(
      new User(),
      "profilePictureFile",
    );

    await expect(
      FileOwnership.assertOwned([
        check(picture, [OWN_FILE_ID], {
          kind: FileOwnerKind.User,
          userId: USER_ID,
        }),
      ]),
    ).resolves.toBeUndefined();

    expect(
      await refusalOf(
        FileOwnership.assertOwned([
          check(picture, [OTHER_PROJECT_FILE_ID], {
            kind: FileOwnerKind.User,
            userId: USER_ID,
          }),
        ]),
      ),
    ).toBe(
      "The profile picture's file could not be found. Upload the profile picture again.",
    );
  });

  test("reads every file's owner in one query, each id once", async () => {
    const getFileOwners: GetFileOwnersMock = stubFileOwners();

    await FileOwnership.assertOwned([
      check(logo, [OWN_FILE_ID]),
      check(attachments, [OWN_FILE_ID, SECOND_OWN_FILE_ID]),
    ]);

    expect(getFileOwners).toHaveBeenCalledTimes(1);
    expect(
      getFileOwners.mock.calls[0]![0].map((fileId: ObjectID): string => {
        return fileId.toString();
      }),
    ).toEqual([OWN_FILE_ID, SECOND_OWN_FILE_ID]);
  });

  test("asks nothing when no file is pointed at", async () => {
    const getFileOwners: GetFileOwnersMock = stubFileOwners();

    await FileOwnership.assertOwned([]);
    await FileOwnership.assertOwned([check(logo, [])]);

    expect(getFileOwners).not.toHaveBeenCalled();
  });
});

describe("FileOwnership.findProjectAttachment", () => {
  function file(fileId: string, bytes: boolean = true): File {
    const attachment: File = new File();
    attachment._id = fileId;

    if (bytes) {
      attachment.file = Buffer.from([1, 2, 3]);
    }

    return attachment;
  }

  const FILES_OF_NOTE: Array<File> = [
    file(OWN_FILE_ID),
    file(OTHER_PROJECT_FILE_ID),
    file(NO_PROJECT_FILE_ID),
    file(SECOND_OWN_FILE_ID, false),
  ];

  test("serves one of the record's files of its own project", async () => {
    stubFileOwners();

    expect(
      await FileOwnership.findProjectAttachment({
        files: FILES_OF_NOTE,
        fileId: new ObjectID(OWN_FILE_ID.toUpperCase()),
        projectId: PROJECT_ID,
      }),
    ).toBe(FILES_OF_NOTE[0]);
  });

  test("serves nothing of another project, of none, or without bytes", async () => {
    stubFileOwners();

    for (const fileId of [
      OTHER_PROJECT_FILE_ID,
      NO_PROJECT_FILE_ID,
      SECOND_OWN_FILE_ID,
      MISSING_FILE_ID,
    ]) {
      expect(
        await FileOwnership.findProjectAttachment({
          files: FILES_OF_NOTE,
          fileId: new ObjectID(fileId),
          projectId: PROJECT_ID,
        }),
      ).toBeUndefined();
    }
  });

  test("serves nothing for a record with no files or no project", async () => {
    const getFileOwners: GetFileOwnersMock = stubFileOwners();

    expect(
      await FileOwnership.findProjectAttachment({
        files: undefined,
        fileId: new ObjectID(OWN_FILE_ID),
        projectId: PROJECT_ID,
      }),
    ).toBeUndefined();

    expect(
      await FileOwnership.findProjectAttachment({
        files: FILES_OF_NOTE,
        fileId: new ObjectID(OWN_FILE_ID),
        projectId: undefined,
      }),
    ).toBeUndefined();

    expect(getFileOwners).not.toHaveBeenCalled();
  });
});

describe("FileOwnership.keepProjectFile", () => {
  test("keeps an image of the record's own project", () => {
    const logo: File = new File();
    logo.projectId = PROJECT_ID;

    expect(FileOwnership.keepProjectFile(logo, PROJECT_ID)).toBe(logo);
  });

  test("drops an image of another project, of none, or none at all", () => {
    const foreign: File = new File();
    foreign.projectId = OTHER_PROJECT_ID;

    expect(FileOwnership.keepProjectFile(foreign, PROJECT_ID)).toBeUndefined();
    expect(
      FileOwnership.keepProjectFile(new File(), PROJECT_ID),
    ).toBeUndefined();
    expect(
      FileOwnership.keepProjectFile(undefined, PROJECT_ID),
    ).toBeUndefined();
    expect(FileOwnership.keepProjectFile(null, PROJECT_ID)).toBeUndefined();

    const own: File = new File();
    own.projectId = PROJECT_ID;

    expect(FileOwnership.keepProjectFile(own, undefined)).toBeUndefined();
  });
});
