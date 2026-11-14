import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
  MonitorProbesOfResult,
} from "../../../Server/Utils/Monitor/MonitorProbeLastResults";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { jest } from "@jest/globals";

/*
 * A monitor's MonitorProbe rows in memory, behind MonitorProbeLastResults:
 * what its one statement does to them (store the reporting probe's result
 * as its last for its step, merged into the column; read the monitor's
 * probes, with the step judged from those agreement reads), for unit tests
 * that run monitorResource without Postgres.
 *
 * The statement itself runs against Postgres in
 * MonitorProbeLastResultsPostgres.test.ts; this answers as it does.
 *
 * A test file mocks the module (jest.mock of
 * Server/Utils/Monitor/MonitorProbeLastResults, with storeResultAndReadProbes
 * and readProbes as jest.fn()) and calls install() in beforeEach.
 */

export interface StoredProbeResult {
  // The MonitorProbe row the result was stored under.
  rowId: string;
  probeId: string;
  stepId: string;
  // The result as monitorResource handed it to the statement.
  result: ProbeMonitorResponse;
  // The row's whole column after the write.
  lastMonitoringLog: MonitorStepProbeResponse;
}

export default class MonitorProbeRowsInMemory {
  public rows: Array<MonitorProbe> = [];

  // Every result stored, in order.
  public stored: Array<StoredProbeResult> = [];

  // Thrown by the next store, when set: a lock timeout, say.
  public storeError: unknown = null;

  /*
   * Called with each result before it is stored, as the statement binds it:
   * may throw what Postgres would (a jsonb value it refuses).
   */
  public beforeStore: ((result: JSONObject) => void) | null = null;

  /*
   * Answers MonitorProbeLastResults' calls from these rows: through the
   * module's mocks when the test file mocks it, or through spies when it
   * does not (jest.spyOn hands back a method that is a mock already).
   */
  public install(): void {
    jest
      .spyOn(MonitorProbeLastResults, "storeResultAndReadProbes")
      .mockImplementation(((input: {
        monitorId: ObjectID;
        reportingProbeId: ObjectID;
        reportedStepId: string;
        judgedStepId: string | undefined;
        result: JSONObject | undefined;
      }): Promise<MonitorProbesOfResult> => {
        return this.storeResultAndReadProbes(input);
      }) as never);

    jest
      .spyOn(MonitorProbeLastResults, "readProbes")
      .mockImplementation(((input: {
        monitorId: ObjectID;
        judgedStepId: string;
      }): Promise<Array<MonitorProbeOfResult>> => {
        return Promise.resolve(
          this.read({
            reportingProbeId: undefined,
            reportedStepId: input.judgedStepId,
            judgedStepId: input.judgedStepId,
          }),
        );
      }) as never);
  }

  public set(rows: Array<MonitorProbe>): void {
    this.rows = rows;
  }

  public async storeResultAndReadProbes(input: {
    reportingProbeId: ObjectID;
    reportedStepId: string;
    judgedStepId: string | undefined;
    result: JSONObject | undefined;
  }): Promise<MonitorProbesOfResult> {
    if (input.result !== undefined && this.storeError) {
      const error: unknown = this.storeError;
      this.storeError = null;
      throw error;
    }

    if (input.result !== undefined && this.beforeStore) {
      this.beforeStore(input.result);
    }

    // Read as the rows stood before the write, as the statement's CTE does.
    const probes: Array<MonitorProbeOfResult> = this.read(input);

    let isResultStored: boolean = false;

    if (input.result !== undefined) {
      const row: MonitorProbe | undefined = this.findRow(
        input.reportingProbeId,
      );

      if (row) {
        // As handed to the statement; it is read back as JSON (read below).
        const result: ProbeMonitorResponse =
          input.result as unknown as ProbeMonitorResponse;

        row.lastMonitoringLog = {
          ...(row.lastMonitoringLog || {}),
          [input.reportedStepId]: result,
        };

        this.stored.push({
          rowId: row.id!.toString(),
          probeId: row.probeId!.toString(),
          stepId: input.reportedStepId,
          result: result,
          lastMonitoringLog: row.lastMonitoringLog,
        });

        isResultStored = true;
      }
    }

    return { probes, isResultStored };
  }

  private findRow(probeId: ObjectID): MonitorProbe | undefined {
    return this.rows.find((row: MonitorProbe) => {
      return (
        row.probeId?.toString().toLowerCase() ===
        probeId.toString().toLowerCase()
      );
    });
  }

  private read(input: {
    reportingProbeId: ObjectID | undefined;
    reportedStepId: string;
    judgedStepId: string | undefined;
  }): Array<MonitorProbeOfResult> {
    return this.rows.map((row: MonitorProbe): MonitorProbeOfResult => {
      const isReporting: boolean = Boolean(
        input.reportingProbeId &&
          row.probeId?.toString().toLowerCase() ===
            input.reportingProbeId.toString().toLowerCase(),
      );

      const isRead: boolean = Boolean(
        input.judgedStepId &&
          ((!isReporting &&
            row.isEnabled === true &&
            row.probe?.connectionStatus === ProbeConnectionStatus.Connected) ||
            (isReporting && input.judgedStepId !== input.reportedStepId)),
      );

      const resultForJudgedStep: ProbeMonitorResponse | undefined = isRead
        ? (row.lastMonitoringLog || {})[input.judgedStepId!]
        : undefined;

      return {
        monitorProbeId: row.id || ObjectID.generate(),
        probeId: row.probeId!,
        isEnabled: row.isEnabled === true,
        probeName: row.probe?.name || undefined,
        probeConnectionStatus: row.probe?.connectionStatus || undefined,
        resultForJudgedStep: resultForJudgedStep
          ? (JSON.parse(
              JSON.stringify(resultForJudgedStep),
            ) as ProbeMonitorResponse)
          : undefined,
      };
    });
  }
}
