import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A form's branding on the server (Forms > a form > Build > Branding): what
 * a write may point a form's logo and favicon at, and how the images reach
 * the anonymous public page.
 *
 *   - Every write that points a form at a logo or a favicon - create or
 *     update, the dashboard's relation or the API's id - is checked against
 *     the File it names (its type, size and project, never its bytes): it
 *     must exist, have been uploaded in the form's own project, and be an
 *     image every browser draws - a logo of 512 KB at most, a favicon of
 *     128 KB. A file of another project reads exactly like one that does not
 *     exist. Clearing one needs no check, a file the form already shows is
 *     not checked again, and a write that does not touch them reads no
 *     file. Nothing here ever makes a file public.
 *   - The public page gets them only inside the form's own public read
 *     (getPublicForm), after every check the form's questions are behind,
 *     read through the form's own relations in the same query - never by a
 *     file's id - and only a file of the form's own project, checked again
 *     as it is read. A submission never reads them.
 *
 * Only the database reads are stubbed; the checks and the shaping run for
 * real. Billing is switched through a mocked EnvironmentConfig, so every
 * test here holds with BILLING_ENABLED on and off alike.
 */

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeFormBrandingBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeFormBrandingBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeFormBrandingBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import File from "../../../Models/DatabaseModels/File";
import Form from "../../../Models/DatabaseModels/Form";
import FileService, { FileFacts } from "../../../Server/Services/FileService";
import FormService, {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import MimeType from "../../../Types/File/MimeType";
import {
  FORM_FAVICON_MAX_BYTES,
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
  FORM_LOGO_MAX_BYTES,
  FORM_LOGO_NOT_FOUND_MESSAGE,
  FORM_LOGO_TOO_LARGE_MESSAGE,
  FORM_LOGO_TYPE_MESSAGE,
} from "../../../Types/Form/FormBranding";
import { getDefaultFormFields } from "../../../Types/Form/FormField";
import { PublicForm } from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type MockedFn = ReturnType<typeof jest.fn>;

type OnBeforeCreate = (createBy: CreateBy<Form>) => Promise<OnCreate<Form>>;
type OnBeforeUpdate = (updateBy: UpdateBy<Form>) => Promise<OnUpdate<Form>>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
// Another project on the same OneUptime, whose files a form must never show.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f99",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const OTHER_FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f2";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CLIENT_IP: string = "203.0.113.7";

// The files there are: a logo, a favicon, and what a form must never show.
const LOGO_FILE_ID: string = "f1000000-0000-4000-8000-000000000001";
const FAVICON_FILE_ID: string = "f1000000-0000-4000-8000-000000000002";
const PDF_FILE_ID: string = "f1000000-0000-4000-8000-000000000003";
const HUGE_FILE_ID: string = "f1000000-0000-4000-8000-000000000004";
const HTML_FILE_ID: string = "f1000000-0000-4000-8000-000000000005";
const ICO_FILE_ID: string = "f1000000-0000-4000-8000-000000000006";
// Small enough for a logo, too large for a favicon.
const MEDIUM_FILE_ID: string = "f1000000-0000-4000-8000-000000000007";
// A fine PNG - of another project, and of none.
const OTHER_PROJECT_FILE_ID: string = "f1000000-0000-4000-8000-000000000008";
const NO_PROJECT_FILE_ID: string = "f1000000-0000-4000-8000-000000000009";
const MISSING_FILE_ID: string = "f1000000-0000-4000-8000-0000000000ff";

const LOGO_BYTES: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);
const FAVICON_BYTES: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);
const ICO_BYTES: Buffer = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
  tenantId: PROJECT_ID,
};

function file(
  id: string,
  fileType: string,
  bytes: Buffer,
  // Null for a file uploaded with no project.
  projectId: ObjectID | null = PROJECT_ID,
): File {
  const row: File = new File();
  row._id = id;
  row.fileType = fileType as MimeType;
  row.file = bytes;
  row.name = `${id}.bin`;
  row.isPublic = false;

  if (projectId) {
    row.projectId = projectId;
  }

  return row;
}

