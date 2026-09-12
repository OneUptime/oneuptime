import ExceptionsLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/Layout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { Location } from "react-router-dom";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

interface NavigateSpy {
  mock: {
    calls: ReadonlyArray<ReadonlyArray<unknown>>;
  };
}

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Exceptions landing redirect", () => {
  test("a bare Exceptions URL opens the Unresolved list", () => {
    const barePath: string = `/dashboard/${PROJECT_ID}/exceptions`;
    goTo(barePath);

    const navigate: NavigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    render(<ExceptionsLayout {...({} as PageComponentProps)} />);

    expect(navigate).toHaveBeenCalledTimes(1);

    const destination: Route = navigate.mock.calls[0]![0] as Route;

    expect(destination.toString()).toBe(
      `/dashboard/${PROJECT_ID}/exceptions/unresolved`,
    );
    expect(destination.toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS] as Route,
      ).toString(),
    );
  });
});
