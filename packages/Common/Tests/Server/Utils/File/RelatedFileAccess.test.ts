import RelatedFileAccess, {
  FileAccessFacts,
  RelatedFileReader,
} from "../../../../Server/Utils/File/RelatedFileAccess";
import FileOwnership, {
  FileOwnerKind,
  FileReferenceColumn,
} from "../../../../Server/Utils/File/FileOwnership";
import FileService from "../../../../Server/Services/FileService";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import File from "../../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * A READ RETURNS A RECORD'S FILES ONLY TO PEOPLE WHO MAY SEE THEM.
 *
 * Who may read a record does not settle who may see the files it names: a
 * record saved before records were held to their own files can name a file
 * of another project, and a file uploaded with no project is nobody's. So
 * a read that selects a file beyond its id hands it back only to someone
 * who may see it - the image routes' rule (FileViewerAccess): a public file
 * to anyone, a project's file to whoever the request may open that project
 * for, a project-less file to its uploader, a person's own picture - and
 * leaves any other out of the answer instead of failing the read.
 *
 * No database: who may see each file is answered from a table of files.
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

const OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const PUBLIC_FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const MY_UPLOAD_ID: string = "cccccccc-0000-4000-8000-000000000001";
const SOMEONE_ELSES_UPLOAD_ID: string = "cccccccc-0000-4000-8000-000000000002";
const MISSING_FILE_ID: string = "dddddddd-0000-4000-8000-000000000001";

const FILES: Record<string, FileAccessFacts> = {
  [OWN_FILE_ID]: {
    projectId: PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: false,
  },
  [FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: false,
  },
  [PUBLIC_FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: true,
  },
  [MY_UPLOAD_ID]: {
    projectId: null,
    createdByUserId: USER_ID,
    isPublic: false,
  },
  [SOMEONE_ELSES_UPLOAD_ID]: {
    projectId: null,
    createdByUserId: OTHER_USER_ID,
    isPublic: false,
  },
};

// A member of PROJECT_ID, signed in.
const MEMBER: RelatedFileReader = {
  projectIds: [PROJECT_ID],
  userId: USER_ID,
};

// Someone who may open no project the files are of, signed in.
const OUTSIDER: RelatedFileReader = {
  projectIds: [new ObjectID("55555555-5555-4555-8555-555555555555")],
  userId: OTHER_USER_ID,
};

// Nobody signed in, with no project to open.
const ANONYMOUS: RelatedFileReader = { projectIds: [], userId: null };

type GetFileAccessMock = Mock<
  (fileIds: Array<ObjectID>) => Promise<Map<string, FileAccessFacts>>
>;

function stubFileAccess(): GetFileAccessMock {
  const getFileAccess: GetFileAccessMock = jest.fn(
    async (fileIds: Array<ObjectID>): Promise<Map<string, FileAccessFacts>> => {
      const facts: Map<string, FileAccessFacts> = new Map();

      for (const fileId of fileIds) {
        const key: string = fileId.toString().toLowerCase();

        if (FILES[key]) {
          facts.set(key, FILES[key]!);
        }
      }

      return facts;
    },
  );

  jest
    .spyOn(FileService, "getFileAccess")
    .mockImplementation(getFileAccess as never);

  return getFileAccess;
}

function file(fileId: string, withBytes: boolean = true): File {
  const value: File = new File();
  value._id = fileId;
  value.name = `${fileId}.png`;

  if (withBytes) {
    value.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  }

  return value;
}

function statusPage(logoFileId: string | null): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = ObjectID.generate().toString();
  page.projectId = PROJECT_ID;

  if (logoFileId) {
    page.logoFile = file(logoFileId);
  }

  return page;
}

function note(attachmentIds: Array<string>): IncidentPublicNote {
  const value: IncidentPublicNote = new IncidentPublicNote();
  value._id = ObjectID.generate().toString();
  value.projectId = PROJECT_ID;
  value.attachments = attachmentIds.map((fileId: string): File => {
    return file(fileId);
  });

  return value;
}

function attachmentIdsOf(value: IncidentPublicNote): Array<string> {
  return (value.attachments || []).map((attachment: File): string => {
    return String(attachment._id);
  });
}

