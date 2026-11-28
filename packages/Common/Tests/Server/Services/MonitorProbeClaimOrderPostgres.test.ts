import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService, {
  ClaimedMonitorProbe,
} from "../../../Server/Services/MonitorProbeService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHICH OF A PROBE'S MONITORS DUE AT THE SAME MOMENT IT IS HANDED FIRST, ON
 * POSTGRES (OneUptime issue #11386).
 *
 * Every monitor a probe claims is stamped with its next whole minute
 * (MonitorProbeService.claimMonitorProbesForProbing), so all of a probe's
 * one-minute monitors are due at the same instant, and a busy probe works
 * through them in a round of several claims. The claim ordered them by when
 * they were due alone, which Postgres answers, among rows due at the same
 * instant, in the order its index holds them: where each row's last write
 * put it in the table, which moves as the claims rewrite the rows and vacuum
 * frees their room. So a busy probe checked a monitor anywhere in its round,
 * somewhere else each minute, and when it fell behind, which monitors
 * waited for its next round was chance.
 *
 * The claim now hands out the monitors due at the same moment by when each
 * was last handed out, oldest first - lastPingAt, which the claim itself
 * writes - from an index that holds them in that order. A round hands them
 * out as the round before did, so each monitor keeps its place in its
 * probe's round; and the ones a round reached after the minute, stamped two
 * minutes on, go first the next time, so when a probe falls behind the wait
 * goes round its monitors instead of falling on whichever the table put
 * last.
 *
 * Time here is simulated: every clock the claim reads (when it was made,
 * the next whole minute it stamps) is the test's (Date, faked alone), so a
 * probe's rounds over many minutes run in seconds, the same way every time.
 * A probe's workers run as FetchList runs them: at each minute's tick a
 * worker that is not still fetching waits for its moment of the minute, then
 * claims a batch at a time - the clock moving on between claims as its
 * checks free room - until a batch comes back short; a worker still
 * fetching at a tick skips it. Before each tick the table is vacuumed, as
 * autovacuum does a table every claim rewrites. Run against the claim before
 * this change, each order test fails.
 *
 * Opt in with RUN_POSTGRES_MONITOR_PROBE_CLAIM_ORDER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The MonitorProbe,
 * Monitor and Project tables' STRUCTURE (and MonitorProbe's fillfactor) is
 * cloned into a unique schema (search_path holds only that schema) that is
 * dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MONITOR_PROBE_CLAIM_ORDER_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from MONITOR_PROBE_CLAIM_ORDER_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_PROBE_CLAIM_ORDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["Project", "Monitor", "MonitorProbe"];

// A claim that waits instead of skipping fails within this, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

// A whole minute to start simulating from, well before the real clock.
const SIMULATION_START_MS: number = Date.UTC(2026, 10, 2, 9, 0, 0);

const DASHES: RegExp = /-/g;

// Every timer stays real, so the database driver's do: only Date is faked.
const REAL_TIMERS: Array<
  | "hrtime"
  | "nextTick"
  | "performance"
  | "queueMicrotask"
  | "setImmediate"
  | "clearImmediate"
  | "setInterval"
  | "clearInterval"
  | "setTimeout"
  | "clearTimeout"
> = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
];

// A worker of a probe, as FetchList runs it, on the simulated clock.
interface SimulatedWorker {
  probeId: ObjectID;
  // Its moment of the minute, in ms from the minute's start.
  momentMs: number;
  // How many monitors it asks for a claim: the room in its check slots.
  batch: number;
  // How far the clock moves between its claims: its checks freeing room.
  stepMs: number;
}

// One monitor probe handed out.
interface HandOut {
  monitorProbeId: string;
  probeId: string;
  atMs: number;
  // Its worker, its worker's round (from 0) and the claim of the round (from 0).
  worker: number;
  round: number;
  claim: number;
}

