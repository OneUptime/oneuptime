import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { CARD_FORM_SECTIONS_TEST_ID } from "../../../UI/Components/Card/CardFormSections";
import { CARD_FORM_SECTION_FRAME_CLASS_NAME } from "../../../UI/Components/Card/Card";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Create Monitor's criteria step: its cards are sections of the page's card
 * (and of the edit dialog) at every width, not frames inside its frame.
 *
 * The step drew Monitor Target, Test Monitor and Criteria as cards
 * inside the page's card. On a phone each frame and its padding came off
 * the width of every field in them, and #5482 drew them as sections there;
 * from sm up they were still cards in a card, which the maintainer asked to
 * remove everywhere. MonitorStep now draws them in CardFormSections: a
 * section of the card it is in at every width (Common's CardFormSections
 * suite holds Card to that).
 *
 * The real MonitorStep form, with the same mocks as
 * MonitorStepDestinationField.test.tsx: the criteria, the test button and
 * the other monitor types' editors need not load.
 */

/*
 * Keep the real form, inputs and details renderer; unrelated criteria and
 * live previews do not need to fetch or render to exercise retry editing.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTest",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteria",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * These type-specific editors are never rendered by the probe monitor types
 * below. Avoid loading their telemetry explorers and code editor in this suite.
 */
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/NetworkDeviceMonitor/NetworkDeviceMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnsMonitor/DnsMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DatabaseMonitor/DatabaseMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DomainMonitor/DomainMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DnssecMonitor/DnssecMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

function editor(monitorType: MonitorType): ReactElement {
  return (
    <MemoryRouter>
      <MonitorStepForm
        value={new MonitorStep()}
        monitorType={monitorType}
        onChange={() => {}}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        allMonitorSteps={new MonitorSteps()}
        probes={[]}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("99999999-9999-4999-8999-999999999999"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function cardTitles(cards: Array<HTMLElement>): Array<string> {
  return cards.map((card: HTMLElement): string => {
    return (
      within(card).queryAllByTestId("card-details-heading")[0]?.textContent ||
      ""
    );
  });
}

describe("the criteria step's cards", () => {
  test.each([MonitorType.Website, MonitorType.API, MonitorType.Ping])(
    "%s: Monitor Target, Test Monitor and Criteria are sections of the card they are in",
    async (monitorType: MonitorType) => {
      render(editor(monitorType));

      await screen.findByText("Criteria");

      const holder: HTMLElement = screen.getByTestId(
        CARD_FORM_SECTIONS_TEST_ID,
      );
      const cards: Array<HTMLElement> = within(holder).getAllByTestId("card");

      expect(cardTitles(cards)).toEqual(
        expect.arrayContaining(["Monitor Target", "Test Monitor", "Criteria"]),
      );

      for (const card of cards) {
        expect([
          cardTitles([card])[0],
          card.getAttribute("data-card-surface"),
        ]).toEqual([cardTitles([card])[0], "form-section"]);
        // A rule above it, and no frame round it at any width.
        expect([
          cardTitles([card])[0],
          (card.firstElementChild as HTMLElement).className,
        ]).toEqual([cardTitles([card])[0], CARD_FORM_SECTION_FRAME_CLASS_NAME]);
      }
    },
  );

  /*
   * Every type's configuration card is drawn in the same holder, so none of
   * them is a card in the page's card at any width either.
   */
  test.each([
    [MonitorType.SQLQuery, "SQL Query Monitor Configuration"],
    [MonitorType.Metrics, "Metric to watch"],
    [MonitorType.Kubernetes, "Kubernetes Monitor Configuration"],
    [MonitorType.NetworkDevice, "Network Device Monitor Configuration"],
    [MonitorType.DNS, "DNS Monitor Configuration"],
    [MonitorType.Domain, "Domain Monitor Configuration"],
    [MonitorType.ExternalStatusPage, "External Status Page Configuration"],
  ])(
    "%s: its configuration card, %s, is a section too",
    async (monitorType: MonitorType, title: string) => {
      render(editor(monitorType));

      const heading: HTMLElement = await screen.findByText(title);
      const card: HTMLElement = heading.closest(
        "[data-testid='card']",
      ) as HTMLElement;

      expect(card).toHaveAttribute("data-card-surface", "form-section");
      expect(card.parentElement).toBe(
        screen.getByTestId(CARD_FORM_SECTIONS_TEST_ID),
      );
    },
  );

  test("the step spaces its sections as it spaced its cards", async () => {
    render(editor(MonitorType.Website));

    await screen.findByText("Criteria");

    const holder: HTMLElement = screen.getByTestId(CARD_FORM_SECTIONS_TEST_ID);

    expect(holder).toHaveClass("mt-5", "space-y-6");

    /*
     * The cards are its own children, so space-y-6 is the gap above each
     * one's rule - as far as its title sits under the rule - at every
     * width.
     */
    const cards: Array<HTMLElement> = within(holder).getAllByTestId("card");

    expect(cards.length).toBeGreaterThanOrEqual(3);

    for (const card of cards) {
      expect([cardTitles([card])[0], card.parentElement]).toEqual([
        cardTitles([card])[0],
        holder,
      ]);
    }
  });

  test("the Test Monitor card is a card like the others: no tint behind its corners", async () => {
    render(editor(MonitorType.Website));

    await screen.findByText("Test Monitor");

    const card: HTMLElement = screen
      .getAllByTestId("card")
      .find((element: HTMLElement): boolean => {
        return cardTitles([element])[0] === "Test Monitor";
      })!;

    /*
     * Its classes went on the box round the frame, which the frame's rounded
     * corners left showing: a blue wedge at each corner, on every width.
     */
    expect(card.className).not.toMatch(/bg-blue-50|border-blue-200/);
  });
});
