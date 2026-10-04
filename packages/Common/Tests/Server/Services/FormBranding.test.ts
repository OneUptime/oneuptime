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
 *     the File it names, read as root: it must exist and be an image every
 *     browser draws, of 1 MB at most. Clearing one needs no check, and a
 *     write that does not touch them reads no file. Nothing here ever makes
 *     a file public.
 *   - The public page gets them only inside the form's own public read
 *     (getPublicForm), after every check the form's questions are behind,
 *     read through the form's own relations in the same query - never by a
 *     file's id, and a submission never reads them.
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
import FileService from "../../../Server/Services/FileService";
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
  FORM_BRANDING_IMAGE_MAX_BYTES,
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
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
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CLIENT_IP: string = "203.0.113.7";

// The files there are: a logo, a favicon, and what a form must never show.
const LOGO_FILE_ID: string = "f1000000-0000-4000-8000-000000000001";
const FAVICON_FILE_ID: string = "f1000000-0000-4000-8000-000000000002";
const PDF_FILE_ID: string = "f1000000-0000-4000-8000-000000000003";
const HUGE_FILE_ID: string = "f1000000-0000-4000-8000-000000000004";
const HTML_FILE_ID: string = "f1000000-0000-4000-8000-000000000005";
const MISSING_FILE_ID: string = "f1000000-0000-4000-8000-0000000000ff";

const LOGO_BYTES: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);
const FAVICON_BYTES: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
  tenantId: PROJECT_ID,
};

function file(id: string, fileType: string, bytes: Buffer): File {
  const row: File = new File();
  row._id = id;
  row.fileType = fileType as MimeType;
  row.file = bytes;
  row.name = `${id}.bin`;
  row.isPublic = false;
  return row;
}

const FILES: Record<string, File> = {
  [LOGO_FILE_ID]: file(LOGO_FILE_ID, MimeType.png, LOGO_BYTES),
  [FAVICON_FILE_ID]: file(FAVICON_FILE_ID, MimeType.svg, FAVICON_BYTES),
  [PDF_FILE_ID]: file(PDF_FILE_ID, MimeType.pdf, Buffer.from("%PDF-1.7")),
  [HUGE_FILE_ID]: file(
    HUGE_FILE_ID,
    MimeType.png,
    Buffer.alloc(FORM_BRANDING_IMAGE_MAX_BYTES + 1),
  ),
  [HTML_FILE_ID]: file(
    HTML_FILE_ID,
    "text/html",
    Buffer.from("<script>alert(1)</script>"),
  ),
};

let billingEnabled: boolean = false;

function setBillingEnabled(value: boolean): void {
  billingEnabled = value;
  (globalThis as EnvMockGlobal).__oneuptimeFormBrandingBillingEnabled = value;
}

let fileFindOneById: MockedFn;
let fileUpdateOneById: MockedFn;
let makeFilePublic: MockedFn;
let formFindOneBy: MockedFn;
let storedForm: Form | null;

function newForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  Object.assign(form, data);
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

function create(data: Form): Promise<OnCreate<Form>> {
  return (
    FormService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props: ADMIN_PROPS });
}

function update(data: JSONObject): Promise<OnUpdate<Form>> {
  return (
    FormService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: FORM_ID },
    data: data as never,
    props: ADMIN_PROPS,
  } as never);
}

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

