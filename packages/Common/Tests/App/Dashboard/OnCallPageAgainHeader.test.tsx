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
  PAGE_AGAIN_TEXT,
  acknowledgePagesAgain,
  getPageAgainAcknowledgeRoute,
  hasPageAgain,
  readOpenPages,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnOutcome,
  OnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * A PAGE AGAIN ON A RECORD'S PAGE (issue #5123).
 *
 * A policy whose acknowledgement timeout ran out pages again about a record
 * somebody acknowledged earlier (OnCallAcknowledgementTimeout). The record is
 * acknowledged, so its own Acknowledge is not in its header - which left the
 * person paged again, opening it from their push, with Escalate and no way
 * to say "still on it". They get an Acknowledge of their own, first, beside
 * Escalate: it answers their page, as its link, a call's 1 or a text would.
 * Nobody else sees it, and a page that is not a page again never shows it.
 *
 * The header is the real EventStatusPanel; only the server is replaced, at
 * API.get / API.post.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "6e1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);

const STATES: Array<EventStateItem> = [
  { id: "created", name: "Created", color: new Color("#64748b") },
  { id: "acknowledged", name: "Acknowledged", color: new Color("#f59e0b") },
  { id: "resolved", name: "Resolved", color: new Color("#10b981") },
];

function preview(): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Payments",
    rule: { order: 2, name: "Platform leads" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 2,
  };
}

function openPage(isPageAgain: boolean): JSONObject {
  return {
    executionLogId: "6e1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e60",
    preview: preview() as unknown as JSONObject,
    ...(isPageAgain ? { isPageAgain: true } : {}),
  };
}

type ServerAnswer = JSONObject | "fail";

let getAnswers: Array<ServerAnswer>;
let postAnswers: Array<ServerAnswer>;
let gets: Array<string>;
let posts: Array<string>;

function answerFrom(next: ServerAnswer): HTTPResponse<JSONObject> {
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
    return answerFrom(getAnswers.shift() || { pages: [] });
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: { url: URL }) => {
    posts.push(args.url.toString());
    return answerFrom(postAnswers.shift() || { acknowledged: 0 });
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
};

interface HeaderProps {
  onPassedOn?: () => void;
  onControls?: (controls: PassOnPageControls) => void;
}

// An acknowledged incident's header: Resolve, then the person's own actions.
function Header(props: HeaderProps): ReactElement {
  const passOn: PassOnPageControls = usePassOnPage({
    recordType: OnCallPageRecordType.Incident,
    recordId: RECORD_ID,
    onPassedOn: props.onPassedOn,
  });

  props.onControls?.(passOn);

  return (
    <div>
      <EventStatusPanel
        stateList={StateListType.IncidentState}
        states={STATES}
        identifier="INC-42"
        currentStateId="acknowledged"
        actions={[]}
        onActionClick={(): void => {}}
        onStateSelect={(): void => {}}
        secondaryActions={[...passOn.actions]}
      />
      {passOn.dialog}
    </div>
  );
}

function headerButton(name: string): HTMLElement | null {
  return within(
    screen.getByRole("group", { name: "Event actions" }),
  ).queryByRole("button", { name: name });
}

