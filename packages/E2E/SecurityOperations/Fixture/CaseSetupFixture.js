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
 */
import Project from "Common/Models/DatabaseModels/Project";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import SecurityCaseNoteTemplate from "Common/Models/DatabaseModels/SecurityCaseNoteTemplate";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
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

export function createCaseSetupFixture(options) {
  const { insert, table, ID, isEmpty } = options;

  function tableName(modelType) {
    return new modelType().tableName;
  }

  function seed() {
    // Read by the settings pages, the case queue and a case's pages, even when empty.
    table(SecurityCaseCustomField);
    table(SecurityCaseNoteTemplate);

    if (isEmpty) {
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

  return { seed, numbering, isCaseSetupTable };
}
