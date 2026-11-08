import { describe, expect, test } from "@jest/globals";
import MattermostActionContext, {
  MattermostPressedAction,
  MAX_ACTIONS_PER_CONTEXT,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * Mattermost signs nothing it POSTs to OneUptime: a press of a button
 * carries the user id and team id Mattermost says, and the context
 * OneUptime gave the button. Anybody who can reach the URL could POST any
 * of them, so OneUptime acts only on a context it signed, for the team the
 * press says it came from. These tests forge, tamper with and replay
 * contexts, and pin that each is refused.
 */

const TEAM_ID: string = "t".repeat(26);
const OTHER_TEAM_ID: string = "o".repeat(26);
const INCIDENT_ID: string = "5a1d8e1c-6b2f-4e36-9c1e-0f2a3b4c5d6e";

function buttonContext(
  actionId: string = "AcknowledgeIncident",
  value: string = INCIDENT_ID,
): JSONObject {
  return MattermostActionContext.toContext({
    teamId: TEAM_ID,
    actions: [{ actionId: actionId, value: value }],
  });
}

describe("MattermostActionContext: a button", () => {
  test("its press is read back as the action it was signed with", () => {
    const pressed: MattermostPressedAction | null =
      MattermostActionContext.readPress({
        context: buttonContext(),
        teamId: TEAM_ID,
      });

    expect(pressed).toEqual({
      teamId: TEAM_ID,
      actionId: "AcknowledgeIncident",
      value: INCIDENT_ID,
    });
  });

  test("the context carries the action, its value, the team and a signature", () => {
    const context: JSONObject = buttonContext();

    expect(context["v"]).toBe(1);
    expect(context["teamId"]).toBe(TEAM_ID);
    expect(context["actions"]).toEqual([
      { actionId: "AcknowledgeIncident", value: INCIDENT_ID },
    ]);
    expect(typeof context["signature"]).toBe("string");
    expect((context["signature"] as string).length).toBeGreaterThan(20);
  });

  test("a press from another team is refused, even with a signed context", () => {
    expect(
      MattermostActionContext.readPress({
        context: buttonContext(),
        teamId: OTHER_TEAM_ID,
      }),
    ).toBeNull();
  });

  test("a context whose team was changed to the press's is refused", () => {
    const context: JSONObject = {
      ...buttonContext(),
      teamId: OTHER_TEAM_ID,
    };

    expect(
      MattermostActionContext.readPress({
        context: context,
        teamId: OTHER_TEAM_ID,
      }),
    ).toBeNull();
  });

  test.each([
    [
      "its action",
      (context: JSONObject): JSONObject => {
        return {
          ...context,
          actions: [{ actionId: "ResolveIncident", value: INCIDENT_ID }],
        };
      },
    ],
    [
      "its value",
      (context: JSONObject): JSONObject => {
        return {
          ...context,
          actions: [
            {
              actionId: "AcknowledgeIncident",
              value: "11111111-1111-4111-8111-111111111111",
            },
          ],
        };
      },
    ],
    [
      "its signature",
      (context: JSONObject): JSONObject => {
        return { ...context, signature: "A".repeat(43) };
      },
    ],
    [
      "its version",
      (context: JSONObject): JSONObject => {
        return { ...context, v: 2 };
      },
    ],
    [
      "nothing but its signature, removed",
      (context: JSONObject): JSONObject => {
        const copy: JSONObject = { ...context };
        delete copy["signature"];
        return copy;
      },
    ],
  ])(
    "a context with %s changed is refused",
    (_what: string, change: (context: JSONObject) => JSONObject) => {
      expect(
        MattermostActionContext.readPress({
          context: change(buttonContext()),
          teamId: TEAM_ID,
        }),
      ).toBeNull();
    },
  );

  test.each([undefined, null, "context", 42, [], {}])(
    "a context that is %j is refused",
    (context: unknown) => {
      expect(
        MattermostActionContext.readPress({
          context: context,
          teamId: TEAM_ID,
        }),
      ).toBeNull();
    },
  );

  test("a forged context, signed with another key, is refused", () => {
    const forged: JSONObject = {
      v: 1,
      teamId: TEAM_ID,
      actions: [{ actionId: "ResolveIncident", value: INCIDENT_ID }],
      signature: "c2lnbmVkLXdpdGgtYW5vdGhlci1rZXktYnktYW4tYXR0YWNrZXI",
    };

    expect(
      MattermostActionContext.readPress({ context: forged, teamId: TEAM_ID }),
    ).toBeNull();
  });

  test("the same action signed for two teams carries two signatures", () => {
    const one: JSONObject = buttonContext();
    const other: JSONObject = MattermostActionContext.toContext({
      teamId: OTHER_TEAM_ID,
      actions: [{ actionId: "AcknowledgeIncident", value: INCIDENT_ID }],
    });

    expect(one["signature"]).not.toBe(other["signature"]);
  });

  test("refuses to sign for a team id Mattermost could not have made", () => {
    expect(() => {
      return MattermostActionContext.toContext({
        teamId: "not-a-team",
        actions: [{ actionId: "AcknowledgeIncident", value: INCIDENT_ID }],
      });
    }).toThrow("The Mattermost team id is not valid.");
  });

  test("refuses to sign no actions, too many, or an action without an id", () => {
    expect(() => {
      return MattermostActionContext.toContext({
        teamId: TEAM_ID,
        actions: [],
      });
    }).toThrow();

    expect(() => {
      return MattermostActionContext.toContext({
        teamId: TEAM_ID,
        actions: Array.from(
          { length: MAX_ACTIONS_PER_CONTEXT + 1 },
          (_: unknown, index: number) => {
            return { actionId: `Action${index}`, value: "" };
          },
        ),
      });
    }).toThrow();

    expect(() => {
      return MattermostActionContext.toContext({
        teamId: TEAM_ID,
        actions: [{ actionId: "", value: INCIDENT_ID }],
      });
    }).toThrow();
  });
});

describe("MattermostActionContext: a menu", () => {
  const menuContext: () => JSONObject = (): JSONObject => {
    return MattermostActionContext.toContext({
      teamId: TEAM_ID,
      actions: [
        { actionId: "ViewChangeIncidentState", value: INCIDENT_ID },
        { actionId: "ViewChangeIncidentSeverity", value: INCIDENT_ID },
        { actionId: "ViewAddIncidentNote", value: INCIDENT_ID },
      ],
    });
  };

  test("the option chosen is the action at its place in the signed list", () => {
    expect(
      MattermostActionContext.readPress({
        context: { ...menuContext(), selected_option: "1" },
        teamId: TEAM_ID,
      }),
    ).toEqual({
      teamId: TEAM_ID,
      actionId: "ViewChangeIncidentSeverity",
      value: INCIDENT_ID,
    });
  });

  test.each([undefined, "", "3", "-1", "1.5", "one", "9999", 1])(
    "an option chosen as %j names nothing and is refused",
    (selectedOption: unknown) => {
      const context: JSONObject = { ...menuContext() };

      if (selectedOption !== undefined) {
        context["selected_option"] = selectedOption as string;
      }

      expect(
        MattermostActionContext.readPress({
          context: context,
          teamId: TEAM_ID,
        }),
      ).toBeNull();
    },
  );
});

describe("MattermostActionContext: a dialog's state", () => {
  const pressed: MattermostPressedAction = {
    teamId: TEAM_ID,
    actionId: "SubmitIncidentNote",
    value: INCIDENT_ID,
  };

  test("is read back as the form it was opened for", () => {
    const state: string = MattermostActionContext.toDialogState(pressed);

    expect(
      MattermostActionContext.readDialogState({
        state: state,
        teamId: TEAM_ID,
      }),
    ).toEqual(pressed);
  });

  test("is a URL-safe string Mattermost hands back as it is", () => {
    expect(MattermostActionContext.toDialogState(pressed)).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  test("submitted from another team is refused", () => {
    const state: string = MattermostActionContext.toDialogState(pressed);

    expect(
      MattermostActionContext.readDialogState({
        state: state,
        teamId: OTHER_TEAM_ID,
      }),
    ).toBeNull();
  });

  test("tampered with is refused", () => {
    const state: string = MattermostActionContext.toDialogState(pressed);
    const context: JSONObject = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    );

    context["actions"] = [
      { actionId: "SubmitChangeIncidentState", value: INCIDENT_ID },
    ];

    const tampered: string = Buffer.from(
      JSON.stringify(context),
      "utf8",
    ).toString("base64url");

    expect(
      MattermostActionContext.readDialogState({
        state: tampered,
        teamId: TEAM_ID,
      }),
    ).toBeNull();
  });

  test("a menu's context is no form's state", () => {
    const menu: JSONObject = MattermostActionContext.toContext({
      teamId: TEAM_ID,
      actions: [
        { actionId: "SubmitIncidentNote", value: INCIDENT_ID },
        { actionId: "SubmitChangeIncidentState", value: INCIDENT_ID },
      ],
    });

    const state: string = Buffer.from(JSON.stringify(menu), "utf8").toString(
      "base64url",
    );

    expect(
      MattermostActionContext.readDialogState({
        state: state,
        teamId: TEAM_ID,
      }),
    ).toBeNull();
  });

  test.each([undefined, null, "", "not-base64-json", 42])(
    "a state that is %j is refused",
    (state: unknown) => {
      expect(
        MattermostActionContext.readDialogState({
          state: state,
          teamId: TEAM_ID,
        }),
      ).toBeNull();
    },
  );
});

/*
 * A direct message belongs to no team: Mattermost names none for a press
 * in a direct or group channel, so its buttons are signed for the
 * channel instead (#6289) - and a team's context is read exactly as before.
 */
describe("MattermostActionContext: a direct message's button", () => {
  const DIRECT_CHANNEL_ID: string = "d".repeat(26);
  const OTHER_CHANNEL_ID: string = "x".repeat(26);

  function directContext(): JSONObject {
    return MattermostActionContext.toContext({
      teamId: TEAM_ID,
      channelId: DIRECT_CHANNEL_ID,
      actions: [{ actionId: "ApprovePublicNote", value: "signed-value" }],
    });
  }

  test("pressed in its direct message, which names no team, it is read back with its channel", () => {
    expect(
      MattermostActionContext.readPress({
        context: directContext(),
        teamId: "",
        channelId: DIRECT_CHANNEL_ID,
      }),
    ).toEqual({
      teamId: TEAM_ID,
      channelId: DIRECT_CHANNEL_ID,
      actionId: "ApprovePublicNote",
      value: "signed-value",
    });
  });

  test("pressed from any other channel it is refused, whatever team is named", () => {
    for (const teamId of ["", TEAM_ID, OTHER_TEAM_ID, undefined]) {
      expect(
        MattermostActionContext.readPress({
          context: directContext(),
          teamId: teamId,
          channelId: OTHER_CHANNEL_ID,
        }),
      ).toBeNull();
    }

    expect(
      MattermostActionContext.readPress({
        context: directContext(),
        teamId: TEAM_ID,
      }),
    ).toBeNull();
  });

  test("a direct message's context with its channel taken off reads as no team's: refused", () => {
    const context: JSONObject = directContext();
    delete context["channelId"];

    expect(
      MattermostActionContext.readPress({
        context: context,
        teamId: TEAM_ID,
        channelId: DIRECT_CHANNEL_ID,
      }),
    ).toBeNull();
  });

  test("a team's context with a channel put on it is refused: the channel is signed", () => {
    const context: JSONObject = MattermostActionContext.toContext({
      teamId: TEAM_ID,
      actions: [{ actionId: "AcknowledgeIncident", value: INCIDENT_ID }],
    });
    context["channelId"] = DIRECT_CHANNEL_ID;

    expect(
      MattermostActionContext.readPress({
        context: context,
        teamId: "",
        channelId: DIRECT_CHANNEL_ID,
      }),
    ).toBeNull();
  });

  test("a direct message's context moved to another channel is refused", () => {
    const context: JSONObject = directContext();
    context["channelId"] = OTHER_CHANNEL_ID;

    expect(
      MattermostActionContext.readPress({
        context: context,
        teamId: "",
        channelId: OTHER_CHANNEL_ID,
      }),
    ).toBeNull();
  });

  test.each([null, "", 42, "not-an-id"])(
    "a channel that is %j is refused",
    (channelId: unknown) => {
      const context: JSONObject = directContext();
      context["channelId"] = channelId as never;

      expect(
        MattermostActionContext.readPress({
          context: context,
          teamId: "",
          channelId: channelId,
        }),
      ).toBeNull();
    },
  );

  test("a team's button is still read as it always was, and signs what it always signed", () => {
    const context: JSONObject = MattermostActionContext.toContext({
      teamId: TEAM_ID,
      actions: [{ actionId: "AcknowledgeIncident", value: INCIDENT_ID }],
    });

    expect(context["channelId"]).toBeUndefined();
    expect(
      MattermostActionContext.readPress({
        context: context,
        teamId: TEAM_ID,
        channelId: DIRECT_CHANNEL_ID,
      })?.actionId,
    ).toBe("AcknowledgeIncident");
  });

  test("refuses to sign for a channel id Mattermost could not have made", () => {
    expect(() => {
      return MattermostActionContext.toContext({
        teamId: TEAM_ID,
        channelId: "not-an-id",
        actions: [{ actionId: "ApprovePublicNote", value: "v" }],
      });
    }).toThrow("The Mattermost channel id is not valid.");
  });

  test("a form opened from a direct message is held to its channel too", () => {
    const state: string = MattermostActionContext.toDialogState({
      teamId: TEAM_ID,
      channelId: DIRECT_CHANNEL_ID,
      actionId: "SubmitRejectPublicNote",
      value: "signed-value",
    });

    // A dialog's submission names the team its person is looking at, any of theirs.
    expect(
      MattermostActionContext.readDialogState({
        state: state,
        teamId: OTHER_TEAM_ID,
        channelId: DIRECT_CHANNEL_ID,
      })?.value,
    ).toBe("signed-value");
    expect(
      MattermostActionContext.readDialogState({
        state: state,
        teamId: TEAM_ID,
        channelId: OTHER_CHANNEL_ID,
      }),
    ).toBeNull();
  });
});
