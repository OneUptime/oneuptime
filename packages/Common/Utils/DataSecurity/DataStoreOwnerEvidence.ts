import {
  DataStoreOwnerCandidate,
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRef,
  DataStoreOwnerUnmatched,
  findEmailAddresses,
  getOwnerNameForms,
  isOwnerTagKey,
  MAX_DATA_STORE_OWNER_CANDIDATES,
  MAX_DATA_STORE_OWNER_EVIDENCE,
} from "../../Types/DataSecurity/DataStoreOwnerProposal";
import { isCodeOwnerTeam } from "../CodeRepository/CodeOwners";
import FeedPersonNameRule from "../../Server/Utils/Feed/FeedPersonNameRule";

/*
 * WHO THE EVIDENCE OF A STORE'S OWNERS NAMES, IN ONEUPTIME (#10374).
 *
 * The server reads what points to an owner (DataStoreOwnerEvidenceReader):
 * the store's cloud tags, the services that use it and their owners, the
 * code owners of the file that declares it, who changed it, who added it.
 * This turns those facts into evidence, each piece mapped to the project's
 * own people and teams - plain code, no AI:
 *
 *   - an email address is a member of the project with that email;
 *   - a name or a code owners team handle is a team of the project with
 *     that name, as getOwnerNameForms folds names ("@acme/payments-team"
 *     is the team "Payments"); a name two teams answer to is no one's;
 *   - a person's handle on a code host is no one OneUptime can tell apart
 *     from its members, and says so;
 *   - a service's owners are its owners in OneUptime, already.
 *
 * Every person and team named is a candidate, numbered in the order the
 * evidence names them - teams "T1", people "P1" - with the evidence that
 * names each and whether they can open the store at all: through the
 * permissions their teams hold on data stores, product levels included
 * (#10289), held to the store's labels. An owner who cannot open the
 * store is still a candidate: the proposal says so.
 *
 * Pure: the reads are the server's; the tests and the eval harness hand
 * facts in directly.
 */

export interface DataStoreOwnerPerson {
  id: string;
  /*
   * Their name as their account holds it, empty for none: what getName
   * names them by.
   */
  name: string;
  // Their address: what evidence that names an address is matched by.
  email: string;
  teamIds: Array<string>;
}

export interface DataStoreOwnerTeam {
  id: string;
  name: string;
}

/*
 * A permission a team holds that reads data stores, as its rows say it:
 * for every store (no labels) or only the stores with one of its labels;
 * a block takes the stores it covers away.
 */
export interface DataStoreReadGrant {
  labelIds: Array<string>;
  isBlock: boolean;
}

/*
 * The project's people and teams, as the evidence is mapped to them, and
 * who among them can open which store.
 */
export class DataStoreOwnerDirectory {
  private readonly peopleByEmail: Map<string, DataStoreOwnerPerson> = new Map();
  private readonly peopleById: Map<string, DataStoreOwnerPerson> = new Map();
  private readonly teamsById: Map<string, DataStoreOwnerTeam> = new Map();
  // By the team's whole name, folded; and by its name without "team".
  private readonly teamsByName: Map<string, Array<DataStoreOwnerTeam>> =
    new Map();
  private readonly teamsByShortName: Map<string, Array<DataStoreOwnerTeam>> =
    new Map();
  private readonly grantsByTeam: Map<string, Array<DataStoreReadGrant>>;

