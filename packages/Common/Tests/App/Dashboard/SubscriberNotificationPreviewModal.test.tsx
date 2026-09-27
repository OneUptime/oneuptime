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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * 'Preview notification': the email each status page's subscribers would get,
 * shown before an incident is declared or a public note is posted, and 'Send
 * test to me'.
 *
 * The raw calls are stubbed and recorded, so these pin down what the dialog
 * asks (the notification API routes, the tenant header, the draft), what it
 * shows (the email in a frame that runs nothing and cannot reach the
 * dashboard, the page picker, which template and why, the counts, nothing
 * will be sent), and that a test send names the page shown and never an
 * address.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import SubscriberNotificationPreviewModal from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewModal";
import SubscriberNotificationPreviewButton from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewButton";
import NoteComposer from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer";
import { getNotesCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import SubscriberNotificationPreviewCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import {
  EMAIL_PREVIEW_SANDBOX,
  getEmailPreviewDocument,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/EmailPreviewFrame";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationPreviewResult,
} from "../../../Types/StatusPage/SubscriberNotificationPreview";

const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";

const HTML_03: string =
  '<html><body><h1>Site 03 update</h1><script>window.parent.hacked = true;</script><a href="https://status.acme.com">Status</a></body></html>';
const HTML_07: string = "<html><body><h1>Site 07 update</h1></body></html>";

const REQUEST: SubscriberNotificationPreviewRequest = {
  event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
  incidentId: INCIDENT_ID,
  note: "We are **rolling back**.",
  postedAt: null,
};

function result(
  partial: Partial<SubscriberNotificationPreviewResult> = {},
): SubscriberNotificationPreviewResult {
  const counts03: ReturnType<typeof IncidentSubscriberAudience.getEmptyCounts> =
    { ...IncidentSubscriberAudience.getEmptyCounts(), email: 41 };
  const counts07: ReturnType<typeof IncidentSubscriberAudience.getEmptyCounts> =
    { ...IncidentSubscriberAudience.getEmptyCounts(), email: 18, sms: 2 };

  return {
    event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    nothingSentReason: null,
    statusPages: [
      {
        statusPageId: SITE_03,
        name: "Site 03",
        subscriberCounts: counts03,
        subject: "[Update Incident] Checkout failing",
        html: HTML_03,
        templateChoice: {
          usesCustomTemplate: true,
          reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
          customTemplateName: "Site 03 branded",
        },
      },
      {
        statusPageId: SITE_07,
        name: "Site 07",
        subscriberCounts: counts07,
        subject: "Site 07: Checkout failing",
        html: HTML_07,
        templateChoice: {
          usesCustomTemplate: false,
          reason:
            SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
          customTemplateName: "Site 07 branded",
        },
      },
    ],
    audience: {
      hasMonitors: true,
      isScoped: true,
      isHiddenFromStatusPages: false,
      statusPages: [
        { statusPageId: SITE_03, name: "Site 03", subscriberCounts: counts03 },
        { statusPageId: SITE_07, name: "Site 07", subscriberCounts: counts07 },
      ],
      hiddenStatusPageCount: 0,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [],
    },
    ...partial,
  };
}

function ok(json: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, json, {});
}

