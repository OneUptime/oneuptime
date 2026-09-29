import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * "Download offline license token" on the OneUptime Cloud license view: asks
 * for the customer's instance id, POSTs it to the license server and saves the
 * returned token as a text file. The token is never shown on the page.
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

jest.mock("Common/UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import OfflineLicenseTokenCard, {
  getOfflineLicenseTokenFilename,
  getOfflineLicenseTokenRoute,
  requestOfflineLicenseToken,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/OfflineLicenseTokenCard";

type MockedFn = ReturnType<typeof jest.fn>;

const LICENSE_ID: ObjectID = new ObjectID(
  "4a1f0c2d-5e6b-4c7d-8e9f-a0b1c2d3e4f5",
);
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";
const TOKEN: string = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

const downloadFileMock: MockedFn = downloadFile as unknown as MockedFn;

const okResponse: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.clearAllMocks();
  postSpy = jest.spyOn(API, "post").mockResolvedValue(
    okResponse({
      token: TOKEN,
      kid: "kid-1",
      licenseId: LICENSE_ID.toString(),
      instanceId: INSTANCE_ID,
      expiresAt: "2027-09-18T00:00:00.000Z",
    }) as never,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("offline license token helpers", () => {
  test("posts to the license's offline-token route", () => {
    expect(getOfflineLicenseTokenRoute(LICENSE_ID).toString()).toContain(
      `/enterprise-license/${LICENSE_ID.toString()}/offline-token`,
    );
  });

  test("names the file after the company and the instance", () => {
    expect(
      getOfflineLicenseTokenFilename({
        companyName: "Acme, Inc. (EU)",
        instanceId: INSTANCE_ID,
      }),
    ).toBe(`oneuptime-enterprise-license-acme-inc-eu-${INSTANCE_ID}.txt`);
    expect(
      getOfflineLicenseTokenFilename({
        companyName: undefined,
        instanceId: INSTANCE_ID,
      }),
    ).toBe(`oneuptime-enterprise-license-license-${INSTANCE_ID}.txt`);
  });

  test("returns the token the server issued", async () => {
    await expect(
      requestOfflineLicenseToken({
        licenseId: LICENSE_ID,
        instanceId: INSTANCE_ID,
      }),
    ).resolves.toEqual({
      token: TOKEN,
      instanceId: INSTANCE_ID,
      expiresAt: "2027-09-18T00:00:00.000Z",
    });

    const call: Record<string, unknown> = postSpy.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(String(call["url"])).toContain(
      `/enterprise-license/${LICENSE_ID.toString()}/offline-token`,
    );
    expect(call["data"]).toEqual({ instanceId: INSTANCE_ID });
  });

  test("throws the server's error (a 400 explaining EdDSA is not configured)", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "Offline license tokens need EdDSA license signing" },
        {},
      ) as never,
    );

    await expect(
      requestOfflineLicenseToken({
        licenseId: LICENSE_ID,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("refuses a response without a token", async () => {
    postSpy.mockResolvedValue(okResponse({}) as never);

    await expect(
      requestOfflineLicenseToken({
        licenseId: LICENSE_ID,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toThrow("did not return a license token");
  });
});

describe("OfflineLicenseTokenCard", () => {
  const openModalAndSubmit: (instanceId: string) => Promise<void> = async (
    instanceId: string,
  ): Promise<void> => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.click(
      screen.getByText("pages.enterpriseLicenseView.offlineTokenButton"),
    );

    const input: HTMLElement = await screen.findByPlaceholderText(
      "00000000-0000-0000-0000-000000000000",
    );

    await user.type(input, instanceId);
    await user.click(screen.getByTestId("modal-footer-submit-button"));
  };

  test("offers the download on the license view, with no token on the page", () => {
    render(
      <OfflineLicenseTokenCard licenseId={LICENSE_ID} companyName="Acme Inc" />,
    );

    expect(
      screen.getByText("pages.enterpriseLicenseView.offlineTokenCardTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pages.enterpriseLicenseView.offlineTokenButton"),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("asks for the instance id, then downloads the token as a text file", async () => {
    render(
      <OfflineLicenseTokenCard licenseId={LICENSE_ID} companyName="Acme Inc" />,
    );

    await openModalAndSubmit(INSTANCE_ID);

    await waitFor(() => {
      expect(downloadFileMock).toHaveBeenCalledTimes(1);
    });

    expect(downloadFileMock).toHaveBeenCalledWith({
      content: TOKEN,
      filename: `oneuptime-enterprise-license-acme-inc-${INSTANCE_ID}.txt`,
      mimeType: "text/plain;charset=utf-8;",
    });
    expect(
      (postSpy.mock.calls[0]?.[0] as Record<string, unknown>)["data"],
    ).toEqual({ instanceId: INSTANCE_ID });
    expect(
      await screen.findByTestId("offline-license-token-issued"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
  }, 30000);

  test("shows the server's reason and downloads nothing when the server refuses", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "Offline license tokens need EdDSA license signing, which is not configured on this server.",
        },
        {},
      ) as never,
    );

    render(<OfflineLicenseTokenCard licenseId={LICENSE_ID} />);

    await openModalAndSubmit(INSTANCE_ID);

    expect(
      await screen.findByText(
        "Offline license tokens need EdDSA license signing, which is not configured on this server.",
      ),
    ).toBeInTheDocument();
    expect(downloadFileMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("offline-license-token-issued"),
    ).not.toBeInTheDocument();
  }, 30000);

  test("does not call the server without an instance id", async () => {
    render(<OfflineLicenseTokenCard licenseId={LICENSE_ID} />);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.click(
      screen.getByText("pages.enterpriseLicenseView.offlineTokenButton"),
    );
    await screen.findByPlaceholderText("00000000-0000-0000-0000-000000000000");
    await user.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toBeInTheDocument();
    });
    expect(postSpy).not.toHaveBeenCalled();
  }, 30000);
});