  public constructor(data: {
    people: ReadonlyArray<DataStoreOwnerPerson>;
    teams: ReadonlyArray<DataStoreOwnerTeam>;
    // Each team's permissions that read data stores, by team id.
    grantsByTeam: Map<string, Array<DataStoreReadGrant>>;
  }) {
    for (const person of data.people) {
      this.peopleById.set(person.id.toLowerCase(), person);

      if (person.email) {
        this.peopleByEmail.set(person.email.trim().toLowerCase(), person);
      }
    }

    for (const team of data.teams) {
      this.teamsById.set(team.id.toLowerCase(), team);

      const [whole, ...shorter]: Array<string> = getOwnerNameForms(team.name);

      if (whole) {
        this.teamsByName.set(whole, [
          ...(this.teamsByName.get(whole) || []),
          team,
        ]);
      }

      for (const form of shorter) {
        this.teamsByShortName.set(form, [
          ...(this.teamsByShortName.get(form) || []),
          team,
        ]);
      }
    }

    this.grantsByTeam = new Map(
      Array.from(data.grantsByTeam.entries()).map(
        ([teamId, grants]: [string, Array<DataStoreReadGrant>]): [
          string,
          Array<DataStoreReadGrant>,
        ] => {
          return [teamId.toLowerCase(), grants];
        },
      ),
    );
  }

  public getPersonByEmail(email: string): DataStoreOwnerPerson | null {
    return this.peopleByEmail.get(email.trim().toLowerCase()) || null;
  }

  public getPerson(id: string): DataStoreOwnerPerson | null {
    return this.peopleById.get(id.toLowerCase()) || null;
  }

  public getTeam(id: string): DataStoreOwnerTeam | null {
    return this.teamsById.get(id.toLowerCase()) || null;
  }

  /*
   * The team a name names: the one team whose whole name it is, else the
   * one whose name it is without "team" ("payments" is "Payments Team"). A
   * name two teams answer to alike names neither - a guess is no evidence.
   */
  public getTeamByName(name: string): DataStoreOwnerTeam | null {
    const [whole, ...shorter]: Array<string> = getOwnerNameForms(name);

    if (!whole) {
      return null;
    }

    const levels: Array<Array<DataStoreOwnerTeam>> = [
      // The team whose whole name it is.
      this.teamsByName.get(whole) || [],
      // Else one side's name without "team" is the other's whole name.
      [
        ...(this.teamsByShortName.get(whole) || []),
        ...shorter.flatMap((form: string): Array<DataStoreOwnerTeam> => {
          return this.teamsByName.get(form) || [];
        }),
      ],
    ];

    for (const level of levels) {
      const matches: Map<string, DataStoreOwnerTeam> = new Map();

      for (const team of level) {
        matches.set(team.id.toLowerCase(), team);
      }

      if (matches.size === 1) {
        return Array.from(matches.values())[0]!;
      }

      if (matches.size > 1) {
        return null;
      }
    }

    return null;
  }

  // Whether a team can open a store with these labels.
  public canTeamOpenStore(
    teamId: string,
    storeLabelIds: Array<string>,
  ): boolean {
    const grants: Array<DataStoreReadGrant> =
      this.grantsByTeam.get(teamId.toLowerCase()) || [];
    const labels: Set<string> = new Set(
      storeLabelIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    );
    const covers: (grant: DataStoreReadGrant) => boolean = (
      grant: DataStoreReadGrant,
    ): boolean => {
      return (
        grant.labelIds.length === 0 ||
        grant.labelIds.some((id: string): boolean => {
          return labels.has(id.toLowerCase());
        })
      );
    };

    if (
      grants.some((grant: DataStoreReadGrant): boolean => {
        return grant.isBlock && covers(grant);
      })
    ) {
      return false;
    }

    return grants.some((grant: DataStoreReadGrant): boolean => {
      return !grant.isBlock && covers(grant);
    });
  }

  // Whether an owner - a team, or a person through any of their teams - can open it.
  public canOpenStore(
    owner: DataStoreOwnerRef,
    storeLabelIds: Array<string>,
  ): boolean {
    if (owner.kind === DataStoreOwnerKind.Team) {
      return this.canTeamOpenStore(owner.id, storeLabelIds);
    }

    const person: DataStoreOwnerPerson | null = this.getPerson(owner.id);

    return Boolean(
      person?.teamIds.some((teamId: string): boolean => {
        return this.canTeamOpenStore(teamId, storeLabelIds);
      }),
    );
  }

