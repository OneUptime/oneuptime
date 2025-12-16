import DuplicateModel from "../../../UI/Components/DuplicateModel/DuplicateModel";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { describe, expect, it, jest } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import CrudApiEndpoint from "../../../Types/Database/CrudApiEndpoint";
import TableMetaData from "../../../Types/Database/TableMetadata";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import React from "react";
import { act } from "react-test-renderer";
import Select from "../../../Types/BaseDatabase/Select";
jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

import Navigation from "../../../UI/Utils/Navigation";

// Track mock call count to return different values
let getItemCallCount = 0;
let createCallCount = 0;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    getItem: jest.fn().mockImplementation(() => {
      getItemCallCount++;
      if (getItemCallCount <= 2) {
        return Promise.resolve({
          changeThis: "changed",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setValue: function (key: string, value: string): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any)[key] = value;
          },
          removeValue: jest.fn(),
        });
      }
      return Promise.resolve(undefined);
    }),
    create: jest.fn().mockImplementation(() => {
      createCallCount++;
      if (createCallCount === 1) {
        return Promise.resolve({
          data: {
            id: "foobar",
            changeThis: "changed",
          },
        });
      }
      return Promise.resolve(undefined);
    }),
  };
});

@TableMetaData({
  tableName: "Foo",
  singularName: "Foo",
  pluralName: "Foos",
  icon: IconProp.Wrench,
  tableDescription: "A test model",
})
@CrudApiEndpoint(new Route("/testModel"))
class TestModel extends BaseModel {
  public changeThis?: string = "original";
}

describe("DuplicateModel", () => {
  const fieldsToDuplicate: Select<TestModel> = {};
  const fieldsToChange: Array<ModelField<TestModel>> = [
    {
      field: {
        changeThis: true,
      },
      title: "Change This",
      required: false,
      placeholder: "You can change this",
    },
  ];
  it("renders correctly", () => {
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
      />,
    );
    expect(screen.getByTestId("card-details-heading")?.textContent).toBe(
      "Duplicate Foo",
    );
    expect(screen.getByTestId("card-description")?.textContent).toBe(
      "Duplicating this foo will create another foo exactly like this one.",
    );
    expect(screen.getByTestId("card-button")?.textContent).toBe(
      "Duplicate Foo",
    );
  });
  it("shows confirmation modal when duplicate button is clicked", () => {
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeDefined();
    const confirmDialog: HTMLElement = screen.getByRole("dialog");
    expect(within(confirmDialog).getByTestId("modal-title")?.textContent).toBe(
      "Duplicate Foo",
    );
    expect(
      within(confirmDialog).getByTestId("modal-description")?.textContent,
    ).toBe("Are you sure you want to duplicate this foo?");
    expect(
      within(confirmDialog).getByTestId("modal-footer-submit-button")
        ?.textContent,
    ).toBe("Duplicate Foo");
    expect(
      within(confirmDialog).getByTestId("modal-footer-close-button")
        ?.textContent,
    ).toBe("Cancel");
  });
  it("duplicates item when confirmation button is clicked", async () => {
    const onDuplicateSuccess: (item: TestModel) => void = jest.fn();
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
        onDuplicateSuccess={onDuplicateSuccess}
        navigateToOnSuccess={new Route("/done")}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(button);
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    const confirmationButton: HTMLElement = within(dialog).getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(confirmationButton);
    });
    await waitFor(() => {
      return expect(onDuplicateSuccess).toBeCalledWith({
        id: "foobar",
        changeThis: "changed",
      });
    });
    await waitFor(() => {
      return expect(Navigation.navigate).toBeCalledWith(
        new Route("/done/foobar"),
        {
          forceNavigate: true,
        },
      );
    });
  });
  it("closes confirmation dialog when close button is clicked", () => {
    const onDuplicateSuccess: (item: TestModel) => void = jest.fn();
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
        onDuplicateSuccess={onDuplicateSuccess}
        navigateToOnSuccess={new Route("/done")}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(button);
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    const closeButton: HTMLElement = within(dialog).getByRole("button", {
      name: "Cancel",
    });
    void act(() => {
      fireEvent.click(closeButton);
    });
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });
  it("handles could not create error correctly", async () => {
    const onDuplicateSuccess: (item: TestModel) => void = jest.fn();
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
        onDuplicateSuccess={onDuplicateSuccess}
        navigateToOnSuccess={new Route("/done")}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(button);
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    const confirmationButton: HTMLElement = within(dialog).getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(confirmationButton);
    });
    await screen.findByText("Duplicate Error");
    const errorDialog: HTMLElement = screen.getByRole("dialog");
    expect(within(errorDialog).getByTestId("modal-title")?.textContent).toBe(
      "Duplicate Error",
    );
    expect(
      within(errorDialog).getByTestId("confirm-modal-description")?.textContent,
    ).toBe("Error: Could not create Foo");
    expect(
      within(errorDialog).getByTestId("modal-footer-submit-button")
        ?.textContent,
    ).toBe("Close");
  });
  it("handles item not found error correctly", async () => {
    const onDuplicateSuccess: (item: TestModel) => void = jest.fn();
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
        onDuplicateSuccess={onDuplicateSuccess}
        navigateToOnSuccess={new Route("/done")}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(button);
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    const confirmationButton: HTMLElement = within(dialog).getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(confirmationButton);
    });
    await screen.findByText("Duplicate Error");
    const errorDialog: HTMLElement = screen.getByRole("dialog");
    expect(within(errorDialog).getByTestId("modal-title")?.textContent).toBe(
      "Duplicate Error",
    );
    expect(
      within(errorDialog).getByTestId("confirm-modal-description")?.textContent,
    ).toBe("Error: Could not find Foo with id foo");
    expect(
      within(errorDialog).getByTestId("modal-footer-submit-button")
        ?.textContent,
    ).toBe("Close");
  });
  it("closes error dialog when close button is clicked", async () => {
    const onDuplicateSuccess: (item: TestModel) => void = jest.fn();
    render(
      <DuplicateModel
        modelType={TestModel}
        modelId={new ObjectID("foo")}
        fieldsToDuplicate={fieldsToDuplicate}
        fieldsToChange={fieldsToChange}
        onDuplicateSuccess={onDuplicateSuccess}
        navigateToOnSuccess={new Route("/done")}
      />,
    );
    const button: HTMLElement = screen.getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(button);
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    const confirmationButton: HTMLElement = within(dialog).getByRole("button", {
      name: "Duplicate Foo",
    });
    void act(() => {
      fireEvent.click(confirmationButton);
    });
    await screen.findByText("Duplicate Error");
    const errorDialog: HTMLElement = screen.getByRole("dialog");
    const closeButton: HTMLElement = within(errorDialog).getByRole("button", {
      name: "Close",
    });
    void act(() => {
      fireEvent.click(closeButton);
    });
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });
});