const FILES: Record<string, File> = {
  [LOGO_FILE_ID]: file(LOGO_FILE_ID, MimeType.png, LOGO_BYTES),
  [FAVICON_FILE_ID]: file(FAVICON_FILE_ID, MimeType.svg, FAVICON_BYTES),
  [PDF_FILE_ID]: file(PDF_FILE_ID, MimeType.pdf, Buffer.from("%PDF-1.7")),
  [HUGE_FILE_ID]: file(
    HUGE_FILE_ID,
    MimeType.png,
    Buffer.alloc(FORM_LOGO_MAX_BYTES + 1),
  ),
  [HTML_FILE_ID]: file(
    HTML_FILE_ID,
    "text/html",
    Buffer.from("<script>alert(1)</script>"),
  ),
  [ICO_FILE_ID]: file(ICO_FILE_ID, MimeType.ico, ICO_BYTES),
  [MEDIUM_FILE_ID]: file(
    MEDIUM_FILE_ID,
    MimeType.png,
    Buffer.alloc(FORM_FAVICON_MAX_BYTES + 1),
  ),
  [OTHER_PROJECT_FILE_ID]: file(
    OTHER_PROJECT_FILE_ID,
    MimeType.png,
    LOGO_BYTES,
    OTHER_PROJECT_ID,
  ),
  [NO_PROJECT_FILE_ID]: file(
    NO_PROJECT_FILE_ID,
    MimeType.png,
    LOGO_BYTES,
    null,
  ),
};

// What FileService.getFileFacts measures of a stored file.
function factsOf(row: File): FileFacts {
  return {
    fileType: row.fileType as string,
    size: row.file!.byteLength,
    projectId: row.projectId || null,
  };
}

let billingEnabled: boolean = false;

function setBillingEnabled(value: boolean): void {
  billingEnabled = value;
  (globalThis as EnvMockGlobal).__oneuptimeFormBrandingBillingEnabled = value;
}

let getFileFacts: MockedFn;
let fileReads: Array<MockedFn>;
let fileUpdateOneById: MockedFn;
let makeFilePublic: MockedFn;
let formFindOneBy: MockedFn;
let formFindBy: MockedFn;
let storedForm: Form | null;
// The forms an update's query matches, as stored.
let storedForms: Array<Form>;

function newForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  Object.assign(form, data);
  return form;
}

// A form as an update's lookup reads it: its id, project and images.
function storedRow(data: Partial<Form> = {}): Form {
  const form: Form = newForm(data);
  form._id = data._id || FORM_ID;
  return form;
}

/*
 * The form the public page reads, as the lookup returns it: with its
 * branding read through its relations when the lookup asked for it.
 */
function publicForm(data: Partial<Form> = {}): Form {
  const form: Form = newForm({
    isEnabled: true,
    shareKey: new ObjectID(SHARE_KEY),
    targetType: FormTargetType.Incident,
    fields: getDefaultFormFields(
      FormTargetType.Incident,
    ) as unknown as JSONArray,
    targetSettings: {},
    ipWhitelist: "",
  });
  form._id = FORM_ID;
  Object.assign(form, data);
  return form;
}

function create(
  data: Form,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<OnCreate<Form>> {
  return (
    FormService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });
}

function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<OnUpdate<Form>> {
  return (
    FormService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: FORM_ID },
    data: data as never,
    props: props,
  } as never);
}

// A member of another project, editing from there.
const OTHER_PROJECT_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f04"),
  tenantId: OTHER_PROJECT_ID,
};

async function refusal(
  promise: Promise<unknown>,
): Promise<Exception | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as Exception;
  }

  return undefined;
}

// The ids every file check asked about, in order.
function factsAsked(): Array<string> {
  return getFileFacts.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0] as ObjectID);
  });
}

// The select of the n-th form lookup.
function lookupSelect(index: number = 0): Record<string, unknown> {
  return (
    formFindOneBy.mock.calls[index]![0] as { select: Record<string, unknown> }
  ).select;
}

