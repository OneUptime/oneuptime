/*
 * A project's own case setup on the fixture's synthetic month: Security
 * Events > Settings > Custom Fields, Note Templates and Numbering, and what
 * a case shows of them.
 *
 *   Custom fields   Business Unit, a dropdown of Corporate IT, Payments and
 *                   Storefront; and External Ticket, text. The spray case
 *                   (CASE-142) is Corporate IT's, tracked as INC-48213 in
 *                   the help desk's tool; no other case has either filled in.
 *   Note templates  Containment checklist and Shift hand-over, the two a
 *                   case's note composer offers under Templates.
 *   Numbering       CASE- in front of every case number, the prefix a
 *                   project starts with; the next case is one past the
 *                   highest case's number, or the number the project set its
 *                   cases to start at, when that is higher - as
 *                   ProjectService.takeNextNumber counts.
 *
 * ?empty=1: a new project's - no fields and no templates; its numbering as
 * every project's starts.
 *
 * ?casesetup= (CASE_SETUP_SCENARIOS), on the busy month:
 *
 *   none  the project has no case fields and no note templates yet: a
 *         case's Custom Fields page says where to add them, its Overview
 *         draws no Custom Fields card, and the composer's Templates menu
 *         offers to create one.
 *   fail  the first read of the case fields, and the first of the note
 *         templates, fails as a server error would (a 500); the next read
 *         answers.
 *   fail-with-reference
 *         the same, but each failure answers as a server that could not
 *         explain it does since #6836: its sentence, and the reference of
 *         its log lines (FAILED_READ_REFERENCE), which the page shows with a
 *         copy button.
 *   fail-twice
 *         as fail, but the first two reads of each fail: a Try again that
 *         fails once more, then one that answers.
 *   notes-fail-with-reference
 *         the first read of a case's notes - its notes feed's - fails as
 *         fail-with-reference's reads do, with its reference; the next
 *         answers. The case fields and templates are read as ever.
 *   notes-fail-twice
 *         the same, but the first two reads of the notes fail.
 *   notes-more-fail
 *         CASE-142 has more notes than a page of its feed holds (26 older
 *         ones besides its two), so the feed offers Load more; Load more's
 *         first read - of a later page - fails as notes-fail-with-reference's
 *         does, with its reference, and the next answers.
 *   note-post-fail
 *         the first note posted on a case fails as
 *         notes-fail-with-reference's read does, with its reference; the
 *         next is saved.
 */
import Project from "Common/Models/DatabaseModels/Project";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityCaseNoteTemplate from "Common/Models/DatabaseModels/SecurityCaseNoteTemplate";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
} from "Common/Types/Exception/UnexplainedError";
import { NumberedRecordKind } from "Common/Utils/Project/NextNumber";

export const BUSINESS_UNIT_FIELD = "Business Unit";
export const EXTERNAL_TICKET_FIELD = "External Ticket";
export const BUSINESS_UNITS = ["Corporate IT", "Payments", "Storefront"];

export const CONTAINMENT_TEMPLATE_NOTE = [
  "**Contained:** ",
  "**How:** ",
  "**Still open:** ",
].join("\n\n");

export const HAND_OVER_TEMPLATE_NOTE = [
  "**Where it stands:** ",
  "**Done this shift:** ",
  "**Next steps:** ",
].join("\n\n");

export const CASE_SETUP_SCENARIOS = [
  "none",
  "fail",
  "fail-with-reference",
  "fail-twice",
  "notes-fail-with-reference",
  "notes-fail-twice",
  "notes-more-fail",
  "note-post-fail",
];

/*
 * How many of each table's first reads fail, by ?casesetup= scenario: the
 * case setup's tables (the case fields and the note templates), a case's
 * notes, or the reads of a later page of them (Load more's).
 */
const FAILING_READS = {
  fail: { caseSetup: 1 },
  "fail-with-reference": { caseSetup: 1 },
  "fail-twice": { caseSetup: 2 },
  "notes-fail-with-reference": { notes: 1 },
  "notes-fail-twice": { notes: 2 },
  "notes-more-fail": { notesMore: 1 },
};

// How many of the first notes posted on a case fail, by ?casesetup= scenario.
const FAILING_NOTE_POSTS = {
  "note-post-fail": 1,
};

// The scenarios whose failed reads and posts answer with a reference.
const FAILS_WITH_REFERENCE = [
  "fail-with-reference",
  "notes-fail-with-reference",
  "notes-fail-twice",
  "notes-more-fail",
  "note-post-fail",
];

// The older notes ?casesetup=notes-more-fail gives CASE-142.
const OLDER_SPRAY_NOTES = 26;

// The reference a ?casesetup=fail-with-reference failure names.
export const FAILED_READ_REFERENCE = "3f9a2c1b";

