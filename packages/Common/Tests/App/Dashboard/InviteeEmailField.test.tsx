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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN INVITATION'S EMAIL BOX THAT SUGGESTS PEOPLE (#9701).
 *
 * Invite New Team Member and Invite New User draw their email row with
 * InviteeEmailField: the form's own text box, as a combobox. Here:
 *
 *   - two letters or more ask the server once the typing stops, for the
 *     team the invitation is for; fewer ask nothing; an older answer that
 *     arrives late is dropped;
 *   - each suggestion is a person by name and address, with where they
 *     stand: Invited, Not in this project yet, and - listed, never offered
 *     - Already in this team or Already invited to this team;
 *   - a click or Enter on one fills their address in and closes the list;
 *     the arrow keys skip those not offered; Escape closes the list, marked
 *     handled so the dialog behind stays open;
 *   - typing any address works as before: every key reaches the form, and
 *     a failed read suggests nobody;
 *   - the error under the box is the form's, and the box is named by its
 *     label and described by its help.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import InviteeEmailField, {
  ALREADY_INVITED_TO_THIS_TEAM_TEXT,
  ALREADY_IN_THIS_TEAM_TEXT,
  INVITED_TEXT,
  INVITE_SUGGESTIONS_DEBOUNCE_IN_MS,
  NOT_IN_THIS_PROJECT_YET_TEXT,
  getNextPickableIndex,
  getStandingWords,
} from "../../../UI/Components/InviteeEmailField/InviteeEmailField";
import {
  getInviteeEmailError,
  readFormTeamId,
} from "../../../UI/Components/InviteeEmailField/InviteeEmailFormField";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  toInviteSuggestionsAnswerJSON,
} from "../../../Types/Team/InviteSuggestions";

const TEAM_ID: string = "22222222-2222-4222-8222-222222222222";

const ADA: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@acme.test",
  standing: InviteSuggestionStanding.Member,
};
const ADAM: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Adam Smith",
  email: "adam@acme.test",
  standing: InviteSuggestionStanding.InThisTeam,
};
const ADDIE: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "",
  email: "addie@acme.test",
  standing: InviteSuggestionStanding.Invited,
};
const ADRIAN: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000004",
  name: "Adrian",
  email: "adrian@other.test",
  standing: InviteSuggestionStanding.NotInProject,
};
const ADELE: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000005",
  name: "Adele",
  email: "adele@acme.test",
  standing: InviteSuggestionStanding.InvitedToThisTeam,
};

function answer(people: Array<InviteSuggestion>): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    toInviteSuggestionsAnswerJSON(people),
    {},
  );
}

interface Rendered {
  onChange: MockFunction;
  onEnterPress: MockFunction;
  onPick: MockFunction;
  input: HTMLInputElement;
}

function renderField(
  props: { teamId?: string | null; error?: string } = {},
): Rendered {
  const onChange: MockFunction = getJestMockFunction();
  const onEnterPress: MockFunction = getJestMockFunction();
  const onPick: MockFunction = getJestMockFunction();

  render(
    <div>
      <label id="email-label">Email</label>
      <p id="email-help">We email them an invitation to this team.</p>
      <InviteeEmailField
        onChange={(email: string) => {
          onChange(email);
        }}
        onEnterPress={() => {
          onEnterPress();
        }}
        onPick={(suggestion: InviteSuggestion) => {
          onPick(suggestion);
        }}
        teamId={props.teamId === undefined ? TEAM_ID : props.teamId}
        error={props.error}
        placeholder="member@company.com"
        ariaLabelledby="email-label"
        ariaDescribedby="email-help"
        dataTestId="invitee-email"
      />
    </div>,
  );

  return {
    onChange: onChange,
    onEnterPress: onEnterPress,
    onPick: onPick,
    input: screen.getByTestId("invitee-email") as HTMLInputElement,
  };
}

// Types into the box and lets the wait before asking run out.
async function type(input: HTMLInputElement, text: string): Promise<void> {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });

  await act(async () => {
    jest.advanceTimersByTime(INVITE_SUGGESTIONS_DEBOUNCE_IN_MS + 10);
  });

  // The answer, once it is in.
  await act(async () => {
    await Promise.resolve();
  });
}

function options(): Array<HTMLElement> {
  return screen.queryAllByTestId("invitee-suggestion");
}

