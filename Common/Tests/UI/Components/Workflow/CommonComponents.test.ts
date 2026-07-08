import { getCommonComponents } from "../../../../UI/Components/Workflow/CommonComponents";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const meta: (id: string, componentType: ComponentType) => ComponentMetadata = (
  id: string,
  componentType: ComponentType,
): ComponentMetadata => {
  return {
    id: id,
    componentType: componentType,
  } as unknown as ComponentMetadata;
};

const catalog: Array<ComponentMetadata> = [
  meta("schedule", ComponentType.Trigger),
  meta("webhook", ComponentType.Trigger),
  meta("slack-send-message-to-channel", ComponentType.Component),
  meta("log", ComponentType.Component),
  meta("if-else", ComponentType.Component),
  meta("some-model-find-one", ComponentType.Component), // not curated
];

describe("CommonComponents.getCommonComponents", () => {
  test("returns curated components of the Component type in curated order", () => {
    const result: Array<ComponentMetadata> = getCommonComponents(
      catalog,
      ComponentType.Component,
    );
    /*
     * Curated order is slack, email, apiGet, apiPost, ifElse, ... log ...
     * Only slack, if-else and log are present, in that order.
     */
    expect(
      result.map((c: ComponentMetadata) => {
        return c.id;
      }),
    ).toEqual(["slack-send-message-to-channel", "if-else", "log"]);
  });

  test("returns curated triggers when asked for triggers", () => {
    const result: Array<ComponentMetadata> = getCommonComponents(
      catalog,
      ComponentType.Trigger,
    );
    expect(
      result.map((c: ComponentMetadata) => {
        return c.id;
      }),
    ).toEqual(["schedule", "webhook"]);
  });

  test("never surfaces a non-curated component", () => {
    const result: Array<ComponentMetadata> = getCommonComponents(
      catalog,
      ComponentType.Component,
    );
    expect(
      result.some((c: ComponentMetadata) => {
        return c.id === "some-model-find-one";
      }),
    ).toBe(false);
  });

  test("is empty when none of the curated ids are present", () => {
    expect(
      getCommonComponents(
        [meta("some-model-find-one", ComponentType.Component)],
        ComponentType.Component,
      ),
    ).toHaveLength(0);
  });
});
