import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import { OnCallPageResult } from "../../../../Server/Services/OnCallPageService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import MicrosoftTeamsPage, {
  MICROSOFT_TEAMS_PAGE_AS_FIELD,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsPage";
import SlackPageActions, {
  PAGE_FORM_PAGE_AS_FIELD,
} from "../../../../Server/Utils/Workspace/Slack/Actions/Page";
import WorkspacePage, {
  WORKSPACE_PAGE_FORM_TEXT,
  WorkspacePageRecord,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import {
  WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
  WorkspacePageSubject,
} from "../../../../Server/Utils/Workspace/WorkspacePageAbout";
import { WorkspacePageText } from "../../../../Server/Utils/Workspace/WorkspacePageText";
import WorkspaceRecordPeople from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import OnCallPageAs from "../../../../Types/OnCallDutyPolicy/OnCallPageAs";
import { OnCallPageRecordType } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { NotificationRuleInvitee } from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PAGING AS OBSERVERS FROM SLACK AND MICROSOFT TEAMS (OnCallObserverPage).
 *
 * A page about an incident or an alert - from its channel, or its Page
 * Someone - asks "Page them as": Responders, until changed, or Observers,
 * kept informed while the people responding stay on it. The answer says
 * they were paged as observers. People paged as observers are not added to
 * the record's channel by a rule that adds on-call responders: they are
 * kept informed, not pulled into the response.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000001",
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Page them as, on the forms", () => {
  test("Responders first, chosen until changed; Observers second - each saying what it means", () => {
    const dropdown: WorkspaceDropdownBlock = WorkspacePage.getPageAsDropdown({
      blockId: "pageAs",
    });

    expect(dropdown.label).toBe(WORKSPACE_PAGE_FORM_TEXT.pageAsLabel);
    expect(dropdown.initialValue).toBe(OnCallPageAs.Responders);
    expect(dropdown.multiSelect).toBeFalsy();
    expect(
      dropdown.options.map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual([OnCallPageAs.Responders, OnCallPageAs.Observers]);
    expect(dropdown.description).toContain("only says they've seen it");

    // Slack shows 75 characters of an option.
    for (const option of dropdown.options) {
      expect(option.label.length).toBeLessThanOrEqual(75);
    }
  });

  test("opens on Observers when as observers was typed", () => {
    expect(
      WorkspacePage.getPageAsDropdown({
        blockId: "pageAs",
        initialValue: OnCallPageAs.Observers,
      }).initialValue,
    ).toBe(OnCallPageAs.Observers);
  });

  test.each([
    [OnCallPageAs.Observers, OnCallPageAs.Observers],
    [[OnCallPageAs.Observers], OnCallPageAs.Observers],
    [OnCallPageAs.Responders, OnCallPageAs.Responders],
    [undefined, OnCallPageAs.Responders],
    ["something else", OnCallPageAs.Responders],
    [42, OnCallPageAs.Responders],
  ])("a submitted %p reads as %p", (value: unknown, expected: OnCallPageAs) => {
    expect(WorkspacePage.readPageAs(value)).toBe(expected);
  });

  test("Microsoft Teams' card: a compact choice, Responders until changed, with what observers are under it", () => {
    const elements: Array<JSONObject> = MicrosoftTeamsPage.getPageAsElements({
      id: MICROSOFT_TEAMS_PAGE_AS_FIELD,
    });

    expect(elements[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: MICROSOFT_TEAMS_PAGE_AS_FIELD,
      style: "compact",
      isMultiSelect: false,
      value: OnCallPageAs.Responders,
      choices: [
        {
          title: WORKSPACE_PAGE_FORM_TEXT.pageAsResponders,
          value: OnCallPageAs.Responders,
        },
        {
          title: WORKSPACE_PAGE_FORM_TEXT.pageAsObservers,
          value: OnCallPageAs.Observers,
        },
      ],
    });
    expect(elements[1]!["text"]).toBe(WORKSPACE_PAGE_FORM_TEXT.pageAsHint);
  });
});

describe("Slack's Page someone form", () => {
  function blockIds(modal: WorkspaceModalBlock): Array<string> {
    return modal.blocks
      .map((block: WorkspaceMessageBlock): string => {
        return String((block as { blockId?: string }).blockId || "");
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      });
  }

  const record: WorkspacePageRecord = {
    type: OnCallPageRecordType.Incident,
    event: {
      id: RECORD_ID,
      projectId: ObjectID.generate(),
      currentStateId: undefined,
      number: 42,
      numberWithPrefix: "INC-42",
    },
    name: {
      label: "Incident INC-42",
      link: "https://oneuptime.test/dashboard/p/incidents/x",
    },
    title: "Mesh network down",
  } as unknown as WorkspacePageRecord;

  test("about an incident: asks who, then Page them as, then the message", () => {
    const modal: WorkspaceModalBlock = SlackPageActions.getFormModal({
      choices: [],
      prefill: { values: [], message: "", notes: [] },
      about: { record: record } as never,
    });

    expect(blockIds(modal)).toEqual([
      "pageTargets",
      PAGE_FORM_PAGE_AS_FIELD,
      "pageMessage",
    ]);
  });

  test("about something new: no Page them as - somebody has to respond to it", () => {
    const modal: WorkspaceModalBlock = SlackPageActions.getFormModal({
      choices: [],
      prefill: { values: [], message: "", notes: [] },
    });

    expect(blockIds(modal)).not.toContain(PAGE_FORM_PAGE_AS_FIELD);
  });
});