beforeEach(() => {
  jest.useFakeTimers();
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return answer([ADA, ADAM, ADDIE, ADRIAN, ADELE]);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what it asks", () => {
  test("two letters or more: the server, once the typing stops, for the team", async () => {
    const { input } = renderField();

    await type(input, " ad ");

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };

    expect(request.url.toString()).toContain(INVITE_SUGGESTIONS_ROUTE);
    expect(request.data).toEqual({ text: "ad", teamId: TEAM_ID });
  });

  test("no team known: for the project", async () => {
    const { input } = renderField({ teamId: null });

    await type(input, "ada");

    expect((postMock.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      text: "ada",
    });
  });

  test("one letter asks nothing, and shows nothing", async () => {
    const { input } = renderField();

    await type(input, "a");

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
  });

  test("keys typed in a run ask once, for the last text", async () => {
    const { input } = renderField();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ad" } });
    fireEvent.change(input, { target: { value: "ada" } });
    fireEvent.change(input, { target: { value: "ada@" } });

    await act(async () => {
      jest.advanceTimersByTime(INVITE_SUGGESTIONS_DEBOUNCE_IN_MS + 10);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(
      (postMock.mock.calls[0]![0] as { data: JSONObject }).data["text"],
    ).toBe("ada@");
  });

  test("an answer for an older text, arriving late, is dropped", async () => {
    let answerOld: (response: HTTPResponse<JSONObject>) => void = () => {
      return undefined;
    };

    postMock.mockImplementationOnce(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          answerOld = resolve;
        },
      );
    });
    postMock.mockImplementationOnce(async () => {
      return answer([ADRIAN]);
    });

    const { input } = renderField();

    await type(input, "ad");
    await type(input, "adri");

    await act(async () => {
      answerOld(answer([ADA]));
      await Promise.resolve();
    });

    expect(
      options().map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([expect.stringContaining("Adrian")]);
  });

  test("a read that fails suggests nobody, and the box goes on taking what is typed", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(403, { message: "No." }, {});
    });

    const { input, onChange } = renderField();

    await type(input, "new.person@acme.test");

    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("new.person@acme.test");
    expect(input.value).toBe("new.person@acme.test");
  });
});

describe("what it lists", () => {
  test("each person by name and address, with where they stand", async () => {
    const { input } = renderField();

    await type(input, "ad");

    const listed: Array<HTMLElement> = options();

    expect(listed).toHaveLength(5);
    expect(listed[0]).toHaveTextContent("Ada Lovelace");
    expect(listed[0]).toHaveTextContent("ada@acme.test");
    // A member needs no word.
    expect(
      within(listed[0]!).queryByTestId("invitee-suggestion-standing"),
    ).toBeNull();
    expect(listed[1]).toHaveTextContent(ALREADY_IN_THIS_TEAM_TEXT);
    // A person with no name yet, by their address alone.
    expect(listed[2]).toHaveTextContent("addie@acme.test");
    expect(listed[2]).toHaveTextContent(INVITED_TEXT);
    expect(listed[3]).toHaveTextContent(NOT_IN_THIS_PROJECT_YET_TEXT);
    expect(listed[4]).toHaveTextContent(ALREADY_INVITED_TO_THIS_TEAM_TEXT);
  });

  test("those the team has already are listed, and are no button: nothing presses them", async () => {
    const { input } = renderField();

    await type(input, "ad");

    for (const option of options()) {
      const standing: string | null = option.getAttribute("data-standing");
      const isOffered: boolean =
        standing !== InviteSuggestionStanding.InThisTeam &&
        standing !== InviteSuggestionStanding.InvitedToThisTeam;

      expect({ standing, tag: option.tagName }).toEqual({
        standing,
        tag: isOffered ? "BUTTON" : "DIV",
      });
      expect(option.getAttribute("aria-disabled")).toBe(
        isOffered ? null : "true",
      );
    }
  });

  test("is a listbox the box controls, named for a screen reader", async () => {
    const { input } = renderField();

    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-labelledby", "email-label");
    expect(input.getAttribute("aria-describedby")).toContain("email-help");

    await type(input, "ad");

    const list: HTMLElement = screen.getByTestId("invitee-suggestions");

    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("aria-label", "People you can invite");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
  });
});

