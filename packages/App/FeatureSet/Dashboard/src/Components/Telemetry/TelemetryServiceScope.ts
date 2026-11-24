import Service from "Common/Models/DatabaseModels/Service";
import Select from "Common/Types/BaseDatabase/Select";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import {
  HeldValueOptions,
  toHeldValueOption,
} from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import ProjectUtil from "Common/UI/Utils/Project";
import RecordsById from "Common/UI/Utils/RecordsById";
import TelemetryEntityNameResolver, {
  ResolvedTelemetryEntity,
  TELEMETRY_ENTITY_RESOLUTION_ORDER,
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { UNKNOWN_SERVICE_NAME } from "Common/UI/Utils/TelemetryService";
import { useEffect, useState } from "react";

/*
 * THE SERVICES A TELEMETRY PAGE IS SCOPED TO, NAMED BY THEIR IDS (#10764).
 *
 * The Metrics and Traces Insights tabs read the project's first 10,000
 * services by name to offer them in their scope picker and to name the ones
 * a scope holds. A service past them could not be found or picked, and one
 * a link or a saved view scoped the page to was named only through a
 * second lookup.
 *
 * The picker searches the server now (TelemetryServiceScopePicker), and
 * what a scope holds is read here by its ids before the picker is drawn:
 *
 *   - a service, by its id: its name, and whether it is archived (an
 *     archived service keeps collecting telemetry, so it stays in scope,
 *     marked);
 *   - the project's own id, which stands for the telemetry that named no
 *     service: "Unknown Service", in the reader's words (TelemetryService);
 *   - any other telemetry entity the Viewer handed over - a RUM
 *     application, a host - by the table it is in
 *     (TelemetryEntityNameResolver), as the scope always named one;
 *   - an id no record answers to any more: "No longer available", to keep
 *     or take out. The page still narrows by it, as the scope was saved.
 */

/*
 * What a held service is read with: its name, its colour (the dot its chip
 * draws, as a picked one's does) and whether it is archived.
 */
export const TELEMETRY_SCOPE_SERVICE_SELECT: Select<Service> = {
  _id: true,
  name: true,
  serviceColor: true,
  isArchived: true,
};

// The column a service's colour is in.
export const SERVICE_COLOR_FIELD: string = "serviceColor";

/*
 * The tables an id that is no service can be in: every telemetry entity's
 * but the Service table, already read.
 */
export const TELEMETRY_SCOPE_OTHER_ENTITY_TYPES: Array<ServiceType> =
  TELEMETRY_ENTITY_RESOLUTION_ORDER.filter((type: ServiceType): boolean => {
    return type !== ServiceType.OpenTelemetry;
  });

/*
 * The scope that stands for the telemetry that named no service: the
 * project's id, worded in the reader's language wherever it is drawn.
 */
export const getUnknownServiceScopeOption: (
  projectId: string,
) => DropdownOption = (projectId: string): DropdownOption => {
  return {
    value: projectId.trim().toLowerCase(),
    label: UNKNOWN_SERVICE_NAME,
    isUserContent: false,
  };
};

// A held id no record answers to any more.
const getNotFoundOption: (id: string) => DropdownOption = (
  id: string,
): DropdownOption => {
  return {
    value: id,
    label: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
    isUserContent: false,
    isNotFound: true,
  };
};

/*
 * Each held id, named: by its lower-cased id. Every id asked for is
 * answered, by a name or as not found.
 */
export const readTelemetryScopeHeldOptions: (data: {
  ids: Array<string>;
  projectId: string;
}) => Promise<Map<string, DropdownOption>> = async (data: {
  ids: Array<string>;
  projectId: string;
}): Promise<Map<string, DropdownOption>> => {
  const named: Map<string, DropdownOption> = new Map();
  const projectId: string = data.projectId.trim().toLowerCase();
  const toRead: Array<string> = [];

  for (const raw of data.ids) {
    const id: string = raw ? raw.toString().trim().toLowerCase() : "";

    if (!id || named.has(id) || toRead.includes(id)) {
      continue;
    }

    if (projectId && id === projectId) {
      named.set(id, getUnknownServiceScopeOption(id));
      continue;
    }

    toRead.push(id);
  }

  const services: Array<Service> = await RecordsById.read<Service>({
    modelType: Service,
    ids: toRead,
    select: TELEMETRY_SCOPE_SERVICE_SELECT,
  });

  for (const service of services) {
    const option: DropdownOption | null = toHeldValueOption(
      service,
      SERVICE_COLOR_FIELD,
    );

    if (option) {
      named.set(String(option.value), option);
    }
  }

  // Not a service: another entity the scope was handed, by its own table.
  const others: Array<string> = RecordsById.getValuesToRead({
    ids: toRead,
  }).filter((id: string): boolean => {
    return !named.has(id);
  });

  if (others.length > 0 && projectId) {
    const entities: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: others,
        projectId: projectId,
        entityTypes: TELEMETRY_SCOPE_OTHER_ENTITY_TYPES,
      });

    for (const id of others) {
      const entity: ResolvedTelemetryEntity | undefined = entities[id];

      if (entity) {
        // What its owner named it, drawn as written.
        named.set(id, { value: id, label: entity.name, isUserContent: true });
      }
    }
  }

  // Asked for by its id, and not there: deleted since, or never an id.
  for (const id of toRead) {
    if (!named.has(id)) {
      named.set(id, getNotFoundOption(id));
    }
  }

  return named;
};

