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
import React, { ReactElement } from "react";

/*
 * Admin Dashboard > Settings > White Label.
 *
 * What these pin:
 *   - with no white-labelling allowed (no PRODUCT_BRANDING in env.js) the
 *     page draws nothing and sends no request at all;
 *   - allowed: it reads the settings once, shows the name, the website and a
 *     preview of each image on the background it is for;
 *   - the name and website are saved together, as one PUT, blanks as null;
 *   - an image is checked for size before upload (the server's own words),
 *     sent as a data: URL under its own key, and the preview follows the
 *     answer; the server's refusal is shown under it;
 *   - removing an image asks first, then sends null;
 *   - a 404 from the server (the license stopped allowing it) leaves the page
 *     as empty as a path that does not exist.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      breadcrumbLinks: Array<{ title: string; to: { toString: () => string } }>;
      children: ReactElement;
      sideMenu: ReactElement;
    }): ReactElement => {
      return (
        <div data-testid="page">
          <nav data-testid="breadcrumbs">
            {props.breadcrumbLinks.map(
              (link: { title: string; to: { toString: () => string } }) => {
                return (
                  <a key={link.title} href={link.to.toString()}>
                    {link.title}
                  </a>
                );
              },
            )}
          </nav>
          {props.sideMenu}
          {props.children}
        </div>
      );
    },
  };
});

jest.mock("@oneuptime/admin-dashboard/Pages/Settings/SideMenu", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <aside data-testid="settings-side-menu" />;
    },
  };
});

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import WhiteLabelSettingsPage from "../../../AdminDashboard/WhiteLabel/WhiteLabelSettingsPage";

type MockedSpy = ReturnType<typeof jest.spyOn>;

const SETTINGS: JSONObject = {
  productName: "Acme Monitoring",
  websiteUrl: "https://acme.example",
  logo: {
    type: "image/png",
    sizeInBytes: 1200,
    url: "/api/branding/logo?v=1",
  },
  darkLogo: null,
  favicon: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const ok: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

const setBrandingEnvironment: (value: string | null) => void = (
  value: string | null,
): void => {
  const windowWithProcess: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  windowWithProcess.process = windowWithProcess.process || {};
  windowWithProcess.process.env = windowWithProcess.process.env || {};

  if (value === null) {
    delete windowWithProcess.process.env["PRODUCT_BRANDING"];
  } else {
    windowWithProcess.process.env["PRODUCT_BRANDING"] = value;
  }
};

let getSpy: MockedSpy;
let putSpy: MockedSpy;

beforeEach(() => {
  jest.clearAllMocks();
  setBrandingEnvironment("{}");
  getSpy = jest.spyOn(API, "get").mockResolvedValue(ok(SETTINGS) as never);
  putSpy = jest
    .spyOn(API, "put")
    .mockImplementation((async (options: { data: JSONObject }) => {
      return ok({ ...SETTINGS, ...options.data });
    }) as never);
});

afterEach(() => {
  cleanup();
  setBrandingEnvironment(null);
  jest.restoreAllMocks();
});

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(<WhiteLabelSettingsPage />);

  await screen.findByTestId("white-label-settings");
};

const putBody: (index?: number) => JSONObject = (
  index: number = 0,
): JSONObject => {
  return (putSpy.mock.calls[index]?.[0] as { data: JSONObject }).data;
};

describe("while the license does not allow white-labelling", () => {
  test("draws nothing and sends no request", async () => {
    setBrandingEnvironment(null);

    const { container } = render(<WhiteLabelSettingsPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(getSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  test("a malformed PRODUCT_BRANDING counts as not allowed", async () => {
    setBrandingEnvironment("not json");

    const { container } = render(<WhiteLabelSettingsPage />);

    expect(container).toBeEmptyDOMElement();
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("a 404 from the server (the license changed while the page was open) leaves the page empty", async () => {
    getSpy.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Page not found" }, {}) as never,
    );

    const { container } = render(<WhiteLabelSettingsPage />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("with white-labelling allowed", () => {
  test("reads the settings once and shows them", async () => {
    await renderPage();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(
      (getSpy.mock.calls[0]?.[0] as { url: { toString: () => string } }).url
        .toString()
        .endsWith("/branding/settings"),
    ).toBe(true);
    expect(screen.getByTestId("white-label-product-name")).toHaveTextContent(
      "Acme Monitoring",
    );
    expect(screen.getByTestId("white-label-website")).toHaveTextContent(
      "https://acme.example",
    );
    expect(screen.getByTestId("white-label-logo-image")).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
    expect(
      screen.queryByTestId("white-label-darkLogo-image"),
    ).not.toBeInTheDocument();
  });

  test("lives at Settings > White Label, with the settings side menu", async () => {
    await renderPage();

    expect(screen.getByTestId("settings-side-menu")).toBeInTheDocument();
    expect(screen.getByText("White Label")).toHaveAttribute(
      "href",
      "/admin/settings/white-label",
    );
  });

  test("says what an empty slot shows", async () => {
    getSpy.mockResolvedValue(
      ok({
        productName: null,
        websiteUrl: null,
        logo: null,
        darkLogo: null,
        favicon: null,
        updatedAt: null,
      }) as never,
    );

    await renderPage();

    expect(screen.getByTestId("white-label-product-name")).toHaveTextContent(
      "OneUptime (not changed)",
    );
    expect(screen.getByTestId("white-label-website")).toHaveTextContent(
      "Not set.",
    );
    expect(screen.getByTestId("white-label-logo-preview")).toHaveTextContent(
      "OneUptime's logo is shown.",
    );
    expect(
      screen.getByTestId("white-label-favicon-preview"),
    ).toHaveTextContent("OneUptime's icon is shown.");
  });

  test("previews each logo on the background it is for, whatever the theme", async () => {
    await renderPage();

    expect(screen.getByTestId("white-label-logo-preview")).toHaveStyle({
      backgroundColor: "#ffffff",
    });
    expect(screen.getByTestId("white-label-darkLogo-preview")).toHaveStyle({
      backgroundColor: "#0f172a",
    });
  });

  test("shows a read error in place of the settings", async () => {
    getSpy.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}) as never,
    );

    render(<WhiteLabelSettingsPage />);

    expect(await screen.findByText("Server Error")).toBeInTheDocument();
  });
});

describe("the product name and website", () => {
  test("are saved together as one PUT, and the card shows what came back", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await renderPage();

    await user.click(screen.getByText("Edit"));

    const nameInput: HTMLElement = await screen.findByPlaceholderText(
      "OneUptime",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "Acme Cloud");

    const websiteInput: HTMLElement =
      screen.getByPlaceholderText("https://example.com");
    await user.clear(websiteInput);

    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    });

    expect(putBody()).toEqual({ productName: "Acme Cloud", websiteUrl: null });
    expect(
      await screen.findByText("Acme Cloud", {
        selector: "[data-testid='white-label-product-name'] *",
      }),
    ).toBeInTheDocument();
  }, 30000);

  test("shows the server's refusal in the form and keeps it open", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    putSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "The product name can't contain line breaks or the characters < > { }.",
        },
        {},
      ) as never,
    );

    await renderPage();
    await user.click(screen.getByText("Edit"));

    const nameInput: HTMLElement = await screen.findByPlaceholderText(
      "OneUptime",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "Acme Cloud");
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "The product name can't contain line breaks or the characters < > { }.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeInTheDocument();
  }, 30000);
});

describe("an image", () => {
  const chooseFile: (slot: string, file: File) => void = (
    slot: string,
    file: File,
  ): void => {
    fireEvent.change(screen.getByTestId(`white-label-${slot}-input`), {
      target: { files: [file] },
    });
  };

  test("is sent as a data: URL under its own key, and the preview follows", async () => {
    putSpy.mockResolvedValue(
      ok({
        ...SETTINGS,
        darkLogo: {
          type: "image/png",
          sizeInBytes: 4,
          url: "/api/branding/dark-logo?v=2",
        },
      }) as never,
    );

    await renderPage();

    chooseFile(
      "darkLogo",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "dark.png", {
        type: "image/png",
      }),
    );

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    });

    expect(Object.keys(putBody())).toEqual(["darkLogo"]);
    expect(String(putBody()["darkLogo"])).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(
      await screen.findByTestId("white-label-darkLogo-image"),
    ).toHaveAttribute("src", "/api/branding/dark-logo?v=2");
  });

  test("over the size limit is refused here, in the server's words, and nothing is sent", async () => {
    await renderPage();

    chooseFile(
      "favicon",
      new File([new Uint8Array(128 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
    );

    expect(
      await screen.findByTestId("white-label-favicon-error"),
    ).toHaveTextContent("The browser tab icon must be 128 KB or smaller.");
    expect(putSpy).not.toHaveBeenCalled();
  });

  test("the server's refusal is shown under the image", async () => {
    putSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "The logo is an SVG with scripts, event handlers or embedded HTML in it. Remove them, or upload a PNG instead.",
        },
        {},
      ) as never,
    );

    await renderPage();

    chooseFile(
      "logo",
      new File(["<svg onload='x'></svg>"], "logo.svg", {
        type: "image/svg+xml",
      }),
    );

    expect(
      await screen.findByTestId("white-label-logo-error"),
    ).toHaveTextContent("The logo is an SVG with scripts");
  });

  test("the file picker takes the image types the server takes", async () => {
    await renderPage();

    expect(screen.getByTestId("white-label-logo-input")).toHaveAttribute(
      "accept",
      expect.stringContaining("image/svg+xml"),
    );
    expect(screen.getByTestId("white-label-logo-input")).not.toHaveAttribute(
      "accept",
      expect.stringContaining(".ico"),
    );
    expect(screen.getByTestId("white-label-favicon-input")).toHaveAttribute(
      "accept",
      expect.stringContaining(".ico"),
    );
  });

  test("Remove asks first, then sends null for that image only", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    putSpy.mockResolvedValue(ok({ ...SETTINGS, logo: null }) as never);

    await renderPage();

    await user.click(screen.getByTestId("white-label-logo-remove"));

    expect(putSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText("People will see OneUptime's logo again.", {
        exact: false,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    });

    expect(putBody()).toEqual({ logo: null });
    await waitFor(() => {
      expect(
        screen.queryByTestId("white-label-logo-image"),
      ).not.toBeInTheDocument();
    });
  }, 30000);

  test("an empty slot offers Upload and no Remove", async () => {
    await renderPage();

    expect(screen.getByTestId("white-label-favicon-upload")).toHaveTextContent(
      "Upload",
    );
    expect(
      screen.queryByTestId("white-label-favicon-remove"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("white-label-logo-upload")).toHaveTextContent(
      "Replace",
    );
  });
});
