import { Tab } from "../../Components/Tabs/Tab";
import Tabs from "../../Components/Tabs/Tabs";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../Types/MockType";

describe("Tabs", () => {
  const activeClass: string = "bg-gray-100 text-gray-700";

  const tab1: Tab = {
    name: "tab1",
    children: <div>tab 1 content</div>,
  };

  const tab2: Tab = {
    name: "tab2",
    children: <div>tab 2 content</div>,
  };

  const tabs: Array<Tab> = [tab1, tab2];

  test("it should render all props passed", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(getByTestId("tab-tab1")).toBeInTheDocument();
    expect(getByTestId("tab-tab2")).toBeInTheDocument();
  });

  test("it should render the first tab as active by default", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(getByTestId("tab-tab1")).toHaveClass(activeClass);
  });

  test("it should call onTabChange with the correct tab when a tab is clicked", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    fireEvent.click(getByTestId("tab-tab1"));
    expect(onTabChange).toHaveBeenCalledWith(tab1);

    fireEvent.click(getByTestId("tab-tab2"));
    expect(onTabChange).toHaveBeenCalledWith(tab2);
  });

  test("it should show the correct tab as active when a tab is clicked", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    fireEvent.click(getByTestId("tab-tab2"));

    expect(getByTestId("tab-tab1")).not.toHaveClass(activeClass);
    expect(getByTestId("tab-tab2")).toHaveClass(activeClass);
  });

  test("it should handle empty tabs array gracefully", () => {
    const tabs: Array<Tab> = [];
    const onTabChange: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Tabs tabs={tabs} onTabChange={onTabChange} />,
    );

    expect(() => {
      return getByTestId("tab-tab1");
    }).toThrow();

    expect(() => {
      return getByTestId("tab-tab2");
    }).toThrow();
  });
});
