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
 *
 * A job file exists to send, so nothing in it reads status page resources
 * (aliased imports included). A service that also sends
 * (ScheduledMaintenanceService) may use the resource service for other
 * work, but not in the function or method that sends.
 *
 * IncidentStatusPageScopeCallSites.test.ts guards the incident side's own
 * rules (scope, which pages a status page shows); this guards that every
 * sender, incident or not, gets its resources from the lookup that follows
 * monitor groups.
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
  /*
   * Whether the call is in a function or method that calls
   * shouldSendNotification: the top-level one, so a helper arrow inside it
   * counts as part of it.
   */
  inSendingFunction: boolean;
}

interface FileFacts {
  callsShouldSendNotification: boolean;
  calls: Array<ServiceCall>;
  // Modules imported, as written.
  importedModules: Array<string>;
  // The names this file calls StatusPageResourceService by.
  resourceServiceNames: Array<string>;
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

function serviceCallOf(
  node: ts.Node,
): { receiver: string; method: string } | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression)
  ) {
    return {
      receiver: node.expression.expression.text,
      method: node.expression.name.text,
    };
  }

  return null;
}

function isShouldSendNotificationCall(node: ts.Node): boolean {
  const call: { receiver: string; method: string } | null = serviceCallOf(node);

  return (
    call !== null &&
    call.receiver === "StatusPageSubscriberService" &&
    call.method === "shouldSendNotification"
  );
}

/*
 * The outermost function or method around a node, or the file itself for
 * code at the top level.
 */
function outermostFunction(node: ts.Node): ts.Node {
  let outermost: ts.Node = node.getSourceFile();
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      outermost = current;
    }

    current = current.parent;
  }

  return outermost;
}

function isInside(node: ts.Node, scopes: Set<ts.Node>): boolean {
  let current: ts.Node | undefined = node;

  while (current) {
    if (scopes.has(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

/*
 * The calls a source makes on an identifier (Service.method(...)), whether
 * it calls StatusPageSubscriberService.shouldSendNotification and from
 * where, what it imports, and the names it gives the resource service. Read
 * from the AST, so a comment or a string that names a method is not a call.
 */
function readFacts(fileName: string, text: string): FileFacts {
  const source: ts.SourceFile = parse(fileName, text);
  const facts: FileFacts = {
    callsShouldSendNotification: false,
    calls: [],
    importedModules: [],
    resourceServiceNames: [RESOURCE_SERVICE],
  };
  const sendingFunctions: Set<ts.Node> = new Set();

  const findSenders: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      facts.importedModules.push(node.moduleSpecifier.text);

      const clause: ts.ImportClause | undefined = node.importClause;

      if (RESOURCE_SERVICE_MODULE.test(node.moduleSpecifier.text) && clause) {
        if (clause.name) {
          facts.resourceServiceNames.push(clause.name.text);
        }

        const bindings: ts.NamedImportBindings | undefined =
          clause.namedBindings;

        if (bindings && ts.isNamespaceImport(bindings)) {
          facts.resourceServiceNames.push(bindings.name.text);
        }

        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            facts.resourceServiceNames.push(element.name.text);
          }
        }
      }
    }

    if (isShouldSendNotificationCall(node)) {
      facts.callsShouldSendNotification = true;
      sendingFunctions.add(outermostFunction(node));
    }

    ts.forEachChild(node, findSenders);
  };

  findSenders(source);

  const collectCalls: (node: ts.Node) => void = (node: ts.Node): void => {
    const call: { receiver: string; method: string } | null =
      serviceCallOf(node);

    if (call) {
      facts.calls.push({
        ...call,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        inSendingFunction: isInside(node, sendingFunctions),
      });
    }

    ts.forEachChild(node, collectCalls);
  };

  collectCalls(source);

  return facts;
}

function describeCall(call: ServiceCall): string {
  return `${call.receiver}.${call.method} (line ${call.line})`;
}

function callsOn(facts: FileFacts, receiver: string): Array<string> {
  return facts.calls
    .filter((call: ServiceCall): boolean => {
      return call.receiver === receiver;
    })
    .map(describeCall);
}

function calls(facts: FileFacts, receiver: string, method: string): boolean {
  return facts.calls.some((call: ServiceCall): boolean => {
    return call.receiver === receiver && call.method === method;
  });
}

