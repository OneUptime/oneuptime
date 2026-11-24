import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { IssueRepositoryModal } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueModals";
import { DataSecurityFixRepository } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../Types/ObjectID";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * FIX WITH AI'S REPOSITORY DIALOG, ON AN ISSUE'S PAGE (#10362).
 *
 * The dialog read every repository the person could read and offered them
 * all, so it offered repositories they could not start a task in from Code
 * - and the server started one there anyway. Now it offers exactly the
 * repositories Fix with AI's answer listed: those the person may ask
 * OneUptime AI to work in. A telemetry issue is fixed in its service's
 * code, so its dialog asks for that repository, not infrastructure code.
 */

configure({ asyncUtilTimeout: 15000 });

const INFRA: DataSecurityFixRepository = {
  id: "10362000-0000-4000-8000-0000000000c1",
  name: "infra",
};
const PLATFORM: DataSecurityFixRepository = {
  id: "10362000-0000-4000-8000-0000000000c3",
  name: "platform",
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderDialog(data: {
  repositories: Array<DataSecurityFixRepository>;
  isTelemetry?: boolean;
  onSubmit?: (codeRepositoryId: ObjectID) => Promise<void>;
}): void {
  render(
    <MemoryRouter>
      <IssueRepositoryModal
        repositories={data.repositories}
        isTelemetry={Boolean(data.isTelemetry)}
        onClose={() => {}}
        onSubmit={
          data.onSubmit ||
          (async (): Promise<void> => {
            return undefined;
          })
        }
      />
    </MemoryRouter>,
  );
}

async function openRepositories(): Promise<void> {
  const combobox: HTMLElement = screen.getByRole("combobox");

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });
}

describe("Fix with AI's repository dialog", () => {
  test("offers exactly the repositories the server listed, by name", async () => {
    renderDialog({ repositories: [INFRA, PLATFORM] });

    await openRepositories();

    const options: Array<HTMLElement> = await screen.findAllByRole("option");

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["infra", "platform"]);
  });

  test("asks for the repository that holds the store's infrastructure code", () => {
    renderDialog({ repositories: [INFRA, PLATFORM] });

    expect(
      screen.getByText(
        "Pick the repository that holds this store's infrastructure code. OneUptime AI opens a pull request there.",
      ),
    ).toBeInTheDocument();
  });

  test("on a telemetry issue, asks for the repository that holds the service's code", () => {
    renderDialog({ repositories: [INFRA, PLATFORM], isTelemetry: true });

    expect(
      screen.getByText(
        "Pick the repository that holds this service's code. OneUptime AI opens a pull request there.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/infrastructure code/)).not.toBeInTheDocument();
  });

  test("the repository chosen is the one the fix is asked for in", async () => {
    const asked: Array<string> = [];

    renderDialog({
      repositories: [INFRA, PLATFORM],
      onSubmit: async (codeRepositoryId: ObjectID): Promise<void> => {
        asked.push(codeRepositoryId.toString());
      },
    });

    await openRepositories();

    const platform: HTMLElement = await screen.findByRole("option", {
      name: "platform",
    });

    await act(async () => {
      fireEvent.click(platform);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    });

    await waitFor(() => {
      expect(asked).toEqual([PLATFORM.id]);
    });
  });
});
