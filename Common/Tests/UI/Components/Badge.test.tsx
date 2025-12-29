import Badge, { BadgeType } from "../../../UI/Components/Badge/Badge";
import "@testing-library/jest-dom/extend-expect";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Badge", () => {
  test("it should render all props", () => {
    render(<Badge id="badge" badgeCount={2} badgeType={BadgeType.SUCCESS} />);
    const badge: HTMLElement = screen.getByTestId("badge");
    expect(badge).toBeInTheDocument();
  });
  test("it should show badge when badgetype is equal to success", () => {
    render(<Badge id="badge" badgeCount={1} badgeType={BadgeType.SUCCESS} />);
    const badge: HTMLElement = screen.getByTestId("badge");
    expect(badge).toBeInTheDocument();
    const testId: HTMLElement = screen.getByText(1);
    expect(testId).toHaveClass("text-emerald-700");
  });
  test("it should show success when badgetype is equal to success", () => {
    render(<Badge badgeCount={1} badgeType={BadgeType.SUCCESS} />);
    const testId: HTMLElement = screen.getByText(1);
    expect(testId).toHaveClass("text-emerald-700");
  });
  test("it should show danger when badgetype is equal to danger", () => {
    render(<Badge badgeCount={1} badgeType={BadgeType.DANGER} />);
    const testId: HTMLElement = screen.getByText(1);
    expect(testId).toHaveClass("text-red-700");
  });
  test("it should show warning when badgetype is equal to warning", () => {
    render(<Badge badgeCount={1} badgeType={BadgeType.WARNING} />);
    const testId: HTMLElement = screen.getByText(1);
    expect(testId).toHaveClass("text-amber-700");
  });
  test("it should show danger when badgetype is equal to danger", () => {
    render(<Badge badgeCount={1} badgeType={BadgeType.DANGER} />);
    const testId: HTMLElement = screen.getByText(1);
    expect(testId).toHaveClass("text-red-700");
  });
  test("it should badgeCount when badgetype is equal to success", () => {
    render(<Badge badgeCount={2} badgeType={BadgeType.SUCCESS} />);
    const testId: HTMLElement = screen.getByText(2);
    expect(testId).toHaveTextContent("2");
  });
  test("it should badgeCount when badgetype is equal to danger", () => {
    render(<Badge badgeCount={2} badgeType={BadgeType.DANGER} />);
    const testId: HTMLElement = screen.getByText(2);
    expect(testId).toHaveTextContent("2");
  });
  test("it should badgeCount when badgetype is equal to warning", () => {
    render(<Badge badgeCount={2} badgeType={BadgeType.WARNING} />);
    const testId: HTMLElement = screen.getByText(2);
    expect(testId).toHaveTextContent("2");
  });

  test("should not show a badge when the count is 0", () => {
    render(<Badge badgeCount={0} badgeType={BadgeType.WARNING} />);
    expect(screen.queryByRole("badge")).toBeFalsy();
  });
});
