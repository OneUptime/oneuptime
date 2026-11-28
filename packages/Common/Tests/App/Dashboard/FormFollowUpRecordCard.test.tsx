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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A form submission's follow-up on the page of the record it created
 * (Components/FormBuilder/FollowUp/FormFollowUpRecordCard): nothing at all
 * for a record no submission created, or one the reader may not read; for
 * the rest, the form, the people following and the conversation, and - for
 * somebody who may edit the record - a reply box, Add Person and Remove,
 * each sent to the follow-up routes. Only the HTTP layer is stubbed.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "c8000000-0000-4000-8000-0000000000aa" };
      },
    },
  };
});

import FormFollowUpRecordCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FollowUp/FormFollowUpRecordCard";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  FormFollowUpAuthor,
  FormFollowUpRecordView,
} from "../../../Types/Form/FormFollowUp";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";

const RECORD_ID: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const JANE_ID: string = "aa2504e0-4f89-41d3-9a0c-0305e82c3301";
const BOB_ID: string = "bb2504e0-4f89-41d3-9a0c-0305e82c3301";

const view: (
  overrides?: Partial<FormFollowUpRecordView>,
) => FormFollowUpRecordView = (
  overrides?: Partial<FormFollowUpRecordView>,
): FormFollowUpRecordView => {
  return {
    submissionId: "cc2504e0-4f89-41d3-9a0c-0305e82c3301",
    formId: "dd2504e0-4f89-41d3-9a0c-0305e82c3301",
    formName: "Support",
    isFollowUpOn: true,
    submittedAt: "2026-11-28T10:00:00.000Z",
    submitterName: "Jane",
    submitterEmail: "jane@example.com",
    people: [
      {
        id: JANE_ID,
        name: "Jane",
        email: "jane@example.com",
        isSubmitter: true,
        addedAt: "2026-11-28T10:00:00.000Z",
      },
      {
        id: BOB_ID,
        email: "bob@example.com",
        isSubmitter: false,
        addedAt: "2026-11-28T10:05:00.000Z",
      },
    ],
    messages: [
      {
        id: "m1",
        createdAt: "2026-11-28T10:10:00.000Z",
        author: FormFollowUpAuthor.Requester,
        authorName: "Jane",
        authorEmail: "jane@example.com",
        text: "Still broken",
        files: [],
      },
      {
        id: "m2",
        createdAt: "2026-11-28T10:20:00.000Z",
        author: FormFollowUpAuthor.Team,
        authorName: "Sam Responder",
        text: "Looking into it",
        files: [],
      },
    ],
    canReply: true,
    maxPeople: 20,
    ...(overrides || {}),
  };
};

let readAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let postAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let gets: Array<Record<string, unknown>> = [];
let posts: Array<Record<string, unknown>> = [];

beforeEach(() => {
  gets = [];
  posts = [];
  readAnswer = new HTTPResponse<JSONObject>(
    200,
    view() as unknown as JSONObject,
    {},
  );
  postAnswer = new HTTPResponse<JSONObject>(
    200,
    view() as unknown as JSONObject,
    {},
  );

  jest.spyOn(API, "get").mockImplementation((async (args: {
    url: { toString: () => string };
  }) => {
    gets.push({ url: args.url.toString() });
    return readAnswer;
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    posts.push({ url: args.url.toString(), data: args.data });
    return postAnswer;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(
  onChanged?: () => void,
  recordType: FormTargetType = FormTargetType.Incident,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <FormFollowUpRecordCard
          recordType={recordType}
          recordId={new ObjectID(RECORD_ID)}
          onChanged={onChanged}
        />
      </MemoryRouter>,
    );
  });
}

async function shown(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByTestId("form-follow-up-record")).toBeInTheDocument();
  });

  return screen.getByTestId("form-follow-up-record");
}

