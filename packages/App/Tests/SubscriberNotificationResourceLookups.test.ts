import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every subscriber notification finds the resources an event affects the
 * same way: through StatusPageResourceService.findByMonitors, the one lookup
 * that returns a status page's resources for the event's monitors AND for
 * the monitor groups that hold them.
 *
 * On a page that lets subscribers choose resources, a subscriber is told
 * about an event when it picked one of the resources the event affects
 * (StatusPageSubscriberService.shouldSendNotification). The announcement and
 * scheduled maintenance note jobs used to look resources up by monitorId
 * themselves, which misses the monitor groups: whoever had subscribed to a
 * group was not told about an announcement or a note on a monitor in it,
 * although the page shows it under that group and the same subscriber heard
 * about incidents there.
 *
 * So a sender - any code that calls shouldSendNotification - never reads
 * status page resources itself. It gets them from:
 *
 *   - IncidentStatusPageScope (the incident and episode jobs), which also
 *     applies an incident's status page scope;
 *   - AffectedStatusPageResources.findForMonitors (announcements and
 *     scheduled maintenance events: created, reminders, state changes and
 *     public notes).
 *
 * Both ask findByMonitors. The list of senders is exact: a new one has to be
 * added here, and pick one of the two.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

// Where code that notifies subscribers can live.
const SCAN_ROOTS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(PACKAGES_DIR, "Common", "Server"),
  path.join(REPOSITORY_DIR, "ee", "Server"),
];

// TypeScript sources, .ts and .tsx.
const SOURCE_FILE: RegExp = /\.tsx?$/;

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  ".git",
];

// The senders that reach status pages through an incident's scope.
const INCIDENT_SENDERS: Array<string> = [
  "packages/App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
];

// The senders that name their status pages and monitors themselves.
const EVENT_SENDERS: Array<string> = [
  "packages/App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
  "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
  // Scheduled maintenance 'scheduled' notifications and reminders.
  "packages/Common/Server/Services/ScheduledMaintenanceService.ts",
];

// The two shared lookups, and what each may ask of the resource service.
const SHARED_LOOKUPS: Array<string> = [
  "packages/Common/Server/Utils/StatusPage/IncidentStatusPageScope.ts",
  "packages/Common/Server/Utils/StatusPage/AffectedStatusPageResources.ts",
];

const RESOURCE_SERVICE: string = "StatusPageResourceService";
const RESOURCE_SERVICE_MODULE: RegExp = /(^|\/)StatusPageResourceService$/;
const INCIDENT_SCOPE: string = "IncidentStatusPageScope";
const INCIDENT_SCOPE_RESOLVERS: Array<string> = [
  "resolvePagesForIncidents",
  "resolvePagesForReaches",
];
const AFFECTED_RESOURCES: string = "AffectedStatusPageResources";
const AFFECTED_RESOURCES_LOOKUP: string = "findForMonitors";

interface ServiceCall {
  // The identifier the method is called on, e.g. StatusPageResourceService.
  receiver: string;
  method: string;
  line: number;
}