/*
 * What a scope holds, named before its picker is drawn (the page draws a
 * placeholder until then), the way HeldValueOptions names what a form
 * holds: read by its ids once, and a pick named by the search that offered
 * it (remember), never read again.
 */
export const useTelemetryScopeHeldOptions: (
  ids: Array<string>,
) => HeldValueOptions = (ids: Array<string>): HeldValueOptions => {
  const [options, setOptions] = useState<Map<string, DropdownOption> | null>(
    null,
  );
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  const idsKey: string = ids
    .map((id: string): string => {
      return id.trim().toLowerCase();
    })
    .join("|");

  useEffect(() => {
    let isCurrent: boolean = true;
    const toRead: Array<string> = ids.filter((id: string): boolean => {
      return !options?.has(id.trim().toLowerCase());
    });

    if (toRead.length === 0) {
      if (!options) {
        setOptions(new Map());
      }

      return;
    }

    // What the read names joins what is known, a pick named meanwhile kept.
    const keep: (named: Map<string, DropdownOption>) => void = (
      named: Map<string, DropdownOption>,
    ): void => {
      if (!isCurrent) {
        return;
      }

      setOptions(
        (
          current: Map<string, DropdownOption> | null,
        ): Map<string, DropdownOption> => {
          const next: Map<string, DropdownOption> = new Map(current || []);

          for (const [id, option] of named) {
            if (!next.has(id)) {
              next.set(id, option);
            }
          }

          return next;
        },
      );
    };

    readTelemetryScopeHeldOptions({ ids: toRead, projectId: projectId })
      .then(keep)
      .catch((): void => {
        /*
         * Naming them is the picker's to do then: it reads a held service
         * by its id itself, and its search must not fail with this read.
         */
        keep(new Map());
      });

    return () => {
      isCurrent = false;
    };
  }, [idsKey, projectId]);

  return {
    options: options,
    remember: (picked: Array<DropdownOption>): void => {
      setOptions(
        (
          current: Map<string, DropdownOption> | null,
        ): Map<string, DropdownOption> => {
          const next: Map<string, DropdownOption> = new Map(current || []);

          for (const option of picked) {
            const id: string = String(option.value).toLowerCase();

            if (!next.has(id)) {
              next.set(id, { ...option, value: id });
            }
          }

          return next;
        },
      );
    },
  };
};
