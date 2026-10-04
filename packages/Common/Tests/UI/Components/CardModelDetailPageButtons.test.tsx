import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement, useEffect, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A card's own buttons - what the page hands CardModelDetail in
 * cardProps.buttons, beside its Edit button - follow the page.
 *
 * The header used to be built in an effect that ran again only when the
 * refresher, isEditable or the Edit button's text changed, so a button the
 * page added after the first paint never appeared. That is exactly what the
 * postmortem page needs: Apply Template is offered once the project's
 * postmortem templates have loaded and there is one.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import IconProp from "../../../Types/Icon/IconProp";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";

function buttonNames(): Array<string> {
  return screen.getAllByRole("button").map((button: HTMLElement): string => {
    return (button.textContent || "").trim();
  });
}

function MonitorCard(props: {
  buttons: Array<CardButtonSchema>;
}): ReactElement {
  return (
    <CardModelDetail<Monitor>
      name="Monitor Details"
      cardProps={{
        title: "Monitor Details",
        description: "About it",
        buttons: props.buttons,
      }}
      isEditable={true}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Monitor,
        id: "monitor-detail",
        modelId: new ObjectID(MONITOR_ID),
        fields: [
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ],
      }}
    />
  );
}

/*
 * A page that offers Apply Template once something it loads says there is
 * a template - and stops offering it once there is none.
 */
let setHasTemplates: (hasTemplates: boolean) => void = () => {};

function PageWithLoadedButton(): ReactElement {
  const [hasTemplates, setHasTemplatesState] = useState<boolean>(false);

  useEffect(() => {
    setHasTemplates = setHasTemplatesState;
  }, []);

  const buttons: Array<CardButtonSchema> = [
    {
      title: "Generate with AI",
      icon: IconProp.Bolt,
      onClick: () => {},
    },
  ];

  if (hasTemplates) {
    buttons.push({
      title: "Apply Template",
      icon: IconProp.Template,
      onClick: () => {},
    });
  }

  return <MonitorCard buttons={buttons} />;
}

describe("CardModelDetail's page buttons", () => {
  beforeEach(() => {
    PermissionGate.clearPermissionPropsCache();
    getItemMock.mockReset();
    getItemMock.mockImplementation(async (): Promise<Monitor> => {
      const monitor: Monitor = new Monitor();
      monitor._id = MONITOR_ID;
      monitor.name = "API";
      return monitor;
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("are drawn after the card's Edit button from the first paint", async () => {
    render(
      <MonitorCard
        buttons={[
          {
            title: "Generate with AI",
            icon: IconProp.Bolt,
            onClick: () => {},
          },
        ]}
      />,
    );

    expect(buttonNames()).toEqual(["Edit Monitor", "Generate with AI"]);

    await screen.findByText("API");
  });

  test("a button the page adds after the first paint appears, and goes when the page drops it", async () => {
    render(<PageWithLoadedButton />);

    await screen.findByText("API");

    expect(buttonNames()).toEqual(["Edit Monitor", "Generate with AI"]);

    act(() => {
      setHasTemplates(true);
    });

    await waitFor(() => {
      expect(buttonNames()).toEqual([
        "Edit Monitor",
        "Generate with AI",
        "Apply Template",
      ]);
    });

    act(() => {
      setHasTemplates(false);
    });

    await waitFor(() => {
      expect(buttonNames()).toEqual(["Edit Monitor", "Generate with AI"]);
    });
  });

  test("a new set of buttons does not fetch the record again", async () => {
    render(<PageWithLoadedButton />);

    await screen.findByText("API");

    const fetchesBefore: number = getItemMock.mock.calls.length;

    act(() => {
      setHasTemplates(true);
    });

    await screen.findByText("Apply Template");

    expect(getItemMock.mock.calls.length).toBe(fetchesBefore);
  });
});