const BYTES_SELECT: Record<string, unknown> = {
  logoFile: { _id: true, file: true, fileType: true, name: true },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RelatedFileAccess.getReader: who a request reads as", () => {
  test("OneUptime itself and server admins read every file", () => {
    expect(RelatedFileAccess.getReader({ isRoot: true })).toBeNull();
    expect(
      RelatedFileAccess.getReader({ isMasterAdmin: true, userId: USER_ID }),
    ).toBeNull();
  });

  test("a member reads as the projects their request may open, and as themselves", () => {
    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [
            {
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            },
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    };

    expect(RelatedFileAccess.getReader(props)).toEqual({
      projectIds: [PROJECT_ID.toString()],
      userId: USER_ID,
    });
  });

  test("a read across the person's projects reads as each of them", () => {
    const reader: RelatedFileReader | null = RelatedFileAccess.getReader({
      userId: USER_ID,
      isMultiTenantRequest: true,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [],
          _type: "UserTenantAccessPermission",
        },
        [OTHER_PROJECT_ID.toString()]: {
          projectId: OTHER_PROJECT_ID,
          permissions: [],
          _type: "UserTenantAccessPermission",
        },
      },
    });

    expect(reader?.projectIds.sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });

  test("an API key reads as its own project, and as no person", () => {
    expect(
      RelatedFileAccess.getReader({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            projectId: PROJECT_ID,
            permissions: [],
            _type: "UserTenantAccessPermission",
          },
        },
      }),
    ).toEqual({ projectIds: [PROJECT_ID.toString()], userId: null });
  });

  /*
   * A project named only in the request's header - with no permission of
   * the person's for it - is not one the request may open.
   */
  test("a project the request names without access to it is not read as", () => {
    expect(
      RelatedFileAccess.getReader({ userId: USER_ID, tenantId: PROJECT_ID }),
    ).toEqual({ projectIds: [], userId: USER_ID });
    expect(RelatedFileAccess.getReader({})).toEqual({
      projectIds: [],
      userId: null,
    });
  });

  // A Project Admin of the workflow's project, and no person.
  test("a workflow step reads as its own project, and as no person", () => {
    expect(
      RelatedFileAccess.getReader(
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: ObjectID.generate(),
        }),
      ),
    ).toEqual({ projectIds: [PROJECT_ID.toString()], userId: null });
  });
});

describe("RelatedFileAccess.getColumnsReadingFiles: which files a select reads", () => {
  function names(columns: Array<FileReferenceColumn>): Array<string> {
    return columns.map((column: FileReferenceColumn): string => {
      return column.relationColumn;
    });
  }

  test("a file selected with its bytes, its name or its type", () => {
    for (const fileColumn of ["file", "name", "fileType", "slug"]) {
      expect(
        names(
          RelatedFileAccess.getColumnsReadingFiles(new StatusPage(), {
            logoFile: { _id: true, [fileColumn]: true },
          }),
        ),
      ).toEqual(["logoFile"]);
    }
  });

  test("a list of files selected beyond the ids", () => {
    expect(
      names(
        RelatedFileAccess.getColumnsReadingFiles(new IncidentPublicNote(), {
          note: true,
          attachments: { _id: true, name: true },
        }),
      ),
    ).toEqual(["attachments"]);
  });

  test("not a file selected by its id alone, or as true, or not at all", () => {
    expect(
      RelatedFileAccess.getColumnsReadingFiles(new StatusPage(), {
        name: true,
        logoFile: { _id: true },
        faviconFile: true,
        logoFileId: true,
        coverImageFile: { _id: true, file: false },
      }),
    ).toEqual([]);
    expect(
      RelatedFileAccess.getColumnsReadingFiles(new StatusPage(), null),
    ).toEqual([]);
    expect(
      RelatedFileAccess.getColumnsReadingFiles(new StatusPage(), undefined),
    ).toEqual([]);
  });

  test("nothing for a model with no File column", () => {
    expect(
      RelatedFileAccess.getColumnsReadingFiles(new Label(), {
        name: { file: true },
      }),
    ).toEqual([]);
  });

  test("every File column of a model, as FileOwnership reads them", () => {
    const select: Record<string, unknown> = {};

    for (const column of FileOwnership.getFileReferenceColumns(
      new StatusPage(),
    )) {
      select[column.relationColumn] = { file: true };
    }

    expect(
      names(
        RelatedFileAccess.getColumnsReadingFiles(new StatusPage(), select),
      ).sort(),
    ).toEqual(["coverImageFile", "faviconFile", "logoFile"]);
  });
});

