import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * A layer's form, at the bottom of an expanded layer on a schedule's Layers
 * page, in plain words.
 *
 * It said "Give this layer a clear name so your team knows what it covers."
 * over a name whose column added "Friendly name for this layer", then asked
 * for a description ("Optional. Explain the purpose of this layer.") that
 * most layers never have, and explained the rotation in the words of the
 * engine: "The date and time this layer's on-call rotation begins.", "How
 * often on-call duty passes to the next user in this layer.", "Hand-offs then
 * repeat every rotation interval." Now each field says in a few words what
 * it decides, and the description waits under More fields.
 *
 * The form, its fields and the fold are the real ones; only the network and
 * the permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        return Object.assign(new data.modelType() as Record<string, unknown>, {
          _id: "3b000000-0000-4000-8000-0000000000b1",
          name: "Weekday primary",
          description: "",
        });
      },
      createOrUpdate: async (): Promise<{ data: JSONObject }> => {
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.ProjectOwner] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import LayerConfigForm from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import ObjectID from "../../../Types/ObjectID";

afterEach(() => {
  cleanup();
});

async function renderForm(): Promise<void> {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  layer.id = new ObjectID("3b000000-0000-4000-8000-0000000000b1");
  layer.name = "Weekday primary";

  render(
    <LayerConfigForm
      layer={layer}
      timezone="Europe/London"
      onLayerChange={(): void => {}}
    />,
  );

  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

describe("a layer's form", () => {
  test("says what each field decides, in a few words", async () => {
    await renderForm();

    await screen.findByText("Layer name");

    for (const line of [
      "What the layer covers.",
      "When turns start, and how long each lasts.",
      "When the first person in the layer goes on call.",
      "How long each turn lasts.",
      "When the first turn passes to the next person. Later hand-offs follow every turn.",
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }

    for (const retired of [
      "Give this layer a clear name",
      "Friendly name for this layer",
      "Optional. Explain the purpose of this layer.",
      "on-call rotation begins",
      "on-call duty passes to the next user",
      "repeat every rotation interval",
      "how often on-call duty hands off between users",
      // Under Restrictions, saying again what the Active hours section says.
      "Restrict this layer to these times",
    ]) {
      expect(document.body).not.toHaveTextContent(retired);
    }

    expect(
      screen.getByText(
        "Limit the hours this layer is on call. Outside these hours, lower layers take over.",
      ),
    ).toBeInTheDocument();
  });

  test("keeps the description under More fields, folded", async () => {
    await renderForm();

    const fold: HTMLElement = await screen.findByRole("button", {
      name: "More fields",
    });

    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("textbox", { name: /^Description/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(fold);
    });

    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: /^Description/ })).toBeVisible();
  });

  test("still has its three sections and its one Save", async () => {
    await renderForm();

    await screen.findByText("Layer name");

    for (const section of [
      "Layer details",
      "Rotation schedule",
      "Active hours",
    ]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }

    expect(
      screen.getByRole("button", { name: "Save Layer" }),
    ).toBeInTheDocument();
  });
});