  public getName(owner: DataStoreOwnerRef): string {
    if (owner.kind === DataStoreOwnerKind.Team) {
      return this.getTeam(owner.id)?.name || "";
    }

    const person: DataStoreOwnerPerson | null = this.getPerson(owner.id);

    /*
     * The people a proposal names are its title and its lines on the
     * store's and its issues' timelines: each is named as every line names
     * a member (FeedPersonNameRule.getMemberName, #10681) - by their name,
     * else the part of their address before the "@". Never their address.
     */
    return person
      ? FeedPersonNameRule.getMemberName({
          name: person.name,
          email: person.email,
        })
      : "";
  }
}

// A service that uses the store, or whose telemetry it is, and its owners.
export interface DataStoreOwnerServiceFact {
  serviceId: string;
  serviceName: string;
  // The store is this service's own telemetry.
  isTelemetry: boolean;
  ownerUserIds: Array<string>;
  ownerTeamIds: Array<string>;
}

// The code owners of the file that declares the store, as the file writes them.
export interface DataStoreOwnerCodeFact {
  repositoryName: string;
  filePath: string;
  codeOwnersPath: string;
  owners: Array<string>;
}

// Someone the cloud's change log names as having changed the store.
export interface DataStoreOwnerChangeFact {
  actor: string;
  operation: string;
  changeCount: number;
  lastChangedAt: string;
}

// Everything the server read that points to the store's owners.
export interface DataStoreOwnerFacts {
  cloudTags: Record<string, string>;
  services: Array<DataStoreOwnerServiceFact>;
  // How many services the service map sees using the store.
  servicesUsingIt: number;
  codeOwners: Array<DataStoreOwnerCodeFact>;
  changes: Array<DataStoreOwnerChangeFact>;
  // The person who added the store to OneUptime, when a person did.
  addedByUserId: string | null;
}

export interface DataStoreOwnerEvidenceSet {
  evidence: Array<DataStoreOwnerEvidence>;
  candidates: Array<DataStoreOwnerCandidate>;
  servicesUsingIt: number;
}

// The most services, people who changed it and code owners read for one store.
export const MAX_OWNER_SERVICES: number = 5;
export const MAX_OWNER_CHANGE_ACTORS: number = 3;
export const MAX_OWNER_CODE_OWNERS: number = 5;

type EvidenceDraft = Omit<DataStoreOwnerEvidence, "id">;

function team(id: string): DataStoreOwnerRef {
  return { kind: DataStoreOwnerKind.Team, id };
}

function user(id: string): DataStoreOwnerRef {
  return { kind: DataStoreOwnerKind.User, id };
}

// The names a tag's value lists: "payments", or "payments, platform".
function namesInTagValue(value: string): Array<string> {
  return value
    .split(/[,;|]/)
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .slice(0, 5);
}

function tagEvidence(
  tags: Record<string, string>,
  directory: DataStoreOwnerDirectory,
): Array<EvidenceDraft> {
  const drafts: Array<EvidenceDraft> = [];

  for (const key of Object.keys(tags).sort()) {
    const value: string = (tags[key] || "").trim();

    if (!value || !isOwnerTagKey(key)) {
      continue;
    }

    const owners: Array<DataStoreOwnerRef> = [];
    const emails: Array<string> = findEmailAddresses(value);
    let unmatched: DataStoreOwnerUnmatched | undefined;

    if (emails.length > 0) {
      for (const email of emails) {
        const person: DataStoreOwnerPerson | null =
          directory.getPersonByEmail(email);

        if (person) {
          owners.push(user(person.id));
        }
      }

      unmatched =
        owners.length === 0
          ? DataStoreOwnerUnmatched.NoMemberWithEmail
          : undefined;
    } else {
      for (const name of namesInTagValue(value)) {
        const found: DataStoreOwnerTeam | null = directory.getTeamByName(name);

        if (found) {
          owners.push(team(found.id));
        }
      }

      unmatched =
        owners.length === 0 ? DataStoreOwnerUnmatched.NoTeamNamed : undefined;
    }

    drafts.push({
      source: DataStoreOwnerEvidenceSource.CloudTag,
      tagKey: key,
      tagValue: value,
      owners,
      unmatched,
    });
  }

  return drafts;
}