describe("which records it is drawn on", () => {
  test("reads the record's follow-up by its type and id", async () => {
    await renderCard(undefined, FormTargetType.ScheduledMaintenance);
    await shown();

    expect(gets[0]!["url"]).toContain(
      `/form-follow-up/ScheduledMaintenance/${RECORD_ID}`,
    );
  });

  test("draws nothing for a record no submission created, which the server answers with nothing", async () => {
    readAnswer = new HTTPResponse<JSONObject>(200, {}, {});

    await renderCard();

    await waitFor(() => {
      expect(gets).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("form-follow-up-record"),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["the reader may not read the record", 404],
    ["the reader may not read its private notes", 403],
    ["the server failed", 500],
  ])("draws nothing when %s", async (_name: string, status: number) => {
    readAnswer = new HTTPErrorResponse(status, { message: "No" }, {});

    await renderCard();

    await waitFor(() => {
      expect(gets).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("form-follow-up-record"),
    ).not.toBeInTheDocument();
  });
});

describe("what it shows", () => {
  test("the form, the people following and the conversation", async () => {
    await renderCard();
    const card: HTMLElement = await shown();

    expect(within(card).getByText("Support")).toBeInTheDocument();

    const people: HTMLElement = screen.getByTestId(
      "form-follow-up-record-people",
    );

    expect(within(people).getByText("Jane")).toBeInTheDocument();
    expect(within(people).getByText("bob@example.com")).toBeInTheDocument();
    expect(
      within(people).getByText(FormsCopy.followUpSubmitterBadge),
    ).toBeInTheDocument();

    const messages: HTMLElement = screen.getByTestId(
      "form-follow-up-record-messages",
    );

    expect(within(messages).getByText("Still broken")).toBeInTheDocument();
    expect(within(messages).getByText("Looking into it")).toBeInTheDocument();
    expect(
      within(messages).getByText(FormsCopy.followUpTeamBadge),
    ).toBeInTheDocument();
  });

  test("a conversation with nothing in it says so", async () => {
    readAnswer = new HTTPResponse<JSONObject>(
      200,
      view({ messages: [] }) as unknown as JSONObject,
      {},
    );

    await renderCard();
    await shown();

    expect(screen.getByText(FormsCopy.followUpNoMessages)).toBeInTheDocument();
  });

  test("says when the form's follow-ups are off", async () => {
    readAnswer = new HTTPResponse<JSONObject>(
      200,
      view({ isFollowUpOn: false, canReply: false }) as unknown as JSONObject,
      {},
    );

    await renderCard();
    await shown();

    expect(screen.getByTestId("form-follow-up-record-off")).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-follow-up-record-reply"),
    ).not.toBeInTheDocument();
  });

  test("offers no reply, Add Person or Remove to somebody who may not edit the record", async () => {
    readAnswer = new HTTPResponse<JSONObject>(
      200,
      view({ canReply: false }) as unknown as JSONObject,
      {},
    );

    await renderCard();
    await shown();

    expect(
      screen.queryByTestId("form-follow-up-record-reply"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(FormsCopy.followUpAddPerson),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`form-follow-up-remove-${JANE_ID}`),
    ).not.toBeInTheDocument();
  });

  test("offers no Add Person once the request is full", async () => {
    readAnswer = new HTTPResponse<JSONObject>(
      200,
      view({ maxPeople: 2 }) as unknown as JSONObject,
      {},
    );

    await renderCard();
    await shown();

    expect(
      screen.queryByText(FormsCopy.followUpAddPerson),
    ).not.toBeInTheDocument();
  });
});

describe("what it does", () => {
  test("Remove asks first, then takes the person off", async () => {
    postAnswer = new HTTPResponse<JSONObject>(
      200,
      view({ people: [view().people[0]!] }) as unknown as JSONObject,
      {},
    );

    await renderCard();
    await shown();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId(`form-follow-up-remove-${BOB_ID}`));
    });

    expect(posts).toHaveLength(0);
    expect(
      screen.getByText(FormsCopy.followUpRemovePersonDescription),
    ).toBeInTheDocument();

    const confirm: HTMLElement = screen
      .getAllByRole("button", {
        name: FormsCopy.followUpRemovePerson,
      })
      .pop()!;

    await act(async (): Promise<void> => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });

    expect(posts[0]!["url"]).toContain(
      `/form-follow-up/Incident/${RECORD_ID}/people/${BOB_ID}/remove`,
    );

    await waitFor(() => {
      expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument();
    });
  });
});
