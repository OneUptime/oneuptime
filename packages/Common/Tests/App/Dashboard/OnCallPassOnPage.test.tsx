import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import React, { ReactElement } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  describePassOnAnswers,
  describePassOnPreview,
  describePassOnRefusal,
  describePassOnResult,
  fetchOpenPages,
  getPassOnPageRoute,
  isAnyPassedOn,
  passOnPages,
  readOpenPages,
  readPassOnAnswers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_PASS_ON_ROUTE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * "PASS IT ON" ON A RECORD'S PAGE, IN ENGLISH.
 *
 * The person an on-call policy is paging about an incident, an alert or an
 * episode can pass the page on from the record's header: the policy pages
 * its next escalation rule now instead of waiting the rule out. The button
 * is there only for them. It asks first, saying what passing on will do,
 * and then says what it did - or why it could not (somebody acknowledged it
 * meanwhile, the page is over).
 *
 * The header is the real EventStatusPanel and the dialog the real
 * ConfirmModal; only the server is replaced, at API.get / API.post. The
 * words in another language are in OnCallPassOnPageGerman.test.tsx.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "4c1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "5d2e8f3b-6c40-4f7b-8d9e-1b2c3d4e5f60",
);

const ENGLISH: Translator = createTranslator(undefined, "en");

function result(overrides: Partial<OnCallPassOnResult>): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Critical",
    rule: { order: 2, name: "Level 2" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 3,
    ...overrides,
  };
}

function page(overrides: Partial<OnCallPassOnResult>): OnCallOpenPage {
  return {
    executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
    preview: result(overrides),
  };
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what passing on will do, and did", () => {
  test("the next rule, before: paged right away, without waiting", () => {
    expect(describePassOnResult(result({}), ENGLISH)).toBe(
      "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
    );
  });

  test("the next rule, after: who it is paging now", () => {
    expect(
      describePassOnResult(
        result({ isPreview: false, pagedNames: ["Bob Smith", "Carl Diaz"] }),
        ENGLISH,
      ),
    ).toBe(
      "Escalation rule 2 of 3 (Level 2) is paging Bob Smith and Carl Diaz now.",
    );
  });

  test("three people are one list, joined the English way", () => {
    expect(
      describePassOnResult(
        result({
          isPreview: false,
          pagedNames: ["Ana Lopez", "Bob Smith", "Carl Diaz"],
        }),
        ENGLISH,
      ),
    ).toBe(
      "Escalation rule 2 of 3 (Level 2) is paging Ana Lopez, Bob Smith and Carl Diaz now.",
    );
  });

  test("the next rule, after, with nobody named: it is next, and being paged", () => {
    expect(describePassOnResult(result({ isPreview: false }), ENGLISH)).toBe(
      "Escalation rule 2 of 3 (Level 2) is next, and is being paged now.",
    );
  });

  test("a rule the reader may not read is 'the next escalation rule'", () => {
    expect(describePassOnResult(result({ rule: undefined }), ENGLISH)).toBe(
      "The next escalation rule is paged right away, without waiting.",
    );
    expect(
      describePassOnResult(
        result({ rule: undefined, isPreview: false }),
        ENGLISH,
      ),
    ).toBe("The next escalation rule is being paged now.");
  });

  test("a rule without a name is called by its place", () => {
    expect(
      describePassOnResult(result({ rule: { order: 2, name: "  " } }), ENGLISH),
    ).toBe("Escalation rule 2 of 3 (#2) is paged right away, without waiting.");
  });

  test("'2 of 3' never says fewer rules than the rule's own place", () => {
    expect(describePassOnResult(result({ ruleCount: 0 }), ENGLISH)).toBe(
      "Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
    );
  });

  test("the last rule, with Repeat Policy on: the policy starts again", () => {
    expect(
      describePassOnResult(
        result({ outcome: OnCallPassOnOutcome.PolicyStartedAgain }),
        ENGLISH,
      ),
    ).toBe(
      "This is the policy's last escalation rule, so the policy starts again from escalation rule 1 right away.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          isPreview: false,
        }),
        ENGLISH,
      ),
    ).toBe(
      "That was the policy's last escalation rule, so the policy started again from escalation rule 1.",
    );
  });

  test("others on the rule are still paged: one person", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith is still being paged.");
  });

  test("others on the rule are still paged: several people", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith", "Carl Diaz"],
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith and Carl Diaz are still being paged.");
  });

  test("...and when the policy moves on if none of them acknowledges", () => {
    const at: Date = new Date("2026-10-16T09:30:00.000Z");
    const time: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(at);

    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
          nextRule: { order: 3, name: "Managers" },
        }),
        ENGLISH,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, escalation rule 3 of 3 (Managers) is next.`,
    );

    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
        }),
        ENGLISH,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, the policy moves on.`,
    );
  });

  test("a direct page has no rules to move on to: who is still paged, only", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          isDirectPage: true,
          policyName: "",
          rule: undefined,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: new Date("2026-10-16T09:30:00.000Z"),
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith is still being paged.");
  });

  test("the policy moved on already: the rule paging now", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: { order: 3, name: "Managers" },
        }),
        ENGLISH,
      ),
    ).toBe(
      "The policy has moved on already: escalation rule 3 of 3 (Managers) is paging now.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: undefined,
        }),
        ENGLISH,
      ),
    ).toBe(
      "The policy has moved on already: a later escalation rule is paging now.",
    );
  });

  test("nobody left to page: paging stops, and somebody needs to take it", () => {
    expect(
      describePassOnResult(
        result({ outcome: OnCallPassOnOutcome.PagingStopped }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PagingStopped,
          isDirectPage: true,
        }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is being paged: paging stops, and somebody needs to take it.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PagingStopped,
          isPreview: false,
        }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
  });
});

