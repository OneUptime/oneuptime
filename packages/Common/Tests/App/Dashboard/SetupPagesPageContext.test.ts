import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DashboardModel from "../../../Models/DatabaseModels/Dashboard";
import Form from "../../../Models/DatabaseModels/Form";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Team from "../../../Models/DatabaseModels/Team";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI KNOWS THE PAGE WHERE A PROJECT IS SET UP (#7062).
 *
 * "How do I add someone here?" was asked with nothing about where "here"
 * is: Ask AI had no context on Home, in Project or User Settings, in
 * On-Call, in Status Pages or on a create form, which is where setup
 * questions are asked. Each now passes its context, and which of its
 * pages is on screen as that page's route template - never an address,
 * with its ids, nor a word of what is on the page: the server names the
 * page from its own catalogs. One status page's and one on-call policy's
 * pages are those records, by id, as an incident's are.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID: string = "20000000-0000-4000-8000-000000000002";
const POLICY_ID: string = "30000000-0000-4000-8000-000000000003";

function navigateTo(address: string): void {
  const [pathname, search] = address.split("?");

  Navigation.setLocation({
    pathname: pathname!,
    search: search ? `?${search}` : "",
    hash: "",
    state: null,
    key: "setup-pages-page-context-test",
  });

  // A list's create form reads its ask from the browser's own address.
  window.history.replaceState({}, "", address);
}

afterEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

const detected: () => DashboardPageContext | null =
  (): DashboardPageContext | null => {
    return PageContextUtil.detectPageContext();
  };

describe("the pages where a project is set up have a context", () => {
  test.each<
    [string, AIChatPageContextType, string, string, string | undefined]
  >([
    [
      `/dashboard/${PROJECT_ID}/home`,
      AIChatPageContextType.Home,
      "Home",
      "/dashboard/:projectId/home",
      undefined,
    ],
    [
      `/dashboard/${PROJECT_ID}/home/setup-health`,
      AIChatPageContextType.Home,
      "Home",
      "/dashboard/:projectId/home/setup-health",
      "Setup Health",
    ],
    [
      `/dashboard/${PROJECT_ID}/settings/api-keys`,
      AIChatPageContextType.ProjectSettings,
      "Project Settings",
      "/dashboard/:projectId/settings/api-keys",
      "API Keys",
    ],
    [
      `/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
      AIChatPageContextType.UserSettings,
      "User Settings",
      "/dashboard/:projectId/user-settings/notification-methods",
      "Notification Methods",
    ],
    [
      `/dashboard/${PROJECT_ID}/on-call-duty/schedules`,
      AIChatPageContextType.OnCall,
      "On-Call",
      "/dashboard/:projectId/on-call-duty/schedules",
      "Schedules",
    ],
    [
      `/dashboard/${PROJECT_ID}/status-pages`,
      AIChatPageContextType.StatusPagesList,
      "Status Pages",
      "/dashboard/:projectId/status-pages",
      undefined,
    ],
  ])(
    "%s is %s, chip %s",
    (
      address: string,
      type: AIChatPageContextType,
      chipLabel: string,
      page: string,
      pageTitle: string | undefined,
    ) => {
      navigateTo(address);

      const context: DashboardPageContext | null = detected();

      expect(context).toMatchObject({
        type,
        chipLabel,
        page,
        isEntity: false,
      });
      expect(context?.entityId).toBeUndefined();
      expect(context?.pageTitle).toBe(pageTitle);
    },
  );

  test("a status page's own pages are that status page, with the page on screen", () => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/domains`,
    );

    expect(detected()).toMatchObject({
      type: AIChatPageContextType.StatusPage,
      entityId: STATUS_PAGE_ID,
      chipLabel: "This status page",
      isEntity: true,
      page: "/dashboard/:projectId/status-pages/:id/domains",
    });
  });

  test("an on-call policy's own pages are that policy", () => {
    navigateTo(
      `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/escalation`,
    );

    expect(detected()).toMatchObject({
      type: AIChatPageContextType.OnCallPolicy,
      entityId: POLICY_ID,
      chipLabel: "This on-call policy",
      isEntity: true,
      page: "/dashboard/:projectId/on-call-duty/policies/:id/escalation",
    });
  });

  test("a status page's address that is no record's id stays Status Pages", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/status-pages/announcements`);

    expect(detected()).toMatchObject({
      type: AIChatPageContextType.StatusPagesList,
      isEntity: false,
    });
  });

  test.each([
    [
      "monitors/create",
      "Create Monitor",
      "/dashboard/:projectId/monitors/create",
    ],
    [
      "incidents/create",
      "Declare Incident",
      "/dashboard/:projectId/incidents/create",
    ],
    ["alerts/create", "Create Alert", "/dashboard/:projectId/alerts/create"],
  ])(
    "the %s form is the form, not its list",
    (path: string, title: string, page: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/${path}`);

      expect(detected()).toMatchObject({
        type: AIChatPageContextType.CreateForm,
        chipLabel: title,
        isEntity: false,
        page,
      });
    },
  );

  test("a list's create form opened from its address is the form; the list without the ask is the list", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/status-pages?create=1`);
    expect(detected()).toMatchObject({
      type: AIChatPageContextType.CreateForm,
      chipLabel: "Create Status Page",
      page: "/dashboard/:projectId/status-pages",
    });

    navigateTo(`/dashboard/${PROJECT_ID}/on-call-duty/policies?create=1`);
    expect(detected()).toMatchObject({
      type: AIChatPageContextType.CreateForm,
      chipLabel: "Create On-Call Policy",
    });

    navigateTo(`/dashboard/${PROJECT_ID}/on-call-duty/policies`);
    expect(detected()).toMatchObject({
      type: AIChatPageContextType.OnCall,
    });
  });

  test("the lists and explorers keep the context they had, with no page", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/monitors`);

    expect(detected()).toEqual({
      type: AIChatPageContextType.MonitorsList,
      noun: "monitors",
      chipLabel: "Monitors",
      icon: "AltGlobe",
      isEntity: false,
    });
  });
});

