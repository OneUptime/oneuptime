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
import { CARD_SECTIONS_ON_PHONES_TEST_ID } from "../../../UI/Components/Card/CardSectionsOnPhones";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Create Monitor's criteria step on a phone: its cards are sections of the
 * page's card (and of the edit dialog), not frames inside its frame.
 *
 * "The criteria editor on phones is still nested several boxes deep: a
 * redesign." The step drew Monitor Target, Test Monitor and Monitor
 * Criteria as cards inside the page's card; on a phone each frame and its
 * padding came off the width of every field in them. MonitorStep now draws
 * them in CardSectionsOnPhones: a section on a phone, the card it always
 * was from sm up (Common's CardSectionsOnPhones suite holds Card to that).
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

describe("the criteria step's cards on a phone", () => {
  test.each([MonitorType.Website, MonitorType.API, MonitorType.Ping])(
    "%s: Monitor Target, Test Monitor and Monitor Criteria are sections of the card they are in",
    async (monitorType: MonitorType) => {
      render(editor(monitorType));

      await screen.findByText("Monitor Criteria");

      const holder: HTMLElement = screen.getByTestId(
        CARD_SECTIONS_ON_PHONES_TEST_ID,
      );
      const cards: Array<HTMLElement> = within(holder).getAllByTestId("card");

      expect(cardTitles(cards)).toEqual(
        expect.arrayContaining([
          "Monitor Target",
          "Test Monitor",
          "Monitor Criteria",
        ]),
      );

      for (const card of cards) {
        expect([
          cardTitles([card])[0],
          card.getAttribute("data-card-surface"),
        ]).toEqual([cardTitles([card])[0], "section-on-phones"]);
      }
    },
  );

  test("the step spaces its sections as it spaced its cards", async () => {
    render(editor(MonitorType.Website));

    await screen.findByText("Monitor Criteria");

    const holder: HTMLElement = screen.getByTestId(
      CARD_SECTIONS_ON_PHONES_TEST_ID,
    );

    expect(holder).toHaveClass("mt-5", "space-y-6");

    /*
     * The cards are its own children, so space-y-6 is the gap above each
     * one's rule on a phone - as far as its title sits under the rule - and
     * the gap between the cards from sm up, as before.
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