function serviceEvidence(
  services: ReadonlyArray<DataStoreOwnerServiceFact>,
  directory: DataStoreOwnerDirectory,
): Array<EvidenceDraft> {
  // The service whose telemetry the store is goes first.
  const ordered: Array<DataStoreOwnerServiceFact> = [...services].sort(
    (left: DataStoreOwnerServiceFact, right: DataStoreOwnerServiceFact) => {
      return Number(right.isTelemetry) - Number(left.isTelemetry);
    },
  );

  return ordered
    .slice(0, MAX_OWNER_SERVICES)
    .map((service: DataStoreOwnerServiceFact): EvidenceDraft => {
      const owners: Array<DataStoreOwnerRef> = [
        ...service.ownerTeamIds
          .filter((id: string): boolean => {
            return directory.getTeam(id) !== null;
          })
          .map(team),
        ...service.ownerUserIds
          .filter((id: string): boolean => {
            return directory.getPerson(id) !== null;
          })
          .map(user),
      ];

      return {
        source: DataStoreOwnerEvidenceSource.ServiceOwners,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        isServiceTelemetry: service.isTelemetry ? true : undefined,
        owners,
        unmatched:
          owners.length === 0
            ? DataStoreOwnerUnmatched.ServiceHasNoOwners
            : undefined,
      };
    });
}

function codeOwnerEvidence(
  facts: ReadonlyArray<DataStoreOwnerCodeFact>,
  directory: DataStoreOwnerDirectory,
): Array<EvidenceDraft> {
  const drafts: Array<EvidenceDraft> = [];

  for (const fact of facts) {
    for (const owner of fact.owners.slice(0, MAX_OWNER_CODE_OWNERS)) {
      const base: EvidenceDraft = {
        source: DataStoreOwnerEvidenceSource.CodeOwners,
        repositoryName: fact.repositoryName,
        filePath: fact.filePath,
        codeOwnersPath: fact.codeOwnersPath,
        codeOwner: owner,
        owners: [],
      };

      if (isCodeOwnerTeam(owner)) {
        const found: DataStoreOwnerTeam | null = directory.getTeamByName(owner);

        drafts.push(
          found
            ? { ...base, owners: [team(found.id)] }
            : { ...base, unmatched: DataStoreOwnerUnmatched.NoTeamNamed },
        );
        continue;
      }

      if (owner.includes("@") && !owner.startsWith("@")) {
        const person: DataStoreOwnerPerson | null =
          directory.getPersonByEmail(owner);

        drafts.push(
          person
            ? { ...base, owners: [user(person.id)] }
            : { ...base, unmatched: DataStoreOwnerUnmatched.NoMemberWithEmail },
        );
        continue;
      }

      // "@alice": a handle on the code host, no one OneUptime can match.
      drafts.push({
        ...base,
        unmatched: DataStoreOwnerUnmatched.UnknownHandle,
      });
    }
  }

  return drafts;
}

/*
 * Who changed the store, by the email address in what the cloud's change
 * log calls them. One it names no member of the project by - a role, an
 * automation, someone outside the project - says nothing of who owns it,
 * and is left out.
 */
function changeEvidence(
  changes: ReadonlyArray<DataStoreOwnerChangeFact>,
  directory: DataStoreOwnerDirectory,
): Array<EvidenceDraft> {
  const drafts: Array<EvidenceDraft> = [];
  const seen: Set<string> = new Set();

  for (const change of changes) {
    if (drafts.length >= MAX_OWNER_CHANGE_ACTORS) {
      break;
    }

    const person: DataStoreOwnerPerson | null =
      findEmailAddresses(change.actor)
        .map((email: string): DataStoreOwnerPerson | null => {
          return directory.getPersonByEmail(email);
        })
        .find((found: DataStoreOwnerPerson | null): boolean => {
          return found !== null;
        }) || null;

    if (!person || seen.has(person.id)) {
      continue;
    }

    seen.add(person.id);
    drafts.push({
      source: DataStoreOwnerEvidenceSource.ChangedBy,
      operation: change.operation,
      changeCount: change.changeCount,
      lastChangedAt: change.lastChangedAt,
      owners: [user(person.id)],
    });
  }

  return drafts;
}