beforeEach(() => {
  setBillingEnabled(false);
  storedForm = publicForm();
  storedForms = [storedRow()];

  getFileFacts = jest
    .spyOn(FileService, "getFileFacts")
    .mockImplementation((async (id: ObjectID): Promise<FileFacts | null> => {
      const row: File | undefined = FILES[id.toString()];
      return row ? factsOf(row) : null;
    }) as never) as unknown as MockedFn;

  // A check never loads a whole File: none of these may be called.
  fileReads = [
    jest.spyOn(FileService, "findOneById") as unknown as MockedFn,
    jest.spyOn(FileService, "findOneBy") as unknown as MockedFn,
    jest.spyOn(FileService, "findBy") as unknown as MockedFn,
  ];

  for (const read of fileReads) {
    read.mockRejectedValue(new Error("a File was loaded") as never);
  }

  fileUpdateOneById = jest
    .spyOn(FileService, "updateOneById")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  makeFilePublic = jest
    .spyOn(FileService, "makeRecordFilePublic")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  formFindOneBy = jest
    .spyOn(FormService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { shareKey?: ObjectID };
    }): Promise<Form | null> => {
      if (
        storedForm &&
        findBy.query.shareKey?.toString() === storedForm.shareKey?.toString()
      ) {
        return storedForm;
      }

      return null;
    }) as never) as unknown as MockedFn;

  formFindBy = jest
    .spyOn(FormService, "findBy")
    .mockImplementation((async (): Promise<Array<Form>> => {
      return storedForms;
    }) as never) as unknown as MockedFn;

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);

  /*
   * A project on a plan that includes forms, for when billing is on: its
   * plan is read, and the plan includes forms (the plan catalogue itself is
   * the environment's, which a unit run does not have).
   */
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Growth,
    isSubscriptionUnpaid: false,
  } as never);
  jest
    .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
    .mockReturnValue(true);
});

