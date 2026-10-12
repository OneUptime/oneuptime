import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import TemplateVariablesModal from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesModal";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";

/*
 * The "Syntax tips" under Dynamic Template Variables, the list a monitor
 * criteria's Learn about dynamic templates opens.
 *
 * The last tip said missing values render as empty strings. They do not:
 * VMUtil.replaceValueInPlace leaves a placeholder it cannot resolve as
 * written, braces and all - on purpose, so a mistyped variable shows in the
 * incident instead of silently vanishing. The tip now says so, and the cases
 * below hold it to what MonitorTemplateUtil renders.
 */

const NO_VALUE_TIP: string =
  "A variable with no value is left as written, so a mistyped name shows in the text.";

function tipsList(): HTMLElement {
  const heading: HTMLElement = screen.getByText("Syntax tips");

  return heading.parentElement!.querySelector("ul") as HTMLElement;
}

function tipTexts(): Array<string> {
  return within(tipsList())
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function storageMap(): JSONObject {
  const monitor: Monitor = new Monitor();
  monitor.name = "Production API";

  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.API,
    dataToProcess: {
      isOnline: false,
      responseCode: 503,
      responseBody: "{}",
    } as unknown as DataToProcess,
    monitor: monitor,
  });
}

afterEach(() => {
  cleanup();
});

describe("TemplateVariablesModal - syntax tips", () => {
  test("says a variable with no value is left as written", () => {
    render(
      <TemplateVariablesModal
        monitorType={MonitorType.API}
        onClose={(): void => {}}
      />,
    );

    expect(tipTexts()).toEqual([
      "Wrap the variable name in double braces: {{monitorName}}",
      "Use dot paths for nested values: {{responseBody.data.status}}",
      NO_VALUE_TIP,
    ]);
  });

  test("never says a missing value renders empty", () => {
    render(
      <TemplateVariablesModal
        monitorType={MonitorType.Kubernetes}
        seriesAttributeKeys={["host.name"]}
        onClose={(): void => {}}
      />,
    );

    const tips: string = tipTexts().join("\n");

    expect(tips).not.toMatch(/empty string/i);
    expect(tips).not.toMatch(/will not break/i);
  });

  test("is shown for every monitor type", () => {
    for (const monitorType of Object.values(
      MonitorType,
    ) as Array<MonitorType>) {
      const { unmount } = render(
        <TemplateVariablesModal
          monitorType={monitorType}
          onClose={(): void => {}}
        />,
      );

      expect(tipTexts()).toContain(NO_VALUE_TIP);
      unmount();
    }
  });
});

describe("the tip says what the renderer does", () => {
  test("a mistyped variable stays in the text, braces and all", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{monitorNmae}} is down",
        storageMap: storageMap(),
      }),
    ).toBe("{{monitorNmae}} is down");
  });

  test("a path into the response that leads nowhere stays as written", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "Error {{responseBody.error.id}}",
        storageMap: storageMap(),
      }),
    ).toBe("Error {{responseBody.error.id}}");
  });

  test("a variable that has a value is replaced, next to one that has none", () => {
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{monitorName}}: {{failureCause}}",
        storageMap: storageMap(),
      }),
    ).toBe("Production API: {{failureCause}}");
  });

  test("a description leaves a missing variable as written too", () => {
    expect(
      MonitorTemplateUtil.processMarkdownTemplateString({
        value: "Status {{responseStatusCode}}, cause {{failureCause}}",
        storageMap: storageMap(),
      }),
    ).toBe("Status 503, cause {{failureCause}}");
  });
});
