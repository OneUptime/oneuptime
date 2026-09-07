import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VMwareResourceView from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Resource";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import ObjectID from "../../../Types/ObjectID";

jest.mock("Common/Models/DatabaseModels/VMwareSource", () => {
  return {
    __esModule: true,
    default: class VMwareSource {},
  };
});
jest.mock("Common/Models/DatabaseModels/VMwareResource", () => {
  return {
    __esModule: true,
    default: class VMwareResource {},
  };
});
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: { getItem: jest.fn(), updateById: jest.fn() },
  };
});
jest.mock("Common/UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: { check: jest.fn() },
    ModelAction: { Update: "update" },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div>Resource history</div>;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/VMware/CreateMonitorButton",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <button>Create VMware monitor</button>;
      },
    };
  },
);

const sourceId: string = "12345678-1234-1234-1234-123456789abc";
const resourceId: string = "22345678-1234-1234-1234-123456789abc";
const source: VMwareSource = {
  _id: sourceId,
  name: "Production vCenter",
  sourceIdentifier: "prod",
  lastSeenAt: new Date(),
  lastCollectionAt: new Date(),
  lastSuccessfulCollectionAt: new Date(),
  metrics: {
    "oneuptime.vmware.source.up": 1,
    "oneuptime.vmware.source.inventory.complete": 1,
  },
} as VMwareSource;
const resource: VMwareResource = {
  _id: resourceId,
  sourceId: new ObjectID(sourceId),
  name: "payments-db",
  resourceIdentifier: "vm-123",
  resourceType: "vm",
  lastSeenAt: new Date(),
  metadata: { "oneuptime.vmware.resource.power_state": "poweredOff" },
} as VMwareResource;

function renderPage(): void {
  render(
    <MemoryRouter
      initialEntries={[`/vmware/${sourceId}/resources/${resourceId}`]}
    >
      <Routes>
        <Route
          path="/vmware/:modelId/resources/:subModelId"
          element={<VMwareResourceView />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VMware resource page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(PermissionGate.check).mockReturnValue({ isAllowed: true });
    jest
      .mocked(ModelAPI.getItem)
      .mockImplementation(
        async (args: Parameters<typeof ModelAPI.getItem>[0]) => {
          return (args.modelType === VMwareSource ? source : resource) as never;
        },
      );
    jest.mocked(ModelAPI.updateById).mockResolvedValue({} as never);
  });
  test("loads the actual scoped resource, exposes history, and saves explicit expectations", async () => {
    renderPage();
    await screen.findByText("payments-db");
    expect(screen.getByText("Powered off")).toBeVisible();
    expect(screen.getByText("Resource history")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Expected to run"), {
      target: { value: "true" },
    });
    fireEvent.change(screen.getByLabelText("Maintenance"), {
      target: { value: "false" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save expectations" }));
    await waitFor(() => {
      expect(ModelAPI.updateById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { expectedRunning: true, maintenanceMode: false },
        }),
      );
    });
    await screen.findByText("Monitoring expectations saved.");
  });
  test("inherit clears both overrides with null instead of coercing them to false", async () => {
    renderPage();
    await screen.findByLabelText("Expected to run");
    fireEvent.click(screen.getByRole("button", { name: "Save expectations" }));
    await waitFor(() => {
      expect(ModelAPI.updateById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { expectedRunning: null, maintenanceMode: null },
        }),
      );
    });
  });
  test("refreshing telemetry preserves unsaved monitoring expectations", async () => {
    renderPage();
    await screen.findByLabelText("Expected to run");
    fireEvent.change(screen.getByLabelText("Expected to run"), {
      target: { value: "true" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(ModelAPI.getItem).toHaveBeenCalledTimes(4);
    });
    expect(screen.getByLabelText("Expected to run")).toHaveValue("true");
  });
  test("read-only users can inspect but cannot change monitoring expectations", async () => {
    jest.mocked(PermissionGate.check).mockReturnValue({ isAllowed: false });
    renderPage();
    expect(await screen.findByLabelText("Expected to run")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save expectations" }),
    ).not.toBeInTheDocument();
  });
  test("rejects a resource from another source even if the resource ID exists", async () => {
    jest
      .mocked(ModelAPI.getItem)
      .mockImplementation(
        async (args: Parameters<typeof ModelAPI.getItem>[0]) => {
          return (
            args.modelType === VMwareSource
              ? source
              : ({
                  ...resource,
                  sourceId: new ObjectID(
                    "32345678-1234-1234-1234-123456789abc",
                  ),
                } as VMwareResource)
          ) as never;
        },
      );
    renderPage();
    await screen.findByText("VMware resource not found in this source.");
    expect(screen.queryByText("payments-db")).not.toBeInTheDocument();
  });
  test("a failed save remains visible and does not report success", async () => {
    jest
      .mocked(ModelAPI.updateById)
      .mockRejectedValue(new Error("Permission changed"));
    renderPage();
    await screen.findByLabelText("Expected to run");
    fireEvent.click(screen.getByRole("button", { name: "Save expectations" }));
    await screen.findByText("Permission changed");
    expect(
      screen.queryByText("Monitoring expectations saved."),
    ).not.toBeInTheDocument();
  });
});