interface RecordedPost {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

function postOf(call: number): RecordedPost {
  const request: Record<string, unknown> = postMock.mock.calls[
    call
  ]![0] as Record<string, unknown>;

  return {
    url: String(request["url"]),
    data: request["data"] as JSONObject,
    headers: request["headers"] as Record<string, string>,
  };
}

function answerPreviewWith(
  preview: SubscriberNotificationPreviewResult,
  sendTest?: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
): void {
  postMock.mockImplementation((async (request: { url: unknown }) => {
    if (String(request.url).endsWith("/send-test")) {
      return sendTest
        ? sendTest()
        : ok({ sentTo: "me@example.com" } as JSONObject);
    }

    return ok(SubscriberNotificationPreview.toJSON(preview));
  }) as never);
}

async function openModal(): Promise<void> {
  render(
    <SubscriberNotificationPreviewModal request={REQUEST} onClose={() => {}} />,
  );

  await screen.findByTestId("subscriber-notification-preview-body");
}

function frame(): HTMLIFrameElement {
  return screen.getByTestId(
    "subscriber-notification-preview-frame",
  ) as HTMLIFrameElement;
}

beforeEach(() => {
  postMock.mockReset();
  answerPreviewWith(result());
});

afterEach(() => {
  cleanup();
});

describe("the email frame", () => {
  test("grants neither allow-scripts nor allow-same-origin", async () => {
    await openModal();

    const sandbox: string = frame().getAttribute("sandbox") || "";
    const tokens: Array<string> = sandbox.split(/\s+/);

    expect(frame().hasAttribute("sandbox")).toBe(true);
    expect(tokens).not.toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
    expect(sandbox).toBe(EMAIL_PREVIEW_SANDBOX);
    expect(tokens.sort()).toEqual(
      ["allow-popups", "allow-popups-to-escape-sandbox"].sort(),
    );
    expect(frame().getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  test("shows the email as the server rendered it, from srcDoc, with links opening in a new tab", async () => {
    await openModal();

    expect(frame().getAttribute("srcdoc")).toBe(
      getEmailPreviewDocument(HTML_03),
    );
    expect(frame().getAttribute("srcdoc")).toBe(
      `<base target="_blank">${HTML_03}`,
    );
    expect(frame().getAttribute("src")).toBeNull();
    // The script in the email never ran in the dashboard.
    expect((window as unknown as Record<string, unknown>)["hacked"]).toBe(
      undefined,
    );
  });
});

describe("the preview", () => {
  test("asks the notification API with the tenant header and the draft", async () => {
    await openModal();

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: RecordedPost = postOf(0);

    expect(request.url).toMatch(
      /\/notification\/subscriber-notification-preview\/preview$/,
    );
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.data).toEqual(
      SubscriberNotificationPreview.requestToJSON(REQUEST),
    );
  });

  test("shows the first page's subject, counts and why its template was chosen", async () => {
    await openModal();

    expect(
      screen.getByTestId("subscriber-notification-preview-subject"),
    ).toHaveTextContent("[Update Incident] Checkout failing");
    expect(
      screen.getByTestId("subscriber-notification-preview-template-choice"),
    ).toHaveTextContent(
      'This status page\'s custom email template "Site 03 branded" is used.',
    );

    const select: HTMLSelectElement = screen.getByTestId(
      "subscriber-notification-preview-page-select",
    ) as HTMLSelectElement;

    expect(
      Array.from(select.options).map((option: HTMLOptionElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["Site 03 (up to 41 email)", "Site 07 (up to 18 email, 2 SMS)"]);
  });

  test("picking another page shows its email and its reason", async () => {
    await openModal();

    fireEvent.change(
      screen.getByTestId("subscriber-notification-preview-page-select"),
      { target: { value: SITE_07 } },
    );

    expect(frame().getAttribute("srcdoc")).toBe(
      getEmailPreviewDocument(HTML_07),
    );
    expect(
      screen.getByTestId("subscriber-notification-preview-subject"),
    ).toHaveTextContent("Site 07: Checkout failing");
    expect(
      screen.getByTestId("subscriber-notification-preview-template-choice"),
    ).toHaveTextContent(
      'The default email is used: the custom template "Site 07 branded" is only used when the status page sends email through its own SMTP server, and this one does not.',
    );
  });

  test("one page: named with its counts, no picker", async () => {
    answerPreviewWith(result({ statusPages: [result().statusPages[0]!] }));

    await openModal();

    expect(
      screen.queryByTestId("subscriber-notification-preview-page-select"),
    ).toBeNull();
    expect(
      screen.getByTestId("subscriber-notification-preview-page-name"),
    ).toHaveTextContent("Site 03 (up to 41 email)");
  });

  test("pages the caller cannot see are counted, not previewed", async () => {
    answerPreviewWith(
      result({
        audience: { ...result().audience, hiddenStatusPageCount: 2 },
      }),
    );

    await openModal();

    expect(
      screen.getByTestId("subscriber-notification-preview-hidden-pages"),
    ).toHaveTextContent(
      "2 more status pages you do not have access to will be sent this notification. They are not previewed.",
    );
  });

  test("nothing will be sent: says why, and shows no email", async () => {
    answerPreviewWith(
      result({
        nothingSentReason:
          SubscriberNotificationPreviewNothingSentReason.NoMonitors,
        statusPages: [],
      }),
    );

    render(
      <SubscriberNotificationPreviewModal
        request={REQUEST}
        onClose={() => {}}
      />,
    );

    const notice: HTMLElement = await screen.findByTestId(
      "subscriber-notification-preview-nothing-sent",
    );

    expect(notice).toHaveTextContent(
      SubscriberNotificationPreviewCopy.nothingWillBeSent,
    );
    expect(notice).toHaveTextContent(
      SubscriberNotificationPreviewCopy.noMonitors,
    );
    expect(notice).toHaveAttribute("data-reason", "NoMonitors");
    expect(
      screen.queryByTestId("subscriber-notification-preview-frame"),
    ).toBeNull();
    expect(
      screen.queryByTestId("subscriber-notification-preview-send-test"),
    ).toBeNull();
  });

  test("a preview that cannot be built says so", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Incident not found" }, {}),
    );

    render(
      <SubscriberNotificationPreviewModal
        request={REQUEST}
        onClose={() => {}}
      />,
    );

    const error: HTMLElement = await screen.findByTestId(
      "subscriber-notification-preview-error",
    );

    expect(error).toHaveTextContent(
      SubscriberNotificationPreviewCopy.loadError,
    );
    expect(error).toHaveTextContent("Incident not found");
  });
});

describe("Send test to me", () => {
  test("sends the shown page's email, naming the page and no address, and says where it went", async () => {
    await openModal();

    fireEvent.change(
      screen.getByTestId("subscriber-notification-preview-page-select"),
      { target: { value: SITE_07 } },
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-preview-send-test"),
      );
    });

    const sent: HTMLElement = await screen.findByTestId(
      "subscriber-notification-preview-send-test-sent",
    );

    expect(sent).toHaveTextContent(
      "Test email sent to me@example.com. It can take a few minutes to arrive.",
    );

    expect(postMock).toHaveBeenCalledTimes(2);

    const request: RecordedPost = postOf(1);

    expect(request.url).toMatch(
      /\/notification\/subscriber-notification-preview\/send-test$/,
    );
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.data).toEqual({
      ...SubscriberNotificationPreview.requestToJSON(REQUEST),
      statusPageId: SITE_07,
    });
    expect(JSON.stringify(request.data)).not.toMatch(/@/);
  });

  /*
   * Picking another page while a test is on its way used to re-enable the
   * button, and the answer then showed "Test email sent" under a page that
   * was never sent.
   */
  test("keeps the picker on the page being sent until the test answers", async () => {
    let answer: (response: HTTPResponse<JSONObject>) => void = (): void => {};
    answerPreviewWith(result(), () => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    });

    await openModal();

    const select: HTMLElement = screen.getByTestId(
      "subscriber-notification-preview-page-select",
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-preview-send-test"),
      );
    });

