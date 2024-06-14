import Component, {
  ComponentProps,
} from "../../../Components/Template/Template";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("Template Component", () => {
  const props: ComponentProps = {
    title: "Template title",
  };
  it("should render component with the correct title", () => {
    render(<Component {...props} />);
    expect(screen.getByText(props.title)).toBeInTheDocument();
  });
});
