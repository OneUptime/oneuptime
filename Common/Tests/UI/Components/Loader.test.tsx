import Loader, { LoaderType } from "../../../UI/Components/Loader/Loader";
import "@testing-library/jest-dom/extend-expect";
import { render, screen } from "@testing-library/react";
import Color from "../../../Types/Color";
import React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Loader tests", () => {
  test("it should render if bar loader show up", () => {
    render(
      <Loader
        size={50}
        color={new Color("#000000")}
        loaderType={LoaderType.Bar}
      />,
    );
    const barLoader: HTMLElement = screen.getByTestId("bar-loader");
    expect(barLoader).toBeInTheDocument();
  });
  test("it should render if beats loader show up", () => {
    render(
      <Loader
        size={50}
        color={new Color("#000000")}
        loaderType={LoaderType.Beats}
      />,
    );
    const beatLoader: HTMLElement = screen.getByTestId("beat-loader");
    expect(beatLoader).toBeInTheDocument();
  });
});