/*
 * The evidence of who owns a store, and the candidates it names, from what
 * the server read of it.
 */
export function assembleDataStoreOwnerEvidence(data: {
  facts: DataStoreOwnerFacts;
  directory: DataStoreOwnerDirectory;
  storeLabelIds: Array<string>;
}): DataStoreOwnerEvidenceSet {
  const { facts, directory } = data;
  const drafts: Array<EvidenceDraft> = [
    ...tagEvidence(facts.cloudTags, directory),
    ...serviceEvidence(facts.services, directory),
    ...codeOwnerEvidence(facts.codeOwners, directory),
    ...changeEvidence(facts.changes, directory),
  ];

  if (facts.addedByUserId && directory.getPerson(facts.addedByUserId)) {
    drafts.push({
      source: DataStoreOwnerEvidenceSource.AddedBy,
      owners: [user(facts.addedByUserId)],
    });
  }

  const evidence: Array<DataStoreOwnerEvidence> = drafts
    .slice(0, MAX_DATA_STORE_OWNER_EVIDENCE)
    .map((draft: EvidenceDraft, index: number): DataStoreOwnerEvidence => {
      return { id: `E${index + 1}`, ...draft };
    });

  // Every owner named, teams first, each in the order it was first named.
  const named: Array<{ ref: DataStoreOwnerRef; evidenceIds: Array<string> }> =
    [];

  for (const item of evidence) {
    for (const owner of item.owners) {
      const existing:
        | { ref: DataStoreOwnerRef; evidenceIds: Array<string> }
        | undefined = named.find(
        (entry: { ref: DataStoreOwnerRef }): boolean => {
          return (
            entry.ref.kind === owner.kind &&
            entry.ref.id.toLowerCase() === owner.id.toLowerCase()
          );
        },
      );

      if (existing) {
        if (!existing.evidenceIds.includes(item.id)) {
          existing.evidenceIds.push(item.id);
        }
        continue;
      }

      named.push({ ref: owner, evidenceIds: [item.id] });
    }
  }

  const teams: Array<{ ref: DataStoreOwnerRef; evidenceIds: Array<string> }> =
    named.filter((entry: { ref: DataStoreOwnerRef }): boolean => {
      return entry.ref.kind === DataStoreOwnerKind.Team;
    });
  const people: Array<{ ref: DataStoreOwnerRef; evidenceIds: Array<string> }> =
    named.filter((entry: { ref: DataStoreOwnerRef }): boolean => {
      return entry.ref.kind === DataStoreOwnerKind.User;
    });

  const candidates: Array<DataStoreOwnerCandidate> = [
    ...teams.map(
      (
        entry: { ref: DataStoreOwnerRef; evidenceIds: Array<string> },
        index: number,
      ): DataStoreOwnerCandidate => {
        return {
          ...entry.ref,
          ref: `T${index + 1}`,
          name: directory.getName(entry.ref),
          evidenceIds: entry.evidenceIds,
          canOpenStore: directory.canOpenStore(entry.ref, data.storeLabelIds),
        };
      },
    ),
    ...people.map(
      (
        entry: { ref: DataStoreOwnerRef; evidenceIds: Array<string> },
        index: number,
      ): DataStoreOwnerCandidate => {
        return {
          ...entry.ref,
          ref: `P${index + 1}`,
          name: directory.getName(entry.ref),
          evidenceIds: entry.evidenceIds,
          canOpenStore: directory.canOpenStore(entry.ref, data.storeLabelIds),
        };
      },
    ),
  ].slice(0, MAX_DATA_STORE_OWNER_CANDIDATES);

  return {
    evidence,
    candidates,
    servicesUsingIt: Math.max(0, facts.servicesUsingIt),
  };
}
