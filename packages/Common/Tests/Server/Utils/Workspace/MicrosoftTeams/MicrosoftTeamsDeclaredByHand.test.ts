import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import { MicrosoftTeamsCardChoiceList } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import { WORKSPACE_DECLARED_BY_HAND_TEXT } from "../../../../../Server/Utils/Workspace/WorkspaceIncidentDeclaredByHand";
import {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Microsoft Teams' Create New Incident card declares incidents by hand, as
 * Declare Incident does (#11137, WorkspaceIncidentDeclaredByHand):
 *
 *   - while the project starts them acknowledged, a note right under the
 *     on-call policies says leaving them empty does that; there is no note
 *     otherwise, nor where the card lists no policy to pick;
 *   - the bot's confirmation says, in a paragraph of its own between what
 *     the incident is linked to and what status page subscribers hear, that
 *     it was acknowledged as it was declared - when it was;
 *   - the command reads the switch with the card's other reads and hands
 *     the card its note.
 */

const SEVERITY_ID: string = ObjectID.generate().toString();
const POLICY_ID: string = ObjectID.generate().toString();

function listOf(
  choices: Array<{ title: string; value: string }>,
): MicrosoftTeamsCardChoiceList {
  return { choices: choices, totalCount: choices.length };
}

function choices(withPolicies: boolean): MicrosoftTeamsNewIncidentFormChoices {
  return {
    severities: listOf([{ title: "Critical", value: SEVERITY_ID }]),
    monitors: listOf([]),
    monitorStatuses: listOf([]),
    labels: listOf([]),
    onCallDutyPolicies: listOf(
      withPolicies ? [{ title: "Primary on-call", value: POLICY_ID }] : [],
    ),
  };
}

function bodyOf(card: JSONObject): Array<JSONObject> {
  return card["body"] as Array<JSONObject>;
}

function card(data: {
  withPolicies: boolean;
  onCallPoliciesHint?: string | undefined;
}): JSONObject {
  return MicrosoftTeamsIncidentActions.buildNewIncidentCardForBudget({
    choices: choices(data.withPolicies),
    budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
    ...(data.onCallPoliciesHint
      ? { onCallPoliciesHint: data.onCallPoliciesHint }
      : {}),
  });
}

function textsOf(body: Array<JSONObject>): Array<string> {
  return body
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return String(element["text"]);
    });
}

describe("the card's on-call policies", () => {
  test("say, right under them, that leaving them empty starts the incident acknowledged", () => {
    const body: Array<JSONObject> = bodyOf(
      card({
        withPolicies: true,
        onCallPoliciesHint: WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint,
      }),
    );
    const policies: number = body.findIndex((element: JSONObject): boolean => {
      return element["id"] === "onCallDutyPolicies";
    });

    expect(policies).toBeGreaterThan(-1);
    expect(body[policies + 1]).toMatchObject({
      type: "TextBlock",
      text: WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint,
      wrap: true,
      isSubtle: true,
    });
  });

  test("say nothing about it without the note", () => {
    const body: Array<JSONObject> = bodyOf(card({ withPolicies: true }));

    expect(textsOf(body)).not.toContain(
      WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint,
    );
  });

  test("are not there to say it under when the card lists no policy", () => {
    const body: Array<JSONObject> = bodyOf(
      card({
        withPolicies: false,
        onCallPoliciesHint: WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint,
      }),
    );

    expect(
      body.some((element: JSONObject): boolean => {
        return element["id"] === "onCallDutyPolicies";
      }),
    ).toBe(false);
    expect(textsOf(body)).not.toContain(
      WORKSPACE_DECLARED_BY_HAND_TEXT.onCallPoliciesHint,
    );
  });
});

describe("the bot's confirmation", () => {
  const LINKED: MarkdownText = mdText`Linked to **api-1** (Host).`;
  const STARTED: MarkdownText = mdText`${WORKSPACE_DECLARED_BY_HAND_TEXT.startedAcknowledged}`;
  const SUBSCRIBERS: MarkdownText = mdText`Status page subscribers will not be notified.`;

  test("says it was acknowledged as it was declared, between what it is linked to and what subscribers hear", async () => {
    const text: string =
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: ObjectID.generate(),
        incidentNumber: "INC-43",
        linkedLine: LINKED,
        startedAcknowledgedLine: STARTED,
        subscribersLine: SUBSCRIBERS,
      });

    expect(text).toBe(
      [
        "✅ **Incident INC-43** created successfully.",
        LINKED.toString(),
        STARTED.toString(),
        SUBSCRIBERS.toString(),
      ].join("\n\n"),
    );
  });

  test("leaves the line out when there is none", async () => {
    const text: string =
      await MicrosoftTeamsIncidentActions.getIncidentCreatedMessage({
        projectId: ObjectID.generate(),
        incidentNumber: "INC-44",
        linkedLine: null,
        startedAcknowledgedLine: null,
        subscribersLine: SUBSCRIBERS,
      });

    expect(text).toBe(
      [
        "✅ **Incident INC-44** created successfully.",
        SUBSCRIBERS.toString(),
      ].join("\n\n"),
    );
  });
});

/*
 * The command and the submit, read as source: the command reads the switch
 * with the card's other reads and hands the card its note; the submit
 * creates as declared by hand and puts the line in the confirmation it
 * sends.
 */
describe("the card's command and its submit", () => {
  const SERVER: string = path.resolve(__dirname, "../../../../../Server");

  test("the command reads the switch, and the card gets the note from it", () => {
    const source: string = fs.readFileSync(
      path.join(
        SERVER,
        "Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "WorkspaceIncidentDeclaredByHand.readIsOn(projectId)",
    );
    expect(source).toContain(
      "WorkspaceIncidentDeclaredByHand.getOnCallPoliciesHint(",
    );
  });

  test("the submit puts the line in the confirmation it sends", () => {
    const source: string = fs.readFileSync(
      path.join(SERVER, "Utils/Workspace/MicrosoftTeams/Actions/Incident.ts"),
      "utf8",
    );

    expect(source).toContain("startedAcknowledgedLine:");
    expect(source).toContain(
      "WorkspaceIncidentDeclaredByHand.getConfirmationLine({",
    );
  });
});