afterEach(() => {
  for (const read of fileReads) {
    expect(read).not.toHaveBeenCalled();
  }

  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe.each([false, true])("with billing %s", (isBillingOn: boolean) => {
  beforeEach(() => {
    setBillingEnabled(isBillingOn);
  });

  test("the switch is what the service reads", () => {
    expect(billingEnabled).toBe(isBillingOn);
  });

  describe("writes: what a form's logo and favicon may be", () => {
    test("a new form with a PNG logo and an SVG favicon of its own project, by id", async () => {
      const form: Form = newForm({
        logoFileId: new ObjectID(LOGO_FILE_ID),
        faviconFileId: new ObjectID(FAVICON_FILE_ID),
      });

      await expect(create(form)).resolves.toBeDefined();
      expect(factsAsked()).toEqual([LOGO_FILE_ID, FAVICON_FILE_ID]);
    });

    test("asks only for each file's type, size and project - it never loads one", async () => {
      await update({ logoFileId: LOGO_FILE_ID });

      expect(factsAsked()).toEqual([LOGO_FILE_ID]);
      // And the forms the update is for: their project and their images.
      expect(formFindBy).toHaveBeenCalledTimes(1);
      expect(formFindBy.mock.calls[0]![0]).toMatchObject({
        query: { _id: FORM_ID },
        select: {
          _id: true,
          projectId: true,
          logoFileId: true,
          faviconFileId: true,
        },
        props: { isRoot: true },
      });
    });

    test("the dashboard's spelling: the relation, as its dialog sends it", async () => {
      const logo: File = new File();
      logo._id = LOGO_FILE_ID;
      logo.name = "logo.png";
      logo.fileType = MimeType.png;

      await expect(
        update({ logoFile: logo as unknown as JSONObject }),
      ).resolves.toBeDefined();
      expect(factsAsked()).toEqual([LOGO_FILE_ID]);
    });

    test("refuses a document as the logo, and a web page as the favicon", async () => {
      const pdf: Exception | undefined = await refusal(
        update({ logoFileId: PDF_FILE_ID }),
      );
      const html: Exception | undefined = await refusal(
        update({ faviconFileId: HTML_FILE_ID }),
      );

      expect(pdf).toBeInstanceOf(BadDataException);
      expect(pdf?.message).toBe(FORM_LOGO_TYPE_MESSAGE);
      expect(html).toBeInstanceOf(BadDataException);
      expect(html?.message).toBe(FORM_FAVICON_TYPE_MESSAGE);
    });

    test("an ICO may be the favicon, never the logo", async () => {
      await expect(
        update({ faviconFileId: ICO_FILE_ID }),
      ).resolves.toBeDefined();
      expect(
        (await refusal(update({ logoFileId: ICO_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_TYPE_MESSAGE);
    });

    test("refuses a logo over 512 KB and a favicon over 128 KB", async () => {
      expect(
        (await refusal(update({ logoFileId: HUGE_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_TOO_LARGE_MESSAGE);
      expect(
        (await refusal(update({ faviconFileId: HUGE_FILE_ID })))?.message,
      ).toBe(FORM_FAVICON_TOO_LARGE_MESSAGE);
      expect(
        (await refusal(update({ faviconFileId: MEDIUM_FILE_ID })))?.message,
      ).toBe(FORM_FAVICON_TOO_LARGE_MESSAGE);

      // The same file is a fine logo.
      await expect(
        update({ logoFileId: MEDIUM_FILE_ID }),
      ).resolves.toBeDefined();
    });

    test("refuses a file that does not exist", async () => {
      expect(
        (await refusal(update({ logoFileId: MISSING_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      expect(
        (
          await refusal(
            create(newForm({ faviconFileId: new ObjectID(MISSING_FILE_ID) })),
          )
        )?.message,
      ).toBe(FORM_FAVICON_NOT_FOUND_MESSAGE);
    });

    test("refuses a file of another project exactly as one that does not exist", async () => {
      const missing: Exception | undefined = await refusal(
        update({ logoFileId: MISSING_FILE_ID }),
      );

      for (const write of [
        (): Promise<unknown> => {
          return update({ logoFileId: OTHER_PROJECT_FILE_ID });
        },
        (): Promise<unknown> => {
          return update({ logoFile: { _id: OTHER_PROJECT_FILE_ID } });
        },
        (): Promise<unknown> => {
          return create(
            newForm({ logoFileId: new ObjectID(OTHER_PROJECT_FILE_ID) }),
          );
        },
      ]) {
        const error: Exception | undefined = await refusal(write());

        // Same class, same words: a form tells nothing of other projects' files.
        expect(error).toBeInstanceOf(BadDataException);
        expect(error?.constructor).toBe(missing?.constructor);
        expect(error?.message).toBe(missing?.message);
        expect(error?.message).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      }

      expect(
        (await refusal(update({ faviconFileId: OTHER_PROJECT_FILE_ID })))
          ?.message,
      ).toBe(FORM_FAVICON_NOT_FOUND_MESSAGE);
    });

    test("refuses a file uploaded with no project - every file from before files recorded one", async () => {
      expect(
        (await refusal(update({ logoFileId: NO_PROJECT_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      expect(
        (await refusal(update({ faviconFileId: NO_PROJECT_FILE_ID })))?.message,
      ).toBe(FORM_FAVICON_NOT_FOUND_MESSAGE);
    });

    test("an update is checked against the stored form's project, never one the write claims", async () => {
      expect(
        (
          await refusal(
            update({
              projectId: OTHER_PROJECT_ID.toString(),
              logoFileId: OTHER_PROJECT_FILE_ID,
            }),
          )
        )?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
    });

    test("a create is checked against the request's project, and a root create against the form's", async () => {
      // The request's project wins over the project the body names.
      expect(
        (
          await refusal(
            create(
              newForm({
                projectId: OTHER_PROJECT_ID,
                logoFileId: new ObjectID(OTHER_PROJECT_FILE_ID),
              }),
            ),
          )
        )?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);

      // A server-side create without a request: the form's own project.
      await expect(
        create(
          newForm({
            projectId: OTHER_PROJECT_ID,
            logoFileId: new ObjectID(OTHER_PROJECT_FILE_ID),
          }),
          { isRoot: true },
        ),
      ).resolves.toBeDefined();
      expect(
        (
          await refusal(
            create(
              newForm({
                projectId: OTHER_PROJECT_ID,
                logoFileId: new ObjectID(LOGO_FILE_ID),
              }),
              { isRoot: true },
            ),
          )
        )?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
    });

    test("a server-side update for forms of two projects checks the file against each", async () => {
      storedForms = [
        storedRow(),
        storedRow({ _id: OTHER_FORM_ID, projectId: OTHER_PROJECT_ID }),
      ];

      expect(
        (await refusal(update({ logoFileId: LOGO_FILE_ID }, { isRoot: true })))
          ?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      // One file, asked about once.
      expect(factsAsked()).toEqual([LOGO_FILE_ID]);
    });

    test("a file the form already shows is not checked again - the dialog sends the whole form back", async () => {
      storedForms = [
        storedRow({
          logoFileId: new ObjectID(LOGO_FILE_ID),
          faviconFileId: new ObjectID(ICO_FILE_ID),
        }),
      ];

      await expect(
        update({
          logoFile: { _id: LOGO_FILE_ID },
          logoFileId: LOGO_FILE_ID,
          faviconFileId: ICO_FILE_ID,
          logoAltText: "Acme Inc.",
        }),
      ).resolves.toBeDefined();
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("...but another form the same write is for, that does not show it yet, is", async () => {
      storedForms = [
        storedRow({ logoFileId: new ObjectID(LOGO_FILE_ID) }),
        storedRow({ _id: OTHER_FORM_ID }),
      ];

      await expect(update({ logoFileId: LOGO_FILE_ID })).resolves.toBeDefined();
      expect(factsAsked()).toEqual([LOGO_FILE_ID]);
    });

    test("...and replacing the file a form shows checks the new one", async () => {
      storedForms = [storedRow({ logoFileId: new ObjectID(LOGO_FILE_ID) })];

      expect(
        (await refusal(update({ logoFileId: OTHER_PROJECT_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      expect(factsAsked()).toEqual([OTHER_PROJECT_FILE_ID]);
    });

    test("a server-side update, with no request project, is checked against the form's own", async () => {
      storedForms = [storedRow({ projectId: OTHER_PROJECT_ID })];

      await expect(
        update({ logoFileId: OTHER_PROJECT_FILE_ID }, { isRoot: true }),
      ).resolves.toBeDefined();
      expect(
        (await refusal(update({ logoFileId: LOGO_FILE_ID }, { isRoot: true })))
          ?.message,
      ).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
    });

    /*
     * Hooks run before the permission layer narrows an update to the
     * request's project, so an update can be aimed at another project's
     * form. It must learn nothing there: the form's own file, a file it
     * already shows and any other file of its project are refused alike,
     * word for word, and only a file of the request's own project passes the
     * check (the permission layer then finds no form of that id to update).
     */
    test("an update aimed at another project's form learns nothing about that project's files", async () => {
      storedForms = [
        storedRow({
          logoFileId: new ObjectID(LOGO_FILE_ID),
          faviconFileId: new ObjectID(ICO_FILE_ID),
        }),
      ];

      const answers: Array<string | undefined> = [];

      for (const data of [
        // The file the form shows now.
        { logoFileId: LOGO_FILE_ID },
        { logoFile: { _id: LOGO_FILE_ID } },
        // Another file of the form's project.
        { logoFileId: FAVICON_FILE_ID },
        // No file at all.
        { logoFileId: MISSING_FILE_ID },
      ] as Array<JSONObject>) {
        const error: Exception | undefined = await refusal(
          update(data, OTHER_PROJECT_PROPS),
        );

        expect(error).toBeInstanceOf(BadDataException);
        answers.push(error?.message);
      }

      expect(new Set(answers)).toEqual(new Set([FORM_LOGO_NOT_FOUND_MESSAGE]));
      expect(
        (
          await refusal(
            update({ faviconFileId: ICO_FILE_ID }, OTHER_PROJECT_PROPS),
          )
        )?.message,
      ).toBe(FORM_FAVICON_NOT_FOUND_MESSAGE);

      // A file of the request's own project passes the check, whatever the form.
      await expect(
        update({ logoFileId: OTHER_PROJECT_FILE_ID }, OTHER_PROJECT_PROPS),
      ).resolves.toBeDefined();
    });

    test("an update that matches no form reads no file", async () => {
      storedForms = [];

      await expect(
        update({ logoFileId: OTHER_PROJECT_FILE_ID }),
      ).resolves.toBeDefined();
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("an empty reference clears the image, as null does, so it never reaches the uuid column", async () => {
      const updated: OnUpdate<Form> = await update({
        logoFileId: "",
        faviconFile: "",
      } as unknown as JSONObject);
      const updatedData: Record<string, unknown> = updated.updateBy
        .data as unknown as Record<string, unknown>;

      expect(updatedData["logoFileId"]).toBeNull();
      expect(updatedData["faviconFile"]).toBeNull();

      const created: OnCreate<Form> = await create(
        newForm({ logoFileId: "" as unknown as ObjectID }),
      );

      expect(created.createBy.data.logoFileId).toBeNull();
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("refuses a reference that is not a file id, as not found", async () => {
      const error: Exception | undefined = await refusal(
        update({ logoFileId: "../../etc/passwd" }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
    });

    test("refuses two spellings that point at different files", async () => {
      const error: Exception | undefined = await refusal(
        update({
          logoFileId: LOGO_FILE_ID,
          logoFile: { _id: PDF_FILE_ID },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe("Conflicting logo references were provided.");
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("checks the logo and the favicon each against its own file", async () => {
      const error: Exception | undefined = await refusal(
        update({ logoFileId: LOGO_FILE_ID, faviconFileId: PDF_FILE_ID }),
      );

      expect(error?.message).toBe(FORM_FAVICON_TYPE_MESSAGE);
      expect(factsAsked()).toEqual([LOGO_FILE_ID, PDF_FILE_ID]);
    });

    test("taking a logo or favicon off the form needs no check", async () => {
      await expect(
        update({ logoFileId: null, faviconFile: null }),
      ).resolves.toBeDefined();
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("a write that does not touch them reads no file, and no form", async () => {
      await update({ name: "Report an Outage" });
      await update({ logoAltText: "Acme Inc." });
      await create(newForm());

      expect(getFileFacts).not.toHaveBeenCalled();
      expect(formFindBy).not.toHaveBeenCalled();
    });

    test("never makes a file public, or changes it at all", async () => {
      await update({
        logoFileId: LOGO_FILE_ID,
        faviconFileId: FAVICON_FILE_ID,
      });
      await create(newForm({ logoFileId: new ObjectID(LOGO_FILE_ID) }));

      expect(makeFilePublic).not.toHaveBeenCalled();
      expect(fileUpdateOneById).not.toHaveBeenCalled();
      expect(FILES[LOGO_FILE_ID]!.isPublic).toBe(false);
    });
  });

  describe("the public read: the form's own images, inside the form", () => {
    function getPublicForm(
      data: { shareKey?: string; clientIp?: string | undefined } = {},
    ): Promise<PublicForm> {
      return FormService.getPublicForm({
        shareKey: "shareKey" in data ? data.shareKey : SHARE_KEY,
        clientIp: "clientIp" in data ? data.clientIp : CLIENT_IP,
      });
    }

    test("a form without branding is told nothing more than before", async () => {
      const form: PublicForm = await getPublicForm();

      expect(Object.keys(form).sort()).toEqual(
        ["fields", "isCaptchaRequired", "name"].sort(),
      );
    });

    test("hands over the logo, its alt text and the favicon, the images base64", async () => {
      storedForm = publicForm({
        logoFile: FILES[LOGO_FILE_ID]!,
        logoAltText: "Acme Inc.",
        faviconFile: FILES[ICO_FILE_ID]!,
      });

      const form: PublicForm = await getPublicForm();

      expect(form.logo).toEqual({
        type: "image/png",
        data: LOGO_BYTES.toString("base64"),
      });
      expect(form.logoAltText).toBe("Acme Inc.");
      expect(form.favicon).toEqual({
        type: "image/x-icon",
        data: ICO_BYTES.toString("base64"),
      });

      // Nothing that names a file: no id, no name, no address, no project.
      const serialized: string = JSON.stringify(form);

      for (const secret of [
        LOGO_FILE_ID,
        ICO_FILE_ID,
        `${LOGO_FILE_ID}.bin`,
        "/file/",
        FORM_ID,
        PROJECT_ID.toString(),
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    test("reads them with the form, through its own relations, in the one lookup", async () => {
      await getPublicForm();

      expect(formFindOneBy).toHaveBeenCalledTimes(1);
      expect(lookupSelect()).toMatchObject({
        projectId: true,
        logoAltText: true,
        logoFile: { file: true, fileType: true, projectId: true },
        faviconFile: { file: true, fileType: true, projectId: true },
      });
      // Never by a file's id.
      expect(getFileFacts).not.toHaveBeenCalled();
    });

    test("never a file of another project, or of none, whatever wrote the row", async () => {
      storedForm = publicForm({
        logoFile: FILES[OTHER_PROJECT_FILE_ID]!,
        logoAltText: "Acme Inc.",
        faviconFile: FILES[NO_PROJECT_FILE_ID]!,
      });

      const form: PublicForm = await getPublicForm();

      expect(form.logo).toBeUndefined();
      expect(form.logoAltText).toBeUndefined();
      expect(form.favicon).toBeUndefined();
      expect(JSON.stringify(form)).not.toContain(LOGO_BYTES.toString("base64"));
    });

    test("a submission never reads them", async () => {
      storedForm = publicForm({ isEnabled: false });

      await refusal(
        FormService.submitPublicForm({
          shareKey: SHARE_KEY,
          request: { data: { answers: {} } },
          clientIp: CLIENT_IP,
        }),
      );

      const select: Record<string, unknown> = lookupSelect();

      expect(formFindOneBy).toHaveBeenCalledTimes(1);
      expect(select).not.toHaveProperty("logoFile");
      expect(select).not.toHaveProperty("faviconFile");
      expect(select).not.toHaveProperty("logoAltText");
    });

    test("never hands over a file a form should not show, whatever its row holds", async () => {
      storedForm = publicForm({
        logoFile: FILES[HTML_FILE_ID]!,
        logoAltText: "Acme Inc.",
        faviconFile: FILES[MEDIUM_FILE_ID]!,
      });

      const form: PublicForm = await getPublicForm();

      expect(form.logo).toBeUndefined();
      expect(form.logoAltText).toBeUndefined();
      expect(form.favicon).toBeUndefined();
      expect(JSON.stringify(form)).not.toContain(
        FILES[HTML_FILE_ID]!.file!.toString("base64"),
      );
      expect(JSON.stringify(form)).not.toContain("<script>");
    });

    test("a form that is turned off hands over nothing, as any other unavailable form", async () => {
      storedForm = publicForm({
        isEnabled: false,
        logoFile: FILES[LOGO_FILE_ID]!,
      });

      const error: Exception | undefined = await refusal(getPublicForm());

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
      expect(JSON.stringify(error)).not.toContain(
        LOGO_BYTES.toString("base64"),
      );
    });

    test("a network the form does not allow gets no logo", async () => {
      storedForm = publicForm({
        ipWhitelist: "198.51.100.0/24",
        logoFile: FILES[LOGO_FILE_ID]!,
      });

      const error: Exception | undefined = await refusal(getPublicForm());

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error?.message).toBe(FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    });

    test("a link to another form, or to none, gets nothing", async () => {
      storedForm = publicForm({ logoFile: FILES[LOGO_FILE_ID]! });

      for (const shareKey of [
        "0f8fad5b-d9cb-469f-a165-70867728950e",
        LOGO_FILE_ID,
        "not-a-key",
      ]) {
        expect(await refusal(getPublicForm({ shareKey }))).toBeInstanceOf(
          NotFoundException,
        );
      }
    });

    test("a project whose plan does not include forms gets nothing, when billing is on", async () => {
      storedForm = publicForm({ logoFile: FILES[LOGO_FILE_ID]! });

      (
        SubscriptionPlan.isFeatureAccessibleOnCurrentPlan as unknown as MockedFn
      ).mockReturnValue(false);

      const result: Exception | undefined = await refusal(getPublicForm());

      if (isBillingOn) {
        expect(result).toBeInstanceOf(NotFoundException);
        expect(result?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
      } else {
        // Without billing every project has every feature.
        expect(result).toBeUndefined();
      }
    });
  });
});