describe("why a page could not be passed on", () => {
  function refused(
    refusal: OnCallPassOnRefusal,
    acknowledgedByName?: string,
  ): OnCallPassOnAnswer {
    return { passedOn: false, refusal, acknowledgedByName };
  }

  test("somebody acknowledged it meanwhile: named, when the reader may see who", () => {
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.RecordAcknowledged, " Ana Lopez "),
        ENGLISH,
      ),
    ).toBe(
      "Ana Lopez acknowledged it already, so there is nothing to pass on.",
    );
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.RecordAcknowledged),
        ENGLISH,
      ),
    ).toBe("Somebody acknowledged it already, so there is nothing to pass on.");
  });

  test("passed on already, the page is over, not paged", () => {
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.AlreadyPassedOn),
        ENGLISH,
      ),
    ).toBe("You passed this page on already.");
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.PageOver), ENGLISH),
    ).toBe("This page is over: the on-call policy has stopped paging.");
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.NotPaged), ENGLISH),
    ).toBe("You are not being paged about this right now.");
  });

  test("a link's refusal never reaches the Dashboard as 'the link expired'", () => {
    // The Dashboard passes on by the signed-in account, never by a link.
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.InvalidLink), ENGLISH),
    ).toBe("You are not being paged about this right now.");
  });
});

describe("one person, two policies paging them about the same record", () => {
  test("one page: the sentence alone", () => {
    expect(describePassOnPreview([page({})], ENGLISH)).toEqual([
      "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
    ]);
  });

  test("two pages: each sentence says which policy it is about", () => {
    expect(
      describePassOnPreview(
        [
          page({}),
          page({
            policyName: "Database",
            outcome: OnCallPassOnOutcome.OthersStillPaged,
            stillPagedNames: ["Bob Smith"],
          }),
        ],
        ENGLISH,
      ),
    ).toEqual([
      "Critical: Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
      "Database: Bob Smith is still being paged.",
    ]);
  });

  test("a direct page beside a policy's page has no policy to name", () => {
    expect(
      describePassOnPreview(
        [
          page({}),
          page({
            policyName: "",
            isDirectPage: true,
            rule: undefined,
            outcome: OnCallPassOnOutcome.PagingStopped,
          }),
        ],
        ENGLISH,
      ),
    ).toEqual([
      "Critical: Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
      "Nobody else is being paged: paging stops, and somebody needs to take it.",
    ]);
  });

  test("the answers: what each pass did, or why it could not", () => {
    const answers: Array<OnCallPassOnAnswer> = [
      {
        passedOn: true,
        result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
      },
      { passedOn: false, refusal: OnCallPassOnRefusal.PageOver },
    ];

    expect(describePassOnAnswers(answers, ENGLISH)).toEqual([
      "Critical: Escalation rule 2 of 3 (Level 2) is paging Carl Diaz now.",
      "This page is over: the on-call policy has stopped paging.",
    ]);
    expect(isAnyPassedOn(answers)).toBe(true);
    expect(isAnyPassedOn([answers[1]!])).toBe(false);
    expect(isAnyPassedOn([])).toBe(false);
  });
});

