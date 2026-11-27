import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { XcpNgVmPowerState } from "../../../Types/XcpNg/XcpNgTelemetry";
import XcpNgResourceService from "../../Services/XcpNgResourceService";
import logger from "../Logger";
import {
  XcpNgNormalizeResult,
  XcpNgVmStatusReading,
  normalizeXcpNgEnvelope,
  readXcpNgVmStatuses,
} from "./XcpNgSeriesNormalizer";

/*
 * What XcpNgSeriesNormalizer needs from outside a batch: which of the VMs a
 * block reports stopped ran within the last day, from the pool's inventory
 * (XcpNgResource.lastRunningAt, which the inventory flush keeps). Only the
 * stopped ones are looked up, in one indexed read per block that has any.
 *
 * Never in the way of a batch: if the read fails, the block is normalized as
 * if no VM ran recently (no "stopped after running" alert is raised for this
 * minute, which the next minute's batch puts right), and if normalizing
 * itself fails the block goes through as it came.
 */
export default class XcpNgSeriesIngest {
  public static async normalizeEnvelope(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    poolIdentifier: string;
    envelope: JSONObject;
  }): Promise<XcpNgNormalizeResult | null> {
    try {
      let ranRecently: Set<string> = new Set<string>();

      const stoppedVmUuids: Array<string> = readXcpNgVmStatuses(data.envelope)
        .filter((reading: XcpNgVmStatusReading) => {
          return reading.powerState !== XcpNgVmPowerState.Running;
        })
        .map((reading: XcpNgVmStatusReading) => {
          return reading.uuid;
        });

      if (stoppedVmUuids.length > 0) {
        try {
          ranRecently = await XcpNgResourceService.findVmsThatRanRecently({
            projectId: data.projectId,
            xcpNgPoolId: data.xcpNgPoolId,
            vmExternalIds: stoppedVmUuids,
            now: OneUptimeDate.getCurrentDate(),
          });
        } catch (err) {
          logger.warn(
            `Reading which VMs of XCP-ng pool ${data.xcpNgPoolId.toString()} ran recently failed; no VM counts as stopped after running this minute: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return normalizeXcpNgEnvelope({
        envelope: data.envelope,
        poolIdentifier: data.poolIdentifier,
        ranRecentlyVmUuids: ranRecently,
      });
    } catch (err) {
      logger.warn(
        `Normalizing the series of XCP-ng pool ${data.xcpNgPoolId.toString()} failed; the block goes through as it came: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
