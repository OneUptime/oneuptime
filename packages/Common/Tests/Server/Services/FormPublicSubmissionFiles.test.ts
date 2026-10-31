import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A public submission with files (FormService.submitPublicForm).
 *
 * Whoever fills the form in may have no OneUptime account, so the page sends
 * the files with the answers, as base64. What must hold:
 *
 *   - nothing is stored for a submission that is turned away - by its
 *     answers, by the form's hourly ceilings - and the files are counted
 *     against the form's allowance of files only once every other check
 *     has passed;
 *   - each file is stored once, as a private file of the form's project
 *     that nobody uploaded, named as the submitter's browser named it
 *     (cleaned), with the bytes they sent;
 *   - a question linked to a file custom field puts those files in the
 *     incident's field; a file question of the form's own puts them on the
 *     private note; the submission keeps them by name - never the bytes;
 *   - when the incident cannot be created, or a file cannot be stored, the
 *     files stored for it are taken away again.
 *
 * Only the database and the rate limiter's counters are stubbed.
 */

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
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import FormRateLimit, {
  FORM_FILES_RATE_LIMIT_MESSAGE,
  FormCeilingException,
} from "../../../Server/Middleware/FormRateLimit";
import FileService from "../../../Server/Services/FileService";
import FormFileAllowance from "../../../Server/Utils/Form/FormFileAllowance";
import FormService, {
  FORM_SUBMIT_FAILED_MESSAGE,
} from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServerException from "../../../Types/Exception/ServerException";
import MimeType from "../../../Types/File/MimeType";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
} from "../../../Types/Form/FormField";
import {
  encodeBase64,
  FormFileAnswer,
} from "../../../Types/Form/FormFileAnswer";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const EVIDENCE_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000f1";

const PDF: Uint8Array = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const PNG: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7,
]);
const LOG: Uint8Array = new TextEncoder().encode("03:12 disk full on db-2\n");

const fileOf: (
  name: string,
  fileType: MimeType,
  bytes: Uint8Array,
) => FormFileAnswer = (
  name: string,
  fileType: MimeType,
  bytes: Uint8Array,
): FormFileAnswer => {
  return { name, fileType, data: encodeBase64(bytes) };
};

const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What is wrong?",
    isRequired: true,
  },
  {
    id: "screenshot",
    source: FormFieldSource.Question,
    type: CustomFieldType.File,
    label: "Screenshot",
    isRequired: false,
  },
  {
    id: "evidence",
    source: FormFieldSource.TargetCustomField,
    customFieldId: EVIDENCE_FIELD_ID,
    label: "Evidence",
    isRequired: false,
  },
  {
    id: "name",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Name,
    label: "Your Name",
    isRequired: false,
  },
];

let incidentCreate: MockedFn;
let fileCreate: MockedFn;
let fileDelete: MockedFn;
let submissionCreate: MockedFn;
let noteCreate: MockedFn;
let reserveSubmission: MockedFn;
let reserveFiles: MockedFn;
let calls: Array<string>;
let fileCreateFailsAt: number;

