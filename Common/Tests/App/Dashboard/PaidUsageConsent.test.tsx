import "@testing-library/jest-dom";
import React from "react";
import userEvent from "@testing-library/user-event";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PaidUsageConsent from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PaidUsageConsent";
import BaseAPI from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";

jest.mock("../../../UI/Config", () => {
  return { ...jest.requireActual("../../../UI/Config"), BILLING_ENABLED: true };
});

describe("PaidUsageConsent", () => {
  const onChange: jest.Mock = jest.fn();
  const projectId: ObjectID = ObjectID.generate();

  const renderConsent: () => ReturnType<typeof render> = () => {
    return render(
      <PaidUsageConsent
        title="I agree to usage charges"
        description="$1 per active monitor per month"
        dataTestId="consent"
        onChange={onChange}
      />,
    );
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    onChange.mockClear();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  });

  it("keeps consent disabled until the authoritative status returns", async () => {
    let resolve: (value: any) => void = (): void => {};
    jest.spyOn(BaseAPI, "get").mockImplementation(() => {
      return new Promise<any>((done: (value: any) => void) => {
        resolve = done;
      });
    });
    renderConsent();
    expect(screen.getByTestId("consent")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Checking");
    await act(async () => {
      resolve({ data: { isAllowed: true } });
    });
    expect(screen.getByTestId("consent")).toBeEnabled();
    expect(screen.getByTestId("consent")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("consent"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("explains locked features and lets the user recheck after billing setup", async () => {
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValueOnce({ data: { isAllowed: false } } as any)
      .mockResolvedValueOnce({ data: { isAllowed: true } } as any);
    renderConsent();
    await screen.findByText(/Add a payment method before/);
    expect(screen.getByTestId("consent")).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Set up billing" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${projectId.toString()}/settings/billing`,
    );
    await userEvent.click(screen.getByTestId("consent"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(screen.getByTestId("consent")).toBeEnabled();
    });
    expect(screen.getByTestId("consent")).not.toBeChecked();
  });

  it("keeps consent locked on network failure and supports retry", async () => {
    jest
      .spyOn(BaseAPI, "get")
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ data: { isAllowed: true } } as any);
    renderConsent();
    await screen.findByText(/We could not check paid feature access/);
    expect(screen.getByTestId("consent")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(screen.getByTestId("consent")).toBeEnabled();
    });
  });

  it("does not accept an absent or nonboolean authorization value", async () => {
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: "true" } } as any);
    renderConsent();
    await screen.findByText(/Add a payment method before/);
    expect(screen.getByTestId("consent")).toBeDisabled();
  });

  it("does not use a stale project response after the selected project changes", async () => {
    let resolveOld: (value: any) => void = (): void => {};
    jest
      .spyOn(BaseAPI, "get")
      .mockImplementationOnce(() => {
        return new Promise<any>((done: (value: any) => void) => {
          resolveOld = done;
        });
      })
      .mockResolvedValueOnce({ data: { isAllowed: false } } as any);
    const view: ReturnType<typeof render> = renderConsent();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    view.rerender(
      <PaidUsageConsent
        title="I agree"
        description="Paid usage"
        dataTestId="consent"
      />,
    );
    await screen.findByText(/Add a payment method before/);
    await act(async () => {
      resolveOld({ data: { isAllowed: true } });
    });
    expect(screen.getByTestId("consent")).toBeDisabled();
  });

  it("does not reload eligibility when a form recreates its callback", async () => {
    const getStatus: jest.SpyInstance = jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: true } } as any);
    const view: ReturnType<typeof render> = renderConsent();
    await waitFor(() => {
      expect(screen.getByTestId("consent")).toBeEnabled();
    });
    view.rerender(
      <PaidUsageConsent
        title="I agree"
        description="Paid usage"
        dataTestId="consent"
        onChange={(): void => {}}
      />,
    );
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier acknowledgement when changing projects", async () => {
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: true } } as any);
    const view: ReturnType<typeof render> = renderConsent();
    await waitFor(() => {
      expect(screen.getByTestId("consent")).toBeEnabled();
    });
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    view.rerender(
      <PaidUsageConsent
        title="I agree"
        description="Paid usage"
        dataTestId="consent"
        value={true}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.getByTestId("consent")).toBeEnabled();
    });
  });
});