interface SimulatedRound {
  worker: number;
  round: number;
  // The tick it started at, and when its first and last claims were made.
  tickMs: number;
  firstClaimMs: number;
  lastClaimMs: number;
  // What each of its claims handed out, in the claim's own order.
  claims: Array<Array<string>>;
}

interface Simulation {
  handOuts: Array<HandOut>;
  rounds: Array<SimulatedRound>;
  // Ticks a worker still fetching skipped: its round ran past the minute.
  ticksSkipped: number;
}

interface WorkerState {
  kind: "tick" | "claim";
  nextAtMs: number;
  round: number;
  claim: number;
  current: SimulatedRound | null;
}

describePostgres(
  "which of a probe's monitors due at the same moment are handed out first (#11386), on Postgres",
  () => {
    const schema: string = `monitor_probe_claim_order_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;

    const PROJECT_ID: ObjectID = ObjectID.generate();

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_PROBE_CLAIM_ORDER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_PROBE_CLAIM_ORDER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_PROBE_CLAIM_ORDER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // Several connections, so claims made at once are made at once.
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
          max: 8,
          connectionTimeoutMillis: 20000,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A fixture names only what the statements touch.
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
             AND column_name NOT IN ('_id', 'isEnabled')`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }

      /*
       * The migrated table's storage parameters (its fillfactor), which LIKE
       * does not copy: where a claim's write puts a row's new version
       * depends on them. Autovacuum is left to the tests, which vacuum
       * before each tick, so a run is the same every time.
       */
      const options: Array<{ reloptions: Array<string> | null }> =
        await database.query(
          `SELECT c.reloptions FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'MonitorProbe'`,
        );

      for (const option of options[0]?.reloptions || []) {
        await database.query(
          `ALTER TABLE "${schema}"."MonitorProbe" SET (${option})`,
        );
      }

      await database.query(
        `ALTER TABLE "${schema}"."MonitorProbe" SET (autovacuum_enabled = false)`,
      );

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const table of [...TABLES].reverse()) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await database.query(`VACUUM "${schema}"."MonitorProbe"`);

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked") VALUES ($1, 'Claim order', false)`,
        [PROJECT_ID.toString()],
      );
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    function setClock(atMs: number): void {
      jest.setSystemTime(atMs);
    }

    function startClock(atMs: number): void {
      jest.useFakeTimers({ doNotFake: REAL_TIMERS, now: atMs });
    }

    /*
     * `count` one-minute monitors on a probe, each with its row for it, due
     * at `dueAt`. Each was last handed out at its own time before that, in
     * an order drawn from `random`, unlike the order the rows are written
     * in, as on a server that has run a while. Returns the rows' ids, the
     * longest ago handed out first.
     */
    async function insertMonitorProbes(data: {
      probeId: ObjectID;
      count: number;
      dueAt: Date;
      random: SeededRandom;
      // When the first was last handed out; each next a second later.
      lastHandedOutFrom?: Date | undefined;
      monitoringInterval?: string | undefined;
    }): Promise<Array<string>> {
      const ids: Array<string> = [];
      const lastFrom: number = (
        data.lastHandedOutFrom || new Date(data.dueAt.getTime() - MINUTE_MS)
      ).getTime();
      const order: Array<number> = shuffled(
        Array.from({ length: data.count }, (_value: unknown, index: number) => {
          return index;
        }),
        data.random,
      );

      for (let index: number = 0; index < data.count; index++) {
        const monitorId: ObjectID = ObjectID.generate();
        const id: ObjectID = ObjectID.generate();
        ids.push(id.toString());

        await database.query(
          `INSERT INTO "${schema}"."Monitor"
             ("_id", "projectId", "name", "monitorType", "monitoringInterval",
              "isArchived", "disableActiveMonitoring",
              "disableActiveMonitoringBecauseOfManualIncident",
              "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent")
           VALUES ($1, $2, $3, 'Website', $4, false, false, false, false)`,
          [
            monitorId.toString(),
            PROJECT_ID.toString(),
            `Monitor ${index + 1}`,
            data.monitoringInterval || "* * * * *",
          ],
        );

        await database.query(
          `INSERT INTO "${schema}"."MonitorProbe"
             ("_id", "projectId", "probeId", "monitorId", "isEnabled",
              "nextPingAt", "lastPingAt", "createdAt", "updatedAt", "version")
           VALUES ($1, $2, $3, $4, true, $5, $6, now(), now(), 1)`,
          [
            id.toString(),
            PROJECT_ID.toString(),
            data.probeId.toString(),
            monitorId.toString(),
            data.dueAt,
            new Date(lastFrom + order[index]! * SECOND_MS),
          ],
        );
      }

      // The longest ago handed out first.
      return ids
        .map((id: string, index: number): [string, number] => {
          return [id, order[index]!];
        })
        .sort((a: [string, number], b: [string, number]): number => {
          return a[1] - b[1];
        })
        .map((entry: [string, number]): string => {
          return entry[0];
        });
    }

    async function claim(
      probeId: ObjectID,
      limit: number,
    ): Promise<Array<string>> {
      const claimed: Array<ClaimedMonitorProbe> =
        await MonitorProbeService.claimMonitorProbesForProbing({
          probeId: probeId,
          limit: limit,
        });

      return claimed.map((row: ClaimedMonitorProbe): string => {
        return row.monitorProbeId.toString();
      });
    }

    async function vacuum(): Promise<void> {
      await database.query(`VACUUM "${schema}"."MonitorProbe"`);
    }

    /*
     * Runs the workers on the simulated clock from `startMs`, a whole
     * minute, starting no round at or after `minutes` on; a round started
     * before then runs to its short batch. Workers with something to do at
     * the same instant do it at once: their claims are made concurrently.
     */
    async function simulate(data: {
      workers: Array<SimulatedWorker>;
      startMs: number;
      minutes: number;
      beforeEachTick?: (() => Promise<void>) | undefined;
    }): Promise<Simulation> {
      const stopMs: number = data.startMs + data.minutes * MINUTE_MS;
      const states: Array<WorkerState> = data.workers.map((): WorkerState => {
        return {
          kind: "tick",
          nextAtMs: data.startMs,
          round: -1,
          claim: 0,
          current: null,
        };
      });
      const simulation: Simulation = {
        handOuts: [],
        rounds: [],
        ticksSkipped: 0,
      };

      for (;;) {
        const pending: Array<WorkerState> = states.filter(
          (state: WorkerState): boolean => {
            return state.kind === "claim" || state.nextAtMs < stopMs;
          },
        );

        if (pending.length === 0) {
          break;
        }

        const nowMs: number = Math.min(
          ...pending.map((state: WorkerState): number => {
            return state.nextAtMs;
          }),
        );
        setClock(nowMs);

        const ticking: Array<number> = states
          .map((state: WorkerState, index: number): number => {
            return state.kind === "tick" && state.nextAtMs === nowMs
              ? index
              : -1;
          })
          .filter((index: number): boolean => {
            return index >= 0;
          });

        if (ticking.length > 0 && data.beforeEachTick) {
          await data.beforeEachTick();
        }

        for (const index of ticking) {
          const state: WorkerState = states[index]!;
          state.kind = "claim";
          state.round++;
          state.claim = 0;
          state.nextAtMs = nowMs + data.workers[index]!.momentMs;
          state.current = {
            worker: index,
            round: state.round,
            tickMs: nowMs,
            firstClaimMs: state.nextAtMs,
            lastClaimMs: state.nextAtMs,
            claims: [],
          };
          simulation.rounds.push(state.current);
        }

        const claiming: Array<number> = states
          .map((state: WorkerState, index: number): number => {
            return state.kind === "claim" && state.nextAtMs === nowMs
              ? index
              : -1;
          })
          .filter((index: number): boolean => {
            return index >= 0;
          });

        const answers: Array<Array<string>> = await Promise.all(
          claiming.map((index: number): Promise<Array<string>> => {
            return claim(
              data.workers[index]!.probeId,
              data.workers[index]!.batch,
            );
          }),
        );

        claiming.forEach((index: number, answer: number): void => {
          const state: WorkerState = states[index]!;
          const worker: SimulatedWorker = data.workers[index]!;
          const ids: Array<string> = answers[answer]!;

          state.current!.claims.push(ids);
          state.current!.lastClaimMs = nowMs;

          for (const id of ids) {
            simulation.handOuts.push({
              monitorProbeId: id,
              probeId: worker.probeId.toString(),
              atMs: nowMs,
              worker: index,
              round: state.round,
              claim: state.claim,
            });
          }

          state.claim++;

          if (ids.length < worker.batch) {
            // Its next tick: the first after its round, the ones before skipped.
            const nextTickMs: number =
              (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;
            simulation.ticksSkipped +=
              (nextTickMs - state.current!.tickMs) / MINUTE_MS - 1;
            state.kind = "tick";
            state.nextAtMs = nextTickMs;
            state.current = null;
          } else {
            state.nextAtMs = nowMs + worker.stepMs;
          }
        });
      }

      return simulation;
    }

    function roundsOf(
      simulation: Simulation,
      worker: number,
    ): Array<SimulatedRound> {
      return simulation.rounds.filter((round: SimulatedRound): boolean => {
        return round.worker === worker;
      });
    }

    // What each claim of a round handed out, each claim's ids sorted.
    function claimsOf(round: SimulatedRound): Array<Array<string>> {
      return round.claims.map((ids: Array<string>): Array<string> => {
        return [...ids].sort();
      });
    }

    /*
     * The minutes of the simulation, from its first, that each monitor
     * probe was handed out in.
     */
    function minutesHandedOut(
      simulation: Simulation,
      startMs: number,
    ): Map<string, Set<number>> {
      const minutes: Map<string, Set<number>> = new Map();

      for (const handOut of simulation.handOuts) {
        const set: Set<number> =
          minutes.get(handOut.monitorProbeId) || new Set<number>();
        set.add(Math.floor((handOut.atMs - startMs) / MINUTE_MS));
        minutes.set(handOut.monitorProbeId, set);
      }

      return minutes;
    }

    test("among monitors due at the same moment, the one handed out longest ago is handed out first, and the claim answers in that order", async () => {
      const probeId: ObjectID = ObjectID.generate();
      const dueAt: Date = new Date(SIMULATION_START_MS);
      const oldestFirst: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 40,
        dueAt: dueAt,
        random: seededRandom(11386),
      });

      startClock(SIMULATION_START_MS + 5 * SECOND_MS);

      const handedOut: Array<string> = [];

      for (let batch: number = 0; batch < 6; batch++) {
        handedOut.push(...(await claim(probeId, 7)));
      }

      expect(handedOut).toEqual(oldestFirst);
    });

    test("when a monitor is due comes before when it was last handed out: an earlier due one first, however recently it was handed out", async () => {
      const probeId: ObjectID = ObjectID.generate();
      const random: SeededRandom = seededRandom(11387);
      const dueFirst: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 6,
        dueAt: new Date(SIMULATION_START_MS - MINUTE_MS),
        // Handed out after every monitor due later.
        lastHandedOutFrom: new Date(SIMULATION_START_MS - 30 * SECOND_MS),
        random: random,
      });
      const dueLater: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 6,
        dueAt: new Date(SIMULATION_START_MS),
        lastHandedOutFrom: new Date(SIMULATION_START_MS - 10 * MINUTE_MS),
        random: random,
      });

      startClock(SIMULATION_START_MS + SECOND_MS);

      expect(await claim(probeId, 20)).toEqual([...dueFirst, ...dueLater]);
    });

    test("a monitor never handed out, due with others, waits behind the ones handed out before, and is handed out in the same round", async () => {
      const probeId: ObjectID = ObjectID.generate();
      const handedOutBefore: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 5,
        dueAt: new Date(SIMULATION_START_MS),
        random: seededRandom(11388),
      });
      const neverHandedOut: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 3,
        dueAt: new Date(SIMULATION_START_MS),
        random: seededRandom(11389),
      });

      await database.query(
        `UPDATE "${schema}"."MonitorProbe" SET "lastPingAt" = NULL WHERE "_id" = ANY($1::uuid[])`,
        [neverHandedOut],
      );

      startClock(SIMULATION_START_MS + SECOND_MS);

      const first: Array<string> = await claim(probeId, 5);
      const second: Array<string> = await claim(probeId, 5);

      expect(first).toEqual(handedOutBefore);
      expect([...second].sort()).toEqual([...neverHandedOut].sort());
    });

    /*
     * A busy probe: 300 one-minute monitors, a worker of 10 checks at a
     * time, half a second for each batch's room, so its round takes 15 s,
     * at its moment of 5 s. Each round hands them out as the one before
     * did: every claim of a round hands out what the same claim of the
     * round before did. The table is vacuumed before each tick, which moves
     * where the claims' writes put the rows.
     */
    test("a busy probe hands its monitors out in the same order every minute, so each keeps its place in the round, also after vacuum frees room in the table", async () => {
      const probeId: ObjectID = ObjectID.generate();

      await insertMonitorProbes({
        probeId: probeId,
        count: 300,
        dueAt: new Date(SIMULATION_START_MS),
        random: seededRandom(11390),
      });

      startClock(SIMULATION_START_MS);

      const simulation: Simulation = await simulate({
        workers: [{ probeId, momentMs: 5 * SECOND_MS, batch: 10, stepMs: 500 }],
        startMs: SIMULATION_START_MS,
        minutes: 8,
        beforeEachTick: vacuum,
      });

      const rounds: Array<SimulatedRound> = roundsOf(simulation, 0);

      expect(rounds).toHaveLength(8);
      expect(simulation.ticksSkipped).toBe(0);

      for (const round of rounds) {
        // 30 full claims and a short one: all 300, once, in 15 s.
        expect(round.claims).toHaveLength(31);
        expect(new Set(round.claims.flat()).size).toBe(300);
        expect(round.lastClaimMs - round.firstClaimMs).toBe(15 * SECOND_MS);
      }

      // Every claim of every round hands out what that claim did the round before.
      for (let index: number = 1; index < rounds.length; index++) {
        expect(claimsOf(rounds[index]!)).toEqual(claimsOf(rounds[index - 1]!));
      }

      // So each monitor is handed out a minute after it last was, to the claim.
      const times: Map<string, Array<number>> = new Map();

      for (const handOut of simulation.handOuts) {
        times.set(handOut.monitorProbeId, [
          ...(times.get(handOut.monitorProbeId) || []),
          handOut.atMs,
        ]);
      }

      expect(times.size).toBe(300);

      for (const atMs of times.values()) {
        expect(atMs).toHaveLength(8);

        for (let index: number = 1; index < atMs.length; index++) {
          expect(atMs[index]! - atMs[index - 1]!).toBe(MINUTE_MS);
        }
      }
    });

    /*
     * Two probes of 150 monitors each, their workers at the same moment of
     * the minute, so every claim of one is made at once with a claim of the
     * other. Each probe's rows go to it alone, each round once, and each
     * probe keeps its own order.
     */
    test("two probes claiming at once each hand out only their own monitors, each once a round, and each keeps its order", async () => {
      const firstProbeId: ObjectID = ObjectID.generate();
      const secondProbeId: ObjectID = ObjectID.generate();
      const random: SeededRandom = seededRandom(11391);
      const firstIds: Array<string> = await insertMonitorProbes({
        probeId: firstProbeId,
        count: 150,
        dueAt: new Date(SIMULATION_START_MS),
        random: random,
      });
      const secondIds: Array<string> = await insertMonitorProbes({
        probeId: secondProbeId,
        count: 150,
        dueAt: new Date(SIMULATION_START_MS),
        random: random,
      });

      startClock(SIMULATION_START_MS);

      const simulation: Simulation = await simulate({
        workers: [
          {
            probeId: firstProbeId,
            momentMs: 10 * SECOND_MS,
            batch: 10,
            stepMs: 500,
          },
          {
            probeId: secondProbeId,
            momentMs: 10 * SECOND_MS,
            batch: 10,
            stepMs: 500,
          },
        ],
        startMs: SIMULATION_START_MS,
        minutes: 6,
        beforeEachTick: vacuum,
      });

      for (const [worker, ids] of [
        [0, firstIds],
        [1, secondIds],
      ] as Array<[number, Array<string>]>) {
        const rounds: Array<SimulatedRound> = roundsOf(simulation, worker);
        expect(rounds).toHaveLength(6);

        for (const round of rounds) {
          // Its own rows, all of them, each once.
          expect([...round.claims.flat()].sort()).toEqual([...ids].sort());
        }

        for (let index: number = 1; index < rounds.length; index++) {
          expect(claimsOf(rounds[index]!)).toEqual(
            claimsOf(rounds[index - 1]!),
          );
        }
      }
    });

    /*
     * Three workers of one probe at the same moment - a probe's replicas
     * asking at the same instant - so three claims for the same probe are
     * made at once each step. They skip each other's rows (SKIP LOCKED), so
     * which of the three hands out a row is chance, but the rows handed out
     * at the same instant are handed out at the same instant again.
     */
    test("a probe's workers claiming at once hand out each monitor once a round, and the monitors handed out together are handed out together again", async () => {
      const probeId: ObjectID = ObjectID.generate();

      await insertMonitorProbes({
        probeId: probeId,
        count: 240,
        dueAt: new Date(SIMULATION_START_MS),
        random: seededRandom(11392),
      });

      startClock(SIMULATION_START_MS);

      const workers: Array<SimulatedWorker> = [0, 1, 2].map(
        (): SimulatedWorker => {
          return { probeId, momentMs: 8 * SECOND_MS, batch: 10, stepMs: 500 };
        },
      );

      const simulation: Simulation = await simulate({
        workers: workers,
        startMs: SIMULATION_START_MS,
        minutes: 6,
        beforeEachTick: vacuum,
      });

      // What the three claims of each step handed out, together.
      const stepsOf: (round: number) => Array<Array<string>> = (
        round: number,
      ): Array<Array<string>> => {
        const steps: Map<number, Array<string>> = new Map();

        for (const handOut of simulation.handOuts) {
          if (handOut.round === round) {
            steps.set(handOut.claim, [
              ...(steps.get(handOut.claim) || []),
              handOut.monitorProbeId,
            ]);
          }
        }

        return Array.from(steps.keys())
          .sort((a: number, b: number): number => {
            return a - b;
          })
          .map((step: number): Array<string> => {
            return [...steps.get(step)!].sort();
          });
      };

      for (let round: number = 0; round < 6; round++) {
        const handedOut: Array<string> = stepsOf(round).flat();
        expect(handedOut).toHaveLength(240);
        expect(new Set(handedOut).size).toBe(240);
      }

      for (let round: number = 1; round < 6; round++) {
        expect(stepsOf(round)).toEqual(stepsOf(round - 1));
      }
    });

    /*
     * A probe whose round passes the next minute: 100 monitors, a claim of
     * 10 a second from its moment of 53 s, so 70 are handed out before the
     * minute and 30 after it. Those 30 are stamped with the minute after
     * that, so they miss a minute; the 70 are due again at the minute and
     * handed out again in the same round, after the 30. The cron's tick at
     * the minute the round ran past is skipped, so the probe asks every
     * other minute. Each time, the 30 it reaches after the minute miss one:
     * which 30 is the claim's order. The ones that missed it go first the
     * next time, so it goes round all 100: no monitor misses a second
     * minute before every one has missed one, and over ten rounds each
     * misses three.
     */
    test("a probe that falls behind: the monitors it reaches after the minute go first next time, so the minutes missed go round its monitors", async () => {
      const probeId: ObjectID = ObjectID.generate();

      const ids: Array<string> = await insertMonitorProbes({
        probeId: probeId,
        count: 100,
        dueAt: new Date(SIMULATION_START_MS),
        random: seededRandom(11393),
      });

      startClock(SIMULATION_START_MS);

      const simulation: Simulation = await simulate({
        workers: [
          { probeId, momentMs: 53 * SECOND_MS, batch: 10, stepMs: SECOND_MS },
        ],
        startMs: SIMULATION_START_MS,
        minutes: 21,
        beforeEachTick: vacuum,
      });

      const rounds: Array<SimulatedRound> = roundsOf(simulation, 0);

      // A round every other minute: the tick of the minute it ran past is skipped.
      expect(rounds).toHaveLength(11);
      expect(simulation.ticksSkipped).toBe(11);

      // Each round: the 30 reached after the minute, in its first pass.
      const lateOf: Array<Set<string>> = rounds.map(
        (round: SimulatedRound): Set<string> => {
          const minuteMs: number = round.tickMs + MINUTE_MS;
          const late: Set<string> = new Set();
          const seen: Set<string> = new Set();

          simulation.handOuts
            .filter((handOut: HandOut): boolean => {
              return handOut.round === round.round;
            })
            .forEach((handOut: HandOut): void => {
              if (!seen.has(handOut.monitorProbeId)) {
                seen.add(handOut.monitorProbeId);

                if (handOut.atMs >= minuteMs) {
                  late.add(handOut.monitorProbeId);
                }
              }
            });

          return late;
        },
      );

      for (const late of lateOf) {
        expect(late.size).toBe(30);
      }

      // The ones reached late one round are not the ones reached late the next.
      for (let index: number = 1; index < lateOf.length; index++) {
        const again: Array<string> = Array.from(lateOf[index]!).filter(
          (id: string): boolean => {
            return lateOf[index - 1]!.has(id);
          },
        );
        expect(again).toEqual([]);
      }

      /*
       * No monitor late a second time before every one has been late once,
       * after the first round, whose order is the one the table started in.
       */
      const lateCount: Map<string, number> = new Map();

      for (let index: number = 1; index < lateOf.length; index++) {
        const lateBefore: Set<string> = new Set(lateCount.keys());

        for (const id of lateOf[index]!) {
          if (lateBefore.has(id)) {
            const notYet: number = ids.filter((other: string): boolean => {
              return !lateCount.has(other) && !lateOf[index]!.has(other);
            }).length;
            expect({ id, notYet }).toEqual({ id, notYet: 0 });
          }
        }

        for (const id of lateOf[index]!) {
          lateCount.set(id, (lateCount.get(id) || 0) + 1);
        }
      }

      // Ten rounds of 30 over 100 monitors: three each.
      const counts: Array<number> = ids.map((id: string): number => {
        return lateCount.get(id) || 0;
      });
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

      // And each late monitor misses exactly the minute it was due in.
      const minutes: Map<string, Set<number>> = minutesHandedOut(
        simulation,
        SIMULATION_START_MS,
      );
      const missed: Map<string, number> = new Map();

      for (const id of ids) {
        for (let minute: number = 1; minute < 21; minute++) {
          if (!minutes.get(id)?.has(minute)) {
            missed.set(id, (missed.get(id) || 0) + 1);
          }
        }
      }

      const missedCounts: Array<number> = ids.map((id: string): number => {
        return missed.get(id) || 0;
      });
      expect(
        Math.max(...missedCounts) - Math.min(...missedCounts),
      ).toBeLessThanOrEqual(1);
    });
  },
);
