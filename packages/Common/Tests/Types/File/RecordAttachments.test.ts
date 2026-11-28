import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentFeed from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import { CUSTOM_FIELD_FILE_TYPES } from "../../../Types/CustomField/CustomFieldFile";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  MARKDOWN_FILE_MAX_SIZE_IN_BYTES,
  MARKDOWN_FILES_MAX_COUNT,
  MARKDOWN_FILES_MAX_REFERENCES,
  MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  MarkdownFileFacts,
} from "../../../Types/File/MarkdownFiles";
import MimeType from "../../../Types/File/MimeType";
import {
  ATTACHMENT_FILE_TYPES,
  ATTACHMENT_LEFT_OUT_MESSAGES,
  ATTACHMENT_MAX_SIZE_IN_BYTES,
  ATTACHMENTS_MAX_COUNT,
  ATTACHMENTS_MAX_REFERENCES,
  ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES,
  AttachmentLeftOutReason,
  canHoldAttachments,
  COMMON_ATTACHMENT_RECORD_TABLE_NAMES,
  getAttachmentColumns,
  getAttachmentFileType,
  getAttachmentLeftOutReason,
  getAttachmentRecordTypes,
  isAttachmentRecordType,
} from "../../../Types/File/RecordAttachments";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FILES A RECORD HOLDS, HANDED TO A WORKFLOW (#11477): the kinds of
 * file, the limits, why a file is left out, and which records hold files -
 * read from the models, so a model that gains a list of files is covered
 * the day it does.
 */

const MODELS: Array<BaseModel> = Entities.map(
  (modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  },
);

const PDF_HEAD: Uint8Array = new Uint8Array(Buffer.from("%PDF-1.7\n%..."));
const PNG_HEAD: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const PAGE_HEAD: Uint8Array = new Uint8Array(
  Buffer.from("<!doctype html><script>alert(1)</script>"),
);
const SVG_HEAD: Uint8Array = new Uint8Array(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
);

const facts: (data: Partial<MarkdownFileFacts>) => MarkdownFileFacts = (
  data: Partial<MarkdownFileFacts>,
): MarkdownFileFacts => {
  return {
    name: "change-request.pdf",
    fileType: MimeType.pdf,
    sizeInBytes: 2048,
    head: PDF_HEAD,
    ...data,
  };
};

const EMPTY_TALLY: { count: number; totalSizeInBytes: number } = {
  count: 0,
  totalSizeInBytes: 0,
};

describe("the limits", () => {
  test("are exactly Get Files From Markdown's", () => {
    expect(ATTACHMENT_MAX_SIZE_IN_BYTES).toBe(MARKDOWN_FILE_MAX_SIZE_IN_BYTES);
    expect(ATTACHMENTS_MAX_COUNT).toBe(MARKDOWN_FILES_MAX_COUNT);
    expect(ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES).toBe(
      MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
    );
    expect(ATTACHMENTS_MAX_REFERENCES).toBe(MARKDOWN_FILES_MAX_REFERENCES);
  });

  test("10 MB a file, 20 files and 10 MB a read, 100 looked up", () => {
    expect(ATTACHMENT_MAX_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENTS_MAX_COUNT).toBe(20);
    expect(ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENTS_MAX_REFERENCES).toBe(100);
  });
});

describe("the kinds of file handed out", () => {
  test("what a file custom field takes, never an SVG", () => {
    expect(ATTACHMENT_FILE_TYPES).not.toContain(MimeType.svg);
    expect([...ATTACHMENT_FILE_TYPES].sort()).toEqual(
      CUSTOM_FIELD_FILE_TYPES.filter((type: MimeType): boolean => {
        return type !== MimeType.svg;
      }).sort(),
    );
  });

  test("documents and pictures alike", () => {
    for (const type of [
      MimeType.pdf,
      MimeType.docx,
      MimeType.xlsx,
      MimeType.png,
      MimeType.jpeg,
      MimeType.txt,
      MimeType.csv,
      MimeType.zip,
    ]) {
      expect(ATTACHMENT_FILE_TYPES).toContain(type);
    }
  });

  test("getAttachmentFileType: a type handed out, in any case and with space around it; an older name read as its type", () => {
    expect(getAttachmentFileType(" Application/PDF ")).toBe(MimeType.pdf);
    expect(getAttachmentFileType("image/jpg")).toBe(MimeType.jpeg);
    expect(getAttachmentFileType("image/pjpeg")).toBe(MimeType.jpeg);
  });

  test("getAttachmentFileType: nothing for an SVG, a page, a script, an unknown type or none", () => {
    for (const type of [
      MimeType.svg,
      "text/html",
      "application/javascript",
      "application/x-unknown",
      "",
      null,
      undefined,
    ]) {
      expect([type, getAttachmentFileType(type)]).toEqual([type, null]);
    }
  });
});

describe("getAttachmentLeftOutReason", () => {
  test("a document that holds what its type says, within the limits, is handed out", () => {
    expect(
      getAttachmentLeftOutReason({ file: facts({}), tally: EMPTY_TALLY }),
    ).toBeNull();
    expect(
      getAttachmentLeftOutReason({
        file: facts({ fileType: MimeType.png, head: PNG_HEAD }),
        tally: EMPTY_TALLY,
      }),
    ).toBeNull();
  });

  test("an SVG is left out, whatever it holds", () => {
    expect(
      getAttachmentLeftOutReason({
        file: facts({ fileType: MimeType.svg, head: SVG_HEAD }),
        tally: EMPTY_TALLY,
      }),
    ).toBe(AttachmentLeftOutReason.NotAllowed);
  });

  test("a page stored as a PDF, or as a picture, is left out: it does not hold what its type says", () => {
    for (const fileType of [MimeType.pdf, MimeType.png]) {
      expect(
        getAttachmentLeftOutReason({
          file: facts({ fileType: fileType, head: PAGE_HEAD }),
          tally: EMPTY_TALLY,
        }),
      ).toBe(AttachmentLeftOutReason.NotAllowed);
    }
  });

  test("an empty file is left out", () => {
    expect(
      getAttachmentLeftOutReason({
        file: facts({ sizeInBytes: 0, head: new Uint8Array(0) }),
        tally: EMPTY_TALLY,
      }),
    ).toBe(AttachmentLeftOutReason.NotAllowed);
  });

  test("one byte over 10 MB is too large; exactly 10 MB is not", () => {
    expect(
      getAttachmentLeftOutReason({
        file: facts({ sizeInBytes: ATTACHMENT_MAX_SIZE_IN_BYTES + 1 }),
        tally: EMPTY_TALLY,
      }),
    ).toBe(AttachmentLeftOutReason.TooLarge);
    expect(
      getAttachmentLeftOutReason({
        file: facts({ sizeInBytes: ATTACHMENT_MAX_SIZE_IN_BYTES }),
        tally: EMPTY_TALLY,
      }),
    ).toBeNull();
  });

  test("past 20 files, too many; past 10 MB in all, over the total - and a smaller file after still fits", () => {
    expect(
      getAttachmentLeftOutReason({
        file: facts({}),
        tally: { count: ATTACHMENTS_MAX_COUNT, totalSizeInBytes: 0 },
      }),
    ).toBe(AttachmentLeftOutReason.TooMany);
    expect(
      getAttachmentLeftOutReason({
        file: facts({ sizeInBytes: 2048 }),
        tally: {
          count: 1,
          totalSizeInBytes: ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES - 1024,
        },
      }),
    ).toBe(AttachmentLeftOutReason.OverTotalSize);
    expect(
      getAttachmentLeftOutReason({
        file: facts({ sizeInBytes: 1024 }),
        tally: {
          count: 1,
          totalSizeInBytes: ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES - 1024,
        },
      }),
    ).toBeNull();
  });

  test("every reason has words, and says the limits", () => {
    for (const reason of Object.values(AttachmentLeftOutReason)) {
      expect(ATTACHMENT_LEFT_OUT_MESSAGES[reason].length).toBeGreaterThan(20);
    }

    expect(
      ATTACHMENT_LEFT_OUT_MESSAGES[AttachmentLeftOutReason.TooLarge],
    ).toContain("10 MB");
    expect(
      ATTACHMENT_LEFT_OUT_MESSAGES[AttachmentLeftOutReason.TooMany],
    ).toContain("20");
    expect(
      ATTACHMENT_LEFT_OUT_MESSAGES[AttachmentLeftOutReason.NotAllowed],
    ).toContain("SVG");
  });
});

describe("which records hold files", () => {
  test("getAttachmentColumns: a note's attachments, an incident's postmortem attachments, an announcement's attachments", () => {
    expect(getAttachmentColumns(new IncidentInternalNote())).toEqual([
      "attachments",
    ]);
    expect(getAttachmentColumns(new Incident())).toEqual([
      "postmortemAttachments",
    ]);
    expect(getAttachmentColumns(new StatusPageAnnouncement())).toEqual([
      "attachments",
    ]);
  });

  test("getAttachmentColumns: a single file - a logo, a favicon - is no attachment", () => {
    expect(getAttachmentColumns(new StatusPage())).toEqual([]);
    expect(getAttachmentColumns(new User())).toEqual([]);
  });

  test("getAttachmentColumns names every list of files of every model, and nothing else", () => {
    for (const model of MODELS) {
      const named: Array<string> = getAttachmentColumns(model);

      for (const column of model.getTableColumns().columns) {
        const metadata: { type?: TableColumnType; modelType?: unknown } =
          model.getTableColumnMetadata(column) || {};
        const isListOfFiles: boolean =
          metadata.type === TableColumnType.EntityArray &&
          Boolean(metadata.modelType) &&
          new (metadata.modelType as { new (): BaseModel })().tableName ===
            "File";

        expect([model.tableName, column, named.includes(column)]).toEqual([
          model.tableName,
          column,
          isListOfFiles,
        ]);
      }
    }
  });

  test("canHoldAttachments: records of a project with a list of files, or with custom fields", () => {
    expect(canHoldAttachments(new IncidentInternalNote())).toBe(true);
    expect(canHoldAttachments(new Incident())).toBe(true);
    // A team holds no list of files, but its custom fields may hold files.
    expect(getAttachmentColumns(new Team())).toEqual([]);
    expect(canHoldAttachments(new Team())).toBe(true);
  });

  test("canHoldAttachments: no record of no project, no file, no feed", () => {
    expect(canHoldAttachments(new User())).toBe(false);
    expect(canHoldAttachments(new File())).toBe(false);
    expect(canHoldAttachments(new IncidentFeed())).toBe(false);
  });

  test("isAttachmentRecordType: one that holds files, and that a workflow reads", () => {
    for (const model of MODELS) {
      expect([model.tableName, isAttachmentRecordType(model)]).toEqual([
        model.tableName,
        canHoldAttachments(model) && Boolean(model.enableWorkflowOn?.read),
      ]);
    }
  });
});

describe("the record types a Get Attachments From Record step reads", () => {
  const offered: Array<BaseModel> = getAttachmentRecordTypes(MODELS);
  const tableNames: Array<string> = offered.map((model: BaseModel): string => {
    return model.tableName || "";
  });

  test("exactly the record types a workflow reads that can hold files", () => {
    expect([...tableNames].sort()).toEqual(
      MODELS.filter(isAttachmentRecordType)
        .map((model: BaseModel): string => {
          return model.tableName!;
        })
        .sort(),
    );
  });

  test("each record type once", () => {
    expect(new Set(tableNames).size).toBe(tableNames.length);
  });

  test("the common ones lead, in their order, then the rest by name", () => {
    const common: Array<string> = COMMON_ATTACHMENT_RECORD_TABLE_NAMES.filter(
      (tableName: string): boolean => {
        return tableNames.includes(tableName);
      },
    );

    expect(tableNames.slice(0, common.length)).toEqual(common);

    const rest: Array<BaseModel> = offered.slice(common.length);
    const restNames: Array<string> = rest.map((model: BaseModel): string => {
      return model.singularName || model.tableName || "";
    });

    expect(restNames).toEqual(
      [...restNames].sort((left: string, right: string): number => {
        return left.localeCompare(right);
      }),
    );
  });

  test("every common record type is one the step reads: a rename cannot drop it quietly", () => {
    for (const tableName of COMMON_ATTACHMENT_RECORD_TABLE_NAMES) {
      expect([tableName, tableNames.includes(tableName)]).toEqual([
        tableName,
        true,
      ]);
    }
  });

  test("the incident and its notes lead the list", () => {
    expect(tableNames.slice(0, 3)).toEqual([
      "Incident",
      "IncidentInternalNote",
      "IncidentPublicNote",
    ]);
  });

  test("the same model listed twice is offered once", () => {
    expect(
      getAttachmentRecordTypes([
        new Incident(),
        new Incident(),
        new IncidentInternalNote(),
      ]).map((model: BaseModel): string => {
        return model.tableName!;
      }),
    ).toEqual(["Incident", "IncidentInternalNote"]);
  });
});
