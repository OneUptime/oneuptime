import { SpyInstance } from "jest-mock";
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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import UserUtil from "../../../UI/Utils/User";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import UiAnalytics from "../../../UI/Utils/Analytics";
import WebAuthnTestUtil, {
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";
import PasskeySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";

/*
 * Keep the real page and browser/API boundary. Shared list and form components
 * are exercised by their own tests and the real browser E2E suite.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      id: string;
      refreshToggle: string;
      cardProps: {
        title: string;
        description: string;
        rightElement?: React.ReactElement;
      };
    }): React.ReactElement => {
      return (
        <section data-testid={props.id} data-refresh={props.refreshToggle}>
          <h2>{props.cardProps.title}</h2>
          <p>{props.cardProps.description}</p>
          {props.cardProps.rightElement}
        </section>
      );
    },
  };
});
jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: React.ReactNode }): React.ReactElement => {
      return <div>{props.children}</div>;
    },
  };
});
/*
 * Exercise this page's registration state and browser/API boundary. The shared
 * form initializes values in asynchronous effects; its primitive behavior and
 * the production modal are covered by the form suites and browser E2E.
 */
jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: function MockRegistrationModal(props: {
      title: string;
      description?: string;
      isLoading?: boolean;
      submitButtonText?: string;
      formProps: { error?: string; fields: Array<{ dataTestId?: string }> };
      onSubmit?: (value: JSONObject) => void;
    }): React.ReactElement {
      const [name, setName] = React.useState<string>("");
      return (
        <div role="dialog">
          <h2>{props.title}</h2>
          <p>{props.description}</p>
          {props.formProps.error && <p>{props.formProps.error}</p>}
          <form
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              props.onSubmit?.({ name: name });
            }}
          >
            <input
              required
              data-testid={props.formProps.fields[0]?.dataTestId}
              value={name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setName(event.target.value);
              }}
            />
            <button type="submit" disabled={props.isLoading}>
              {props.submitButtonText}
            </button>
          </form>
        </div>
      );
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <p>Two factor authentication is disabled</p>;
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/BackupCodes",
  () => {
    return {
      __esModule: true,
      default: (props: {
        codesFromEnrolment: Array<string>;
      }): React.ReactElement => {
        return (
          <div data-testid="enrolment-backup-codes">
            {props.codesFromEnrolment.join(",")}
          </div>
        );
      },
    };
  },
);

type PostedRequest = { url: string; data: JSONObject | undefined };
let posted: Array<PostedRequest> = [];
let backupCodes: Array<string> = [];