describe("as observers, typed about something new", () => {
  const typed: (pageAs?: OnCallPageAs) => WorkspacePageText = (
    pageAs?: OnCallPageAs,
  ): WorkspacePageText => {
    return {
      people: [{ workspaceUserId: "U1", name: "oversight" }],
      groups: [],
      unknownNames: [],
      message: "Team Y is on it",
      ...(pageAs ? { pageAs: pageAs } : {}),
    };
  };

  const recordChannel: WorkspacePageSubject = {
    record: {
      type: OnCallPageRecordType.Incident,
      event: { id: RECORD_ID },
      name: { label: "Incident INC-42", link: null },
      title: "Mesh network down",
    },
  } as unknown as WorkspacePageSubject;

  test("is refused at once, saying observers are told about something that is there", () => {
    const refusal: string | null = WorkspacePage.getObserverPageRefusal({
      text: typed(OnCallPageAs.Observers),
      about: WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
    });

    expect(refusal).toBe(ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE);
    expect(refusal).toContain("To page about something new, page responders.");
  });

  test("in the channel of a resolved incident, which pages about something new, too", () => {
    expect(
      WorkspacePage.getObserverPageRefusal({
        text: typed(OnCallPageAs.Observers),
        about: {
          record: null,
          resolvedRecord: { label: "Incident INC-42", link: null },
        } as WorkspacePageSubject,
      }),
    ).toBe(ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE);
  });

  test("in an incident's own channel, observers are paged", () => {
    expect(
      WorkspacePage.getObserverPageRefusal({
        text: typed(OnCallPageAs.Observers),
        about: recordChannel,
      }),
    ).toBeNull();
  });

  test("responders - as typed without it - are paged anywhere", () => {
    for (const about of [WORKSPACE_PAGE_NEW_ALERT_SUBJECT, recordChannel]) {
      expect(
        WorkspacePage.getObserverPageRefusal({ text: typed(), about: about }),
      ).toBeNull();
      expect(
        WorkspacePage.getObserverPageRefusal({
          text: typed(OnCallPageAs.Responders),
          about: about,
        }),
      ).toBeNull();
    }
  });
});

describe("what the person who paged is told", () => {
  function result(isObserverPage: boolean): OnCallPageResult {
    return {
      record: {
        type: OnCallPageRecordType.Incident,
        id: RECORD_ID,
        label: "Incident INC-42",
        url: URL.fromString("https://oneuptime.test/i"),
        isNew: false,
      },
      paged: [
        {
          userId: ObjectID.generate(),
          name: "Nitin",
          teamName: "Oversight",
        },
      ],
      startedPolicies: [
        { onCallDutyPolicyId: ObjectID.generate(), name: "Leadership" },
      ],
      notPaged: [],
      isAnyonePaged: true,
      directPageExecutionLogId: null,
      isObserverPage: isObserverPage,
      summary: "",
    } as unknown as OnCallPageResult;
  }

  test("paged as observers: says so, for the people and the policies", () => {
    const answer: { markdown: string; text: string } =
      WorkspacePage.getPagedAnswer({
        result: result(true),
        message: "Team Y is on it",
        isShownAtPlace: false,
        canBeShownAtPlace: false,
      });

    expect(answer.markdown).toContain("👀 Paged");
    expect(answer.markdown).toContain("as observers about");
    expect(answer.markdown).toContain("“Team Y is on it”");
    expect(answer.markdown).toContain("as observers too.");
    expect(answer.text).toContain("as observers about Incident INC-42");
  });

  test("paged as responders: as before", () => {
    const answer: { markdown: string; text: string } =
      WorkspacePage.getPagedAnswer({
        result: result(false),
        message: "",
        isShownAtPlace: false,
        canBeShownAtPlace: false,
      });

    expect(answer.markdown).toContain("📟 Paged");
    expect(answer.markdown).not.toContain("observers");
  });
});

describe("a rule that adds on-call responders to the record's channel", () => {
  function pagedAs(
    userId: ObjectID,
    isObserverPage: boolean | undefined,
  ): UserOnCallLog {
    const row: UserOnCallLog = new UserOnCallLog();
    row.userId = userId;

    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    if (isObserverPage !== undefined) {
      run.isObserverPage = isObserverPage;
    }

    row.onCallDutyPolicyExecutionLog = run;
    return row;
  }

  test("adds the people paged to respond, and not those paged as observers", async () => {
    const responder: ObjectID = ObjectID.generate();
    const observer: ObjectID = ObjectID.generate();
    const both: ObjectID = ObjectID.generate();

    let select: JSONObject = {};

    jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockImplementation((async (data: { select: JSONObject }) => {
        select = data.select;

        return [
          pagedAs(responder, false),
          pagedAs(observer, true),
          // Paged as an observer by one run, and to respond by another.
          pagedAs(both, true),
          pagedAs(both, undefined),
        ];
      }) as never);

    const ids: Array<string> = (
      await WorkspaceRecordPeople.getUserIds({
        record: { incidentId: RECORD_ID },
        invitee: NotificationRuleInvitee.OnCallResponders,
      })
    ).map((id: ObjectID): string => {
      return id.toString();
    });

    expect(ids.sort()).toEqual([responder.toString(), both.toString()].sort());
    expect(select).toMatchObject({
      onCallDutyPolicyExecutionLog: { isObserverPage: true },
    });
  });
});