beforeEach(() => {
  calls = [];
  fileCreateFailsAt = -1;

  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = FIELDS as unknown as JSONArray;
  form.targetSettings = { incidentSeverityId: SEVERITY_ID };
  form.ipWhitelist = "";

  jest.spyOn(FormService, "findOneBy").mockResolvedValue(form as never);
  jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true as never);
  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true as never);

  const evidence: IncidentCustomField = new IncidentCustomField();
  evidence._id = EVIDENCE_FIELD_ID;
  evidence.name = "Evidence";
  evidence.customFieldType = CustomFieldType.MultipleFiles;
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([evidence] as never);

  let fileCount: number = 0;

  fileCreate = jest
    .spyOn(FileService, "create")
    .mockImplementation((async (createBy: { data: File }) => {
      calls.push("file");

      if (fileCount === fileCreateFailsAt) {
        throw new Error("disk full");
      }

      const created: File = new File();
      created._id = `f0000000-0000-4000-8000-${String(++fileCount).padStart(12, "0")}`;
      created.name = createBy.data.name!;
      return created;
    }) as never) as unknown as MockedFn;

  fileDelete = jest
    .spyOn(FileService, "hardDeleteBy")
    .mockResolvedValue(1 as never) as unknown as MockedFn;

  incidentCreate = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (): Promise<Incident> => {
      calls.push("incident");
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.incidentNumberWithPrefix = "INC-42";
      return incident;
    }) as never) as unknown as MockedFn;

  submissionCreate = jest
    .spyOn(FormSubmissionService, "create")
    .mockImplementation((async (createBy: { data: FormSubmission }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  noteCreate = jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: { data: IncidentInternalNote }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  reserveSubmission = jest
    .spyOn(FormRateLimit, "reserveFormSubmission")
    .mockImplementation((async () => {
      calls.push("submission ceiling");
    }) as never) as unknown as MockedFn;

  reserveFiles = jest
    .spyOn(FormFileAllowance, "reserve")
    .mockImplementation((async () => {
      calls.push("file ceiling");
    }) as never) as unknown as MockedFn;

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

type SubmitFunction = (answers: JSONObject) => Promise<unknown>;

const submit: SubmitFunction = async (
  answers: JSONObject,
): Promise<unknown> => {
  return await FormService.submitPublicForm({
    shareKey: SHARE_KEY,
    request: { data: { answers: answers } },
    clientIp: "203.0.113.7",
  });
};

async function refusalOf(promise: Promise<unknown>): Promise<Exception> {
  try {
    await promise;
  } catch (err) {
    return err as Exception;
  }

  throw new Error("The submission was not refused.");
}

const ANSWERS: JSONObject = {
  title: "Checkout is down",
  screenshot: fileOf(
    "C:\\fakepath\\checkout.png",
    MimeType.png,
    PNG,
  ) as unknown as JSONObject,
  evidence: [
    fileOf("payments.log", MimeType.txt, LOG),
    fileOf("receipt.pdf", MimeType.pdf, PDF),
  ] as unknown as JSONArray,
  name: "Jane Doe",
};

function storedFiles(): Array<File> {
  return fileCreate.mock.calls.map((call: Array<unknown>): File => {
    return (call[0] as { data: File }).data;
  });
}

describe("a submission's files are stored", () => {
  test("each once, private, in the form's project, as nobody's upload, named as sent", async () => {
    await submit(ANSWERS);

    expect(fileCreate).toHaveBeenCalledTimes(3);

    for (const call of fileCreate.mock.calls) {
      expect((call[0] as { props: JSONObject }).props).toEqual({
        isRoot: true,
        tenantId: PROJECT_ID,
      });
    }

    expect(
      storedFiles().map((file: File) => {
        return [file.name, file.fileType, file.isPublic];
      }),
    ).toEqual([
      ["checkout.png", MimeType.png, false],
      ["payments.log", MimeType.txt, false],
      ["receipt.pdf", MimeType.pdf, false],
    ]);

    expect(Buffer.from(storedFiles()[0]!.file!).equals(Buffer.from(PNG))).toBe(
      true,
    );
    expect(Buffer.from(storedFiles()[2]!.file!).equals(Buffer.from(PDF))).toBe(
      true,
    );
  });

  test("the linked custom field holds its files, as the files say they are", async () => {
    await submit(ANSWERS);

    const incident: Incident = (
      incidentCreate.mock.calls[0]![0] as { data: Incident }
    ).data;

    expect(incident.customFields).toEqual({
      Evidence: [
        {
          fileId: "f0000000-0000-4000-8000-000000000002",
          name: "payments.log",
          fileType: MimeType.txt,
          size: LOG.length,
        },
        {
          fileId: "f0000000-0000-4000-8000-000000000003",
          name: "receipt.pdf",
          fileType: MimeType.pdf,
          size: PDF.length,
        },
      ],
    });
  });

  test("the form's own file question goes on the private note, which names it", async () => {
    await submit(ANSWERS);

    const note: IncidentInternalNote = (
      noteCreate.mock.calls[0]![0] as { data: IncidentInternalNote }
    ).data;

    expect(
      (note.attachments || []).map((file: File): string => {
        return file._id!.toString();
      }),
    ).toEqual(["f0000000-0000-4000-8000-000000000001"]);
    expect(note.note).toContain("checkout.png");
  });

  test("the submission keeps the files by name, never their bytes", async () => {
    await submit(ANSWERS);

    const submission: FormSubmission = (
      submissionCreate.mock.calls[0]![0] as { data: FormSubmission }
    ).data;
    const kept: string = JSON.stringify(submission.answers);

    expect(kept).toContain("checkout.png");
    expect(kept).toContain("payments.log, receipt.pdf");
    expect(kept).not.toContain(encodeBase64(PNG));
    expect(kept).not.toContain(encodeBase64(LOG));
  });

  test("nothing the incident is created with holds a file's bytes", async () => {
    await submit(ANSWERS);

    const created: string = JSON.stringify(
      (incidentCreate.mock.calls[0]![0] as { data: Incident }).data,
    );

    expect(created).not.toContain(encodeBase64(LOG));
    expect(created).not.toContain(encodeBase64(PDF));
  });
});

describe("the order of things", () => {
  test("the files are counted after the submission ceiling, with all their bytes, and stored before the incident", async () => {
    await submit(ANSWERS);

    expect(calls).toEqual([
      "submission ceiling",
      "file ceiling",
      "file",
      "file",
      "file",
      "incident",
    ]);
    expect(reserveFiles).toHaveBeenCalledWith({
      shareKey: SHARE_KEY,
      bytes: PNG.length + LOG.length + PDF.length,
    });
  });

  test("a submission without files spends no file allowance", async () => {
    await submit({ title: "Checkout is down" });

    expect(reserveFiles).not.toHaveBeenCalled();
    expect(fileCreate).not.toHaveBeenCalled();
    expect(incidentCreate).toHaveBeenCalledTimes(1);
  });

  test("a submission refused for a file stores nothing and spends nothing", async () => {
    const refusal: Exception = await refusalOf(
      submit({
        ...ANSWERS,
        evidence: [
          fileOf(
            "receipt.pdf",
            MimeType.pdf,
            new TextEncoder().encode("<html>"),
          ),
        ] as unknown as JSONArray,
      }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "A file in Evidence does not hold what its type says. Upload the file as it was saved.",
    );
    expect(reserveSubmission).not.toHaveBeenCalled();
    expect(reserveFiles).not.toHaveBeenCalled();
    expect(fileCreate).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("the form's allowance of files used up: nothing is stored or created", async () => {
    reserveFiles.mockImplementation((async () => {
      throw new FormCeilingException(1200, FORM_FILES_RATE_LIMIT_MESSAGE);
    }) as never);

    const refusal: Exception = await refusalOf(submit(ANSWERS));

    expect(refusal).toBeInstanceOf(FormCeilingException);
    expect(refusal.message).toBe(FORM_FILES_RATE_LIMIT_MESSAGE);
    expect(fileCreate).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
  });
});

// The ids of the files this suite stores.
const STORED_FILE_ID: RegExp = /f0000000-[0-9a-f-]+/g;

describe("files are taken away again", () => {
  function deletedIds(): Array<string> {
    return fileDelete.mock.calls.flatMap((call: Array<unknown>) => {
      const query: { _id: unknown } = (call[0] as { query: { _id: unknown } })
        .query;

      return JSON.stringify(query._id).match(STORED_FILE_ID) || [];
    });
  }

  test("when one cannot be stored: the ones stored before it go, and nothing is created", async () => {
    fileCreateFailsAt = 2;

    const refusal: Exception = await refusalOf(submit(ANSWERS));

    expect(refusal).toBeInstanceOf(ServerException);
    expect(refusal.message).toBe(FORM_SUBMIT_FAILED_MESSAGE);
    expect(deletedIds()).toEqual([
      "f0000000-0000-4000-8000-000000000001",
      "f0000000-0000-4000-8000-000000000002",
    ]);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("when the incident cannot be created: every stored file goes", async () => {
    incidentCreate.mockImplementation((async () => {
      throw new Error("no connection");
    }) as never);

    const refusal: Exception = await refusalOf(submit(ANSWERS));

    expect(refusal.message).toBe(FORM_SUBMIT_FAILED_MESSAGE);
    expect(deletedIds()).toEqual([
      "f0000000-0000-4000-8000-000000000001",
      "f0000000-0000-4000-8000-000000000002",
      "f0000000-0000-4000-8000-000000000003",
    ]);
    expect(
      (fileDelete.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });
});