/*
 * What a sender breaks, in words: reading status page resources itself, or
 * not asking the lookup its kind of event goes through.
 *
 * A job exists to send, so nothing in its file reads status page resources.
 * A service that also sends (ScheduledMaintenanceService) may use the
 * resource service for other work, just not in the function or method that
 * sends.
 */
function senderProblems(data: {
  facts: FileFacts;
  isIncidentSender: boolean;
  isJob: boolean;
}): Array<string> {
  const problems: Array<string> = [];
  const { facts } = data;

  for (const call of facts.calls) {
    if (
      facts.resourceServiceNames.includes(call.receiver) &&
      (data.isJob || call.inSendingFunction)
    ) {
      problems.push(
        `reads status page resources itself (${describeCall(call)}); get them from ${
          data.isIncidentSender ? INCIDENT_SCOPE : AFFECTED_RESOURCES
        }, which also follows monitor groups`,
      );
    }
  }

  if (data.isJob) {
    for (const moduleName of facts.importedModules) {
      if (RESOURCE_SERVICE_MODULE.test(moduleName)) {
        problems.push(`imports ${moduleName}`);
      }
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

function isJobFile(relativePath: string): boolean {
  return relativePath.includes("/Workers/Jobs/");
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
      expect(
        senderProblems({
          facts: facts,
          isIncidentSender: true,
          isJob: isJobFile(file),
        }),
      ).toEqual([]);
    },
  );

  test.each(EVENT_SENDERS)(
    "%s gets its resources from AffectedStatusPageResources",
    (file: string) => {
      const facts: FileFacts = readFacts(file, readRepositoryFile(file));

      expect(facts.callsShouldSendNotification).toBe(true);
      expect(
        senderProblems({
          facts: facts,
          isIncidentSender: false,
          isJob: isJobFile(file),
        }),
      ).toEqual([]);
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

  // A job file that sends, with the given code after the send.
  function problemsOf(text: string, isIncidentSender: boolean): Array<string> {
    return senderProblems({
      facts: readFacts("Example.ts", SENDER_HEAD + text),
      isIncidentSender: isIncidentSender,
      isJob: true,
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

  test("an aliased import of the resource service is caught, and so are its calls", () => {
    expect(
      problemsOf(
        `
        import Resources from "Common/Server/Services/StatusPageResourceService";
        const rows = await Resources.findAllBy({ query: { monitorId } });
        const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, select });
        `,
        false,
      ),
    ).toEqual([
      "reads status page resources itself (Resources.findAllBy (line 6)); get them from AffectedStatusPageResources, which also follows monitor groups",
      "imports Common/Server/Services/StatusPageResourceService",
    ]);
  });

  /*
   * A service that also sends may use the resource service for other work,
   * just not in the method that sends - nor in a helper arrow inside it.
   */
  const SENDING_SERVICE: string = `
    import Resources from "../../Server/Services/StatusPageResourceService";

    export class Service {
      public async addResources(): Promise<void> {
        await Resources.findBy({ query: { statusPageId } });
      }

      public async notify(events: Array<Event>): Promise<void> {
        for (const event of events) {
          const byPage = await AffectedStatusPageResources.findForMonitors({ monitors, statusPages, select });
          const pick = async () => {
            return READ_IN_SEND;
          };
          StatusPageSubscriberService.shouldSendNotification({ subscriber, statusPageResources, statusPage, eventType });
        }
      }
    }
  `;

  function serviceProblems(readInSend: string): Array<string> {
    return senderProblems({
      facts: readFacts(
        "Service.ts",
        SENDING_SERVICE.replace("READ_IN_SEND", readInSend),
      ),
      isIncidentSender: false,
      isJob: false,
    });
  }

  test("a service may use the resource service outside the method that sends", () => {
    expect(serviceProblems("null")).toEqual([]);
  });

  test("a service that reads resources in the method that sends is caught, inside a helper arrow too", () => {
    expect(
      serviceProblems("await Resources.findAllBy({ query: { monitorId } })"),
    ).toEqual([
      "reads status page resources itself (Resources.findAllBy (line 13)); get them from AffectedStatusPageResources, which also follows monitor groups",
    ]);
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
