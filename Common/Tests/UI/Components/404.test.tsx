import NotFound, { ComponentProps } from "../../../UI/Components/404";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render, screen } from "@testing-library/react";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import * as React from "react";
import { describe, expect, jest, beforeEach, test } from "@jest/globals";

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

// Import Navigation after mock setup
import Navigation from "../../../UI/Utils/Navigation";

describe("NotFound Component", () => {
  const mockProps: ComponentProps = {
    homeRoute: new Route("/"),
    supportEmail: new Email("support@example.com"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    render(<NotFound {...mockProps} />);
  });

  test("should display the 404 message", () => {
    const notFoundText: HTMLElement = screen.getByText("404");
    expect(notFoundText).toBeInTheDocument();
  });

  test('should display the "Page not found" title', () => {
    const pageTitle: HTMLElement = screen.getByText("Page not found");
    expect(pageTitle).toBeInTheDocument();
  });

  test('should display the "Please check the URL" message', () => {
    const errorMessage: HTMLElement = screen.getByText(
      "Please check the URL in the address bar and try again.",
    );
    expect(errorMessage).toBeInTheDocument();
  });

  test('should display "Go Home" button', () => {
    const goHomeButton: HTMLElement = screen.getByText("Go Home");
    expect(goHomeButton).toBeInTheDocument();
  });

  test('should display "Contact Support" button', () => {
    const contactSupportButton: HTMLElement =
      screen.getByText("Contact Support");
    expect(contactSupportButton).toBeInTheDocument();
  });

  test('should navigate to the home route when "Go Home" button is clicked', () => {
    const goHomeButton: HTMLElement = screen.getByText("Go Home");
    fireEvent.click(goHomeButton);
    expect(Navigation.navigate).toHaveBeenCalledWith(mockProps.homeRoute);
  });

  test('should navigate to the support email when "Contact Support" button is clicked', () => {
    const contactSupportButton: HTMLElement =
      screen.getByText("Contact Support");
    fireEvent.click(contactSupportButton);
    // The Navigation.navigate call with mailto URL
    expect(Navigation.navigate).toHaveBeenCalled();
  });
});
