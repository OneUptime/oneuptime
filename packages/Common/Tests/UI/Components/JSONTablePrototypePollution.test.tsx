import { JSONObject } from "../../../Types/JSON";
import JSONTable from "../../../UI/Components/JSONTable/JSONTable";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("JSONTable prototype-pollution protection", () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)["polluted"];
  });

  test("renders safe trace attributes and omits dangerous dotted paths", () => {
    const attributes: JSONObject = JSON.parse(
      '{"service.name":"checkout","__proto__.polluted":"yes","constructor.prototype.polluted":"yes","safe.__proto__.polluted":"yes"}',
    ) as JSONObject;

    render(<JSONTable json={attributes} />);

    expect(screen.getByText("service.name")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.queryByText(/__proto__/)).not.toBeInTheDocument();
    expect(screen.queryByText(/constructor/)).not.toBeInTheDocument();
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
      undefined,
    );
  });

  test("ignores inherited attributes before rendering", () => {
    const attributes: JSONObject = Object.create({
      "inherited.secret": "must-not-render",
    }) as JSONObject;
    attributes["owned.value"] = "visible";

    render(<JSONTable json={attributes} />);

    expect(screen.getByText("owned.value")).toBeInTheDocument();
    expect(screen.getByText("visible")).toBeInTheDocument();
    expect(screen.queryByText("inherited.secret")).not.toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
  });

  test("groups safe primitive arrays without consulting Object.prototype", () => {
    (Object.prototype as Record<string, unknown>)["polluted"] = [
      { index: 99, value: "must-not-render" },
    ];

    render(
      <JSONTable
        json={{
          "http.headers.0": "application/json",
          "http.headers.1": "text/plain",
        }}
      />,
    );

    expect(screen.getByText("http.headers")).toBeInTheDocument();
    expect(
      screen.getByText('["application/json","text/plain"]'),
    ).toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
  });

  test("copies an existing object bridge before expanding later attributes", () => {
    const callerBridge: JSONObject = Object.create({
      inherited: "must-not-render",
    }) as JSONObject;
    callerBridge["owned"] = "owned-value";

    const attributes: JSONObject = {};
    attributes["http"] = callerBridge;
    attributes["http.method"] = "GET";

    render(<JSONTable json={attributes} />);

    expect(screen.getByText("http.owned")).toBeInTheDocument();
    expect(screen.getByText("owned-value")).toBeInTheDocument();
    expect(screen.getByText("http.method")).toBeInTheDocument();
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(callerBridge["method"]).toBeUndefined();
  });

  test("omits nested object-valued prototype bridges", () => {
    const nestedValue: JSONObject = JSON.parse(
      '{"visible":"kept","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
    ) as JSONObject;

    render(<JSONTable json={{ details: nestedValue }} />);

    expect(screen.getByText("details.visible")).toBeInTheDocument();
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.queryByText(/__proto__/)).not.toBeInTheDocument();
    expect(screen.queryByText(/constructor/)).not.toBeInTheDocument();
    expect(screen.queryByText("yes")).not.toBeInTheDocument();
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
      undefined,
    );
  });

  test("renders reserved-looking primitive attribute names safely", () => {
    const attributes: JSONObject = JSON.parse(
      '{"http.constructor":"fetch","http.prototype":"otel","__proto__":"literal"}',
    ) as JSONObject;

    render(<JSONTable json={attributes} />);

    expect(screen.getByText("http.constructor")).toBeInTheDocument();
    expect(screen.getByText("fetch")).toBeInTheDocument();
    expect(screen.getByText("http.prototype")).toBeInTheDocument();
    expect(screen.getByText("otel")).toBeInTheDocument();
    expect(screen.getByText("__proto__")).toBeInTheDocument();
    expect(screen.getByText("literal")).toBeInTheDocument();
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
      undefined,
    );
  });
});