describe("the server's answers, read with care", () => {
  test("the route names the record's type and id", () => {
    expect(
      getPassOnPageRoute({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).toBe(`/on-call-page/pass-on/incident/${RECORD_ID.toString()}`);
    expect(
      getPassOnPageRoute({
        recordType: OnCallPageRecordType.AlertEpisode,
        recordId: RECORD_ID,
      }),
    ).toBe(
      `${ON_CALL_PAGE_PASS_ON_ROUTE}/alert-episode/${RECORD_ID.toString()}`,
    );
  });

  test("open pages: a time comes back a date, and anything malformed is left out", () => {
    const pages: Array<OnCallOpenPage> = readOpenPages({
      pages: [
        {
          executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
          preview: {
            ...result({ outcome: OnCallPassOnOutcome.OthersStillPaged }),
            nextStepAt: "2026-10-16T09:30:00.000Z",
          },
        },
        null,
        { executionLogId: "a1b2c3d4-0000-4000-8000-000000000002" },
        { executionLogId: 7, preview: result({}) },
        "page",
      ],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(
      "a1b2c3d4-0000-4000-8000-000000000001",
    );
    expect(pages[0]!.preview.nextStepAt).toEqual(
      new Date("2026-10-16T09:30:00.000Z"),
    );
  });

  test("open pages: no list at all is no page", () => {
    expect(readOpenPages({})).toEqual([]);
    expect(readOpenPages(undefined)).toEqual([]);
    expect(readOpenPages({ pages: "none" })).toEqual([]);
  });

  test("answers: passedOn is a yes or a no, and the result's time a date", () => {
    const answers: Array<OnCallPassOnAnswer> = readPassOnAnswers({
      answers: [
        {
          passedOn: 1,
          result: {
            ...result({ outcome: OnCallPassOnOutcome.OthersStillPaged }),
            nextStepAt: "2026-10-16T09:30:00.000Z",
          },
        },
        { refusal: OnCallPassOnRefusal.PageOver },
        null,
      ],
    });

    expect(answers).toHaveLength(2);
    expect(answers[0]!.passedOn).toBe(true);
    expect(answers[0]!.result!.nextStepAt).toEqual(
      new Date("2026-10-16T09:30:00.000Z"),
    );
    expect(answers[1]!.passedOn).toBe(false);
    expect(answers[1]!.result).toBeUndefined();
    expect(readPassOnAnswers({ answers: {} })).toEqual([]);
  });
});

describe("asking the server", () => {
  let requests: Array<{ method: string; url: string; headers: unknown }>;

  beforeEach(() => {
    requests = [];

    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" });
  });

  test("the open pages are read at the record's route, with the project", async () => {
    jest.spyOn(API, "get").mockImplementation((async (args: {
      url: URL;
      headers: unknown;
    }) => {
      requests.push({
        method: "GET",
        url: args.url.toString(),
        headers: args.headers,
      });
      return new HTTPResponse<JSONObject>(
        200,
        { pages: [page({})] as unknown as JSONObject["pages"] },
        {},
      );
    }) as never);

    const pages: Array<OnCallOpenPage> = await fetchOpenPages({
      recordType: OnCallPageRecordType.IncidentEpisode,
      recordId: RECORD_ID,
    });

    expect(pages).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(
      new globalThis.URL(requests[0]!.url).pathname.endsWith(
        `/on-call-page/pass-on/incident-episode/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
    expect(requests[0]!.headers).toEqual({ tenantid: "project-1" });
  });

  test("passing on is a POST to the same route", async () => {
    jest.spyOn(API, "post").mockImplementation((async (args: {
      url: URL;
      headers: unknown;
    }) => {
      requests.push({
        method: "POST",
        url: args.url.toString(),
        headers: args.headers,
      });
      return new HTTPResponse<JSONObject>(
        200,
        {
          answers: [
            { passedOn: true, result: result({ isPreview: false }) },
          ] as unknown as JSONObject["answers"],
        },
        {},
      );
    }) as never);

    const answers: Array<OnCallPassOnAnswer> = await passOnPages({
      recordType: OnCallPageRecordType.Alert,
      recordId: RECORD_ID,
    });

    expect(answers[0]!.passedOn).toBe(true);
    expect(requests).toEqual([expect.objectContaining({ method: "POST" })]);
    expect(
      new globalThis.URL(requests[0]!.url).pathname.endsWith(
        `/on-call-page/pass-on/alert/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
  });

  test("an answer that is not a success is an error, not 'not paged'", async () => {
    jest.spyOn(API, "get").mockImplementation((async () => {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }) as never);
    jest.spyOn(API, "post").mockImplementation((async () => {
      return new HTTPErrorResponse(403, { message: "Forbidden" }, {});
    }) as never);

    await expect(
      fetchOpenPages({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    await expect(
      passOnPages({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("in a record's header", () => {
  type ServerAnswer = JSONObject | "fail" | Promise<JSONObject | "fail">;

  let getAnswers: Array<ServerAnswer>;
  let postAnswers: Array<ServerAnswer>;
  let gets: Array<string>;
  let posts: Array<string>;

  const STATES: Array<EventStateItem> = [
    { id: "created", name: "Created", color: new Color("#64748b") },
    { id: "acknowledged", name: "Acknowledged", color: new Color("#f59e0b") },
    { id: "resolved", name: "Resolved", color: new Color("#10b981") },
  ];

  function answerFrom(next: JSONObject | "fail"): HTTPResponse<JSONObject> {
    if (next === "fail") {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }

    return new HTTPResponse<JSONObject>(200, next, {});
  }

  beforeEach(() => {
    getAnswers = [];
    postAnswers = [];
    gets = [];
    posts = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

    jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
      gets.push(args.url.toString());
      return answerFrom(await (getAnswers.shift() || { pages: [] }));
    }) as never);

    jest.spyOn(API, "post").mockImplementation((async (args: { url: URL }) => {
      posts.push(args.url.toString());
      return answerFrom(await (postAnswers.shift() || { answers: [] }));
    }) as never);
  });

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  const pagedAbout: (overrides?: Partial<OnCallPassOnResult>) => JSONObject = (
    overrides?: Partial<OnCallPassOnResult>,
  ): JSONObject => {
    return {
      pages: [page(overrides || {})] as unknown as JSONObject["pages"],
    };
  };

  const passed: (overrides?: Partial<OnCallPassOnResult>) => JSONObject = (
    overrides?: Partial<OnCallPassOnResult>,
  ): JSONObject => {
    return {
      answers: [
        {
          passedOn: true,
          result: result({
            isPreview: false,
            pagedNames: ["Carl Diaz"],
            ...(overrides || {}),
          }),
        },
      ] as unknown as JSONObject["answers"],
    };
  };

  interface HeaderProps {
    recordType?: OnCallPageRecordType;
    recordId?: ObjectID;
    onPassedOn?: () => void;
    onControls?: (controls: PassOnPageControls) => void;
  }

  // A record page's header as the record pages draw it: the state buttons, then Pass it on.
  function Header(props: HeaderProps): ReactElement {
    const passOn: PassOnPageControls = usePassOnPage({
      recordType: props.recordType || OnCallPageRecordType.Incident,
      recordId: props.recordId || RECORD_ID,
      onPassedOn: props.onPassedOn,
    });

    props.onControls?.(passOn);

    return (
      <div>
        <EventStatusPanel
          stateList={StateListType.IncidentState}
          states={STATES}
          identifier="INC-42"
          currentStateId="created"
          actions={[
            {
              stateId: "acknowledged",
              label: "Acknowledge",
              icon: IconProp.Check,
              buttonStyle: ButtonStyleType.PRIMARY,
              id: "incident-acknowledge-btn",
            },
          ]}
          onActionClick={(): void => {}}
          onStateSelect={(): void => {}}
          secondaryActions={[...passOn.actions]}
        />
        {passOn.dialog}
      </div>
    );
  }

  const passOnButton: () => HTMLElement | null = (): HTMLElement | null => {
    return within(
      screen.getByRole("group", { name: "Event actions" }),
    ).queryByRole("button", { name: "Pass it on" });
  };

  const dialogLines: () => Array<string> = (): Array<string> => {
    const lines: HTMLElement | null =
      screen.queryByTestId("pass-on-preview") ||
      screen.queryByTestId("pass-on-answer");

    return lines
      ? Array.from(lines.querySelectorAll("p")).map(
          (line: HTMLParagraphElement): string => {
            return (line.textContent || "").trim();
          },
        )
      : [];
  };

  test("somebody the policy is not paging sees no button", async () => {
    getAnswers.push({ pages: [] });

    render(<Header />);
    await flush();

    expect(passOnButton()).toBeNull();
    expect(gets).toHaveLength(1);
    expect(gets[0]).toContain(
      `/on-call-page/pass-on/incident/${RECORD_ID.toString()}`,
    );
  });

  test("when the server cannot say, the button stays away and nothing breaks", async () => {
    getAnswers.push("fail");

    render(<Header />);
    await flush();

    expect(passOnButton()).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Acknowledge" },
      ),
    ).toBeInTheDocument();
  });

  test("the person being paged sees Pass it on after the state buttons", async () => {
    const latest: { controls?: PassOnPageControls } = {};

    getAnswers.push(pagedAbout());

    render(
      <Header
        onControls={(passOn: PassOnPageControls): void => {
          latest.controls = passOn;
        }}
      />,
    );

    // Nothing until the server has said so.
    expect(passOnButton()).toBeNull();

    await flush();

    /*
     * One button, with no tooltip: the header shows an action's tooltip only
     * while it is disabled, and the dialog says what passing on does.
     */
    expect(latest.controls!.actions).toEqual([
      {
        id: "pass-on-page",
        label: "Pass it on",
        icon: IconProp.Forward,
        onClick: expect.any(Function),
      },
    ]);

    const button: HTMLElement = passOnButton()!;
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("id", "pass-on-page");

    const acknowledge: HTMLElement = within(
      screen.getByRole("group", { name: "Event actions" }),
    ).getByRole("button", { name: "Acknowledge" });

    expect(
      acknowledge.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("it asks first, saying what passing on will do; Cancel does nothing", async () => {
    getAnswers.push(pagedAbout());

    render(<Header />);
    await flush();

    fireEvent.click(passOnButton()!);

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Pass it on?");
    expect(dialogLines()).toEqual([
      "You won't be paged about it again.",
      "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
    ]);
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Pass it on",
    );

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal-title")).toBeNull();
    expect(posts).toHaveLength(0);
  });

  test("passing on says what it did, tells the page, and the button goes", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push(passed());
    // Read again after passing on: no longer paged.
    getAnswers.push({ pages: [] });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(passOnButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(
      `/on-call-page/pass-on/incident/${RECORD_ID.toString()}`,
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "You passed it on",
    );
    expect(dialogLines()).toEqual([
      "Escalation rule 2 of 3 (Level 2) is paging Carl Diaz now.",
      "You won't be paged about it again.",
    ]);
    expect(onPassedOn).toHaveBeenCalledTimes(1);

    // A notice now: one plain Close, and no Cancel.
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Close",
    );
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();

    expect(gets).toHaveLength(2);
    expect(passOnButton()).toBeNull();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(screen.queryByTestId("modal-title")).toBeNull();
  });

  test("others on the rule still paged: the dialog says who, and when the policy moves on", async () => {
    const at: Date = new Date("2026-10-16T09:30:00.000Z");

    getAnswers.push(
      pagedAbout({
        outcome: OnCallPassOnOutcome.OthersStillPaged,
        stillPagedNames: ["Bob Smith"],
        nextStepAt: at,
        nextRule: { order: 3, name: "Managers" },
      }),
    );

    render(<Header />);
    await flush();

    fireEvent.click(passOnButton()!);

    expect(dialogLines()[1]).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        at,
      )}, escalation rule 3 of 3 (Managers) is next.`,
    );
  });

  test("somebody acknowledged it meanwhile: it says so, and nothing was passed on", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push({
      answers: [
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          acknowledgedByName: "Ana Lopez",
        },
      ] as unknown as JSONObject["answers"],
    });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(passOnButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Pass it on");
    expect(screen.getByTestId("modal-title")).not.toHaveTextContent(
      "You passed it on",
    );
    expect(dialogLines()).toEqual([
      "Ana Lopez acknowledged it already, so there is nothing to pass on.",
    ]);
    expect(onPassedOn).not.toHaveBeenCalled();
  });

  test("a failed request keeps the question open, with an error, so it can be tried again", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push("fail");
    postAnswers.push(passed());

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(passOnButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Pass it on?");
    expect(
      screen.getByText("Could not pass it on. Please try again."),
    ).toBeInTheDocument();
    expect(onPassedOn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toHaveLength(2);
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "You passed it on",
    );
    expect(onPassedOn).toHaveBeenCalledTimes(1);
  });

  test("while it passes on, the dialog shows it is working and cannot be sent twice", async () => {
    let finish: (value: JSONObject) => void = (): void => {};

    getAnswers.push(pagedAbout());
    postAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finish = resolve;
      }),
    );

    render(<Header />);
    await flush();

    fireEvent.click(passOnButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    // The footer's submit is disabled, with a spinner, while the request is out.
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();
    expect(posts).toHaveLength(1);

    finish(passed());
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "You passed it on",
    );
  });

  test("acknowledging from the header reads the page again: no page, no button", async () => {
    const latest: { controls?: PassOnPageControls } = {};

    getAnswers.push(pagedAbout());
    getAnswers.push({ pages: [] });

    render(
      <Header
        onControls={(passOn: PassOnPageControls): void => {
          latest.controls = passOn;
        }}
      />,
    );
    await flush();
    expect(passOnButton()).not.toBeNull();

    // What onActionComplete does on the record pages.
    act(() => {
      latest.controls!.refresh();
    });
    await flush();

    expect(gets).toHaveLength(2);
    expect(passOnButton()).toBeNull();
  });

  test("moving to another record never shows the last record's button", async () => {
    let finishOther: (value: JSONObject) => void = (): void => {};

    getAnswers.push(pagedAbout());
    getAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finishOther = resolve;
      }),
    );

    const view: { rerender: (ui: ReactElement) => void } = render(<Header />);
    await flush();
    expect(passOnButton()).not.toBeNull();

    view.rerender(<Header recordId={OTHER_RECORD_ID} />);
    await flush();

    // Before the other record's answer: no button, not the first record's.
    expect(passOnButton()).toBeNull();
    expect(gets[1]).toContain(OTHER_RECORD_ID.toString());

    finishOther({ pages: [] });
    await flush();
    expect(passOnButton()).toBeNull();
  });

  test("a late answer about the record left behind is ignored", async () => {
    let finishFirst: (value: JSONObject) => void = (): void => {};

    getAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finishFirst = resolve;
      }),
    );
    getAnswers.push({ pages: [] });

    const view: { rerender: (ui: ReactElement) => void } = render(<Header />);
    view.rerender(<Header recordId={OTHER_RECORD_ID} />);
    await flush();

    // The first record's answer arrives last, saying the reader was paged.
    finishFirst(pagedAbout());
    await flush();

    expect(passOnButton()).toBeNull();
  });

  test("each kind of record asks at its own route", async () => {
    for (const recordType of [
      OnCallPageRecordType.Incident,
      OnCallPageRecordType.Alert,
      OnCallPageRecordType.IncidentEpisode,
      OnCallPageRecordType.AlertEpisode,
    ]) {
      getAnswers.push({ pages: [] });
      render(<Header recordType={recordType} />);
      await flush();
      cleanup();
    }

    expect(
      gets.map((url: string): string => {
        return new globalThis.URL(url).pathname.split("/pass-on/")[1]!;
      }),
    ).toEqual([
      `incident/${RECORD_ID.toString()}`,
      `alert/${RECORD_ID.toString()}`,
      `incident-episode/${RECORD_ID.toString()}`,
      `alert-episode/${RECORD_ID.toString()}`,
    ]);
  });

  test("the button's words are the Dashboard's translation keys", () => {
    expect(PASS_ON_PAGE_TEXT).toEqual({
      button: "Pass it on",
      dialogTitle: "Pass it on?",
      notPagedAgain: "You won't be paged about it again.",
      doneTitle: "You passed it on",
      failed: "Could not pass it on. Please try again.",
      passedOnStatus: "Passed On",
    });
  });
});