export function createCaseSetupFixture(options) {
  const { insert, table, ID, isEmpty, scenario } = options;
  // The tables whose first read ?casesetup=fail fails, and the reads so far.
  const readsSoFar = new Map();
  // The notes posted on a case so far.
  let notePostsSoFar = 0;

  function tableName(modelType) {
    return new modelType().tableName;
  }

  function seed() {
    // Read by the settings pages, the case queue and a case's pages, even when empty.
    table(SecurityCaseCustomField);
    table(SecurityCaseNoteTemplate);

    if (isEmpty || scenario === "none") {
      return;
    }

    insert(SecurityCaseCustomField, {
      _id: ID.caseField(1),
      name: BUSINESS_UNIT_FIELD,
      description: "The part of the company the case is about.",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: BUSINESS_UNITS.join("\n"),
    });
    insert(SecurityCaseCustomField, {
      _id: ID.caseField(2),
      name: EXTERNAL_TICKET_FIELD,
      description: "The case's ticket in the help desk's tool.",
      customFieldType: CustomFieldType.Text,
    });

    insert(SecurityCaseNoteTemplate, {
      _id: ID.noteTemplate(1),
      templateName: "Containment checklist",
      templateDescription: "What was contained, how, and what is still open.",
      note: CONTAINMENT_TEMPLATE_NOTE,
    });
    insert(SecurityCaseNoteTemplate, {
      _id: ID.noteTemplate(2),
      templateName: "Shift hand-over",
      templateDescription: "Where the case stands for the next shift.",
      note: HAND_OVER_TEMPLATE_NOTE,
    });

    const sprayCase = table(SecurityCase).find((row) => {
      return row.caseNumber === 142;
    });

    if (sprayCase) {
      sprayCase.customFields = {
        [BUSINESS_UNIT_FIELD]: "Corporate IT",
        [EXTERNAL_TICKET_FIELD]: "INC-48213",
      };
    }

    if (scenario === "notes-more-fail") {
      seedOlderSprayNotes();
    }
  }

  /*
   * notes-more-fail: shift-log notes older than CASE-142's two, 10 minutes
   * apart - more than a page of its feed holds (NOTES_PAGE_SIZE, 25).
   */
  function seedOlderSprayNotes() {
    const sprayNotes = table(SecurityCaseNote).filter((row) => {
      return String(row.securityCaseId) === ID.case(142);
    });
    const oldest = Math.min(
      ...sprayNotes.map((row) => {
        return new Date(row.createdAt).getTime();
      }),
    );

    for (let n = 1; n <= OLDER_SPRAY_NOTES; n++) {
      insert(SecurityCaseNote, {
        ...sprayNotes[0],
        _id: ID.note(100 + n),
        note: `Shift log ${n}: checked the Okta sign-in report again; nothing new from the Tor exit.`,
        createdAt: new Date(oldest - n * 10 * 60 * 1000),
      });
    }
  }

  // GET /project/:id/numbering: where the project's case numbers stand.
  function numbering() {
    const project = table(Project)[0] || {};
    const highestNumber = table(SecurityCase).reduce((highest, row) => {
      return Math.max(highest, Number(row.caseNumber) || 0);
    }, 0);
    const numbersStartAt =
      typeof project.securityCaseNumbersStartAt === "number"
        ? project.securityCaseNumbersStartAt
        : null;

    return {
      numbering: [
        {
          kind: NumberedRecordKind.SecurityCase,
          prefix:
            project.securityCaseNumberPrefix === undefined
              ? null
              : project.securityCaseNumberPrefix,
          highestNumber,
          nextNumber: Math.max(highestNumber + 1, numbersStartAt || 1),
          numbersStartAt,
        },
      ],
    };
  }

  // The tables a Delete takes a row out of, as the server does.
  function isCaseSetupTable(modelName) {
    return (
      modelName === tableName(SecurityCaseCustomField) ||
      modelName === tableName(SecurityCaseNoteTemplate)
    );
  }

  // How many of the reads of `modelName` that count fail, from the first.
  function failingReadsOf(modelName, skip) {
    const failing = FAILING_READS[scenario] || {};

    if (isCaseSetupTable(modelName)) {
      return failing.caseSetup || 0;
    }

    if (modelName !== tableName(SecurityCaseNote)) {
      return 0;
    }

    // notes-more-fail: Load more's reads alone count - a later page's.
    if (failing.notesMore) {
      return skip > 0 ? failing.notesMore : 0;
    }

    return failing.notes || 0;
  }

  /*
   * ?casesetup=fail (or fail-with-reference): each table's first read fails,
   * the next answers; fail-twice: its first two. notes-fail-with-reference
   * and notes-fail-twice: the same of a case's notes; notes-more-fail: of
   * the reads of a later page of them, from `skip` on.
   */
  function failsRead(modelName, skip = 0) {
    const failingReads = failingReadsOf(modelName, skip);

    if (!failingReads) {
      return false;
    }

    const reads = (readsSoFar.get(modelName) || 0) + 1;
    readsSoFar.set(modelName, reads);

    return reads <= failingReads;
  }

  /*
   * ?casesetup=note-post-fail: the first note posted on a case fails; the
   * next is saved.
   */
  function failsNotePost(modelName) {
    const failingPosts = FAILING_NOTE_POSTS[scenario] || 0;

    if (!failingPosts || modelName !== tableName(SecurityCaseNote)) {
      return false;
    }

    notePostsSoFar++;

    return notePostsSoFar <= failingPosts;
  }

  /*
   * The answer of a read or a post that fails: a bare "Server Error", or,
   * with fail-with-reference and the notes' scenarios, what a server
   * answers for a failure it could not explain
   * (Common/Server/Utils/UnexplainedServerError).
   */
  function failedAnswer() {
    if (!FAILS_WITH_REFERENCE.includes(scenario)) {
      return { message: "Server Error" };
    }

    return {
      message: getUnexplainedServerErrorMessage(FAILED_READ_REFERENCE),
      [ERROR_REFERENCE_FIELD]: FAILED_READ_REFERENCE,
    };
  }

  return {
    seed,
    numbering,
    isCaseSetupTable,
    failsRead,
    failsNotePost,
    failedAnswer,
  };
}