interface FileFacts {
  callsShouldSendNotification: boolean;
  calls: Array<ServiceCall>;
  // Modules imported, as written.
  importedModules: Array<string>;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/*
 * The calls a source makes on an identifier (Service.method(...)), whether
 * it calls StatusPageSubscriberService.shouldSendNotification, and what it
 * imports. Read from the AST, so a comment or a string that names a method
 * is not a call.
 */
function readFacts(fileName: string, text: string): FileFacts {
  const source: ts.SourceFile = parse(fileName, text);
  const facts: FileFacts = {
    callsShouldSendNotification: false,
    calls: [],
    importedModules: [],
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      facts.importedModules.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const call: ServiceCall = {
        receiver: node.expression.expression.text,
        method: node.expression.name.text,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      };

      facts.calls.push(call);

      if (
        call.receiver === "StatusPageSubscriberService" &&
        call.method === "shouldSendNotification"
      ) {
        facts.callsShouldSendNotification = true;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return facts;
}

function callsOn(facts: FileFacts, receiver: string): Array<string> {
  return facts.calls
    .filter((call: ServiceCall): boolean => {
      return call.receiver === receiver;
    })
    .map((call: ServiceCall): string => {
      return `${call.receiver}.${call.method} (line ${call.line})`;
    });
}

function calls(facts: FileFacts, receiver: string, method: string): boolean {
  return facts.calls.some((call: ServiceCall): boolean => {
    return call.receiver === receiver && call.method === method;
  });
}

/*
 * What a sender breaks, in words: reading status page resources itself, or
 * not asking the lookup its kind of event goes through.
 */
function senderProblems(data: {
  facts: FileFacts;
  isIncidentSender: boolean;
}): Array<string> {
  const problems: Array<string> = [];
  const { facts } = data;

  for (const call of callsOn(facts, RESOURCE_SERVICE)) {
    problems.push(
      `reads status page resources itself (${call}); get them from ${
        data.isIncidentSender ? INCIDENT_SCOPE : AFFECTED_RESOURCES
      }, which also follows monitor groups`,
    );
  }

  for (const moduleName of facts.importedModules) {
    if (RESOURCE_SERVICE_MODULE.test(moduleName)) {
      problems.push(`imports ${moduleName}`);
    }
  }

  if (data.isIncidentSender) {
    const resolves: boolean = INCIDENT_SCOPE_RESOLVERS.some(
      (method: string): boolean => {
        return calls(facts, INCIDENT_SCOPE, method);
      },
    );

    if (!resolves) {
      problems.push(
        `does not ask ${INCIDENT_SCOPE} which pages and resources the incident reaches`,
      );
    }

    for (const call of callsOn(facts, AFFECTED_RESOURCES)) {
      problems.push(
        `calls ${call}, which knows nothing of an incident's status page scope`,
      );
    }
  } else {
    if (!calls(facts, AFFECTED_RESOURCES, AFFECTED_RESOURCES_LOOKUP)) {
      problems.push(
        `does not get its resources from ${AFFECTED_RESOURCES}.${AFFECTED_RESOURCES_LOOKUP}`,
      );
    }

    for (const call of callsOn(facts, INCIDENT_SCOPE)) {
      problems.push(`calls ${call}, which is for incidents`);
    }
  }

  return problems;
}

function repositoryPath(absolutePath: string): string {
  return path.relative(REPOSITORY_DIR, absolutePath).split(path.sep).join("/");
}

function readRepositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIR, relativePath), "utf8");
}

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

// Every file that calls shouldSendNotification, repository-relative.
function findSenders(): Array<string> {
  return SCAN_ROOTS.flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      const text: string = fs.readFileSync(file, "utf8");

      // Parse only the files that could be one.
      return (
        text.includes("shouldSendNotification") &&
        readFacts(file, text).callsShouldSendNotification
      );
    })
    .map(repositoryPath)
    .sort();
}

describe("subscriber notifications find an event's resources through the lookup that follows monitor groups", () => {
  test("the senders are exactly the known ones", () => {
    expect(findSenders()).toEqual(
      [...INCIDENT_SENDERS, ...EVENT_SENDERS].sort(),
    );
  });

  test.each(INCIDENT_SENDERS)(
    "%s gets its pages and resources from IncidentStatusPageScope",
    (file: string) => {
      const facts: FileFacts = readFacts(file, readRepositoryFile(file));

      expect(facts.callsShouldSendNotification).toBe(true);
      expect(senderProblems({ facts: facts, isIncidentSender: true })).toEqual(
        [],
      );
    },
  );

  test.each(EVENT_SENDERS)(
    "%s gets its resources from AffectedStatusPageResources",
    (file: string) => {
      const facts: FileFacts = readFacts(file, readRepositoryFile(file));

      expect(facts.callsShouldSendNotification).toBe(true);
      expect(senderProblems({ facts: facts, isIncidentSender: false })).toEqual(
        [],
      );
    },
  );

  test.each(SHARED_LOOKUPS)(
    "%s asks findByMonitors, and nothing else of the resource service",
    (file: string) => {
      const facts: FileFacts = readFacts(file, readRepositoryFile(file));
      const resourceCalls: Array<string> = facts.calls
        .filter((call: ServiceCall): boolean => {
          return call.receiver === RESOURCE_SERVICE;
        })
        .map((call: ServiceCall): string => {
          return call.method;
        });

      expect(resourceCalls.length).toBeGreaterThan(0);
      expect(
        resourceCalls.filter((method: string): boolean => {
          return method !== "findByMonitors";
        }),
      ).toEqual([]);
    },
  );

  test("findByMonitors follows monitor groups", () => {
    const source: ts.SourceFile = parse(
      "StatusPageResourceService.ts",
      readRepositoryFile(
        "packages/Common/Server/Services/StatusPageResourceService.ts",
      ),
    );

    let body: string = "";

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "findByMonitors" &&
        node.body
      ) {
        body = node.body.getText(source);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    // The groups that hold the monitors, then the groups' own resources.
    expect(body).toContain("MonitorGroupResourceService.");
    expect(body).toContain("monitorGroupId: QueryHelper.any(");
  });
});

