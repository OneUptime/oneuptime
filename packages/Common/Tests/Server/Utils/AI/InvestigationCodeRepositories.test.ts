import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import InvestigationCodeRepositories from "../../../../Server/Utils/AI/SRE/InvestigationCodeRepositories";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The code repositories an investigation may read: "if no code repo is
 * selected - it should be able to read and investigate all the repos that
 * are connected" - the maintainer. Each AI rule that investigates names
 * some, or none (all of them), under its More fields:
 *
 *   - no enabled rule that investigates: every connected repository;
 *   - a matching rule that names none: every connected repository;
 *   - matching rules that name some: the ones any of them names;
 *   - rules set up, none matching: none (nothing would have started a run);
 *   - rules that cannot be read: none - a rule might have kept one out.
 *
 * InvestigationCodeRepositories reads the incident (or alert) the way the
 * investigation gate does and hands it to the rules, failing closed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const MONITOR_B: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);
const SEVERITY_HIGH: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
);
const SEVERITY_LOW: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
);
const CHECKOUT_REPO: string = "c1111111-1111-4111-8111-111111111111";
const BILLING_REPO: string = "c2222222-2222-4222-8222-222222222222";
const SEARCH_REPO: string = "c3333333-3333-4333-8333-333333333333";

function ref<T extends { _id?: string | undefined }>(
  type: { new (): T },
  id: ObjectID | string,
): T {
  const model: T = new type();
  model._id = id.toString();
  return model;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    _id: ObjectID.generate().toString(),
    name: "Production",
    ...values,
  });
}

function repositories(...ids: Array<string>): Array<CodeRepository> {
  return ids.map((id: string): CodeRepository => {
    return ref(CodeRepository, id);
  });
}

function incident(): Incident {
  return Object.assign(new Incident(), {
    title: "Checkout is down",
    incidentSeverityId: SEVERITY_HIGH,
    monitors: [ref(Monitor, MONITOR_A)],
    labels: [],
  });
}

function alert(): Alert {
  return Object.assign(new Alert(), {
    title: "Checkout is down",
    alertSeverityId: SEVERITY_LOW,
    monitorId: MONITOR_A,
    labels: [],
  });
}

function mockRules(
  rules: Array<AutoRemediationRule> | Error,
): SpyInstance<typeof AutoRemediationRuleService.findBy> {
  return jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation(async () => {
      if (rules instanceof Error) {
        throw rules;
      }

      return rules;
    });
}

function quietLogger(): SpyInstance<typeof logger.error> {
  return jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
}

function only(...ids: Array<string>): CodeRepositoryAllowance {
  return { isEveryRepository: false, repositoryIds: ids };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InvestigationRules.getIncidentCodeRepositoryAllowance", () => {
  async function allowanceFor(
    rules: Array<AutoRemediationRule> | Error,
  ): Promise<CodeRepositoryAllowance> {
    mockRules(rules);

    return await InvestigationRules.getIncidentCodeRepositoryAllowance({
      projectId: PROJECT_ID,
      incident: incident(),
    });
  }

  test("with no enabled rule, every connected repository", async () => {
    expect(await allowanceFor([])).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("reads the project's enabled incident rules that investigate, with the repositories each names, as root", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    await InvestigationRules.getIncidentCodeRepositoryAllowance({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
        investigates: true,
      },
      select: {
        monitors: { _id: true },
        codeRepositories: { _id: true },
      },
      props: { isRoot: true },
    });
  });

  test("a matching rule that names none: every connected repository", async () => {
    expect(
      await allowanceFor([rule({ monitors: [ref(Monitor, MONITOR_A)] })]),
    ).toEqual(EVERY_CODE_REPOSITORY);
    expect(
      await allowanceFor([
        rule({
          monitors: [ref(Monitor, MONITOR_A)],
          codeRepositories: [],
        }),
      ]),
    ).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("a matching rule that names some: those, and only those", async () => {
    expect(
      await allowanceFor([
        rule({
          monitors: [ref(Monitor, MONITOR_A)],
          codeRepositories: repositories(CHECKOUT_REPO, BILLING_REPO),
        }),
      ]),
    ).toEqual(only(CHECKOUT_REPO, BILLING_REPO));
  });

  test("several matching rules: the repositories any of them names, each once", async () => {
    expect(
      await allowanceFor([
        rule({
          name: "By monitor",
          monitors: [ref(Monitor, MONITOR_A)],
          codeRepositories: repositories(CHECKOUT_REPO),
        }),
        rule({
          name: "By severity",
          incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)],
          codeRepositories: repositories(BILLING_REPO, CHECKOUT_REPO),
        }),
      ]),
    ).toEqual(only(CHECKOUT_REPO, BILLING_REPO));
  });

  test("one matching rule that names none opens every repository, whatever the others name", async () => {
    expect(
      await allowanceFor([
        rule({
          monitors: [ref(Monitor, MONITOR_A)],
          codeRepositories: repositories(CHECKOUT_REPO),
        }),
        rule({ incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)] }),
      ]),
    ).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("a rule the incident does not match lends it none of its repositories", async () => {
    expect(
      await allowanceFor([
        rule({
          monitors: [ref(Monitor, MONITOR_A)],
          codeRepositories: repositories(CHECKOUT_REPO),
        }),
        rule({
          monitors: [ref(Monitor, MONITOR_B)],
          codeRepositories: repositories(SEARCH_REPO),
        }),
        // Matches nothing either: it would have opened every repository.
        rule({ incidentSeverities: [ref(IncidentSeverity, SEVERITY_LOW)] }),
      ]),
    ).toEqual(only(CHECKOUT_REPO));
  });

  test("rules set up, none matching: no repository", async () => {
    expect(
      await allowanceFor([
        rule({
          monitors: [ref(Monitor, MONITOR_B)],
          codeRepositories: repositories(SEARCH_REPO),
        }),
      ]),
    ).toEqual(NO_CODE_REPOSITORY);
  });

  test("rules that cannot be read: no repository, never all of them", async () => {
    quietLogger();

    expect(await allowanceFor(new Error("database is down"))).toEqual(
      NO_CODE_REPOSITORY,
    );
  });
});