describe("RelatedFileAccess.mayRead: who may see a file", () => {
  const projectOwner: {
    kind: FileOwnerKind.Project;
    projectId: ObjectID;
  } = { kind: FileOwnerKind.Project, projectId: PROJECT_ID };

  test("a member of the file's project", async () => {
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[OWN_FILE_ID],
        owner: projectOwner,
        reader: MEMBER,
      }),
    ).toBe(true);
  });

  test("not someone who may not open the file's project", async () => {
    for (const reader of [OUTSIDER, ANONYMOUS]) {
      expect(
        await RelatedFileAccess.mayRead({
          file: FILES[OWN_FILE_ID],
          owner: projectOwner,
          reader: reader,
        }),
      ).toBe(false);
    }
  });

  /*
   * A record of the member's project naming a file of another project - a
   * record saved before records were held to their own files - shows the
   * member nothing of it.
   */
  test("not a file of another project, through a record of the reader's own", async () => {
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[FOREIGN_FILE_ID],
        owner: projectOwner,
        reader: MEMBER,
      }),
    ).toBe(false);
  });

  test("a public file, to anyone, signed in or not", async () => {
    for (const reader of [MEMBER, OUTSIDER, ANONYMOUS]) {
      expect(
        await RelatedFileAccess.mayRead({
          file: FILES[PUBLIC_FOREIGN_FILE_ID],
          owner: projectOwner,
          reader: reader,
        }),
      ).toBe(true);
    }
  });

  test("only a real true is public", async () => {
    for (const isPublic of ["true", 1, "t", null, undefined]) {
      expect(
        await RelatedFileAccess.mayRead({
          file: {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: null,
            isPublic: isPublic as unknown as boolean,
          },
          owner: projectOwner,
          reader: MEMBER,
        }),
      ).toBe(false);
    }
  });

  test("a file uploaded with no project, to the person who uploaded it only", async () => {
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[MY_UPLOAD_ID],
        owner: projectOwner,
        reader: MEMBER,
      }),
    ).toBe(true);
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[SOMEONE_ELSES_UPLOAD_ID],
        owner: projectOwner,
        reader: MEMBER,
      }),
    ).toBe(false);
    // An API key is nobody: it uploaded nothing outside its project.
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[SOMEONE_ELSES_UPLOAD_ID],
        owner: projectOwner,
        reader: { projectIds: [PROJECT_ID], userId: null },
      }),
    ).toBe(false);
  });

  /*
   * A person's picture is served to anyone who asks for it by the profile
   * picture route, when they uploaded it: their own record publishes it,
   * whatever project it was uploaded in.
   */
  test("a person's own picture, read with the person", async () => {
    const pictureOfAnotherProject: FileAccessFacts = {
      projectId: OTHER_PROJECT_ID,
      createdByUserId: USER_ID,
      isPublic: false,
    };

    expect(
      await RelatedFileAccess.mayRead({
        file: pictureOfAnotherProject,
        owner: { kind: FileOwnerKind.User, userId: USER_ID },
        reader: MEMBER,
      }),
    ).toBe(true);
    // A picture someone else uploaded is not the person's own.
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[FOREIGN_FILE_ID],
        owner: { kind: FileOwnerKind.User, userId: USER_ID },
        reader: MEMBER,
      }),
    ).toBe(false);
  });

  test("not a file that could not be found", async () => {
    expect(
      await RelatedFileAccess.mayRead({
        file: undefined,
        owner: projectOwner,
        reader: MEMBER,
      }),
    ).toBe(false);
  });

  test("project ids compare in any case", async () => {
    expect(
      await RelatedFileAccess.mayRead({
        file: FILES[OWN_FILE_ID],
        owner: projectOwner,
        reader: {
          projectIds: [PROJECT_ID.toString().toUpperCase()],
          userId: null,
        },
      }),
    ).toBe(true);
  });
});

