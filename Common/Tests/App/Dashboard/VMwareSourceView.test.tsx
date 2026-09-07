import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VMwareSourceView from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Source";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";

jest.mock("Common/Models/DatabaseModels/VMwareSource", () => ({
  __esModule: true,
  default: class VMwareSource {},
}));
jest.mock("Common/Models/DatabaseModels/VMwareResource", () => ({
  __esModule: true,
  default: class VMwareResource {},
}));
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => ({
  __esModule: true,
  default: { getItem: jest.fn() },
}));
jest.mock("Common/UI/Utils/PermissionGate", () => ({
  __esModule: true,
  default: { check: jest.fn() },
  ModelAction: { Read: "read" },
}));
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Resources",
  () => ({
    __esModule: true,
    default: (): React.ReactElement => <div>Discovered inventory</div>,
  }),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => ({
    __esModule: true,
    default: (): React.ReactElement => <div>Resource history</div>,
  }),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/VMware/CreateMonitorButton",
  () => ({
    __esModule: true,
    default: (): React.ReactElement => <button>Create VMware monitor</button>,
  }),
);

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={["/vmware/12345678-1234-1234-1234-123456789abc"]}
    >
      <Routes>
        <Route path="/vmware/:modelId" element={<VMwareSourceView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VMware source resource access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ModelAPI.getItem).mockResolvedValue({
      _id: "12345678-1234-1234-1234-123456789abc",
      name: "Production vCenter",
      sourceIdentifier: "prod",
      lastCollectionAt: new Date(),
      lastSuccessfulCollectionAt: new Date(),
      metrics: {
        "oneuptime.vmware.source.up": 1,
        "oneuptime.vmware.source.inventory.complete": 1,
      },
    } as never);
  });
  test("source-only readers see connection health without mounting resource inventory or charts", async () => {
    jest.mocked(PermissionGate.check).mockReturnValue({ isAllowed: false });
    renderPage();
    expect(await screen.findByText("Production vCenter")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(
      screen.getByText(/Access to VMware resources is required/),
    ).toBeVisible();
    expect(screen.queryByText("Discovered inventory")).not.toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
    expect(screen.queryByText("Resource history")).not.toBeInTheDocument();
    expect(PermissionGate.check).toHaveBeenCalledWith(
      expect.any(VMwareResource),
      ModelAction.Read,
    );
  });
  test("resource readers can open the discovered inventory and performance tabs", async () => {
    jest.mocked(PermissionGate.check).mockReturnValue({ isAllowed: true });
    renderPage();
    expect(await screen.findByText("Discovered inventory")).toBeVisible();
    expect(screen.getByText("Performance")).toBeVisible();
    expect(
      screen.queryByText(/Access to VMware resources is required/),
    ).not.toBeInTheDocument();
  });
});