// The ids every file read asked for, in order.
function filesRead(): Array<string> {
  return fileFindOneById.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as { id: ObjectID }).id);
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

  fileFindOneById = jest
    .spyOn(FileService, "findOneById")
    .mockImplementation((async (findBy: {
      id: ObjectID;
    }): Promise<File | null> => {
      return FILES[findBy.id.toString()] || null;
    }) as never) as unknown as MockedFn;

  fileUpdateOneById = jest
    .spyOn(FileService, "updateOneById")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  makeFilePublic = jest
    .spyOn(FileService, "makeFilePublic")
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

  jest.spyOn(FormService, "findBy").mockResolvedValue([] as never);

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
    test("a new form with a PNG logo and an SVG favicon, by id", async () => {
      const form: Form = newForm({
        logoFileId: new ObjectID(LOGO_FILE_ID),
        faviconFileId: new ObjectID(FAVICON_FILE_ID),
      });

      await expect(create(form)).resolves.toBeDefined();
      expect(filesRead()).toEqual([LOGO_FILE_ID, FAVICON_FILE_ID]);
    });

    test("reads each file as root, its type and its bytes, and nothing else", async () => {
      await update({ logoFileId: LOGO_FILE_ID });

      expect(fileFindOneById).toHaveBeenCalledTimes(1);
      expect(fileFindOneById.mock.calls[0]![0]).toEqual({
        id: new ObjectID(LOGO_FILE_ID),
        select: { _id: true, fileType: true, file: true },
        props: { isRoot: true, ignoreHooks: true },
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
      expect(filesRead()).toEqual([LOGO_FILE_ID]);
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

    test("refuses an image over 1 MB", async () => {
      expect(
        (await refusal(update({ logoFileId: HUGE_FILE_ID })))?.message,
      ).toBe(FORM_LOGO_TOO_LARGE_MESSAGE);
      expect(
        (await refusal(update({ faviconFileId: HUGE_FILE_ID })))?.message,
      ).toBe(FORM_FAVICON_TOO_LARGE_MESSAGE);
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

    test("refuses a reference that is not a file id, without asking Postgres", async () => {
      const error: Exception | undefined = await refusal(
        update({ logoFileId: "../../etc/passwd" }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(FORM_LOGO_NOT_FOUND_MESSAGE);
      expect(fileFindOneById).not.toHaveBeenCalled();
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
      expect(fileFindOneById).not.toHaveBeenCalled();
    });

    test("checks the logo and the favicon each against its own file", async () => {
      const error: Exception | undefined = await refusal(
        update({ logoFileId: LOGO_FILE_ID, faviconFileId: PDF_FILE_ID }),
      );

      expect(error?.message).toBe(FORM_FAVICON_TYPE_MESSAGE);
      expect(filesRead()).toEqual([LOGO_FILE_ID, PDF_FILE_ID]);
    });

    test("taking a logo or favicon off the form needs no check", async () => {
      await expect(
        update({ logoFileId: null, faviconFile: null }),
      ).resolves.toBeDefined();
      expect(fileFindOneById).not.toHaveBeenCalled();
    });

    test("a write that does not touch them reads no file", async () => {
      await update({ name: "Report an Outage" });
      await update({ logoAltText: "Acme Inc." });
      await create(newForm());

      expect(fileFindOneById).not.toHaveBeenCalled();
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
        logoFile: FILES[LOGO_FILE_ID],
        logoAltText: "Acme Inc.",
        faviconFile: FILES[FAVICON_FILE_ID],
      });

      const form: PublicForm = await getPublicForm();

      expect(form.logo).toEqual({
        type: "image/png",
        data: LOGO_BYTES.toString("base64"),
      });
      expect(form.logoAltText).toBe("Acme Inc.");
      expect(form.favicon).toEqual({
        type: "image/svg+xml",
        data: FAVICON_BYTES.toString("base64"),
      });

      // Nothing that names a file: no id, no name, no address.
      const serialized: string = JSON.stringify(form);

      for (const secret of [
        LOGO_FILE_ID,
        FAVICON_FILE_ID,
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
        logoAltText: true,
        logoFile: { file: true, fileType: true },
        faviconFile: { file: true, fileType: true },
      });
      // Never by a file's id.
      expect(fileFindOneById).not.toHaveBeenCalled();
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
        logoFile: FILES[HTML_FILE_ID],
        logoAltText: "Acme Inc.",
        faviconFile: FILES[HUGE_FILE_ID],
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
        logoFile: FILES[LOGO_FILE_ID],
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
        logoFile: FILES[LOGO_FILE_ID],
      });

      const error: Exception | undefined = await refusal(getPublicForm());

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error?.message).toBe(FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    });

    test("a link to another form, or to none, gets nothing", async () => {
      storedForm = publicForm({ logoFile: FILES[LOGO_FILE_ID] });

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
      storedForm = publicForm({ logoFile: FILES[LOGO_FILE_ID] });

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