describe("RelatedFileAccess.keepReadableFiles: what a read hands back", () => {
  test("keeps the reader's own project's file, with its bytes", async () => {
    stubFileAccess();
    const page: StatusPage = statusPage(OWN_FILE_ID);

    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [page],
      select: BYTES_SELECT,
      reader: MEMBER,
    });

    expect(page.logoFile?._id).toBe(OWN_FILE_ID);
    expect(page.logoFile?.file).toBeDefined();
  });

  test("leaves out a file the reader may not see, and keeps the rest of the record", async () => {
    stubFileAccess();
    const page: StatusPage = statusPage(FOREIGN_FILE_ID);
    page.name = "Status";

    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [page],
      select: BYTES_SELECT,
      reader: MEMBER,
    });

    expect(page.logoFile).toBeUndefined();
    expect(page.name).toBe("Status");
    expect(page.projectId).toEqual(PROJECT_ID);
  });

  test("answers each row for itself", async () => {
    stubFileAccess();
    const own: StatusPage = statusPage(OWN_FILE_ID);
    const foreign: StatusPage = statusPage(FOREIGN_FILE_ID);
    const publicFile: StatusPage = statusPage(PUBLIC_FOREIGN_FILE_ID);
    const none: StatusPage = statusPage(null);

    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [own, foreign, publicFile, none],
      select: BYTES_SELECT,
      reader: MEMBER,
    });

    expect(own.logoFile?._id).toBe(OWN_FILE_ID);
    expect(foreign.logoFile).toBeUndefined();
    expect(publicFile.logoFile?._id).toBe(PUBLIC_FOREIGN_FILE_ID);
    expect(none.logoFile).toBeUndefined();
  });

  test("leaves the files the reader may not see out of a list, in order", async () => {
    stubFileAccess();
    const value: IncidentPublicNote = note([
      OWN_FILE_ID,
      FOREIGN_FILE_ID,
      MY_UPLOAD_ID,
      SOMEONE_ELSES_UPLOAD_ID,
      PUBLIC_FOREIGN_FILE_ID,
      MISSING_FILE_ID,
    ]);

    await RelatedFileAccess.keepReadableFiles({
      model: new IncidentPublicNote(),
      rows: [value],
      select: { attachments: { _id: true, name: true, file: true } },
      reader: MEMBER,
    });

    expect(attachmentIdsOf(value)).toEqual([
      OWN_FILE_ID,
      MY_UPLOAD_ID,
      PUBLIC_FOREIGN_FILE_ID,
    ]);
  });

  test("leaves every file out for an outsider and for nobody signed in", async () => {
    stubFileAccess();

    for (const reader of [OUTSIDER, ANONYMOUS]) {
      const value: IncidentPublicNote = note([
        OWN_FILE_ID,
        FOREIGN_FILE_ID,
        MY_UPLOAD_ID,
      ]);

      await RelatedFileAccess.keepReadableFiles({
        model: new IncidentPublicNote(),
        rows: [value],
        select: { attachments: { name: true } },
        reader: reader,
      });

      expect(attachmentIdsOf(value)).toEqual([]);
    }
  });

  test("reads who may see the files in one query, each file once, never with the bytes", async () => {
    const getFileAccess: GetFileAccessMock = stubFileAccess();

    await RelatedFileAccess.keepReadableFiles({
      model: new IncidentPublicNote(),
      rows: [
        note([OWN_FILE_ID, FOREIGN_FILE_ID]),
        note([OWN_FILE_ID.toUpperCase(), MY_UPLOAD_ID]),
      ],
      select: { attachments: { file: true } },
      reader: MEMBER,
    });

    expect(getFileAccess).toHaveBeenCalledTimes(1);
    expect(
      getFileAccess.mock.calls[0]![0].map((fileId: ObjectID): string => {
        return fileId.toString();
      }),
    ).toEqual([OWN_FILE_ID, FOREIGN_FILE_ID, MY_UPLOAD_ID]);
  });

  test("asks nothing for OneUptime itself, a select of ids, or rows with no files", async () => {
    const getFileAccess: GetFileAccessMock = stubFileAccess();
    const page: StatusPage = statusPage(FOREIGN_FILE_ID);

    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [page],
      select: BYTES_SELECT,
      reader: null,
    });
    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [page],
      select: { logoFile: { _id: true } },
      reader: MEMBER,
    });
    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [],
      select: BYTES_SELECT,
      reader: MEMBER,
    });
    await RelatedFileAccess.keepReadableFiles({
      model: new StatusPage(),
      rows: [statusPage(null)],
      select: BYTES_SELECT,
      reader: MEMBER,
    });

    expect(getFileAccess).not.toHaveBeenCalled();
    // Untouched for OneUptime itself.
    expect(page.logoFile?._id).toBe(FOREIGN_FILE_ID);
  });

  test("a person reading themselves keeps the picture they uploaded", async () => {
    jest.spyOn(FileService, "getFileAccess").mockResolvedValue(
      new Map<string, FileAccessFacts>([
        [
          OWN_FILE_ID,
          {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: USER_ID,
            isPublic: false,
          },
        ],
        [
          FOREIGN_FILE_ID,
          {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: OTHER_USER_ID,
            isPublic: false,
          },
        ],
      ]) as never,
    );

    const me: User = new User();
    me._id = USER_ID.toString();
    me.profilePictureFile = file(OWN_FILE_ID);

    const pictureOfSomeoneElse: User = new User();
    pictureOfSomeoneElse._id = USER_ID.toString();
    pictureOfSomeoneElse.profilePictureFile = file(FOREIGN_FILE_ID);

    await RelatedFileAccess.keepReadableFiles({
      model: new User(),
      rows: [me, pictureOfSomeoneElse],
      select: { profilePictureFile: { file: true } },
      reader: { projectIds: [], userId: USER_ID },
    });

    expect(me.profilePictureFile?._id).toBe(OWN_FILE_ID);
    expect(pictureOfSomeoneElse.profilePictureFile).toBeUndefined();
  });

  test("a failed lookup fails the read rather than hand a file back unchecked", async () => {
    jest
      .spyOn(FileService, "getFileAccess")
      .mockRejectedValue(new Error("db down") as never);
    const page: StatusPage = statusPage(OWN_FILE_ID);

    await expect(
      RelatedFileAccess.keepReadableFiles({
        model: new StatusPage(),
        rows: [page],
        select: BYTES_SELECT,
        reader: MEMBER,
      }),
    ).rejects.toThrow("db down");
  });
});
