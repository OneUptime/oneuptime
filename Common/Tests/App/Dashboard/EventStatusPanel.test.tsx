import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import EventStatusPanel from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { Black, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

const CREATED: Color = new Color("#6366f1");
const ACKNOWLEDGED: Color = new Color("#22c55e");

describe("EventStatusPanel header notice", () => {
  test("renders a notice inside the titled header card", () => {
    render(
      <EventStatusPanel
        title="Database latency"
        identifier="INC-42"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    const notice: HTMLElement = screen.getByTestId("header-notice");
    expect(notice).toHaveTextContent("AI is investigating");
    expect(notice.parentElement).toHaveClass("mt-3");
    expect(screen.getByText("Database latency")).toBeInTheDocument();
    expect(screen.getByText("INC-42")).toBeInTheDocument();
  });

  test("adds no empty notice spacing when the optional content is absent", () => {
    const { container } = render(
      <EventStatusPanel
        title="Database latency"
        states={[]}
        actions={[]}
        onActionClick={() => {}}
      />,
    );

    expect(container.querySelector(".mt-3")).toBeNull();
  });

  test("keeps existing metadata, state progress, and actions intact beside the notice", () => {
    const onActionClick: MockFunction = getJestMockFunction();
    render(
      <EventStatusPanel
        title="Database latency"
        states={[
          { id: "created", name: "Created", color: CREATED },
          {
            id: "acknowledged",
            name: "Acknowledged",
            color: ACKNOWLEDGED,
          },
        ]}
        currentStateId="created"
        severity={{ name: "Critical", color: Red500 }}
        isPrivate={true}
        durationPrefix="Ongoing for"
        durationStartsAt={new Date("2026-08-07T10:00:00.000Z")}
        durationEndsAt={new Date("2026-08-07T10:05:00.000Z")}
        actions={[
          {
            stateId: "acknowledged",
            label: "Acknowledge",
            icon: IconProp.Check,
            buttonStyle: ButtonStyleType.PRIMARY,
          },
        ]}
        onActionClick={onActionClick}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Ongoing for")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onActionClick).toHaveBeenCalledWith("acknowledged");
  });

  test("leaves compact consumers unchanged", () => {
    render(
      <EventStatusPanel
        identifier="#7"
        states={[{ id: "created", name: "Created", color: Black }]}
        currentStateId="created"
        actions={[]}
        onActionClick={() => {}}
        headerNotice={
          <div data-testid="header-notice">AI is investigating</div>
        }
      />,
    );

    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.queryByTestId("header-notice")).not.toBeInTheDocument();
  });
});
