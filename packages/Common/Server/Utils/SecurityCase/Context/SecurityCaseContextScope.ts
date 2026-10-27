import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityConnectionWindow,
  getCaseConnectionWindow,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import { isRefusedRead } from "../../SecurityEvent/Connections/SecurityConnectedRecords";
import logger from "../../Logger";

/*
 * What a case's Story and Impact are read around: the case itself, as the
 * reader may read it, its entities, and its window - the one Connected
 * Signals reads (getCaseConnectionWindow): half an hour either side of its
 * detections, at most a day.
 */
export interface SecurityCaseContextScope {
  securityCase: SecurityCase;
  entities: Array<SecurityEntity>;
  window: SecurityConnectionWindow;
  firstDetectedAt: Date | null;
}

export async function readSecurityCaseContextScope(data: {
  projectId: ObjectID;
  securityCaseId: ObjectID;
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
}): Promise<SecurityCaseContextScope | null> {
  const securityCase: SecurityCase | null = await SecurityCaseService.findOneBy(
    {
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: {
        _id: true,
        projectId: true,
        entities: true,
        createdAt: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        acknowledgedAt: true,
        containedAt: true,
        closedAt: true,
        incidentId: true,
      },
      props: data.props,
    },
  );

  if (!securityCase) {
    return null;
  }

  const firstDetectedAt: Date | null = securityCase.firstDetectedAt
    ? new Date(securityCase.firstDetectedAt)
    : null;

  return {
    securityCase,
    entities: readSecurityEntities(securityCase.entities),
    window: getCaseConnectionWindow({
      firstDetectedAt: securityCase.firstDetectedAt,
      lastDetectedAt: securityCase.lastDetectedAt,
      createdAt: securityCase.createdAt,
      now: data.now || OneUptimeDate.getCurrentDate(),
    }),
    firstDetectedAt:
      firstDetectedAt && !Number.isNaN(firstDetectedAt.getTime())
        ? firstDetectedAt
        : null,
  };
}

/*
 * Keeps what became of each of a Story's or an Impact's sources: read,
 * refused (the reader's role cannot read it - said, never shown as empty),
 * failed (said too), or cut at its bound.
 */
export class SecurityCaseSourceTracker<Source extends string> {
  private readonly unreadable: Set<Source> = new Set();
  private readonly failed: Set<Source> = new Set();
  private readonly truncated: Set<Source> = new Set();

  public constructor(private readonly label: string) {}

  /*
   * The answer of `read`, or null when it was refused or failed - which is
   * then remembered against `source`. Never throws.
   */
  public async read<T>(source: Source, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (isRefusedRead(error)) {
        this.unreadable.add(source);
      } else {
        this.failed.add(source);
        logger.error(
          `${this.label}: the ${source} could not be read: ${error}`,
        );
      }

      return null;
    }
  }

  // Rows read one past their bound: the bound's worth, the cut remembered.
  public bound<T>(source: Source, rows: Array<T>, max: number): Array<T> {
    if (rows.length > max) {
      this.truncated.add(source);
      return rows.slice(0, max);
    }

    return rows;
  }

  public markUnreadable(source: Source): void {
    this.unreadable.add(source);
  }

  public markFailed(source: Source): void {
    this.failed.add(source);
  }

  public markTruncated(source: Source): void {
    this.truncated.add(source);
  }

  public isUnreadable(source: Source): boolean {
    return this.unreadable.has(source);
  }

  public getUnreadable(): Array<Source> {
    return Array.from(this.unreadable).sort();
  }

  public getFailed(): Array<Source> {
    return Array.from(this.failed)
      .filter((source: Source): boolean => {
        return !this.unreadable.has(source);
      })
      .sort();
  }

  public getTruncated(): Array<Source> {
    return Array.from(this.truncated).sort();
  }
}