describe("the record's header, for the person paged again", () => {
  test("has Acknowledge first, then Escalate", async () => {
    const latest: { controls?: PassOnPageControls } = {};
    getAnswers.push({
      pages: [openPage(true)] as unknown as JSONObject["pages"],
    });

    render(
      <Header
        onControls={(controls: PassOnPageControls): void => {
          latest.controls = controls;
        }}
      />,
    );
    await flush();

    expect(
      latest.controls!.actions.map(
        (action: {
          id: string;
          label: string;
          icon?: IconProp | undefined;
        }) => {
          return [action.id, action.label, action.icon];
        },
      ),
    ).toEqual([
      ["acknowledge-page-again", "Acknowledge", IconProp.Check],
      ["pass-on-page", "Escalate", IconProp.ArrowCircleUp],
    ]);

    const acknowledge: HTMLElement = headerButton("Acknowledge")!;
    const escalate: HTMLElement = headerButton("Escalate")!;

    expect(
      acknowledge.compareDocumentPosition(escalate) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Acknowledge answers their page in one step, tells the page, and goes", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push({
      pages: [openPage(true)] as unknown as JSONObject["pages"],
    });
    postAnswers.push({ acknowledged: 1 });
    // Read again afterwards: not paged any more.
    getAnswers.push({ pages: [] });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    await act(async () => {
      fireEvent.click(headerButton("Acknowledge")!);
    });
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(
      `/on-call-page/acknowledge/incident/${RECORD_ID.toString()}`,
    );
    // No dialog: answering a page is one step on every channel.
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(onPassedOn).toHaveBeenCalledTimes(1);
    expect(gets).toHaveLength(2);
    expect(headerButton("Acknowledge")).toBeNull();
    expect(headerButton("Escalate")).toBeNull();
  });

  test("an answer of none - answered elsewhere already - tells the page nothing", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push({
      pages: [openPage(true)] as unknown as JSONObject["pages"],
    });
    postAnswers.push({ acknowledged: 0 });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    await act(async () => {
      fireEvent.click(headerButton("Acknowledge")!);
    });
    await flush();

    expect(onPassedOn).not.toHaveBeenCalled();
    expect(gets).toHaveLength(2);
  });

  test("a failure says so, and nothing else changes", async () => {
    getAnswers.push({
      pages: [openPage(true)] as unknown as JSONObject["pages"],
    });
    postAnswers.push("fail");

    render(<Header />);
    await flush();

    await act(async () => {
      fireEvent.click(headerButton("Acknowledge")!);
    });
    await flush();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    expect(dialog).toHaveTextContent(
      "Could not acknowledge. Please try again.",
    );
    expect(headerButton("Acknowledge")).not.toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});

describe("the record's header, for everybody else", () => {
  test("a page that is not a page again: Escalate alone, as before", async () => {
    getAnswers.push({
      pages: [openPage(false)] as unknown as JSONObject["pages"],
    });

    render(<Header />);
    await flush();

    expect(headerButton("Escalate")).not.toBeNull();
    expect(headerButton("Acknowledge")).toBeNull();
  });

  test("not paged at all: nothing", async () => {
    render(<Header />);
    await flush();

    expect(headerButton("Escalate")).toBeNull();
    expect(headerButton("Acknowledge")).toBeNull();
  });
});

describe("the server's answers, read with care", () => {
  test("an open page is a page again only when the server says so, exactly", () => {
    const pages: Array<OnCallOpenPage> = readOpenPages({
      pages: [
        openPage(true),
        openPage(false),
        { ...openPage(false), isPageAgain: "yes" },
        { ...openPage(false), isPageAgain: 1 },
      ] as unknown as JSONObject["pages"],
    });

    expect(
      pages.map((page: OnCallOpenPage) => {
        return page.isPageAgain === true;
      }),
    ).toEqual([true, false, false, false]);
    expect("isPageAgain" in pages[1]!).toBe(false);
    expect(hasPageAgain(pages)).toBe(true);
    expect(hasPageAgain(pages.slice(1))).toBe(false);
  });

  test("the route names the record's type and id", () => {
    expect(
      getPageAgainAcknowledgeRoute({
        recordType: OnCallPageRecordType.AlertEpisode,
        recordId: RECORD_ID,
      }),
    ).toBe(`/on-call-page/acknowledge/alert-episode/${RECORD_ID.toString()}`);
  });

  test("acknowledging reads how many, and anything else as none", async () => {
    for (const [answer, expected] of [
      [{ acknowledged: 2 }, 2],
      [{ acknowledged: 0 }, 0],
      [{ acknowledged: "2" }, 0],
      [{}, 0],
    ] as Array<[JSONObject, number]>) {
      postAnswers.push(answer);

      await expect(
        acknowledgePagesAgain({
          recordType: OnCallPageRecordType.Incident,
          recordId: RECORD_ID,
        }),
      ).resolves.toBe(expected);
    }
  });

  test("an answer that is not a success is an error", async () => {
    postAnswers.push("fail");

    await expect(
      acknowledgePagesAgain({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeDefined();
  });

  test("the words are the button's and one plain failure", () => {
    expect(PAGE_AGAIN_TEXT).toEqual({
      button: "Acknowledge",
      failed: "Could not acknowledge. Please try again.",
    });
  });
});
