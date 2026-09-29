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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The shared link dialog, rendered for real (BasicFormModal, BasicForm and
 * the entity dropdown included): it shows a loader while the recent records
 * are fetched, then the picker with its label and help text, inside a modal
 * carrying the page's title, description and submit button. The flows
 * behind it are covered with a stubbed modal in
 * IncidentAlertLinkDialog.test.tsx and BulkIncidentLinkActions.test.tsx.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import LinkIncidentAlertModal from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlert/LinkIncidentAlertModal";
import Alert from "../../../Models/DatabaseModels/Alert";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

type Deferred = {
  promise: Promise<Array<DropdownOption>>;
  resolve: (options: Array<DropdownOption>) => void;
};

type MakeDeferredFunction = () => Deferred;

const makeDeferred: MakeDeferredFunction = (): Deferred => {
  let resolve: (options: Array<DropdownOption>) => void = (): void => {};
  const promise: Promise<Array<DropdownOption>> = new Promise<
    Array<DropdownOption>
  >((done: (options: Array<DropdownOption>) => void): void => {
    resolve = done;
  });

  return { promise, resolve };
};

describe("LinkIncidentAlertModal", () => {
  let deferred: Deferred;
  let loadOptionCalls: number = 0;

  beforeEach(() => {
    deferred = makeDeferred();
    loadOptionCalls = 0;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("shows a loader until the recent records arrive, then the picker", async () => {
    render(
      <MemoryRouter>
        <LinkIncidentAlertModal
          title="Link Alert"
          description="Select an alert to link to this incident."
          submitButtonText="Link Alert"
          fieldTitle="Alert"
          fieldDescription="Recent alerts are listed with their number. Type to search every alert by title."
          placeholder="Select an alert"
          modelType={Alert}
          loadOptions={(): Promise<Array<DropdownOption>> => {
            loadOptionCalls++;
            return deferred.promise;
          }}
          onSubmit={async (): Promise<void> => {
            return Promise.resolve();
          }}
          onClose={(): void => {}}
        />
      </MemoryRouter>,
    );

    // The modal's title and its submit button.
    expect(screen.getAllByText("Link Alert")).toHaveLength(2);
    expect(
      screen.getByText("Select an alert to link to this incident."),
    ).toBeInTheDocument();
    expect(loadOptionCalls).toBe(1);
    expect(
      screen.queryByText(
        "Recent alerts are listed with their number. Type to search every alert by title.",
      ),
    ).not.toBeInTheDocument();

    deferred.resolve([
      { label: "ALT-63: Checkout API is offline", value: "a-63" },
    ]);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Recent alerts are listed with their number. Type to search every alert by title.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.getAllByText("Alert").length).toBeGreaterThan(0);
    expect(loadOptionCalls).toBe(1);
  });

  test("still shows the picker when the recent records cannot be read", async () => {
    render(
      <MemoryRouter>
        <LinkIncidentAlertModal
          title="Link Incident"
          description="Select an incident to link this alert to."
          submitButtonText="Link Incident"
          fieldTitle="Incident"
          fieldDescription="Recent incidents are listed with their number. Type to search every incident by title."
          placeholder="Select an incident"
          modelType={Alert}
          loadOptions={async (): Promise<Array<DropdownOption>> => {
            throw new Error("Forbidden");
          }}
          onSubmit={async (): Promise<void> => {
            return Promise.resolve();
          }}
          onClose={(): void => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Recent incidents are listed with their number. Type to search every incident by title.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Forbidden")).not.toBeInTheDocument();
  });
});
