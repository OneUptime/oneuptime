import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import { MonitorAttachedProbes } from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import { OverviewSection } from "../../../Utils/OverviewSection";

/*
 * Shapes shared by the monitor overview's hooks and cards. Types only: no
 * React, routing or API imports, so the pure helpers and the tests can use
 * them freely.
 */

export interface MonitorOverviewProbeData {
  // The merged MonitorProbe rows: newest light fields over the last full read.
  rows: Array<MonitorProbe>;
  // What the Summary card's probe picker needs.
  attached: MonitorAttachedProbes;
  // When lastMonitoringLog was last read in full; null before the first read.
  fullLoadedAt: Date | null;
}

export interface MonitorOpenWorkRow {
  // Unique across both kinds, for React keys.
  key: string;
  kind: "Incident" | "Alert";
  id: string;
  title: string;
  // Incident declaredAt (or createdAt), alert createdAt.
  startedAt?: Date | undefined;
  severityName?: string | undefined;
  severityColor?: string | undefined;
  stateName?: string | undefined;
}

export interface MonitorOpenWorkSide {
  // The total unresolved count, not just the rows fetched.
  count: number;
  // The newest few, newest first.
  rows: Array<MonitorOpenWorkRow>;
}

export interface MonitorOpenWork {
  incidents: OverviewSection<MonitorOpenWorkSide>;
  alerts: OverviewSection<MonitorOpenWorkSide>;
}
