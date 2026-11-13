import ErrorExplanation, {
  getExplanationWords,
  isUnexplainedErrorMessage,
} from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import ErrorMessage from "../../../../UI/Components/ErrorMessage/ErrorMessage";
import PageError from "../../../../UI/Components/Error/PageError";
import BasicFormModal from "../../../../UI/Components/FormModal/BasicFormModal";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "../../../../UI/Components/Modal/ConfirmModal";
import Modal from "../../../../UI/Components/Modal/Modal";
import ModalBody from "../../../../UI/Components/Modal/ModalBody";
import { JSONObject } from "../../../../Types/JSON";
import TableEmptyState, {
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";
import NewVersion, {
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import User from "../../../../UI/Utils/User";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An error nobody explained, drawn (#6836): what failed, why as far as
 * anyone knows, what to do next and, when the server failed, the reference
 * to give with a copy button. A master admin of a self-hosted server also
 * reads where to look; on a gateway's error anyone on a self-hosted server
 * does, since who installed it may not be signed in yet (#1741).
 *
 * And the shared places an error is drawn - a form's alert, a list that did
 * not load, a dialog, the page that did not load - draw it that way, and
 * every other message as before.
 */

let isCloud: boolean = false;

jest.mock("../../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return isCloud;
    },
  });

  return mockedConfig;
});

const REFERENCE: string = "a1b2c3d4";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);

let isMasterAdmin: boolean = false;