    expect(select).toBeDisabled();
    expect(
      screen.getByTestId("subscriber-notification-preview-send-test"),
    ).toBeDisabled();

    await act(async () => {
      answer(ok({ sentTo: "me@example.com" } as JSONObject));
    });

    expect(select).not.toBeDisabled();
    expect(select).toHaveValue(SITE_03);
    expect(
      await screen.findByTestId(
        "subscriber-notification-preview-send-test-sent",
      ),
    ).toBeInTheDocument();
  });

  test("an answer for a page no longer shown is dropped", async () => {
    let answer: (response: HTTPResponse<JSONObject>) => void = (): void => {};
    answerPreviewWith(result(), () => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    });

    await openModal();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-preview-send-test"),
      );
    });

    // Changed anyway, as a script or an assistive technology could.
    const select: HTMLSelectElement = screen.getByTestId(
      "subscriber-notification-preview-page-select",
    ) as HTMLSelectElement;
    select.disabled = false;
    fireEvent.change(select, { target: { value: SITE_07 } });

    await act(async () => {
      answer(ok({ sentTo: "me@example.com" } as JSONObject));
    });

    expect(
      screen.queryByTestId("subscriber-notification-preview-send-test-sent"),
    ).toBeNull();
    expect(
      screen.getByTestId("subscriber-notification-preview-send-test"),
    ).not.toBeDisabled();
  });

  test("a refused test says why", async () => {
    answerPreviewWith(result(), async () => {
      return new HTTPErrorResponse(
        429,
        {
          message:
            "You have sent yourself too many test emails. Please try again later.",
        },
        {},
      );
    });

    await openModal();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-preview-send-test"),
      );
    });

    const error: HTMLElement = await screen.findByTestId(
      "subscriber-notification-preview-send-test-error",
    );

    expect(error).toHaveTextContent(
      SubscriberNotificationPreviewCopy.sendTestError,
    );
    expect(error).toHaveTextContent("too many test emails");
  });
});