/*
 * ONE RECORD'S PAGES ARE THAT RECORD, AND SAY WHICH PAGE (#10104): an
 * on-call schedule's, an incoming call policy's, a team's, a dashboard's,
 * a runbook's, an SLO's and a form's sent no context, so "how do I add a
 * layer to this schedule?" was asked about no schedule; a monitor's,
 * incident's, alert's, maintenance event's, service's and workflow's sent
 * which record but not which of its pages.
 */
describe("a record's own pages are that record, with the page on screen (#10104)", () => {
  const RECORD_ID: string = "40000000-0000-4000-8000-000000000004";

  test.each<[string, AIChatPageContextType, string, string]>([
    [
      `on-call-duty/schedules/${RECORD_ID}/layers`,
      AIChatPageContextType.OnCallSchedule,
      "This on-call schedule",
      "/dashboard/:projectId/on-call-duty/schedules/:id/layers",
    ],
    [
      `on-call-duty/incoming-call-policies/${RECORD_ID}/escalation`,
      AIChatPageContextType.IncomingCallPolicy,
      "This incoming call policy",
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/escalation",
    ],
    [
      `teams/${RECORD_ID}/members`,
      AIChatPageContextType.Team,
      "This team",
      "/dashboard/:projectId/teams/:id/members",
    ],
    [
      `dashboards/${RECORD_ID}/authentication-settings`,
      AIChatPageContextType.Dashboard,
      "This dashboard",
      "/dashboard/:projectId/dashboards/:id/authentication-settings",
    ],
    [
      `runbooks/${RECORD_ID}/steps`,
      AIChatPageContextType.Runbook,
      "This runbook",
      "/dashboard/:projectId/runbooks/:id/steps",
    ],
    [
      `slos/${RECORD_ID}/burn-rate-rules`,
      AIChatPageContextType.Slo,
      "This SLO",
      "/dashboard/:projectId/slos/:id/burn-rate-rules",
    ],
    [
      `forms/${RECORD_ID}/share`,
      AIChatPageContextType.Form,
      "This form",
      "/dashboard/:projectId/forms/:id/share",
    ],
    // Records Ask AI knew, which now say which of their pages is on screen.
    [
      `monitors/${RECORD_ID}/criteria`,
      AIChatPageContextType.Monitor,
      "This monitor",
      "/dashboard/:projectId/monitors/:id/criteria",
    ],
    [
      `incidents/${RECORD_ID}/postmortem`,
      AIChatPageContextType.Incident,
      "This incident",
      "/dashboard/:projectId/incidents/:id/postmortem",
    ],
    [
      `alerts/${RECORD_ID}/notification-logs`,
      AIChatPageContextType.Alert,
      "This alert",
      "/dashboard/:projectId/alerts/:id/notification-logs",
    ],
    [
      `scheduled-maintenance-events/${RECORD_ID}/notification-logs`,
      AIChatPageContextType.ScheduledMaintenanceEvent,
      "This maintenance event",
      "/dashboard/:projectId/scheduled-maintenance-events/:id/notification-logs",
    ],
    [
      `service/${RECORD_ID}/exceptions`,
      AIChatPageContextType.TelemetryService,
      "This service",
      "/dashboard/:projectId/service/:id/exceptions",
    ],
    [
      `workflows/${RECORD_ID}/builder`,
      AIChatPageContextType.Workflow,
      "This workflow",
      "/dashboard/:projectId/workflows/:id/builder",
    ],
  ])(
    "%s is %s, chip %s, on its page",
    (
      path: string,
      type: AIChatPageContextType,
      chipLabel: string,
      page: string,
    ) => {
      navigateTo(`/dashboard/${PROJECT_ID}/${path}`);

      const context: DashboardPageContext | null = detected();

      expect(context).toMatchObject({
        type,
        entityId: RECORD_ID,
        chipLabel,
        isEntity: true,
        page,
      });

      // Sent as the record's id and its page's template, never the address.
      const payload: JSONObject = PageContextUtil.toRequestPayload(context!);

      expect(payload).toEqual({ type, entityId: RECORD_ID, page });
      expect(String(payload["page"])).not.toContain(RECORD_ID);
      expect(String(payload["page"])).not.toContain(PROJECT_ID);
      expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
    },
  );

  test("a schedule's or a team's page is that record, not On-Call or Project Settings", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/on-call-duty/schedules/${RECORD_ID}`);
    expect(detected()?.type).toBe(AIChatPageContextType.OnCallSchedule);

    // The list of schedules is On-Call still.
    navigateTo(`/dashboard/${PROJECT_ID}/on-call-duty/schedules`);
    expect(detected()?.type).toBe(AIChatPageContextType.OnCall);
  });

  test("an address under a record's root that is no record's id is no record", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/dashboards/not-an-id`);

    expect(detected()?.isEntity).not.toBe(true);
  });

  test.each<[AIChatPageContextType, { new (): BaseModel }, string]>([
    [AIChatPageContextType.OnCallSchedule, OnCallDutyPolicySchedule, "Weekly"],
    [
      AIChatPageContextType.IncomingCallPolicy,
      IncomingCallPolicy,
      "Support line",
    ],
    [AIChatPageContextType.Team, Team, "Platform"],
    [AIChatPageContextType.Dashboard, DashboardModel, "Checkout health"],
    [AIChatPageContextType.Runbook, Runbook, "Restart the API"],
    [AIChatPageContextType.Slo, ServiceLevelObjective, "Checkout 99.9%"],
    [AIChatPageContextType.Form, Form, "Report a problem"],
  ])(
    "%s is named by its name, read with the viewer's own permissions",
    async (
      type: AIChatPageContextType,
      modelType: { new (): BaseModel },
      name: string,
    ) => {
      const record: BaseModel = new modelType();
      (record as unknown as { name: string }).name = name;
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(record);

      const context: DashboardPageContext = {
        type,
        entityId: RECORD_ID,
        noun: "record",
        chipLabel: "This record",
        icon: "Add" as never,
        isEntity: true,
      };

      expect(await PageContextUtil.resolveEntityTitle(context)).toBe(name);
      expect(getItem).toHaveBeenCalledWith({
        modelType,
        id: new ObjectID(RECORD_ID),
        select: { name: true },
      });

      // One the viewer may not read keeps the chip's plain label.
      jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("No access"));
      expect(await PageContextUtil.resolveEntityTitle(context)).toBeNull();
    },
  );
});