describe("InvestigationRules.getAlertCodeRepositoryAllowance", () => {
  test("reads the alert rules, and matches the alert on its own severity and monitor", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([
        rule({
          alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)],
          codeRepositories: repositories(BILLING_REPO),
        }),
        rule({
          alertSeverities: [ref(AlertSeverity, SEVERITY_HIGH)],
          codeRepositories: repositories(SEARCH_REPO),
        }),
      ]);

    expect(
      await InvestigationRules.getAlertCodeRepositoryAllowance({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual(only(BILLING_REPO));
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { triggerEntityType: AutoRemediationTriggerEntity.Alert },
    });
  });

  test("no alert rule: every repository; unreadable rules: none", async () => {
    mockRules([]);
    expect(
      await InvestigationRules.getAlertCodeRepositoryAllowance({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual(EVERY_CODE_REPOSITORY);

    jest.restoreAllMocks();
    quietLogger();
    mockRules(new Error("database is down"));
    expect(
      await InvestigationRules.getAlertCodeRepositoryAllowance({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual(NO_CODE_REPOSITORY);
  });
});

describe("InvestigationCodeRepositories", () => {
  const INCIDENT_ID: ObjectID = new ObjectID(
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  );
  const ALERT_ID: ObjectID = new ObjectID(
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  );

  test("reads the incident as the investigation gate does, as root, and asks its rules", async () => {
    const read: SpyInstance<typeof IncidentService.findOneById> = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);
    const ask: SpyInstance<
      typeof InvestigationRules.getIncidentCodeRepositoryAllowance
    > = jest
      .spyOn(InvestigationRules, "getIncidentCodeRepositoryAllowance")
      .mockResolvedValue(only(CHECKOUT_REPO));

    expect(
      await InvestigationCodeRepositories.forIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual(only(CHECKOUT_REPO));

    expect(read.mock.calls[0]![0]).toMatchObject({
      id: INCIDENT_ID,
      select: {
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
      },
      props: { isRoot: true },
    });
    expect(ask.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(ask.mock.calls[0]![0].incident.title).toBe("Checkout is down");
  });

  test("an incident that is gone, or a failed read, reads no repository", async () => {
    const ask: SpyInstance<
      typeof InvestigationRules.getIncidentCodeRepositoryAllowance
    > = jest
      .spyOn(InvestigationRules, "getIncidentCodeRepositoryAllowance")
      .mockResolvedValue(EVERY_CODE_REPOSITORY);

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);
    expect(
      await InvestigationCodeRepositories.forIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual(NO_CODE_REPOSITORY);

    const error: SpyInstance<typeof logger.error> = quietLogger();
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("database is down"));
    expect(
      await InvestigationCodeRepositories.forIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual(NO_CODE_REPOSITORY);

    expect(ask).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]![0])).toContain(
      `could not read which code repositories incident ${INCIDENT_ID.toString()} may use`,
    );
  });

  test("an alert: read the same way, with its own rules", async () => {
    const read: SpyInstance<typeof AlertService.findOneById> = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert() as never);
    jest
      .spyOn(InvestigationRules, "getAlertCodeRepositoryAllowance")
      .mockResolvedValue(only(BILLING_REPO));

    expect(
      await InvestigationCodeRepositories.forAlert({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual(only(BILLING_REPO));
    expect(read.mock.calls[0]![0]).toMatchObject({
      id: ALERT_ID,
      select: { alertSeverityId: true, monitorId: true },
      props: { isRoot: true },
    });
  });

  test("an alert whose rules cannot be read reads no repository", async () => {
    quietLogger();
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert() as never);
    mockRules(new Error("database is down"));

    expect(
      await InvestigationCodeRepositories.forAlert({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual(NO_CODE_REPOSITORY);
  });
});