describe("inside the forms it opens from", () => {
  test("is rendered outside them, and clicking in it submits nothing", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <form
        data-testid="host-form"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SubscriberNotificationPreviewModal
          request={REQUEST}
          onClose={() => {}}
        />
      </form>,
    );

    await screen.findByTestId("subscriber-notification-preview-body");

    expect(
      within(screen.getByTestId("host-form")).queryByTestId(
        "subscriber-notification-preview",
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("subscriber-notification-preview-send-test"),
      );
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * The note composer posts on Cmd+Enter and drops a blank draft on Escape.
   * React bubbles the portalled dialog's key events to it; it ignores the
   * ones from outside its own element, so the dialog's keys stay the
   * dialog's.
   */
  describe("the note composer", () => {
    function renderComposer(): {
      onSubmit: MockFunction;
      onCancel: MockFunction;
      onClose: MockFunction;
    } {
      const onSubmit: MockFunction = getJestMockFunction();
      const onCancel: MockFunction = getJestMockFunction();
      const onClose: MockFunction = getJestMockFunction();

      render(
        <NoteComposer
          mode="create"
          visibility="public"
          copy={getNotesCopy("public", "incident")}
          values={{
            note: "",
            attachments: [],
            shouldNotify: true,
            postedAt: null,
          }}
          onChange={() => {}}
          editorKey="editor"
          isAttachmentsEnabled={false}
          notifyOption={{
            title: "Notify status page subscribers",
            checkedDescription: "Subscribers will be notified.",
            uncheckedDescription: "Nobody will be notified.",
          }}
          notifyPreview={() => {
            return (
              <SubscriberNotificationPreviewModal
                request={REQUEST}
                onClose={() => {
                  onClose();
                }}
              />
            );
          }}
          isPostedAtEditable={false}
          isSubmitting={false}
          onSubmit={() => {
            onSubmit();
          }}
          onCancel={() => {
            onCancel();
          }}
          dataTestId="note-composer"
        />,
      );

      return { onSubmit, onCancel, onClose };
    }

    test("Escape in the dialog closes the dialog, not the draft", async () => {
      const calls: {
        onSubmit: MockFunction;
        onCancel: MockFunction;
        onClose: MockFunction;
      } = renderComposer();

      await screen.findByTestId("subscriber-notification-preview-body");

      fireEvent.keyDown(
        screen.getByTestId("subscriber-notification-preview-page-select"),
        { key: "Escape" },
      );

      expect(calls.onClose).toHaveBeenCalledTimes(1);
      expect(calls.onCancel).not.toHaveBeenCalled();
    });

    test("Cmd+Enter in the dialog does not post the note", async () => {
      const calls: {
        onSubmit: MockFunction;
        onCancel: MockFunction;
        onClose: MockFunction;
      } = renderComposer();

      await screen.findByTestId("subscriber-notification-preview-body");

      fireEvent.keyDown(
        screen.getByTestId("subscriber-notification-preview-page-select"),
        { key: "Enter", metaKey: true },
      );

      expect(calls.onSubmit).not.toHaveBeenCalled();
    });

    test("the composer's own keys still work", async () => {
      const calls: {
        onSubmit: MockFunction;
        onCancel: MockFunction;
        onClose: MockFunction;
      } = renderComposer();

      await screen.findByTestId("subscriber-notification-preview-body");

      fireEvent.keyDown(screen.getByTestId("note-composer"), {
        key: "Escape",
      });

      expect(calls.onCancel).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * The dialog closes on Escape and keeps Tab inside it (Modal listens on the
 * document). A wrapper that stopped every key's propagation, to keep keys
 * from the note composer, stopped them at the body before the document saw
 * them: Escape did nothing, and Tab walked out of an aria-modal dialog.
 */
describe("the keyboard", () => {
  test("Escape closes the dialog", async () => {
    const onClose: MockFunction = getJestMockFunction();

    render(
      <SubscriberNotificationPreviewModal
        request={REQUEST}
        onClose={() => {
          onClose();
        }}
      />,
    );

    await screen.findByTestId("subscriber-notification-preview-body");

    fireEvent.keyDown(
      screen.getByTestId("subscriber-notification-preview-page-select"),
      { key: "Escape" },
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Tab from the last control wraps to the first, and Shift+Tab back", async () => {
    render(
      <SubscriberNotificationPreviewModal
        request={REQUEST}
        onClose={() => {}}
      />,
    );

    await screen.findByTestId("subscriber-notification-preview-body");

    const dialog: HTMLElement = screen.getByRole("dialog");
    const focusable: Array<HTMLElement> = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

    expect(focusable.length).toBeGreaterThan(1);

    const last: HTMLElement = focusable[focusable.length - 1]!;
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);

    const first: HTMLElement = document.activeElement as HTMLElement;

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("the button", () => {
  test("opens the preview with the draft as it is when clicked", async () => {
    let note: string = "First draft";

    render(
      <SubscriberNotificationPreviewButton
        getRequest={() => {
          return { ...REQUEST, note: note };
        }}
      />,
    );

    note = "Second draft";

    fireEvent.click(
      screen.getByTestId("subscriber-notification-preview-button"),
    );

    await screen.findByTestId("subscriber-notification-preview-body");

    expect(postOf(0).data["note"]).toBe("Second draft");

    fireEvent.click(screen.getByTestId("close-button"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("subscriber-notification-preview"),
      ).toBeNull();
    });
  });

  test("nothing to preview: disabled, and nothing is asked", () => {
    render(
      <SubscriberNotificationPreviewButton
        getRequest={() => {
          return null;
        }}
        isDisabled={true}
        disabledReason={
          SubscriberNotificationPreviewCopy.previewButtonDisabledNoNote
        }
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      "subscriber-notification-preview-button",
    );

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("subscriber-notification-preview")).toBeNull();
  });
});
