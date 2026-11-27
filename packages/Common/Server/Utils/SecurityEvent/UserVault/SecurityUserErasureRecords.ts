import PostgresAppInstance from "../../../Infrastructure/PostgresDatabase";
import SecurityCaseAiActionService from "../../../Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityDetectionService from "../../../Services/SecurityDetectionService";
import SecurityPlaybookRunService from "../../../Services/SecurityPlaybookRunService";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Includes from "../../../../Types/BaseDatabase/Includes";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityPlaybookRunStatus from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  CORRELATION_SENTENCE_PREFIX,
  ErasedName,
  GROUP_VALUE_PART_SEPARATOR,
  THREAT_INTEL_INDICATOR_NAME_PREFIX,
  THREAT_INTEL_STIX_INDICATOR_PREFIX,
  getDescriptionNameTexts,
  getErasedRiskKeys,
  getStixIndicatorIdOf,
  unnameDescription,
  unnameGroupValue,
  unnameGroupingKey,
  unnameJson,
  unnameKeptEventStamps,
  unnameThreatIntelDescription,
  unnameTitle,
  unnameValue,
  withErasedStixIndicator,
} from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { toErasedIndicatorId } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import {
  DetectionFingerprintKind,
  DetectionFingerprintPlaces,
  getFindingUidPlaces,
  getFiringKeyPlaces,
  getSourceFingerprintPlaces,
  putFingerprintAt,
} from "../../../../Utils/SecurityEvent/DetectionFingerprintPlaces";
import { getEntityCaseGroupingKey } from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import DetectionFingerprint, {
  DETECTION_FINGERPRINT_KINDS,
} from "../DetectionFingerprint";
import { getEntityRiskFingerprint } from "../EntityRisk/SecurityEntityRiskCases";
import JobDeadline from "../../JobDeadline";
import logger from "../../Logger";

/*
 * WHAT AN ERASURE CHANGES IN POSTGRES (#10908): the person taken out of
 * what Security Events wrote about them once the user vault named them.
 * Each place gets what the Hash rule left in the name's place
 * (Utils/SecurityEvent/SecurityUserErasureUnnaming says which values):
 *
 *   - detections: their title, description, entities, group value and kept
 *     events;
 *   - cases: their title, description, entities and grouping key. A
 *     description gets the token only where OneUptime wrote the name as a
 *     value of its own: as inline code, or in a correlation's sentence;
 *   - entity risk: the person's row is deleted. Risk is worked out again
 *     from what is found, which names the token from now on;
 *   - proposals: an action of OneUptime AI's waiting for a person's
 *     approval to act on them is withdrawn (Left, PersonErased), and a
 *     playbook run waiting for approval is cancelled - nobody may act on a
 *     person after they were erased because the vault named them. The
 *     target of every action and the results of every run that named them
 *     get the token too.
 *
 * And the fingerprints (#11130): what Security Events deduped by the value
 * a rule grouped on, or a feed's indicator, carries that value's
 * fingerprint - a detection's fingerprint, the id of the Detection Finding
 * it points at and the firings it took, an alert's and an incident's
 * fingerprint, the firings an entity's risk counted. Each that is of a value
 * that named the person gets the fingerprint of the value once the names
 * are out (rewriteFingerprints): what the rule makes when it fires on the
 * token, so an open alert, incident or case detection goes on taking its
 * group's firings, and nothing stored is a fingerprint of the person.
 *
 * And a threat intel feed's indicator (#11230): a feed can list the
 * person's email address, and keeps it beside the indicator's id and name
 * in clear. Where a match on the person named the indicator - a detection's
 * description and its case's ("STIX indicator: `indicator--...`",
 * "Indicator: <its name>"), the events a detection kept (their threat intel
 * stamp), and the description of an alert or an incident the match opened
 * with the feed items that copied it - it says the erased indicator id
 * instead (Types/SecurityEvent/ThreatIntelConstants), and the indicator's
 * name goes. The feed stays named.
 *
 * What it does not change: what people wrote (notes, closing notes,
 * tasks, evidence, custom fields, watchlists, protected entities),
 * OneUptime AI's written reports, a case's feed, the titles and
 * descriptions of incidents and alerts a detection opened (but a feed's
 * indicator id in them), and notifications already sent.
 *
 * WRITTEN WITHOUT THE AUDIT LOG KEEPING THE NAME. An audited update records
 * the values it replaced, and an audited delete the whole row: through the
 * services, erasing a case's title would copy the person's name into the
 * audit log. So cases, a run's results and entity risk rows are written
 * with SQL of their own, and the erasure request records what it changed
 * (its counts). Detections and OneUptime AI's actions are not audited, and
 * are written through their services, as the server, without their hooks.
 *
 * Every step finds only what still names the person, so running it again
 * changes nothing more.
 */

// The most rows of one kind one run takes the person out of.
export const MAX_ROWS_PER_KIND: number = 5000;

// What an erasure changed in Postgres.
export interface SecurityUserErasureRecordCounts {
  // Cases that named the person, themselves or through their detections.
  cases: number;
  // Proposals to act on the person that were withdrawn.
  proposals: number;
}

// What unnameDetections changed: the cases of the detections, and the correlations' values.
export interface UnnamedDetections {
  caseIds: Array<string>;
  // Each correlation's group value it un-named, as it was (named) and now (hashed).
  groupValues: Array<ErasedName>;
}

/*
 * One fingerprint an erasure rewrites (#11130): what it was - of a value
 * that named the person, keyed or as it was before the key - and what it
 * becomes, the keyed one of the value once the names are out.
 */
export interface DetectionFingerprintChange {
  kind: DetectionFingerprintKind;
  previous: string;
  next: string;
}

// What rewriteFingerprints changed, record by record.
export interface RewrittenFingerprintCounts {
  detections: number;
  alerts: number;
  incidents: number;
  entityRisks: number;
}

