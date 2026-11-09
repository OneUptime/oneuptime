/*
 * The choices of a profile widget's Service setting, React-free so App's
 * tests pin them: what sent profiles lately, busiest first and then by
 * name, each named as the Profiler names it - and the service the widget
 * is pinned to, kept listed when it sent nothing lately, so the setting
 * never reads as empty while the widget still reads that service.
 */

// The value of "All services": no service pinned.
export const PROFILED_SERVICE_ALL_VALUE: string = "__all__";

/*
 * How far back the picker looks for what is profiled: as far as the
 * Profiler looks for "any profile at all" (its first steps), past the 15
 * days profiles are kept unless a project keeps them longer.
 */
export const PROFILED_SERVICE_LOOKBACK_DAYS: number = 30;

export interface ProfiledServiceSource {
  id: string;
  sampleCount: number;
}

export interface ProfiledServiceChoice {
  id: string;
  // As written: the service's (or host's, cluster's) own name.
  name: string;
  // In English, for a resource that is no service ("Host").
  typeLabel?: string | undefined;
  sampleCount: number;
}

export function getProfiledServiceChoices(data: {
  entities: ReadonlyArray<ProfiledServiceSource>;
  selectedId: string | null;
  getName: (id: string) => string | undefined;
  getTypeLabel: (id: string) => string | undefined;
}): Array<ProfiledServiceChoice> {
  const byId: Map<string, ProfiledServiceChoice> = new Map();

  for (const entity of data.entities) {
    const id: string = (entity.id || "").trim();

    if (!id) {
      continue;
    }

    const existing: ProfiledServiceChoice | undefined = byId.get(id);
    const sampleCount: number = Number(entity.sampleCount) || 0;

    if (existing) {
      existing.sampleCount += sampleCount;
      continue;
    }

    byId.set(id, {
      id,
      name: data.getName(id) || id,
      typeLabel: data.getTypeLabel(id),
      sampleCount,
    });
  }

  if (data.selectedId && !byId.has(data.selectedId)) {
    byId.set(data.selectedId, {
      id: data.selectedId,
      name: data.getName(data.selectedId) || data.selectedId,
      typeLabel: data.getTypeLabel(data.selectedId),
      sampleCount: 0,
    });
  }

  return Array.from(byId.values()).sort(
    (a: ProfiledServiceChoice, b: ProfiledServiceChoice): number => {
      return b.sampleCount - a.sampleCount || a.name.localeCompare(b.name);
    },
  );
}