beforeEach(() => {
  isCloud = false;
  isMasterAdmin = false;
  jest.spyOn(User, "isMasterAdmin").mockImplementation((): boolean => {
    return isMasterAdmin;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("isUnexplainedErrorMessage", () => {
  test("is true for the sentences API.getFriendlyMessage writes for these", () => {
    expect(isUnexplainedErrorMessage(WITH_REFERENCE)).toBe(true);
    expect(isUnexplainedErrorMessage(UNEXPLAINED_ERROR_MESSAGES.server)).toBe(
      true,
    );
    expect(isUnexplainedErrorMessage(SERVER_DOWN_MESSAGE)).toBe(true);
    expect(
      isUnexplainedErrorMessage(UNEXPLAINED_ERROR_MESSAGES.unreachable),
    ).toBe(true);
    expect(isUnexplainedErrorMessage(UNEXPLAINED_ERROR_MESSAGES.page)).toBe(
      true,
    );
  });

  test("is false for a message somebody wrote, and for anything not a string", () => {
    expect(isUnexplainedErrorMessage("Promo code is invalid.")).toBe(false);
    expect(isUnexplainedErrorMessage(<span>x</span>)).toBe(false);
    expect(isUnexplainedErrorMessage(undefined)).toBe(false);
  });
});

describe("getExplanationWords", () => {
  const server: { kind: UnexplainedErrorKind; reference: string } = {
    kind: UnexplainedErrorKind.ServerWithReference,
    reference: REFERENCE,
  };

  test("on OneUptime Cloud, the reference goes to OneUptime support", () => {
    expect(
      getExplanationWords({
        error: server,
        isCloud: true,
        isMasterAdmin: true,
      }),
    ).toEqual({
      why: UnexplainedErrorWords.serverWhy,
      next: UnexplainedErrorWords.serverNextWithReferenceCloud,
      whereToLook: null,
    });
  });

  test("on a self-hosted server, it goes to whoever runs the server", () => {
    expect(
      getExplanationWords({
        error: server,
        isCloud: false,
        isMasterAdmin: false,
      }).next,
    ).toBe(UnexplainedErrorWords.serverNextWithReferenceSelfHosted);
  });

  test("whoever runs it - a master admin - is told where to look", () => {
    expect(
      getExplanationWords({
        error: server,
        isCloud: false,
        isMasterAdmin: true,
      }).whereToLook,
    ).toBe(UnexplainedErrorWords.adminWhereToLookWithReference);
    expect(
      getExplanationWords({
        error: { kind: UnexplainedErrorKind.Server, reference: null },
        isCloud: false,
        isMasterAdmin: true,
      }).whereToLook,
    ).toBe(UnexplainedErrorWords.adminWhereToLook);
  });

  test("a gateway's error tells anyone on a self-hosted server to run the doctor, and nobody on Cloud", () => {
    const down: { kind: UnexplainedErrorKind; reference: null } = {
      kind: UnexplainedErrorKind.ServerDown,
      reference: null,
    };

    expect(
      getExplanationWords({ error: down, isCloud: false, isMasterAdmin: false })
        .whereToLook,
    ).toBe(UnexplainedErrorWords.serverDownWhereToLook);
    expect(
      getExplanationWords({ error: down, isCloud: true, isMasterAdmin: true })
        .whereToLook,
    ).toBeNull();
  });

  test("a status page's visitor is told to try again, and nothing about the server's logs or support", () => {
    expect(
      getExplanationWords({
        error: server,
        isCloud: false,
        isMasterAdmin: true,
        isVisitor: true,
      }),
    ).toEqual({
      why: UnexplainedErrorWords.serverWhy,
      next: UnexplainedErrorWords.serverNext,
      whereToLook: null,
    });
    expect(
      getExplanationWords({
        error: { kind: UnexplainedErrorKind.ServerDown, reference: null },
        isCloud: false,
        isMasterAdmin: false,
        isVisitor: true,
      }).whereToLook,
    ).toBeNull();
  });

  test("what to do next for a connection and a page", () => {
    expect(
      getExplanationWords({
        error: { kind: UnexplainedErrorKind.Unreachable, reference: null },
        isCloud: false,
        isMasterAdmin: true,
      }),
    ).toEqual({
      why: UnexplainedErrorWords.unreachableWhy,
      next: UnexplainedErrorWords.unreachableNext,
      whereToLook: null,
    });
    expect(
      getExplanationWords({
        error: { kind: UnexplainedErrorKind.Page, reference: null },
        isCloud: false,
        isMasterAdmin: true,
      }),
    ).toEqual({
      why: UnexplainedErrorWords.pageWhy,
      next: UnexplainedErrorWords.pageNext,
      whereToLook: null,
    });
  });
});

describe("ErrorExplanation", () => {
  test("says what failed, why, what to do next, and the reference with a copy button", () => {
    render(
      <ErrorExplanation
        message={WITH_REFERENCE}
        whatFailed="The monitor was not saved."
      />,
    );

    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      "The monitor was not saved.",
    );
    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      `${UnexplainedErrorWords.serverWhy} ${UnexplainedErrorWords.serverNextWithReferenceSelfHosted}`,
    );

    const reference: HTMLElement = screen.getByTestId("error-reference");

    expect(within(reference).getByText(REFERENCE)).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(within(reference).getByRole("button")).toHaveTextContent("Copy");
  });

  test("says 'This did not finish.' when the page does not say what it was doing", () => {
    render(<ErrorExplanation message={WITH_REFERENCE} />);

    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      UnexplainedErrorWords.didNotFinish,
    );
  });

  test("leaves the first line out under a title that says it", () => {
    render(<ErrorExplanation message={WITH_REFERENCE} hideWhatFailed={true} />);

    expect(screen.queryByTestId("error-what-failed")).toBeNull();
  });

  test("on OneUptime Cloud sends the reference to OneUptime support", () => {
    isCloud = true;

    render(<ErrorExplanation message={WITH_REFERENCE} />);

    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      UnexplainedErrorWords.serverNextWithReferenceCloud,
    );
  });

  test("tells a master admin of a self-hosted server where to look, and opens OneUptime Health", () => {
    isMasterAdmin = true;

    render(<ErrorExplanation message={WITH_REFERENCE} />);

    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      UnexplainedErrorWords.adminWhereToLookWithReference,
    );
    expect(screen.getByTestId("error-open-health")).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/health"),
    );
  });

  test("tells a member nothing about the server's logs", () => {
    render(<ErrorExplanation message={WITH_REFERENCE} />);

    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
    expect(screen.queryByTestId("error-open-health")).toBeNull();
  });

  test("on a status page, a gateway's error tells the visitor nothing about running the server", () => {
    jest
      .spyOn(NewVersion, "getAudience")
      .mockReturnValue(NewVersionAudience.Visitors);

    render(<ErrorExplanation message={SERVER_DOWN_MESSAGE} />);

    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      UnexplainedErrorWords.serverDownWhy,
    );
    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });

  test("a master admin on Cloud is not told to run the doctor", () => {
    isCloud = true;
    isMasterAdmin = true;

    render(<ErrorExplanation message={WITH_REFERENCE} />);

    expect(screen.queryByTestId("error-where-to-look")).toBeNull();
  });

  test("a gateway's error on a self-hosted server: the doctor, for anyone, and no Health link while the server is down", () => {
    render(<ErrorExplanation message={SERVER_DOWN_MESSAGE} />);

    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      `${UnexplainedErrorWords.serverDownWhy} ${UnexplainedErrorWords.serverDownNext}`,
    );
    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      UnexplainedErrorWords.serverDownWhereToLook,
    );
    expect(screen.queryByTestId("error-open-health")).toBeNull();
    expect(screen.queryByTestId("error-reference")).toBeNull();
  });

  test("a connection that failed: check it, then try again; no reference", () => {
    render(
      <ErrorExplanation message={UNEXPLAINED_ERROR_MESSAGES.unreachable} />,
    );

    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      `${UnexplainedErrorWords.unreachableWhy} ${UnexplainedErrorWords.unreachableNext}`,
    );
    expect(screen.queryByTestId("error-reference")).toBeNull();
  });

  test("a message somebody wrote is drawn as it is", () => {
    render(<ErrorExplanation message="Promo code is invalid." />);

    expect(document.body).toHaveTextContent("Promo code is invalid.");
    expect(screen.queryByTestId("error-explanation")).toBeNull();
  });
});

