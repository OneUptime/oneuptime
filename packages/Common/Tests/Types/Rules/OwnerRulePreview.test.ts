import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import { JSONObject } from "../../../Types/JSON";
import OwnerRulePreview, {
  OWNER_RULE_PREVIEW_DRAFT_LISTS,
  OWNER_RULE_PREVIEW_ROUTE,
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "../../../Types/Rules/OwnerRulePreview";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the shape the server and the dashboard share for
 * "which owner rules would run, and who they would add"
 * (Types/Rules/OwnerRulePreview): each event's route, the draft the create
 * form sends, and the answer it reads back.
 */

describe("each event's route", () => {
  it.each([
    [OwnerRulePreviewEvent.Incident, new Incident()],
    [OwnerRulePreviewEvent.Alert, new Alert()],
    [OwnerRulePreviewEvent.IncidentEpisode, new IncidentEpisode()],
    [OwnerRulePreviewEvent.AlertEpisode, new AlertEpisode()],
  ])(
    "%s is under the event's own API path, where its API registers it",
    (
      event: OwnerRulePreviewEvent,
      model: { getCrudApiPath: () => { toString: () => string } | null },
    ) => {
      expect(OwnerRulePreview.getApiPath(event)).toBe(
        `${model.getCrudApiPath()!.toString()}${OWNER_RULE_PREVIEW_ROUTE}`,
      );
    },
  );
});

describe("the draft", () => {
  it("starts with nothing filled in", () => {
    expect(OwnerRulePreview.emptyDraft()).toEqual({
      title: "",
      description: "",
      severityId: null,
      labelIds: [],
      monitorIds: [],
      hostIds: [],
      kubernetesClusterIds: [],
      dockerHostIds: [],
      podmanHostIds: [],
      serviceIds: [],
    });
  });

  it("names every list of ids it carries", () => {
    const draft: OwnerRulePreviewDraft = OwnerRulePreview.emptyDraft();

    expect([...OWNER_RULE_PREVIEW_DRAFT_LISTS].sort()).toEqual(
      Object.keys(draft)
        .filter((key: string): boolean => {
          return Array.isArray(
            (draft as unknown as Record<string, unknown>)[key],
          );
        })
        .sort(),
    );
  });

  it("travels as JSON with copies of its lists", () => {
    const draft: OwnerRulePreviewDraft = {
      ...OwnerRulePreview.emptyDraft(),
      title: "Checkout is down",
      severityId: "30000000-0000-4000-8000-000000000009",
      labelIds: ["30000000-0000-4000-8000-000000000001"],
    };

    const json: JSONObject = OwnerRulePreview.draftToJSON(draft);

    expect(json).toEqual(draft);
    expect(json["labelIds"]).not.toBe(draft.labelIds);
  });
});

describe("the answer", () => {
  const RESULT: OwnerRulePreviewResult = {
    rules: [
      {
        ruleId: "40000000-0000-4000-8000-000000000001",
        ruleName: "Platform owns checkout",
        userIds: ["50000000-0000-4000-8000-000000000001"],
        teamIds: [
          "50000000-0000-4000-8000-000000000002",
          "50000000-0000-4000-8000-000000000003",
        ],
        creatorTeamIds: ["50000000-0000-4000-8000-000000000003"],
        notifiesOwners: false,
      },
    ],
  };

  it("reads back as it was written", () => {
    expect(
      OwnerRulePreview.resultFromJSON(
        JSON.parse(JSON.stringify(OwnerRulePreview.resultToJSON(RESULT))),
      ),
    ).toEqual(RESULT);
  });

  it("is read leniently: a rule without an id is left out, a list that is not one is empty", () => {
    expect(
      OwnerRulePreview.resultFromJSON({
        rules: [
          { ruleName: "No id" },
          null,
          "text",
          ["a"],
          {
            ruleId: "40000000-0000-4000-8000-000000000002",
            ruleName: 12,
            userIds: "50000000-0000-4000-8000-000000000001",
            teamIds: ["50000000-0000-4000-8000-000000000002", 7, ""],
            notifiesOwners: "true",
          },
        ],
      } as unknown as JSONObject),
    ).toEqual({
      rules: [
        {
          ruleId: "40000000-0000-4000-8000-000000000002",
          ruleName: "",
          userIds: [],
          teamIds: ["50000000-0000-4000-8000-000000000002"],
          creatorTeamIds: [],
          notifiesOwners: false,
        },
      ],
    });
  });

  it("is no rules when there is no list of them", () => {
    expect(OwnerRulePreview.resultFromJSON({})).toEqual({ rules: [] });
    expect(
      OwnerRulePreview.resultFromJSON({ rules: "none" } as JSONObject),
    ).toEqual({ rules: [] });
  });
});
