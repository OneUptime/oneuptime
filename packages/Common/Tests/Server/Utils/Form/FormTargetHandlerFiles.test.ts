/*
 * The handlers' import graph reaches the native isolated-vm addon through
 * the incident services' template rendering. Nothing here touches the
 * sandbox, and the prebuilt binary cannot always load in a test worker.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import File from "../../../../Models/DatabaseModels/File";
import Form from "../../../../Models/DatabaseModels/Form";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import {
  FormSubmissionContext,
  FormTargetHelpers,
  SortedFormAnswers,
} from "../../../../Server/Utils/Form/FormTargetHandler";
import { FormNoteAnswerFormat } from "../../../../Server/Utils/Form/FormSubmissionNote";
import IncidentFormTarget from "../../../../Server/Utils/Form/IncidentFormTarget";
import ScheduledMaintenanceFormTarget from "../../../../Server/Utils/Form/ScheduledMaintenanceFormTarget";
import { CustomFieldFile } from "../../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import { FormFieldSource } from "../../../../Types/Form/FormField";
import { PublicFormFieldType } from "../../../../Types/Form/FormPublic";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Where a submission's files go once they are stored: the files answering a
 * question linked to a File or Multiple files custom field go to that field
 * (by reference: the record holds the stored files), and the files answering
 * one of the form's own file questions go on the private note - named in it
 * and attached to it - so the people acting on the record download them
 * there.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SCREENSHOT: CustomFieldFile = {
  fileId: "f0000000-0000-4000-8000-000000000001",
  name: "checkout.png",
  fileType: MimeType.png,
  size: 2048,
};

const LOG: CustomFieldFile = {
  fileId: "f0000000-0000-4000-8000-000000000002",
  name: "checkout.log",
  fileType: MimeType.txt,
  size: 512,
};

const CONTRACT: CustomFieldFile = {
  fileId: "f0000000-0000-4000-8000-000000000003",
  name: "contract.pdf",
  fileType: MimeType.pdf,
  size: 4096,
};

function makeForm(): Form {
  const form: Form = new Form();
  form._id = "22222222-2222-4222-8222-222222222222";
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  return form;
}

function context(answers: Record<string, unknown>): FormSubmissionContext {
  return {
    form: makeForm(),
    fields: [
      {
        id: "shots",
        label: "Screenshots",
        type: PublicFormFieldType.MultipleFiles,
        isRequired: false,
      },
      {
        id: "contract",
        label: "Signed contract",
        type: PublicFormFieldType.File,
        isRequired: false,
      },
      {
        id: "why",
        label: "Why?",
        type: PublicFormFieldType.Text,
        isRequired: false,
      },
    ],
    bindings: {
      shots: {
        source: FormFieldSource.Question,
        label: "Screenshots",
        type: CustomFieldType.MultipleFiles,
      },
      contract: {
        source: FormFieldSource.TargetCustomField,
        label: "Signed contract",
        customFieldId: "c0000000-0000-4000-8000-000000000001",
        customFieldName: "Contract",
        customFieldType: CustomFieldType.File,
      },
      why: {
        source: FormFieldSource.Question,
        label: "Why?",
        type: CustomFieldType.Text,
      },
    },
    answers: answers as never,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FormTargetHelpers.sortAnswers and files", () => {
  test("a linked file field holds its files; the form's own file question goes on the note", () => {
    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(
      context({
        shots: [SCREENSHOT, LOG],
        contract: CONTRACT,
        why: "It broke",
      }),
    );

    expect(sorted.customFields).toEqual({ Contract: CONTRACT });
    expect(sorted.noteAttachments).toEqual([SCREENSHOT, LOG]);
    expect(sorted.questions).toEqual([
      {
        label: "Screenshots",
        displayValue: "checkout.png, checkout.log",
        format: FormNoteAnswerFormat.SingleLine,
      },
      {
        label: "Why?",
        displayValue: "It broke",
        format: FormNoteAnswerFormat.SingleLine,
      },
    ]);
  });

  test("no files, no attachments", () => {
    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(
      context({ why: "It broke" }),
    );

    expect(sorted.noteAttachments).toEqual([]);
  });

  test("a linked file field's files are never attached to the note as well", () => {
    expect(
      FormTargetHelpers.sortAnswers(context({ contract: CONTRACT }))
        .noteAttachments,
    ).toEqual([]);
  });

  test("a value that holds no stored file attaches nothing", () => {
    expect(
      FormTargetHelpers.sortAnswers(
        context({ shots: [{ name: "a.png", fileType: "image/png" }] }),
      ).noteAttachments,
    ).toEqual([]);
  });
});

describe("FormTargetHelpers.toAttachmentStubs", () => {
  test("each file as a File with only its id, the shape a relation is written with", () => {
    const stubs: Array<File> = FormTargetHelpers.toAttachmentStubs([
      SCREENSHOT,
      LOG,
    ]);

    expect(
      stubs.map((stub: File): string => {
        return stub._id!.toString();
      }),
    ).toEqual([SCREENSHOT.fileId, LOG.fileId]);
    expect(stubs[0]).toBeInstanceOf(File);
    expect(stubs[0]!.name).toBeUndefined();
  });

  test("none is none", () => {
    expect(FormTargetHelpers.toAttachmentStubs(undefined)).toEqual([]);
    expect(FormTargetHelpers.toAttachmentStubs([])).toEqual([]);
  });
});

describe("the private note carries the files", () => {
  test("on an incident", async () => {
    const createNote: SpyInstance<typeof IncidentInternalNoteService.create> =
      jest
        .spyOn(IncidentInternalNoteService, "create")
        .mockImplementation(
          async (
            createBy: CreateBy<IncidentInternalNote>,
          ): Promise<IncidentInternalNote> => {
            return createBy.data;
          },
        );

    await new IncidentFormTarget().addNote({
      form: makeForm(),
      createdId: RECORD_ID,
      note: "Submitted through the form.",
      attachments: [SCREENSHOT, LOG],
    });

    const note: IncidentInternalNote = createNote.mock.calls[0]![0].data;

    expect(
      (note.attachments || []).map((file: File): string => {
        return file._id!.toString();
      }),
    ).toEqual([SCREENSHOT.fileId, LOG.fileId]);
    expect(createNote.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("on a scheduled maintenance event", async () => {
    const createNote: SpyInstance<
      typeof ScheduledMaintenanceInternalNoteService.create
    > = jest
      .spyOn(ScheduledMaintenanceInternalNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<ScheduledMaintenanceInternalNote>,
        ): Promise<ScheduledMaintenanceInternalNote> => {
          return createBy.data;
        },
      );

    await new ScheduledMaintenanceFormTarget().addNote({
      form: makeForm(),
      createdId: RECORD_ID,
      note: "Submitted through the form.",
      attachments: [SCREENSHOT],
    });

    const note: ScheduledMaintenanceInternalNote =
      createNote.mock.calls[0]![0].data;

    expect(
      (note.attachments || []).map((file: File): string => {
        return file._id!.toString();
      }),
    ).toEqual([SCREENSHOT.fileId]);
  });

  test("a note with no files has no attachments", async () => {
    const createNote: SpyInstance<typeof IncidentInternalNoteService.create> =
      jest
        .spyOn(IncidentInternalNoteService, "create")
        .mockImplementation(
          async (
            createBy: CreateBy<IncidentInternalNote>,
          ): Promise<IncidentInternalNote> => {
            return createBy.data;
          },
        );

    await new IncidentFormTarget().addNote({
      form: makeForm(),
      createdId: RECORD_ID,
      note: "Submitted through the form.",
      attachments: [],
    });

    expect(createNote.mock.calls[0]![0].data.attachments).toBeUndefined();
  });
});
