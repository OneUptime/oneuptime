import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";

/*
 * The rule a run on past events would read with: drawn as the rule's id,
 * since the subject is which rule the picker hands it.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntPanel",
  () => {
    return {
      __esModule: true,
      default: (props: { getRequest: (hours: number) => unknown }) => {
        return (
          <div data-testid="retrohunt-panel">
            {JSON.stringify(props.getRequest(24))}
          </div>
        );
      },
    };
  },
);

import ProjectUser, {
  ProjectUserResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser";
import LogRecordingRuleFilterEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/RecordingRule/LogRecordingRuleFilterEditor";
import LateArrivalsRetrohuntModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/LateArrivals/LateArrivalsRetrohuntModal";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Service from "../../../Models/DatabaseModels/Service";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { LogRecordingRuleFilter } from "../../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * MORE OF THE DASHBOARD'S PICKERS, PAST THE RECORDS THEY READ (#10646).
 *
 *   - The project's users (Utils/ProjectUser), for the incident roles, the
 *     Teams > Members filter and five more: read from the first 10,000
 *     team memberships, unsorted - so only the newest - and a person whose
 *     memberships were all older was offered nowhere.
 *   - A log recording rule's Services: the first 10,000 by name, a service
 *     past them not offered, and one the rule held drawn as its raw id.
 *   - Run on Past Events' rule: the first 500 rules by name.
 *
 * ModelAPI answers from a project faked whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the project's users", () => {
  const LATE_USER_ID: string = "d3000000-0000-4000-8000-0000000000aa";
  const MEMBERSHIPS: number = LIMIT_PER_PROJECT + 50;

  beforeEach(() => {
    /*
     * More memberships than one read lists, each a user of its own; the
     * last made belongs to the late user, who is in two teams.
     */
    server.add(
      TeamMember,
      namesSortingFirst(MEMBERSHIPS, "User ").map(
        (name: string, index: number): Record<string, unknown> => {
          return {
            _id: ObjectID.generate().toString(),
            createdAt: index,
            user: {
              _id: ObjectID.generate().toString(),
              name: name,
              email: `${index}@example.com`,
            },
          };
        },
      ),
    );
    server.add(TeamMember, [
      {
        _id: ObjectID.generate().toString(),
        createdAt: MEMBERSHIPS,
        user: { _id: LATE_USER_ID, name: "Ada WB", email: "ada@example.com" },
      },
      {
        _id: ObjectID.generate().toString(),
        createdAt: MEMBERSHIPS + 1,
        user: { _id: LATE_USER_ID, name: "Ada WB", email: "ada@example.com" },
      },
    ]);
    server.install();
  });

  test("are every user, read a page of memberships at a time in the order they were made", async () => {
    const users: Array<ProjectUserResult> =
      await ProjectUser.fetchAllProjectUsers(new ObjectID(PROJECT_ID));

    expect(users).toHaveLength(MEMBERSHIPS + 1);
    // Once each, however many teams they are in.
    expect(
      users.filter((user: ProjectUserResult): boolean => {
        return user.userId === LATE_USER_ID;
      }),
    ).toHaveLength(1);

    const reads: Array<CappedListCall> = server.callsFor(TeamMember);

    expect(
      reads.map((call: CappedListCall): number => {
        return call.skip;
      }),
    ).toEqual([0, LIMIT_PER_PROJECT]);

    for (const read of reads) {
      expect(read.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(read.limit).toBe(LIMIT_PER_PROJECT);
    }
  });

  test("as a picker's options: the late user is offered, by name, drawn as written", async () => {
    const options: Array<{ value: unknown; label: string }> =
      await ProjectUser.fetchProjectUsersAsDropdownOptions(
        new ObjectID(PROJECT_ID),
      );

    expect(
      options.find((option: { value: unknown }): boolean => {
        return option.value === LATE_USER_ID;
      }),
    ).toMatchObject({ label: "Ada WB", isUserContent: true });
  });
});