describe("the shared places an error is drawn", () => {
  const renderForm: (error: string, whatFailed?: string) => void = (
    error: string,
    whatFailed?: string,
  ): void => {
    render(
      <BasicForm
        disableAutofocus={true}
        error={error}
        whatFailed={whatFailed}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
      />,
    );
  };

  test("a form's alert says what the form was doing first", async () => {
    renderForm(WITH_REFERENCE, "The monitor was not created.");

    await screen.findByRole("textbox", { name: "Name" });

    const alert: HTMLElement = screen.getByRole("alert");

    expect(within(alert).getByTestId("error-what-failed")).toHaveTextContent(
      "The monitor was not created.",
    );
    expect(within(alert).getByText(REFERENCE)).toBeInTheDocument();
  });

  test("a form's alert draws any other message as before", async () => {
    renderForm("Promo code is invalid.");

    await screen.findByRole("textbox", { name: "Name" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Promo code is invalid.",
    );
    expect(screen.queryByTestId("error-explanation")).toBeNull();
  });

  test("a list that did not load offers Try again rather than Refresh?", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    render(
      <ErrorMessage
        message={UNEXPLAINED_ERROR_MESSAGES.server}
        whatFailed="The monitors could not be loaded."
        onRefreshClick={onRefresh}
      />,
    );

    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      "The monitors could not be loaded.",
    );

    const retry: HTMLElement = screen.getByTestId("refresh-button");

    expect(retry).toHaveTextContent("Try again");

    fireEvent.click(retry);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("a list's own message keeps Refresh?", () => {
    render(
      <ErrorMessage
        message="This search took too long."
        onRefreshClick={getJestMockFunction()}
      />,
    );

    expect(screen.getByTestId("refresh-button")).toHaveTextContent("Refresh?");
    expect(screen.queryByTestId("error-explanation")).toBeNull();
  });

  test("a table that did not load explains under its own title", () => {
    render(
      <TableEmptyState
        kind={TableEmptyStateKind.Error}
        title="Could not load monitors"
        description={WITH_REFERENCE}
      />,
    );

    expect(screen.getByTestId("error-explanation")).toBeInTheDocument();
    expect(screen.queryByTestId("error-what-failed")).toBeNull();
    expect(screen.getByText(REFERENCE)).toBeInTheDocument();
  });

  test("an Error dialog explains its message", () => {
    render(
      <ConfirmModal
        title="Error"
        description={WITH_REFERENCE}
        submitButtonText="Close"
        onSubmit={getJestMockFunction()}
      />,
    );

    const description: HTMLElement = screen.getByTestId(
      "confirm-modal-description",
    );

    expect(
      within(description).getByTestId("error-explanation"),
    ).toBeInTheDocument();
    expect(within(description).getByText(REFERENCE)).toBeInTheDocument();
  });

  test("a dialog's error alert explains its message", () => {
    render(
      <ModalBody error={UNEXPLAINED_ERROR_MESSAGES.page}>
        <p>Body</p>
      </ModalBody>,
    );

    expect(
      within(screen.getByTestId("modal-error")).getByTestId(
        "error-why-and-next",
      ),
    ).toHaveTextContent(UnexplainedErrorWords.pageNext);
  });

  /*
   * A dialog's alert has no heading of its own to say what failed: the
   * dialog says it first, when it says what it was doing (#7647) - deleting
   * a note, approving it - and "This did not finish." when it does not.
   */
  describe("a dialog's error alert says what the dialog was doing first", () => {
    const whatFailedLine: () => HTMLElement = (): HTMLElement => {
      return within(screen.getByTestId("modal-error")).getByTestId(
        "error-what-failed",
      );
    };

    test("a dialog", () => {
      render(
        <Modal
          title="Delete note"
          submitButtonText="Delete note"
          onClose={getJestMockFunction()}
          onSubmit={getJestMockFunction()}
          error={WITH_REFERENCE}
          errorWhatFailed="Couldn't delete the note."
        >
          <p>Body</p>
        </Modal>,
      );

      expect(whatFailedLine()).toHaveTextContent(
        /^Couldn't delete the note\.$/,
      );
      expect(
        within(screen.getByTestId("modal-error")).getByText(REFERENCE),
      ).toBeInTheDocument();
    });

    test("a confirmation", () => {
      render(
        <ConfirmModal
          title="Approve note"
          description="Approve this note?"
          submitButtonText="Approve"
          onSubmit={getJestMockFunction()}
          error={WITH_REFERENCE}
          errorWhatFailed="Couldn't approve the note."
        />,
      );

      expect(whatFailedLine()).toHaveTextContent(
        /^Couldn't approve the note\.$/,
      );
    });

    test("a dialog's form", async () => {
      render(
        <BasicFormModal<JSONObject>
          title="Reject note"
          submitButtonText="Reject"
          onClose={getJestMockFunction()}
          onSubmit={getJestMockFunction()}
          error={WITH_REFERENCE}
          errorWhatFailed="Couldn't reject the note."
          formProps={{
            disableAutofocus: true,
            fields: [
              {
                field: { reason: true },
                title: "Reason",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
              },
            ],
          }}
        />,
      );

      await screen.findByRole("textbox", { name: "Reason" });

      expect(whatFailedLine()).toHaveTextContent(
        /^Couldn't reject the note\.$/,
      );
      // Said once: the form under the alert does not say it again.
      expect(screen.getAllByTestId("error-explanation")).toHaveLength(1);
    });

    test("a dialog that does not say it says 'This did not finish.'", () => {
      render(
        <ConfirmModal
          title="Approve note"
          description="Approve this note?"
          submitButtonText="Approve"
          onSubmit={getJestMockFunction()}
          error={WITH_REFERENCE}
        />,
      );

      expect(whatFailedLine()).toHaveTextContent(
        UnexplainedErrorWords.didNotFinish,
      );
    });
  });
});

describe("the page that did not load (#1741)", () => {
  test("says so, not 'Oops, something went wrong.'", () => {
    render(<PageError message={SERVER_DOWN_MESSAGE} />);

    expect(
      screen.getByText(UnexplainedErrorWords.pageDidNotLoadTitle),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Oops");
    expect(document.body).not.toHaveTextContent("something went wrong");
  });

  test("on a self-hosted server whose gateway answered, says to run the doctor", () => {
    render(<PageError message={SERVER_DOWN_MESSAGE} />);

    expect(screen.getByTestId("error-where-to-look")).toHaveTextContent(
      "npm run doctor",
    );
  });

  test("a bare 'Server Error' is no longer called a network error", () => {
    render(<PageError message="Server Error" />);

    expect(document.body).not.toHaveTextContent("Network Error");
    expect(screen.getByTestId("error-why-and-next")).toHaveTextContent(
      UnexplainedErrorWords.serverWhy,
    );
  });

  test("a message somebody wrote is shown as it is", () => {
    render(<PageError message="Your project was deleted." />);

    expect(screen.getByTestId("page-error-message")).toHaveTextContent(
      "Your project was deleted.",
    );
  });
});