describe("picking", () => {
  test("a click fills the address in, and closes the list", async () => {
    const { input, onChange } = renderField();

    await type(input, "ad");
    fireEvent.click(options()[3]!);

    expect(onChange).toHaveBeenLastCalledWith("adrian@other.test");
    expect(input.value).toBe("adrian@other.test");
    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
  });

  test("a click on someone the team has already does nothing", async () => {
    const { input, onChange, onPick } = renderField();

    await type(input, "ad");
    fireEvent.click(options()[1]!);

    expect(onChange).toHaveBeenLastCalledWith("ad");
    expect(onPick).not.toHaveBeenCalled();
    expect(input.value).toBe("ad");
    expect(screen.getByTestId("invitee-suggestions")).toBeInTheDocument();
  });

  /*
   * #9745: a pick tells the form who it is, after the address is in, so
   * the form asks no name for someone with an account (InviteeName).
   */
  test("a pick tells the form who was picked, after the address is filled in", async () => {
    const { input, onChange, onPick } = renderField();

    await type(input, "ad");

    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(options()[3]!);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ADRIAN);
    expect(onChange).toHaveBeenLastCalledWith(ADRIAN.email);
    expect(
      onChange.mock.invocationCallOrder[onChange.mock.calls.length - 1]!,
    ).toBeLessThan(onPick.mock.invocationCallOrder[0]!);
  });

  test("typing an address tells the form of no pick, even one a suggestion has", async () => {
    const { input, onPick } = renderField();

    await type(input, ADA.email);

    expect(onPick).not.toHaveBeenCalled();
  });

  test("the arrow keys skip those not offered, and Enter picks, never submitting the form", async () => {
    const { input, onChange } = renderField();

    await type(input, "ad");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]!.id);

    // Adam is in the team already: the next offered is Addie.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[2]!.id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[3]!.id);

    // Adele is invited to the team already: round to Ada.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]!.id);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[3]!.id);

    const enter: boolean = fireEvent.keyDown(input, { key: "Enter" });

    // Handled: the form's Enter does not submit it.
    expect(enter).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith("adrian@other.test");
  });

  test("Enter with no suggestion picked out is the form's own: it invites", async () => {
    const { input, onEnterPress } = renderField();

    await type(input, "new.person@acme.test");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEnterPress).toHaveBeenCalledTimes(1);
  });

  test("Enter on a suggestion picks it, and does not invite yet", async () => {
    const { input, onChange, onEnterPress } = renderField();

    await type(input, "ad");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenLastCalledWith("ada@acme.test");
    expect(onEnterPress).not.toHaveBeenCalled();

    // The list is closed: the next Enter invites.
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEnterPress).toHaveBeenCalledTimes(1);
  });

  test("Escape closes the list, handled, so the dialog behind stays open", async () => {
    const { input } = renderField();

    await type(input, "ad");

    const escape: boolean = fireEvent.keyDown(input, { key: "Escape" });

    expect(escape).toBe(false);
    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
  });

  test("with the list closed, Escape is the dialog's", async () => {
    const { input } = renderField();

    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true);
  });
});

describe("the box", () => {
  test("says the form's error under it", () => {
    renderField({ error: "Email is not valid." });

    expect(screen.getByText("Email is not valid.")).toBeInTheDocument();
    expect(screen.getByTestId("invitee-email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("leaves the browser's own list of addresses out", () => {
    const { input } = renderField();

    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("type", "email");
  });
});

describe("the words and the keys", () => {
  test("each standing's words; a member's none", () => {
    expect(getStandingWords(InviteSuggestionStanding.Member)).toBeNull();
    expect(getStandingWords(InviteSuggestionStanding.Invited)?.text).toBe(
      "Invited",
    );
    expect(getStandingWords(InviteSuggestionStanding.InThisTeam)?.text).toBe(
      "Already in this team",
    );
    expect(
      getStandingWords(InviteSuggestionStanding.InvitedToThisTeam)?.text,
    ).toBe("Already invited to this team");
    expect(getStandingWords(InviteSuggestionStanding.NotInProject)?.text).toBe(
      "Not in this project yet",
    );
  });

  test("the arrow keys find nobody where nobody is offered", () => {
    expect(
      getNextPickableIndex({ suggestions: [ADAM, ADELE], from: -1, step: 1 }),
    ).toBe(-1);
    expect(
      getNextPickableIndex({ suggestions: [ADAM, ADA], from: -1, step: 1 }),
    ).toBe(1);
  });
});

describe("the form's row", () => {
  test("an address that is not one is said, in the form's words; none typed is the required check's", () => {
    expect(getInviteeEmailError({ email: "ada@" } as never)).toBe(
      "Email is not valid.",
    );
    expect(getInviteeEmailError({ email: " ada@acme.test " } as never)).toBe(
      null,
    );
    expect(getInviteeEmailError({ email: "" } as never)).toBe(null);
    expect(getInviteeEmailError({} as never)).toBe(null);
  });

  test("the Team row's pick is read as an id, however the dropdown keeps it", () => {
    expect(readFormTeamId(TEAM_ID)).toBe(TEAM_ID);
    expect(readFormTeamId(new ObjectID(TEAM_ID))).toBe(TEAM_ID);
    expect(readFormTeamId({ _id: TEAM_ID })).toBe(TEAM_ID);
    expect(readFormTeamId({ value: TEAM_ID, label: "Platform" })).toBe(TEAM_ID);
    expect(readFormTeamId("Platform")).toBeNull();
    expect(readFormTeamId(undefined)).toBeNull();
    expect(readFormTeamId([TEAM_ID])).toBeNull();
  });
});