/*
 * The fingerprints of every value that named the person, each with the one
 * it becomes: for each value (a name, or a correlation's group value) and
 * each source, its keyed and its unkeyed fingerprint, to the keyed one of
 * what it is once the names are out. A value the change leaves as it was
 * changes nothing.
 */
export function getFingerprintChanges(data: {
  projectId: ObjectID;
  groupValues: ReadonlyArray<ErasedName>;
}): Array<DetectionFingerprintChange> {
  const changes: Map<string, DetectionFingerprintChange> = new Map();

  for (const value of data.groupValues) {
    if (!value.named || !value.hashed || value.named === value.hashed) {
      continue;
    }

    for (const kind of DETECTION_FINGERPRINT_KINDS) {
      const next: string = DetectionFingerprint.of({
        projectId: data.projectId,
        kind,
        value: value.hashed,
      });

      for (const previous of DetectionFingerprint.allOf({
        projectId: data.projectId,
        kind,
        value: value.named,
      })) {
        if (previous !== next) {
          changes.set(`${kind}\u0000${previous}`, { kind, previous, next });
        }
      }
    }
  }

  return Array.from(changes.values());
}

/*
 * The fingerprint an entity's risk detection carries for each name
 * ("entity-risk:<the name, case folded>": the name itself, not a hash), with
 * the one about what the rule left in its place.
 */
export function getEntityRiskFingerprintChanges(
  names: ReadonlyArray<ErasedName>,
): Map<string, string> {
  const changes: Map<string, string> = new Map<string, string>();

  for (const name of names) {
    if (!name.named || !name.hashed || name.named === name.hashed) {
      continue;
    }

    const previous: string = getEntityRiskFingerprint(name.named);
    const next: string = getEntityRiskFingerprint(name.hashed);

    if (previous !== next) {
      changes.set(previous, next);
    }
  }

  return changes;
}

/*
 * `text` with the fingerprint of a change where its places hold a previous
 * one; `text` as it was when they hold none of them.
 */
function rewriteWithChanges(data: {
  text: string | undefined | null;
  placesOf: (text: string) => DetectionFingerprintPlaces | null;
  changes: Map<string, DetectionFingerprintChange>;
}): string | undefined | null {
  if (typeof data.text !== "string") {
    return data.text;
  }

  const places: DetectionFingerprintPlaces | null = data.placesOf(data.text);
  const change: DetectionFingerprintChange | undefined = places
    ? data.changes.get(`${places.source}\u0000${places.fingerprint}`)
    : undefined;

  return places && change
    ? putFingerprintAt({ text: data.text, places, fingerprint: change.next })
    : data.text;
}

// The changes by kind and previous fingerprint, as rewriteWithChanges looks them up.
function changesByPrevious(
  changes: ReadonlyArray<DetectionFingerprintChange>,
): Map<string, DetectionFingerprintChange> {
  const byPrevious: Map<string, DetectionFingerprintChange> = new Map();

  for (const change of changes) {
    byPrevious.set(`${change.kind}\u0000${change.previous}`, change);
  }

  return byPrevious;
}

// A list of firing names with each that holds a previous fingerprint rewritten; null when none did.
function rewriteFiringKeys(
  value: unknown,
  changes: Map<string, DetectionFingerprintChange>,
): Array<unknown> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  let changed: boolean = false;
  const rewritten: Array<unknown> = value.map((key: unknown): unknown => {
    if (typeof key !== "string") {
      return key;
    }

    const next: string = rewriteWithChanges({
      text: key,
      placesOf: getFiringKeyPlaces,
      changes,
    }) as string;

    if (next !== key) {
      changed = true;
    }

    return next;
  });

  // A name kept under both fingerprints of one firing is the same name now: once.
  return changed
    ? rewritten.filter((key: unknown, index: number): boolean => {
        return typeof key !== "string" || rewritten.indexOf(key) === index;
      })
    : null;
}

// The previous fingerprints of the changes, each once.
function previousFingerprintsOf(
  changes: ReadonlyArray<DetectionFingerprintChange>,
): Array<string> {
  return Array.from(
    new Set<string>(
      changes.map((change: DetectionFingerprintChange): string => {
        return change.previous;
      }),
    ),
  );
}

/*
 * An entity's risk contributions with each firing its rule counted under a
 * previous fingerprint rewritten; null when none was.
 */
function rewriteContributionFiringKeys(
  value: unknown,
  changes: Map<string, DetectionFingerprintChange>,
): Array<unknown> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  let changed: boolean = false;
  const contributions: Array<unknown> = value.map(
    (contribution: unknown): unknown => {
      if (!contribution || typeof contribution !== "object") {
        return contribution;
      }

      const record: Record<string, unknown> = contribution as Record<
        string,
        unknown
      >;
      const firingKeys: Array<unknown> | null = rewriteFiringKeys(
        record["firingKeys"],
        changes,
      );

      if (!firingKeys) {
        return contribution;
      }

      changed = true;

      return { ...record, firingKeys };
    },
  );

  return changed ? contributions : null;
}

// A JSON column's value as Postgres is handed it back: its text, or null.
function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// A detection as its fingerprints' rewrite reads it.
interface DetectionFingerprintRow {
  _id: string;
  fingerprint: string | null;
  eventUid: string | null;
  recentFiringKeys: unknown;
}

// An entity's risk as the rewrite of the firings it counted reads it.
interface EntityRiskContributionsRow {
  _id: string;
  contributions: unknown;
}

// An alert or an incident as the cut of a feed's indicator reads it (#11230).
interface SeriesDescriptionRow {
  _id: string;
  description: string | null;
  seriesFingerprint: string | null;
}

// How an alert's description names a STIX indicator, as the read finds it.
const STIX_INDICATOR_STATED: string = `${THREAT_INTEL_STIX_INDICATOR_PREFIX}indicator--`;

// The most batches of rows one rewrite of the fingerprints goes through, so it always ends.
const MAX_FINGERPRINT_BATCHES: number = 20;

// The run statuses a proposal still waits in: nothing it would do has been done.
const WAITING_RUN_STATUSES: ReadonlyArray<SecurityPlaybookRunStatus> = [
  SecurityPlaybookRunStatus.WaitingForApproval,
  SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
];

