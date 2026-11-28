import { describe, expect, test } from "@jest/globals";
import {
  DuplicateNamesAnswer,
  UniqueNameCheckAnswer,
  readDuplicateNamesAnswer,
  readUniqueNameCheckAnswer,
  toDuplicateNamesAnswerJSON,
  toUniqueNameCheckAnswerJSON,
} from "../../../Types/Database/RequiredUniqueNames";
import { JSONObject } from "../../../Types/JSON";

/*
 * WHAT GET /unique-names/check AND /unique-names/duplicates ANSWER, WRITTEN
 * AND READ BACK (#10761, #11020).
 *
 * A record either route names carries, where its kind's page opens under
 * another record or page, what that page's address needs (pageFields: an
 * OpenStack budget's cloud, a workspace summary's workspace and type).
 * Written only when the server has them; read back only as text values by
 * column; an answer from before them - or for any other kind - reads as it
 * always did.
 */

const BUDGET: string = "b0000000-0000-4000-8000-000000011020";
const OTHER_BUDGET: string = "b1111111-0000-4000-8000-000000011020";
const CLOUD: string = "c0000000-0000-4000-8000-000000011020";

describe("the check's answer", () => {
  test("a holder with page fields is written with them, and read back as it was", () => {
    const answer: UniqueNameCheckAnswer = {
      isRequired: true,
      takenBy: {
        id: BUDGET,
        name: "Compute",
        isArchived: false,
        pageFields: { openStackCloudId: CLOUD },
      },
      isTakenByUnreadable: false,
    };

    const json: JSONObject = toUniqueNameCheckAnswerJSON(answer);

    expect(json).toEqual({
      isRequired: true,
      takenBy: {
        id: BUDGET,
        name: "Compute",
        isArchived: false,
        pageFields: { openStackCloudId: CLOUD },
      },
      isTakenByUnreadable: false,
    });
    expect(readUniqueNameCheckAnswer(JSON.parse(JSON.stringify(json)))).toEqual(
      answer,
    );
  });

  test("a holder without them is written and read as it always was", () => {
    const answer: UniqueNameCheckAnswer = {
      isRequired: false,
      takenBy: { id: BUDGET, name: "Compute", isArchived: true },
      isTakenByUnreadable: false,
    };

    expect(toUniqueNameCheckAnswerJSON(answer)).toEqual({
      isRequired: false,
      takenBy: { id: BUDGET, name: "Compute", isArchived: true },
      isTakenByUnreadable: false,
    });
    expect(
      readUniqueNameCheckAnswer(toUniqueNameCheckAnswerJSON(answer)),
    ).toEqual(answer);
  });

  test("page fields that are not text by column read as none", () => {
    for (const pageFields of [
      "x",
      7,
      [CLOUD],
      { openStackCloudId: 7 },
      {},
      null,
    ]) {
      expect({
        pageFields,
        takenBy: readUniqueNameCheckAnswer({
          isRequired: true,
          takenBy: {
            id: BUDGET,
            name: "Compute",
            isArchived: false,
            pageFields,
          },
          isTakenByUnreadable: false,
        }).takenBy,
      }).toEqual({
        pageFields,
        takenBy: { id: BUDGET, name: "Compute", isArchived: false },
      });
    }
  });
});

describe("the duplicates' answer", () => {
  const ANSWER: DuplicateNamesAnswer = {
    requireUniqueNames: true,
    kinds: [
      {
        tableName: "OpenStackBudget",
        pluralName: "OpenStack Budgets",
        groupCount: 1,
        groups: [
          {
            name: "Compute",
            count: 3,
            records: [
              {
                id: BUDGET,
                name: "Compute",
                createdAt: "2026-11-05T05:14:00.000Z",
                isArchived: false,
                pageFields: { openStackCloudId: CLOUD },
              },
              {
                id: OTHER_BUDGET,
                name: "compute",
                createdAt: null,
                isArchived: false,
              },
            ],
          },
        ],
      },
    ],
  };

  test("each record is written with its page fields where it has them, and read back as it was", () => {
    const json: JSONObject = toDuplicateNamesAnswerJSON(ANSWER);
    const records: Array<JSONObject> = (
      (
        (json["kinds"] as Array<JSONObject>)[0]!["groups"] as Array<JSONObject>
      )[0]!["records"] as Array<JSONObject>
    ).map((record: JSONObject): JSONObject => {
      return record;
    });

    expect(records[0]).toEqual({
      id: BUDGET,
      name: "Compute",
      createdAt: "2026-11-05T05:14:00.000Z",
      isArchived: false,
      pageFields: { openStackCloudId: CLOUD },
    });
    // A record without them carries no key for them.
    expect(records[1]).toEqual({
      id: OTHER_BUDGET,
      name: "compute",
      createdAt: null,
      isArchived: false,
    });

    expect(readDuplicateNamesAnswer(JSON.parse(JSON.stringify(json)))).toEqual(
      ANSWER,
    );
  });

  test("a record's page fields that are not text by column read as none", () => {
    const read: DuplicateNamesAnswer = readDuplicateNamesAnswer({
      requireUniqueNames: false,
      kinds: [
        {
          tableName: "WorkspaceNotificationSummary",
          pluralName: "Workspace Notification Summaries",
          groupCount: 1,
          groups: [
            {
              name: "Morning",
              count: 2,
              records: [
                {
                  id: BUDGET,
                  name: "Morning",
                  createdAt: null,
                  isArchived: false,
                  pageFields: { workspaceType: ["Slack"], summaryType: "" },
                },
                {
                  id: OTHER_BUDGET,
                  name: "morning",
                  createdAt: null,
                  isArchived: false,
                  pageFields: { workspaceType: "Slack", summaryType: 3 },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(read.kinds[0]!.groups[0]!.records).toEqual([
      { id: BUDGET, name: "Morning", createdAt: null, isArchived: false },
      {
        id: OTHER_BUDGET,
        name: "morning",
        createdAt: null,
        isArchived: false,
        pageFields: { workspaceType: "Slack" },
      },
    ]);
  });
});
