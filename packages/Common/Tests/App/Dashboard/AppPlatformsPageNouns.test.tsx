import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * App Platforms' environments are CloudResource rows, and the rows their
 * pages list are CloudResourceInstance rows: models whose own nouns are
 * Cloud's ("Delete Cloud Resource", "cloud resource instances"). An
 * environment's pages say what App Platforms calls them. The shared
 * components are captured so the nouns each page hands them are asserted
 * exactly, beside Cloud's own Delete page, which keeps the model's.
 */

const modelDeleteMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelDeleteMock(props);
      return <div data-testid="model-delete" />;
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

import AppPlatformEnvironmentDelete from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Delete";
import AppPlatformEnvironmentInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Instances";
import CloudResourceDelete from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Delete";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import Route from "../../../Types/API/Route";

type Props = Record<string, any>;

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "72000000-0000-4000-8000-000000000001";

function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  url: string,
): void {
  goTo(url);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page
        pageRoute={new Route(url)}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function lastProps(mock: MockFunction): Props {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1]![0] as Props;
}

beforeEach(() => {
  modelDeleteMock.mockReset();
  modelTableMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("an environment's Delete page", () => {
  test("deletes the environment it is on, and calls it a cloud environment", () => {
    renderPage(
      AppPlatformEnvironmentDelete,
      `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/delete`,
    );

    const props: Props = lastProps(modelDeleteMock);
    expect(props["modelType"]).toBe(CloudResource);
    expect(props["modelId"].toString()).toBe(ENVIRONMENT_ID);
    // The side menu's Delete Environment opens "Delete Cloud Environment".
    expect(props["singularName"]).toBe("Cloud Environment");
    expect(new CloudResource().singularName).toBe("Cloud Resource");
  });

  test("Cloud's Delete page keeps the model's noun: it deletes a resource", () => {
    renderPage(
      CloudResourceDelete,
      `/dashboard/${PROJECT_ID}/cloud/${RESOURCE_ID}/delete`,
    );

    const props: Props = lastProps(modelDeleteMock);
    expect(props["modelType"]).toBe(CloudResource);
    expect(props["modelId"].toString()).toBe(RESOURCE_ID);
    expect(props["singularName"]).toBeUndefined();
  });
});

describe("an environment's Instances page", () => {
  test("lists the environment's own instances, and calls them instances", () => {
    renderPage(
      AppPlatformEnvironmentInstances,
      `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/instances`,
    );

    const props: Props = lastProps(modelTableMock);
    expect(props["modelType"]).toBe(CloudResourceInstance);
    expect(String(props["query"]["cloudResourceId"])).toBe(ENVIRONMENT_ID);
    // "Showing 1-3 of 3 instances", not "of 3 cloud resource instances".
    expect(props["singularName"]).toBe("Instance");
    expect(props["pluralName"]).toBe("Instances");
    expect(props["cardProps"]["title"]).toBe("Instances");
    expect(new CloudResourceInstance().pluralName).not.toBe("Instances");
  });
});