// Why a run was cancelled, on its case's feed.
export const RUN_CANCELLED_FOR_ERASURE_MARKDOWN: string =
  "Cancelled: the person it would act on was erased from Security Events on request.";

interface IdRow {
  _id: string;
}

function namesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return names.map((name: ErasedName): string => {
    return name.named;
  });
}

// Each name as jsonb writes a string value: how it shows in a JSON column's text.
function jsonNamesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return names.map((name: ErasedName): string => {
    return JSON.stringify(name.named);
  });
}

/*
 * Each name as a JSON column's text holds it, and in lower case too: a
 * threat intel stamp on an event a detection kept holds the value it
 * matched lower-cased (#11230).
 */
function jsonSearchNamesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return Array.from(
    new Set<string>(
      names.flatMap((name: ErasedName): Array<string> => {
        return [
          JSON.stringify(name.named),
          JSON.stringify(name.named.trim().toLowerCase()),
        ];
      }),
    ),
  );
}

/*
 * The lines of a threat intel match's description that name the feed's
 * indicator (#11230), as the read finds them: a STIX indicator's id, and the
 * indicator's own name.
 */
const INDICATOR_DESCRIPTION_LINES: ReadonlyArray<string> = [
  `\n\n${THREAT_INTEL_STIX_INDICATOR_PREFIX}\`indicator--`,
  `\n\n${THREAT_INTEL_INDICATOR_NAME_PREFIX}`,
];

// What the rule left of each name, as a JSON column's text holds it.
function jsonHashedOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return Array.from(
    new Set<string>(
      names.map((name: ErasedName): string => {
        return JSON.stringify(name.hashed);
      }),
    ),
  );
}

/*
 * A STIX indicator's id as a kept event's stamp holds it in a JSON column's
 * text (#11230): the start of a string value.
 */
const KEPT_STIX_INDICATOR_TEXT: string = '"indicator--';

// What the rule left of each name, as a description writes it as inline code.
function hashedCodesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return Array.from(
    new Set<string>(
      names.map((name: ErasedName): string => {
        return FeedMarkdown.code(name.hashed).toString();
      }),
    ),
  );
}

/*
 * The part of a query that finds a description an earlier erasure un-named
 * while it still names the feed's indicator (#11230): one of its lines
 * ($lines), beside what the rule left of a name as inline code ($hashed).
 */
function indicatorLinesCondition(placeholders: {
  lines: string;
  hashed: string;
}): string {
  return `(EXISTS (SELECT 1 FROM unnest(${placeholders.lines}::text[]) AS line(text) WHERE strpos(COALESCE("description", ''), line.text) > 0) AND EXISTS (SELECT 1 FROM unnest(${placeholders.hashed}::text[]) AS hashed(code) WHERE strpos(COALESCE("description", ''), hashed.code) > 0))`;
}

/*
 * The part of a query that finds a description naming one of the names, as
 * unnameDescription changes it: a name as inline code ($codes), or as text in
 * a correlation's sentence ($texts, on a description that has one, $prefix).
 */
function descriptionNamesCondition(placeholders: {
  codes: string;
  texts: string;
  prefix: string;
}): string {
  return `EXISTS (SELECT 1 FROM unnest(${placeholders.codes}::text[]) AS erased(name) WHERE strpos(COALESCE("description", ''), erased.name) > 0) OR (strpos(COALESCE("description", ''), ${placeholders.prefix}) > 0 AND EXISTS (SELECT 1 FROM unnest(${placeholders.texts}::text[]) AS erased(name) WHERE strpos("description", erased.name) > 0))`;
}

function idsOf(rows: Array<IdRow>): Array<ObjectID> {
  return rows
    .map((row: IdRow): string => {
      return String(row._id || "");
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    })
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });
}

export default class SecurityUserErasureRecords {
  /*
   * What stands in place of a feed's indicator in the project once the
   * match it was about is out of the person's name (#11230): the keyed
   * fingerprint of the match's value, as the feed's alert carries it.
   */
  public static erasedIndicatorIdOf(
    projectId: ObjectID,
  ): (value: string) => string {
    return (value: string): string => {
      return DetectionFingerprint.erasedIndicatorIdOf({ projectId, value });
    };
  }

  private static async query(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<Array<IdRow>> {
    return (await PostgresAppInstance.getDataSource()!.query(
      sql,
      parameters,
    )) as Array<IdRow>;
  }

  // A write of its own, and how many rows it changed.
  private static async write(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<number> {
    const result: unknown = await PostgresAppInstance.getDataSource()!.query(
      sql,
      parameters,
    );

    // An UPDATE comes back as [the rows it returned, how many it changed].
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[1];
    }

    return Array.isArray(result) ? result.length : 0;
  }

  /*
   * Takes the person out of what Security Events wrote about them in a
   * project. See the file's comment.
   */
  public static async unnameRecords(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
    // The run's: the fingerprints' rewrite stops between batches when it passes.
    deadline?: JobDeadline | undefined;
  }): Promise<SecurityUserErasureRecordCounts> {
    const names: Array<ErasedName> = data.names.filter(
      (name: ErasedName): boolean => {
        return (
          Boolean(name.named) &&
          Boolean(name.hashed) &&
          name.named !== name.hashed
        );
      },
    );

    if (names.length === 0) {
      return { cases: 0, proposals: 0 };
    }

    const caseIds: Set<string> = new Set<string>();
    const detections: UnnamedDetections = await this.unnameDetections({
      projectId: data.projectId,
      names,
    });

    for (const caseId of detections.caseIds) {
      caseIds.add(caseId);
    }

    for (const caseId of await this.unnameCases({
      projectId: data.projectId,
      names,
    })) {
      caseIds.add(caseId);
    }

    await this.deleteEntityRisk({ projectId: data.projectId, names });

    const proposals: number =
      (await this.withdrawAiActions({ projectId: data.projectId, names })) +
      (await this.withdrawPlaybookRuns({ projectId: data.projectId, names }));

    // Every group value that named the person: each name, and each correlation's.
    await this.rewriteFingerprints({
      projectId: data.projectId,
      groupValues: [...names, ...detections.groupValues],
      deadline: data.deadline,
    });

    return { cases: caseIds.size, proposals };
  }