describe("what a setup page sends, and what it keeps in the browser", () => {
  test("sends its type and its page's route template, never the page's name or an id", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/settings/api-keys`);

    const payload: JSONObject = PageContextUtil.toRequestPayload(detected()!);

    expect(payload).toEqual({
      type: AIChatPageContextType.ProjectSettings,
      page: "/dashboard/:projectId/settings/api-keys",
    });
    expect(JSON.stringify(payload)).not.toContain(PROJECT_ID);
    // What the server keeps of it is what was sent.
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });

  test("a record's page sends the record's id and its page's template, never the address", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`);

    const payload: JSONObject = PageContextUtil.toRequestPayload(detected()!);

    expect(payload).toEqual({
      type: AIChatPageContextType.StatusPage,
      entityId: STATUS_PAGE_ID,
      page: "/dashboard/:projectId/status-pages/:id/sso",
    });
    expect(String(payload["page"])).not.toContain(STATUS_PAGE_ID);
  });

  test("a page off every route sends no page", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/settings/no-such-page-here`);

    expect(detected()?.page).toBeUndefined();
  });
});

describe("the record's name in Ask AI", () => {
  test("a status page by its name, read with the viewer's own permissions", async () => {
    const page: StatusPage = new StatusPage();
    page.name = "Acme Status";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(page);

    expect(
      await PageContextUtil.resolveEntityTitle({
        type: AIChatPageContextType.StatusPage,
        entityId: STATUS_PAGE_ID,
        noun: "status page",
        chipLabel: "This status page",
        icon: "CheckCircle" as never,
        isEntity: true,
      }),
    ).toBe("Acme Status");
    expect(getItem).toHaveBeenCalledWith({
      modelType: StatusPage,
      id: new ObjectID(STATUS_PAGE_ID),
      select: { name: true },
    });
  });

  test("an on-call policy by its name; one the viewer cannot read keeps the plain label", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "Primary";
    jest.spyOn(ModelAPI, "getItem").mockResolvedValueOnce(policy);

    const context: DashboardPageContext = {
      type: AIChatPageContextType.OnCallPolicy,
      entityId: POLICY_ID,
      noun: "on-call policy",
      chipLabel: "This on-call policy",
      icon: "Call" as never,
      isEntity: true,
    };

    expect(await PageContextUtil.resolveEntityTitle(context)).toBe("Primary");

    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("No access"));
    expect(await PageContextUtil.resolveEntityTitle(context)).toBeNull();
  });
});

describe("the questions a setup page offers", () => {
  const contextOf: (type: AIChatPageContextType) => DashboardPageContext = (
    type: AIChatPageContextType,
  ): DashboardPageContext => {
    const isEntity: boolean = AIChatPageContextHelper.isEntityType(type);

    return {
      type,
      noun: "thing",
      chipLabel: "Thing",
      icon: "Add" as never,
      isEntity,
      ...(isEntity ? { entityId: STATUS_PAGE_ID } : {}),
    };
  };

  test.each([
    AIChatPageContextType.StatusPage,
    AIChatPageContextType.OnCallPolicy,
    AIChatPageContextType.OnCallSchedule,
    AIChatPageContextType.IncomingCallPolicy,
    AIChatPageContextType.Team,
    AIChatPageContextType.Dashboard,
    AIChatPageContextType.Runbook,
    AIChatPageContextType.Slo,
    AIChatPageContextType.Form,
    AIChatPageContextType.Home,
    AIChatPageContextType.ProjectSettings,
    AIChatPageContextType.UserSettings,
    AIChatPageContextType.OnCall,
    AIChatPageContextType.StatusPagesList,
    AIChatPageContextType.CreateForm,
  ])(
    "%s offers its own questions, worded in every Dashboard language",
    (type: AIChatPageContextType) => {
      const questions: Array<SuggestedQuestion> =
        PageContextUtil.getSuggestions(contextOf(type));

      expect(questions.length).toBeGreaterThanOrEqual(2);

      for (const question of questions) {
        for (const language of DASHBOARD_LANGUAGES) {
          expect({
            language,
            title: question.title,
            isWorded: isWordedInDashboardLocale(question.title, language),
          }).toEqual({ language, title: question.title, isWorded: true });
          expect({
            language,
            question: question.question,
            isWorded: isWordedInDashboardLocale(question.question, language),
          }).toEqual({
            language,
            question: question.question,
            isWorded: true,
          });
        }
      }
    },
  );

  test("a chip's label is worded in every Dashboard language", () => {
    for (const label of [
      "This status page",
      "This on-call policy",
      "This on-call schedule",
      "This incoming call policy",
      "This team",
      "This dashboard",
      "This runbook",
      "This SLO",
      "This form",
    ]) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          label,
          isWorded: isWordedInDashboardLocale(label, language),
        }).toEqual({ language, label, isWorded: true });
      }
    }
  });
});