describe("a log recording rule's services", () => {
  const LATE_SERVICE_ID: string = "d4000000-0000-4000-8000-0000000000aa";
  const OTHER_LATE_SERVICE_ID: string = "d4000000-0000-4000-8000-0000000000ab";
  const DELETED_SERVICE_ID: string = "d4000000-0000-4000-8000-0000000000dd";

  let onChange: MockFunction;

  beforeEach(() => {
    server.add(
      Service,
      namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
    server.add(Service, [
      { _id: LATE_SERVICE_ID, name: "WB kiosk api" },
      { _id: OTHER_LATE_SERVICE_ID, name: "WB kiosk web" },
    ]);
    server.install();

    onChange = getJestMockFunction();
  });

  function renderEditor(serviceIds: Array<string>): void {
    render(
      <LogRecordingRuleFilterEditor
        filter={{ telemetryServiceIds: serviceIds }}
        attributeKeys={[]}
        isLoadingAttributeKeys={false}
        onChange={(filter: LogRecordingRuleFilter): void => {
          onChange(filter);
        }}
      />,
    );
  }

  function chips(): Array<string> {
    return screen
      .queryAllByTestId("entity-dropdown-chip-label")
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });
  }

  test("names a service the rule holds past the 10,000th by its id, and one deleted since as No longer available", async () => {
    renderEditor([LATE_SERVICE_ID, DELETED_SERVICE_ID]);

    await waitFor(() => {
      expect(chips()).toEqual(["WB kiosk api", "No longer available"]);
    });

    for (const call of server.callsFor(Service)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }

    // Drawn, the rule is unchanged; the one gone is taken out by hand.
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith({
      telemetryServiceIds: [LATE_SERVICE_ID],
    });
  });

  test("finds a service past the 10,000th on the server, and adds it beside the one held", async () => {
    renderEditor([LATE_SERVICE_ID]);

    await waitFor(() => {
      expect(chips()).toEqual(["WB kiosk api"]);
    });

    const services: HTMLElement = screen.getByRole("combobox", {
      name: "Services",
    });

    await act(async () => {
      fireEvent.focus(services);
      fireEvent.change(services, { target: { value: "WB kiosk" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB kiosk web/,
    });

    const searched: CappedListCall | undefined = server
      .callsFor(Service)
      .find((call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      });

    expect(searched!.limit).toBe(50);

    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      telemetryServiceIds: [LATE_SERVICE_ID, OTHER_LATE_SERVICE_ID],
    });
  });
});

describe("Run on Past Events' rule", () => {
  const LATE_RULE_ID: string = "d5000000-0000-4000-8000-0000000000aa";

  function renderModal(): ReactElement {
    return (
      <LateArrivalsRetrohuntModal
        initialPeriodInHours={24}
        onClose={() => {}}
      />
    );
  }

  test("finds a rule past the first 500 on the server, and runs that one", async () => {
    server.add(
      DetectionRule,
      namesSortingFirst(520).map((name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      }),
    );
    server.add(DetectionRule, [
      { _id: LATE_RULE_ID, name: "WB kiosk brute force" },
    ]);
    server.install();

    render(renderModal());

    const picker: HTMLElement = await screen.findByRole("combobox", {
      name: "Rule",
      hidden: true,
    });

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB kiosk" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB kiosk brute force/,
      hidden: true,
    });

    // Never the project's rules whole.
    for (const call of server.callsFor(DetectionRule)) {
      expect(call.limit).toBeLessThanOrEqual(50);
    }

    await act(async () => {
      fireEvent.click(option);
    });

    expect(
      within(screen.getByTestId("retrohunt-panel")).getByText(
        new RegExp(LATE_RULE_ID),
      ),
    ).toBeInTheDocument();
  });

  test("a project with no rule says so, and offers no picker", async () => {
    server.install();

    render(renderModal());

    expect(
      await screen.findByText("There is no detection rule to run yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { hidden: true })).toBeNull();
  });
});