  /*
   * The group values of the project's correlations that hold one of the
   * names as one of their values ("alice@example.com / 203.0.113.7"), each
   * with what it is once the names are out (#11130). Read before anything
   * changes: once a detection is un-named, nothing says what its value was,
   * and the alerts, incidents and risk that carry its fingerprint are found
   * by it. The erasure keeps them with the names, encrypted, and wipes them
   * with them.
   */
  public static async findCorrelationValues(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<Array<ErasedName>> {
    const names: Array<ErasedName> = data.names.filter(
      (name: ErasedName): boolean => {
        return (
          Boolean(name.named) &&
          Boolean(name.hashed) &&
          name.named !== name.hashed
        );
      },
    );

    if (names.length === 0) {
      return [];
    }

    const rows: Array<{ groupValue: string | null }> = (await this.query(
      `SELECT DISTINCT "groupValue" FROM "SecurityDetection" WHERE "projectId" = $1 AND strpos(COALESCE("groupValue", ''), $3) > 0 AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos("groupValue", erased.name) > 0) LIMIT ${MAX_ROWS_PER_KIND}`,
      [data.projectId.toString(), namesOf(names), GROUP_VALUE_PART_SEPARATOR],
    )) as unknown as Array<{ groupValue: string | null }>;

    const values: Map<string, ErasedName> = new Map<string, ErasedName>();

    for (const row of rows) {
      const value: string = row.groupValue || "";
      const unnamed: string | undefined | null = unnameGroupValue(value, names);

      if (value && unnamed && unnamed !== value) {
        values.set(value, { named: value, hashed: unnamed });
      }
    }

    return Array.from(values.values());
  }

  /*
   * The project's detections that name the person: in their group value,
   * their title, their description, their entities or their kept events.
   * Returns the cases of the ones it changed, and the correlations' group
   * values it un-named - each as it was, with what it is now - whose
   * fingerprint other records carry (rewriteFingerprints).
   */
  public static async unnameDetections(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<UnnamedDetections> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityDetection" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("groupValue" = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos("title", erased.name) > 0) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("entities"::text, ''), erased.name) > 0 OR strpos(COALESCE("matchedEvents"::text, ''), erased.name) > 0) OR ${descriptionNamesCondition({ codes: "$4", texts: "$5", prefix: "$6" })} OR ${indicatorLinesCondition({ lines: "$7", hashed: "$8" })} OR (strpos(COALESCE("matchedEvents"::text, ''), $10) > 0 AND EXISTS (SELECT 1 FROM unnest($9::text[]) AS hashed(value) WHERE strpos("matchedEvents"::text, hashed.value) > 0))) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonSearchNamesOf(data.names),
          getDescriptionNameTexts(data.names).code,
          getDescriptionNameTexts(data.names).text,
          CORRELATION_SENTENCE_PREFIX,
          INDICATOR_DESCRIPTION_LINES,
          hashedCodesOf(data.names),
          jsonHashedOf(data.names),
          KEPT_STIX_INDICATOR_TEXT,
        ],
      ),
    );

    if (ids.length === 0) {
      return { caseIds: [], groupValues: [] };
    }

    const detections: Array<SecurityDetection> =
      await SecurityDetectionService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: {
          _id: true,
          securityCaseId: true,
          title: true,
          description: true,
          groupValue: true,
          entities: true,
          matchedEvents: true,
        },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    const caseIds: Array<string> = [];
    const groupValues: Map<string, ErasedName> = new Map<string, ErasedName>();
    const erasedIndicatorIdOf: (value: string) => string =
      this.erasedIndicatorIdOf(data.projectId);

    for (const detection of detections) {
      const changes: Record<string, unknown> = {};
      const title: string | undefined | null = unnameTitle(
        detection.title,
        data.names,
      );
      // The names, and a threat intel match's indicator with them (#11230).
      const description: string | undefined | null =
        unnameThreatIntelDescription(
          unnameDescription(detection.description, data.names),
          { names: data.names, erasedIndicatorIdOf },
        );
      // A correlation's values each, as its findings get them (#11130).
      const groupValue: string | undefined | null = unnameGroupValue(
        detection.groupValue,
        data.names,
      );

      if (
        detection.groupValue &&
        groupValue &&
        groupValue !== detection.groupValue &&
        detection.groupValue.includes(GROUP_VALUE_PART_SEPARATOR)
      ) {
        groupValues.set(`${detection.groupValue}\u0000${groupValue}`, {
          named: detection.groupValue,
          hashed: groupValue,
        });
      }
      const entities: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(detection.entities, data.names);
      const keptEvents: {
        value: JSONObject | undefined;
        changed: boolean;
      } = unnameJson(detection.matchedEvents, data.names);
      // And their threat intel stamps about the person (#11230).
      const keptStamps: {
        value: JSONObject | undefined;
        changed: boolean;
      } = unnameKeptEventStamps(keptEvents.value, {
        names: data.names,
        erasedIndicatorIdOf,
      });
      const matchedEvents: {
        value: JSONObject | undefined;
        changed: boolean;
      } = {
        value: keptStamps.value,
        changed: keptEvents.changed || keptStamps.changed,
      };

      if (title !== detection.title) {
        changes["title"] = title;
      }

      if (description !== detection.description) {
        changes["description"] = description;
      }

      if (groupValue !== detection.groupValue) {
        changes["groupValue"] = groupValue;
      }

      if (entities.changed) {
        changes["entities"] = entities.value;
      }

      if (matchedEvents.changed) {
        changes["matchedEvents"] = matchedEvents.value;
      }

      if (Object.keys(changes).length === 0 || !detection.id) {
        continue;
      }

      await SecurityDetectionService.updateOneById({
        id: detection.id,
        data: changes as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      if (detection.securityCaseId) {
        caseIds.push(detection.securityCaseId.toString());
      }
    }

    return { caseIds, groupValues: Array.from(groupValues.values()) };
  }

  /*
   * The project's cases that name the person: in their title, their
   * description, their entities or their grouping key. Returns the ones it
   * changed. Written
   * with SQL of its own, so the audit log never keeps the name the case
   * held (see the file's comment).
   */
  public static async unnameCases(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<Array<string>> {
    // The grouping keys a case about one of the names holds.
    const keysAboutNames: Array<string> = data.names.map(
      (name: ErasedName): string => {
        return getEntityCaseGroupingKey(name.named);
      },
    );

    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityCase" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("groupingKey" = ANY($4::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos("title", erased.name) > 0) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("entities"::text, ''), erased.name) > 0) OR ${descriptionNamesCondition({ codes: "$5", texts: "$6", prefix: "$7" })} OR ${indicatorLinesCondition({ lines: "$8", hashed: "$9" })}) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonNamesOf(data.names),
          keysAboutNames,
          getDescriptionNameTexts(data.names).code,
          getDescriptionNameTexts(data.names).text,
          CORRELATION_SENTENCE_PREFIX,
          INDICATOR_DESCRIPTION_LINES,
          hashedCodesOf(data.names),
        ],
      ),
    );

    if (ids.length === 0) {
      return [];
    }

    const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: { projectId: data.projectId, _id: new Includes(ids) },
      select: {
        _id: true,
        title: true,
        description: true,
        entities: true,
        groupingKey: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    const changedIds: Array<string> = [];
    const erasedIndicatorIdOf: (value: string) => string =
      this.erasedIndicatorIdOf(data.projectId);

    for (const securityCase of cases) {
      const title: string | undefined | null = unnameTitle(
        securityCase.title,
        data.names,
      );
      // The names, and the indicator of the threat intel match that opened it (#11230).
      const description: string | undefined | null =
        unnameThreatIntelDescription(
          unnameDescription(securityCase.description, data.names),
          { names: data.names, erasedIndicatorIdOf },
        );
      const entities: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(securityCase.entities, data.names);
      const groupingKey: string | undefined | null = unnameGroupingKey(
        securityCase.groupingKey,
        data.names,
      );

      if (
        !securityCase.id ||
        (title === securityCase.title &&
          description === securityCase.description &&
          !entities.changed &&
          groupingKey === securityCase.groupingKey)
      ) {
        continue;
      }

      await this.writeCase({
        projectId: data.projectId,
        caseId: securityCase.id,
        title: title ?? null,
        description: description ?? null,
        entities: entities.value ?? null,
        groupingKey: groupingKey ?? null,
      });

      changedIds.push(securityCase.id.toString());
    }

    return changedIds;
  }

  // A case's title, description, entities and grouping key, as the erasure leaves them.
  private static async writeCase(data: {
    projectId: ObjectID;
    caseId: ObjectID;
    title: string | null;
    description: string | null;
    entities: JSONArray | null;
    groupingKey: string | null;
  }): Promise<void> {
    await this.query(
      `UPDATE "SecurityCase" SET "title" = $3, "entities" = $4::jsonb, "groupingKey" = $5, "description" = $6, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2`,
      [
        data.caseId.toString(),
        data.projectId.toString(),
        data.title,
        data.entities === null ? null : JSON.stringify(data.entities),
        data.groupingKey,
        data.description,
      ],
    );
  }

  /*
   * The person's entity risk rows, deleted with SQL of their own: an
   * audited delete keeps the row, name and all, in the audit log.
   */
  public static async deleteEntityRisk(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<void> {
    const keys: Array<string> = getErasedRiskKeys(data.names);

    if (keys.length === 0) {
      return;
    }

    await this.query(
      `DELETE FROM "SecurityEntityRisk" WHERE "projectId" = $1 AND "entityKey" = ANY($2::text[])`,
      [data.projectId.toString(), keys],
    );
  }

  /*
   * OneUptime AI's actions that name the person: each one's target and
   * evidence get the token, and one waiting for a person's approval is
   * withdrawn - Left, because the person was erased - claimed from Asked,
   * so a person approving it at the same moment wins or loses cleanly.
   * Returns how many were withdrawn.
   */
  public static async withdrawAiActions(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<number> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityCaseAiAction" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("target" = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("evidence"::text, ''), erased.name) > 0)) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonNamesOf(data.names),
        ],
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    const actions: Array<SecurityCaseAiAction> =
      await SecurityCaseAiActionService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: { _id: true, status: true, target: true, evidence: true },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    let withdrawn: number = 0;

    for (const action of actions) {
      if (!action.id) {
        continue;
      }

      const target: string | undefined | null = unnameValue(
        action.target,
        data.names,
      );
      const evidence: { value: JSONObject | undefined; changed: boolean } =
        unnameJson(action.evidence, data.names);
      const changes: Record<string, unknown> = {};

      if (target !== action.target) {
        changes["target"] = target;
      }

      if (evidence.changed) {
        changes["evidence"] = evidence.value;
      }

      if (action.status === SecurityCaseAiActionStatus.Asked) {
        const isClaimed: boolean =
          await SecurityCaseAiActionService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: action.id,
              data: {
                ...changes,
                status: SecurityCaseAiActionStatus.Left,
                reason: SecurityCaseAiActionReason.PersonErased,
                decidedAt: OneUptimeDate.getCurrentDate(),
              } as unknown as PartialEntity<SecurityCaseAiAction>,
              expectedData: {
                status: SecurityCaseAiActionStatus.Asked,
              } as unknown as PartialEntity<SecurityCaseAiAction>,
            },
          );

        if (isClaimed) {
          withdrawn++;
          continue;
        }
      }

      if (Object.keys(changes).length === 0) {
        continue;
      }

      await SecurityCaseAiActionService.updateOneById({
        id: action.id,
        data: changes as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    return withdrawn;
  }

  /*
   * Playbook runs whose results name the person: their results get the
   * token, with SQL of their own (a run is audited), and a run still
   * waiting - for a person's approval, or for OneUptime AI - is cancelled,
   * and its case's feed says why. Returns how many were cancelled.
   */
  public static async withdrawPlaybookRuns(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<number> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityPlaybookRun" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos(COALESCE("stepResults"::text, ''), erased.name) > 0) LIMIT ${MAX_ROWS_PER_KIND}`,
        [data.projectId.toString(), jsonNamesOf(data.names)],
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    const runs: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: { _id: true, status: true, stepResults: true },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    let cancelled: number = 0;

    for (const run of runs) {
      if (!run.id) {
        continue;
      }

      const results: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(run.stepResults, data.names);

      if (!results.changed) {
        continue;
      }

      await this.query(
        `UPDATE "SecurityPlaybookRun" SET "stepResults" = $3::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2`,
        [
          run.id.toString(),
          data.projectId.toString(),
          JSON.stringify(results.value ?? []),
        ],
      );

      if (
        !run.status ||
        !WAITING_RUN_STATUSES.includes(run.status as SecurityPlaybookRunStatus)
      ) {
        continue;
      }

      const isClaimed: boolean =
        await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
          id: run.id,
          data: {
            status: SecurityPlaybookRunStatus.Cancelled,
          } as unknown as PartialEntity<SecurityPlaybookRun>,
          expectedData: {
            status: run.status,
          } as unknown as PartialEntity<SecurityPlaybookRun>,
        });

      if (!isClaimed) {
        continue;
      }

      cancelled++;

      try {
        await SecurityPlaybookRunService.recordCancellation({
          runId: run.id,
          reasonInMarkdown: RUN_CANCELLED_FOR_ERASURE_MARKDOWN,
        });
      } catch (error) {
        logger.error(
          `SecurityUserErasureRecords: could not record the cancellation of run ${run.id.toString()}; it is cancelled.`,
        );
        logger.error(error);
      }
    }

    return cancelled;
  }

  /*
   * Every fingerprint of a value that named the person, rewritten to the
   * one of the value once the names are out (#11130, see the file's
   * comment): in the project's detections (their fingerprint, the id of
   * the finding they point at, the firings they took), alerts, incidents,
   * and the firings its entities' risk counted. Each is found by the
   * fingerprint itself - written by a rule before the change or after, open
   * or closed, deleted or not - so running it again finds none. With SQL of
   * its own: an audited write would copy the old fingerprint into the audit
   * log.
   */
  public static async rewriteFingerprints(data: {
    projectId: ObjectID;
    // Each value that named the person, with what it is once the names are out.
    groupValues: ReadonlyArray<ErasedName>;
    deadline?: JobDeadline | undefined;
  }): Promise<RewrittenFingerprintCounts> {
    const changes: Array<DetectionFingerprintChange> = getFingerprintChanges({
      projectId: data.projectId,
      groupValues: data.groupValues,
    });
    const entityRiskChanges: Map<string, string> =
      getEntityRiskFingerprintChanges(data.groupValues);

    if (changes.length === 0 && entityRiskChanges.size === 0) {
      return { detections: 0, alerts: 0, incidents: 0, entityRisks: 0 };
    }

    const detections: number = await this.rewriteDetectionFingerprints({
      projectId: data.projectId,
      changes,
      entityRiskChanges,
      deadline: data.deadline,
    });

    const alerts: number = await this.rewriteSeriesFingerprints({
      projectId: data.projectId,
      table: "Alert",
      changes,
    });

    const incidents: number = await this.rewriteSeriesFingerprints({
      projectId: data.projectId,
      table: "Incident",
      changes,
    });

    // And the feed's indicator, out of what a threat intel match opened (#11230).
    for (const table of ["Alert", "Incident"] as const) {
      await this.cutIndicatorFromSeries({
        projectId: data.projectId,
        table,
        changes,
        deadline: data.deadline,
      });
    }

    const entityRisks: number = await this.rewriteEntityRiskFiringKeys({
      projectId: data.projectId,
      changes,
      deadline: data.deadline,
    });

    return { detections, alerts, incidents, entityRisks };
  }

  /*
   * The feed's indicator, out of the alerts or incidents a threat intel
   * match on the person opened (#11230): each is found by its fingerprint,
   * the person's or the token's (an alert keeps its title and description,
   * as an erasure leaves them, and its fingerprint is rewritten first), and
   * where its description says "STIX indicator: indicator--...", it says the
   * erased indicator id instead - the token in the fingerprint it now has,
   * the same as the finding's and the case detection's. So does every item
   * of its feed that copied the description (the one that announced it).
   * The feed items first: a run that stops in between still finds the id
   * in the description. With SQL of its own, as the fingerprints are, and
   * nothing else about the record changes. Returns how many records.
   */
  public static async cutIndicatorFromSeries(data: {
    projectId: ObjectID;
    table: "Alert" | "Incident";
    changes: ReadonlyArray<DetectionFingerprintChange>;
    deadline?: JobDeadline | undefined;
  }): Promise<number> {
    // The fingerprint each record of the match carries once rewritten, by any it may carry.
    const nextOf: Map<string, string> = new Map<string, string>();

    for (const change of data.changes) {
      if (change.kind === DetectionFingerprintKind.ThreatIntel) {
        nextOf.set(change.previous, change.next);
        nextOf.set(change.next, change.next);
      }
    }

    if (nextOf.size === 0) {
      return 0;
    }

    // Each table's statements in full, so the audit guard reads what they write.
    const read: string =
      data.table === "Alert"
        ? `SELECT "_id", "description", "seriesFingerprint" FROM "Alert" WHERE "projectId" = $1 AND split_part(COALESCE("seriesFingerprint", ''), ':', 1) = $2 AND split_part("seriesFingerprint", ':', 3) = ANY($3::text[]) AND split_part("seriesFingerprint", ':', 4) = '' AND strpos(COALESCE("description", ''), $4) > 0 LIMIT ${MAX_ROWS_PER_KIND}`
        : `SELECT "_id", "description", "seriesFingerprint" FROM "Incident" WHERE "projectId" = $1 AND split_part(COALESCE("seriesFingerprint", ''), ':', 1) = $2 AND split_part("seriesFingerprint", ':', 3) = ANY($3::text[]) AND split_part("seriesFingerprint", ':', 4) = '' AND strpos(COALESCE("description", ''), $4) > 0 LIMIT ${MAX_ROWS_PER_KIND}`;
    const feedWrite: string =
      data.table === "Alert"
        ? `UPDATE "AlertFeed" SET "feedInfoInMarkdown" = replace("feedInfoInMarkdown", $3, $4) WHERE "projectId" = $1 AND "alertId" = $2 AND strpos(COALESCE("feedInfoInMarkdown", ''), $3) > 0 RETURNING "_id"`
        : `UPDATE "IncidentFeed" SET "feedInfoInMarkdown" = replace("feedInfoInMarkdown", $3, $4) WHERE "projectId" = $1 AND "incidentId" = $2 AND strpos(COALESCE("feedInfoInMarkdown", ''), $3) > 0 RETURNING "_id"`;
    const descriptionWrite: string =
      data.table === "Alert"
        ? `UPDATE "Alert" SET "description" = $3 WHERE "_id" = $1 AND "projectId" = $2 AND "description" IS NOT DISTINCT FROM $4 RETURNING "_id"`
        : `UPDATE "Incident" SET "description" = $3 WHERE "_id" = $1 AND "projectId" = $2 AND "description" IS NOT DISTINCT FROM $4 RETURNING "_id"`;

    const seen: Set<string> = new Set<string>();
    let cut: number = 0;

    for (let batch: number = 0; batch < MAX_FINGERPRINT_BATCHES; batch++) {
      if (data.deadline?.hasPassed()) {
        break;
      }

      const rows: Array<SeriesDescriptionRow> = (await this.query(read, [
        data.projectId.toString(),
        DetectionFingerprintKind.ThreatIntel,
        Array.from(nextOf.keys()),
        STIX_INDICATOR_STATED,
      ])) as unknown as Array<SeriesDescriptionRow>;
      let fresh: number = 0;

      for (const row of rows) {
        const id: string = String(row._id);

        if (seen.has(id)) {
          continue;
        }

        seen.add(id);
        fresh++;

        const next: string | undefined = nextOf.get(
          String(row.seriesFingerprint || "").split(":")[2] || "",
        );
        const stixId: string | null = getStixIndicatorIdOf(row.description);

        if (!next || !stixId) {
          continue;
        }

        const erasedId: string = toErasedIndicatorId(next);
        const description: string | undefined | null = withErasedStixIndicator(
          row.description,
          { stixId, erasedId },
        );

        await this.write(feedWrite, [
          data.projectId.toString(),
          id,
          `${THREAT_INTEL_STIX_INDICATOR_PREFIX}${stixId}`,
          `${THREAT_INTEL_STIX_INDICATOR_PREFIX}${erasedId}`,
        ]);

        if (description === row.description) {
          continue;
        }

        cut +=
          (await this.write(descriptionWrite, [
            id,
            data.projectId.toString(),
            description ?? null,
            row.description,
          ])) > 0
            ? 1
            : 0;
      }

      if (rows.length < MAX_ROWS_PER_KIND || fresh === 0) {
        break;
      }
    }

    return cut;
  }

  /*
   * The project's detections that carry a previous fingerprint - as their
   * own, in the id of the finding they point at, in a firing they took - or
   * an entity's risk fingerprint of a name, with each rewritten. A row is
   * written only if it is still as it was read, so a repeat recorded in
   * between is never lost: a later run rewrites it. Returns how many.
   */
  public static async rewriteDetectionFingerprints(data: {
    projectId: ObjectID;
    changes: ReadonlyArray<DetectionFingerprintChange>;
    entityRiskChanges: Map<string, string>;
    deadline?: JobDeadline | undefined;
  }): Promise<number> {
    const byPrevious: Map<string, DetectionFingerprintChange> =
      changesByPrevious(data.changes);
    const previous: Array<string> = previousFingerprintsOf(data.changes);
    const entityRiskPrevious: Array<string> = Array.from(
      data.entityRiskChanges.keys(),
    );
    const seen: Set<string> = new Set<string>();
    let rewritten: number = 0;

    for (let batch: number = 0; batch < MAX_FINGERPRINT_BATCHES; batch++) {
      if (data.deadline?.hasPassed()) {
        break;
      }

      const rows: Array<DetectionFingerprintRow> = (await this.query(
        `SELECT "_id", "fingerprint", "eventUid", "recentFiringKeys" FROM "SecurityDetection" WHERE "projectId" = $1 AND NOT ("_id"::text = ANY($4::text[])) AND (split_part(COALESCE("fingerprint", ''), ':', 3) = ANY($2::text[]) OR split_part(COALESCE("eventUid", ''), ':', 5) = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS previous(fingerprint) WHERE strpos(COALESCE("recentFiringKeys"::text, ''), ':' || previous.fingerprint || '"') > 0) OR "fingerprint" = ANY($3::text[])) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          previous,
          entityRiskPrevious,
          Array.from(seen),
        ],
      )) as unknown as Array<DetectionFingerprintRow>;

      for (const row of rows) {
        seen.add(String(row._id));

        const fingerprint: string | undefined | null =
          (row.fingerprint && data.entityRiskChanges.get(row.fingerprint)) ||
          rewriteWithChanges({
            text: row.fingerprint,
            placesOf: getSourceFingerprintPlaces,
            changes: byPrevious,
          });
        const eventUid: string | undefined | null = rewriteWithChanges({
          text: row.eventUid,
          placesOf: getFindingUidPlaces,
          changes: byPrevious,
        });
        const firingKeys: Array<unknown> | null = rewriteFiringKeys(
          row.recentFiringKeys,
          byPrevious,
        );

        if (
          fingerprint === row.fingerprint &&
          eventUid === row.eventUid &&
          !firingKeys
        ) {
          continue;
        }

        const keptFiringKeys: string | null = jsonOrNull(row.recentFiringKeys);
        const written: number = await this.write(
          `UPDATE "SecurityDetection" SET "fingerprint" = $3, "eventUid" = $4, "recentFiringKeys" = $5::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2 AND "fingerprint" IS NOT DISTINCT FROM $6 AND "eventUid" IS NOT DISTINCT FROM $7 AND "recentFiringKeys" IS NOT DISTINCT FROM $8::jsonb RETURNING "_id"`,
          [
            String(row._id),
            data.projectId.toString(),
            fingerprint ?? null,
            eventUid ?? null,
            firingKeys ? JSON.stringify(firingKeys) : keptFiringKeys,
            row.fingerprint,
            row.eventUid,
            keptFiringKeys,
          ],
        );

        rewritten += written > 0 ? 1 : 0;
      }

      if (rows.length < MAX_ROWS_PER_KIND) {
        break;
      }
    }

    return rewritten;
  }

  /*
   * The project's alerts or incidents whose fingerprint - a rule's or a
   * feed's, open or resolved - is a previous one, with the next in its
   * place: an open one goes on taking its group's firings, which come about
   * the token. Nothing else about it changes, not even when it was last
   * updated. Returns how many.
   */
  public static async rewriteSeriesFingerprints(data: {
    projectId: ObjectID;
    table: "Alert" | "Incident";
    changes: ReadonlyArray<DetectionFingerprintChange>;
  }): Promise<number> {
    if (data.changes.length === 0) {
      return 0;
    }

    // Each table's statement in full, so the audit guard reads what it writes.
    const statement: string =
      data.table === "Alert"
        ? `UPDATE "Alert" AS record SET "seriesFingerprint" = split_part(record."seriesFingerprint", ':', 1) || ':' || split_part(record."seriesFingerprint", ':', 2) || ':' || change.next FROM unnest($2::text[], $3::text[], $4::text[]) AS change(kind, previous, next) WHERE record."projectId" = $1 AND split_part(record."seriesFingerprint", ':', 1) = change.kind AND split_part(record."seriesFingerprint", ':', 2) <> '' AND split_part(record."seriesFingerprint", ':', 3) = change.previous AND split_part(record."seriesFingerprint", ':', 4) = '' RETURNING record."_id"`
        : `UPDATE "Incident" AS record SET "seriesFingerprint" = split_part(record."seriesFingerprint", ':', 1) || ':' || split_part(record."seriesFingerprint", ':', 2) || ':' || change.next FROM unnest($2::text[], $3::text[], $4::text[]) AS change(kind, previous, next) WHERE record."projectId" = $1 AND split_part(record."seriesFingerprint", ':', 1) = change.kind AND split_part(record."seriesFingerprint", ':', 2) <> '' AND split_part(record."seriesFingerprint", ':', 3) = change.previous AND split_part(record."seriesFingerprint", ':', 4) = '' RETURNING record."_id"`;

    return await this.write(statement, [
      data.projectId.toString(),
      data.changes.map((change: DetectionFingerprintChange): string => {
        return change.kind;
      }),
      data.changes.map((change: DetectionFingerprintChange): string => {
        return change.previous;
      }),
      data.changes.map((change: DetectionFingerprintChange): string => {
        return change.next;
      }),
    ]);
  }

  /*
   * The firings the project's entities' risk counted under a previous
   * fingerprint - another entity of a correlation's group, such as the
   * address beside the person's name - with each rewritten. A row is
   * written only if it is still as it was read. Returns how many rows.
   */
  public static async rewriteEntityRiskFiringKeys(data: {
    projectId: ObjectID;
    changes: ReadonlyArray<DetectionFingerprintChange>;
    deadline?: JobDeadline | undefined;
  }): Promise<number> {
    const ruleChanges: Array<DetectionFingerprintChange> = data.changes.filter(
      (change: DetectionFingerprintChange): boolean => {
        return change.kind === DetectionFingerprintKind.DetectionRule;
      },
    );
    const byPrevious: Map<string, DetectionFingerprintChange> =
      changesByPrevious(ruleChanges);
    const previous: Array<string> = previousFingerprintsOf(ruleChanges);

    if (previous.length === 0) {
      return 0;
    }

    const seen: Set<string> = new Set<string>();
    let rewritten: number = 0;

    for (let batch: number = 0; batch < MAX_FINGERPRINT_BATCHES; batch++) {
      if (data.deadline?.hasPassed()) {
        break;
      }

      const rows: Array<EntityRiskContributionsRow> = (await this.query(
        `SELECT "_id", "contributions" FROM "SecurityEntityRisk" WHERE "projectId" = $1 AND NOT ("_id"::text = ANY($3::text[])) AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS previous(fingerprint) WHERE strpos(COALESCE("contributions"::text, ''), ':' || previous.fingerprint || '"') > 0) LIMIT ${MAX_ROWS_PER_KIND}`,
        [data.projectId.toString(), previous, Array.from(seen)],
      )) as unknown as Array<EntityRiskContributionsRow>;

      for (const row of rows) {
        seen.add(String(row._id));

        const contributions: Array<unknown> | null =
          rewriteContributionFiringKeys(row.contributions, byPrevious);

        if (!contributions) {
          continue;
        }

        const written: number = await this.write(
          `UPDATE "SecurityEntityRisk" SET "contributions" = $3::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2 AND "contributions" IS NOT DISTINCT FROM $4::jsonb RETURNING "_id"`,
          [
            String(row._id),
            data.projectId.toString(),
            JSON.stringify(contributions),
            jsonOrNull(row.contributions),
          ],
        );

        rewritten += written > 0 ? 1 : 0;
      }

      if (rows.length < MAX_ROWS_PER_KIND) {
        break;
      }
    }

    return rewritten;
  }
}
