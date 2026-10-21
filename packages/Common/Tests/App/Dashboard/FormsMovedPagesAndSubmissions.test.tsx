import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

/*
 * Two small pieces of the Forms product that the pages lean on:
 *
 *  - MovedFormPageRedirect, which sends bookmarks of the old Incidents >
 *    Settings > Forms pages to the same form in Forms - run through the
 *    real router, with the real route table;
 *  - how a submission is shown in the submissions tables: who sent it,
 *    and a link to what it created.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import MovedFormPageRedirect from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/MovedFormPageRedirect";
import {
  FormSubmissionCreatedLink,
  getFormSubmissionCreatedLink,
  getFormSubmissionSubmitter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionPresentation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { MOVED_INCIDENT_FORM_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Email from "../../../Types/Email";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";

const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const INCIDENT_ID: string = "b1b2c3d4-0000-4000-8000-0000000000f2";
const EVENT_ID: string = "c1b2c3d4-0000-4000-8000-0000000000f3";

const LocationShown: () => ReactElement = (): ReactElement => {
  const location: Location = useLocation();

  return (
    <div data-testid="arrived">
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  );
};

async function visit(path: string): Promise<string> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={`/dashboard/:projectId/incidents/${MOVED_INCIDENT_FORM_PATHS.forms}`}
            element={<MovedFormPageRedirect pageMap={PageMap.FORMS} />}
          />
          <Route
            path={`/dashboard/:projectId/incidents/${MOVED_INCIDENT_FORM_PATHS.formView}`}
            element={<MovedFormPageRedirect pageMap={PageMap.FORM_VIEW} />}
          />
          <Route path="*" element={<LocationShown />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  return screen.getByTestId("arrived").textContent || "";
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the old Incident Forms pages", () => {
  test("are matched where they lived", () => {
    expect(MOVED_INCIDENT_FORM_PATHS).toEqual({
      forms: "settings/forms",
      formView: "settings/forms/:id",
    });
  });

  test("the list forwards to Forms", async () => {
    expect(
      await visit(`/dashboard/${PROJECT_ID}/incidents/settings/forms`),
    ).toBe(`/dashboard/${PROJECT_ID}/forms`);
  });

  test("a form's page forwards to the same form, which kept its id", async () => {
    expect(
      await visit(
        `/dashboard/${PROJECT_ID}/incidents/settings/forms/${FORM_ID}`,
      ),
    ).toBe(`/dashboard/${PROJECT_ID}/forms/${FORM_ID}`);
  });

  test("the query string and the hash come along", async () => {
    expect(
      await visit(
        `/dashboard/${PROJECT_ID}/incidents/settings/forms/${FORM_ID}?tab=share#link`,
      ),
    ).toBe(`/dashboard/${PROJECT_ID}/forms/${FORM_ID}?tab=share#link`);
  });

  test("the old address is replaced, not left in the history", async () => {
    let navigationType: NavigationType | null = null;

    const HistoryShown: () => ReactElement = (): ReactElement => {
      const location: Location = useLocation();
      navigationType = useNavigationType();
      return <div data-testid="arrived">{location.pathname}</div>;
    };

    await act(async () => {
      render(
        <MemoryRouter
          initialEntries={[
            `/dashboard/${PROJECT_ID}/incidents/settings/forms/${FORM_ID}`,
          ]}
        >
          <Routes>
            <Route
              path={`/dashboard/:projectId/incidents/${MOVED_INCIDENT_FORM_PATHS.formView}`}
              element={<MovedFormPageRedirect pageMap={PageMap.FORM_VIEW} />}
            />
            <Route path="*" element={<HistoryShown />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.getByTestId("arrived")).toHaveTextContent(
      `/dashboard/${PROJECT_ID}/forms/${FORM_ID}`,
    );
    // Back from the form leaves it, rather than bouncing through the old address.
    expect(navigationType).toBe(NavigationType.Replace);
  });
});

describe("who sent a submission", () => {
  test("the name and email given, trimmed", () => {
    const submission: FormSubmission = new FormSubmission();
    submission.submitterName = "  Ada Lovelace ";
    submission.submitterEmail = new Email("ada@example.com");

    expect(getFormSubmissionSubmitter(submission)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test("empty strings for an anonymous one", () => {
    expect(getFormSubmissionSubmitter(new FormSubmission())).toEqual({
      name: "",
      email: "",
    });
  });
});

describe("what a submission created", () => {
  let submission: FormSubmission;

  beforeEach(() => {
    submission = new FormSubmission();
  });

  test("an incident, by its number with the project's prefix", () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID;
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    submission.targetType = FormTargetType.Incident;
    submission.incident = incident;

    const link: FormSubmissionCreatedLink | null =
      getFormSubmissionCreatedLink(submission);

    expect(link).not.toBeNull();
    expect(link!.id.toString()).toBe(INCIDENT_ID);
    expect(link!.reference).toBe("INC-42");
    expect(link!.pageMap).toBe(PageMap.INCIDENT_VIEW);
    expect(link!.kindTitle).toBe("Incident");
  });

  test("an incident without a prefix, by #number", () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID;
    incident.incidentNumber = 7;
    submission.incident = incident;

    expect(getFormSubmissionCreatedLink(submission)?.reference).toBe("#7");
  });

  test("an incident whose number was not read: linked, with no reference", () => {
    submission.incidentId = new ObjectID(INCIDENT_ID);

    const link: FormSubmissionCreatedLink | null =
      getFormSubmissionCreatedLink(submission);

    expect(link!.id.toString()).toBe(INCIDENT_ID);
    expect(link!.reference).toBe("");
  });

  test("a scheduled maintenance event, by its number", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = EVENT_ID;
    event.scheduledMaintenanceNumber = 3;
    event.scheduledMaintenanceNumberWithPrefix = "SM-3";
    submission.targetType = FormTargetType.ScheduledMaintenance;
    submission.scheduledMaintenance = event;

    const link: FormSubmissionCreatedLink | null =
      getFormSubmissionCreatedLink(submission);

    expect(link!.id.toString()).toBe(EVENT_ID);
    expect(link!.reference).toBe("SM-3");
    expect(link!.pageMap).toBe(PageMap.SCHEDULED_MAINTENANCE_VIEW);
    expect(link!.kindTitle).toBe("Scheduled Maintenance");
  });

  test("a maintenance event is told apart by its id, even with no target type", () => {
    submission.scheduledMaintenanceId = new ObjectID(EVENT_ID);

    const link: FormSubmissionCreatedLink | null =
      getFormSubmissionCreatedLink(submission);

    expect(link!.pageMap).toBe(PageMap.SCHEDULED_MAINTENANCE_VIEW);
    expect(link!.reference).toBe("");
  });

  test.each([FormTargetType.Incident, FormTargetType.ScheduledMaintenance])(
    "nothing once what a %s submission created is deleted",
    (targetType: FormTargetType) => {
      submission.targetType = targetType;

      expect(getFormSubmissionCreatedLink(submission)).toBeNull();
    },
  );
});