/*
 * The scanner itself, on small sources: it must see a resource lookup
 * however the sender writes it, and must not mistake a comment, a string or
 * the method's own definition for a call.
 */
describe("the subscriber resource lookup scanner", () => {
  const SENDER_HEAD: string = `
    import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
    StatusPageSubscriberService.shouldSendNotification({ subscriber, statusPageResources, statusPage, eventType });
  `;

  function problemsOf(text: string, isIncidentSender: boolean): Array<string> {
    return senderProblems({
      facts: readFacts("Example.ts", SENDER_HEAD + text),
      isIncidentSender: isIncidentSender,
    });
  }

  test("a sender that looks resources up by monitorId itself is caught", () => {
    expect(
      problemsOf(
        `
        const resources = await StatusPageResourceService.findAllBy({ query: { monitorId: QueryHelper.any(ids) } });
        const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, select });
        `,
        false,
      ),
    ).toEqual([
      "reads status page resources itself (StatusPageResourceService.findAllBy (line 5)); get them from AffectedStatusPageResources, which also follows monitor groups",
    ]);
  });

  test("calling findByMonitors directly is caught too: the pages are grouped by the shared lookup", () => {
    expect(
      problemsOf(
        `
        const resources = await StatusPageResourceService.findByMonitors({ monitors, select });
        `,
        false,
      ),
    ).toEqual([
      "reads status page resources itself (StatusPageResourceService.findByMonitors (line 5)); get them from AffectedStatusPageResources, which also follows monitor groups",
      "does not get its resources from AffectedStatusPageResources.findForMonitors",
    ]);
  });

  test("an aliased import of the resource service is caught", () => {
    expect(
      problemsOf(
        `
        import Resources from "Common/Server/Services/StatusPageResourceService";
        const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, select });
        `,
        false,
      ),
    ).toEqual(["imports Common/Server/Services/StatusPageResourceService"]);
  });

  test("an event sender that asks AffectedStatusPageResources passes, whatever its comments say", () => {
    expect(
      problemsOf(
        `
        // It used to call StatusPageResourceService.findAllBy({ monitorId }).
        const note = "StatusPageResourceService.findAllBy";
        const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, select });
        `,
        false,
      ),
    ).toEqual([]);
  });

  test("an incident sender must ask IncidentStatusPageScope, and not the scope-blind lookup", () => {
    expect(
      problemsOf(
        `
        const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, select });
        `,
        true,
      ),
    ).toEqual([
      "does not ask IncidentStatusPageScope which pages and resources the incident reaches",
      "calls AffectedStatusPageResources.findForMonitors (line 5), which knows nothing of an incident's status page scope",
    ]);

    expect(
      problemsOf(
        `
        const resolved = await IncidentStatusPageScope.resolvePagesForIncidents({ incidents });
        `,
        true,
      ),
    ).toEqual([]);
  });

  test("only a call to shouldSendNotification makes a file a sender", () => {
    expect(
      readFacts(
        "Service.ts",
        `
        class Service {
          // StatusPageSubscriberService.shouldSendNotification(...) decides.
          public shouldSendNotification(data: unknown): boolean { return true; }
        }
        const text = "StatusPageSubscriberService.shouldSendNotification(";
        `,
      ).callsShouldSendNotification,
    ).toBe(false);

    expect(
      readFacts("Example.ts", SENDER_HEAD).callsShouldSendNotification,
    ).toBe(true);
  });
});