const renderPage: () => void = (): void => {
  render(
    <MemoryRouter>
      <PasskeySettings
        pageRoute={new Route("/user-profile/two-factor-auth")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
};

const enterName: () => Promise<void> = async (): Promise<void> => {
  const input: HTMLElement = await screen.findByTestId("passkey-name");
  await act(async () => {
    fireEvent.change(input, { target: { value: "My laptop" } });
  });
  expect(input).toHaveValue("My laptop");
};

const register: (isPasskey?: boolean) => Promise<void> = async (
  isPasskey: boolean = true,
): Promise<void> => {
  await userEvent.click(
    screen.getByRole("button", {
      name: isPasskey ? "Add Passkey" : "Add Security Key",
    }),
  );
  await enterName();
  await act(async () => {
    await userEvent.click(
      screen.getByRole("button", {
        name: isPasskey ? "Create Passkey" : "Register Security Key",
      }),
    );
  });
};

describe("Passkey settings registration", () => {
  beforeEach(() => {
    posted = [];
    backupCodes = [];
    WebAuthnTestUtil.install();
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (options: {
          url?: { toString: () => string };
          data?: JSONObject;
        }): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url?.toString() || "";
          posted.push({ url: url, data: options.data });
          if (url.endsWith("/generate-registration-options")) {
            return new HTTPResponse<JSONObject>(
              200,
              { options: registrationOptions },
              {},
            );
          }
          return new HTTPResponse<JSONObject>(
            200,
            { verified: true, backupCodes: backupCodes },
            {},
          );
        },
      );
  });
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("makes passkeys available even when two factor authentication is disabled", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Add Passkey" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Security Key" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Two factor authentication is disabled"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Passkeys work independently of the two factor authentication setting/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")[0]).toHaveTextContent(
      "Passkeys and security keys",
    );
  });

  test("requests a discoverable passkey, verifies registration and refreshes management", async () => {
    renderPage();
    const refreshBefore: string | null = screen
      .getByTestId("webauthn-table")
      .getAttribute("data-refresh");
    await register();
    expect(posted[0]?.data).toEqual({ isPasskey: true });
    expect(posted[1]?.url).toContain("/user-webauthn/verify-registration");
    expect(posted[1]?.data).toMatchObject({
      name: "My laptop",
      credential: {
        id: "-_8A",
        rawId: "-_8A",
        type: "public-key",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          attestationObject: "BAUG",
          clientDataJSON: "AQID",
          transports: ["internal", "hybrid"],
        },
      },
    });
    expect(
      screen.queryByRole("button", { name: "Create Passkey" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("webauthn-table").getAttribute("data-refresh"),
    ).not.toBe(refreshBefore);
  });

  test("preserves separate legacy security key MFA registration", async () => {
    renderPage();
    await register(false);
    expect(posted[0]?.data).toEqual({ isPasskey: false });
    expect(posted[1]?.data?.["name"]).toBe("My laptop");
  });

  test("passes newly minted recovery codes to their save-once UI", async () => {
    backupCodes = ["ABCDE-12345", "FGHIJ-67890"];
    renderPage();
    await register();
    expect(screen.getByTestId("enrolment-backup-codes")).toHaveTextContent(
      "ABCDE-12345,FGHIJ-67890",
    );
  });

  test("keeps cancellation recoverable without posting verification", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    renderPage();
    await register();
    expect(
      screen.getByText(
        "Passkey registration was canceled or timed out. Try again when you are ready.",
      ),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Create Passkey" }),
    ).toBeEnabled();
  });

  test("explains duplicate authenticators", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(
        new DOMException("Duplicate", "InvalidStateError"),
      );
    renderPage();
    await register();
    expect(
      screen.getByText(/This authenticator is already registered/),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(1);
  });

  test("shows verification rejection and leaves the modal available for retry", async () => {
    const post: SpyInstance<typeof API.post> = jest.spyOn(API, "post");
    post.mockResolvedValueOnce(
      new HTTPResponse<JSONObject>(200, { options: registrationOptions }, {}),
    );
    post.mockRejectedValueOnce(
      new Error("Registration expired. Please try again."),
    );
    renderPage();
    await register();
    expect(
      screen.getByText("Registration expired. Please try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Passkey" }),
    ).toBeEnabled();
    expect(screen.getByTestId("enrolment-backup-codes")).toBeEmptyDOMElement();
  });

  test("rejects unsupported clients before requesting registration options", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
    renderPage();
    await register();
    expect(
      screen.getByText(/This browser does not support passkeys/),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  test("prevents duplicate registration while the authenticator is open", async () => {
    let finish: ((value: Credential | null) => void) | undefined;
    jest.spyOn(navigator.credentials, "create").mockImplementation(() => {
      return new Promise<Credential | null>(
        (resolve: (value: Credential | null) => void) => {
          finish = resolve;
        },
      );
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Add Passkey" }));
    await enterName();
    const submit: HTMLElement = screen.getByRole("button", {
      name: "Create Passkey",
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(navigator.credentials.create).toHaveBeenCalledTimes(1);
    });
    expect(posted).toHaveLength(1);
    await act(async () => {
      finish!(WebAuthnTestUtil.credential(true));
    });
    expect(posted).toHaveLength(2);
  });
});
