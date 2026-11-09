import React, { FunctionComponent, ReactElement, useMemo, useState } from "react";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import OneUptimeDate from "Common/Types/Date";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { readProfileWidgetServiceId } from "Common/Utils/Dashboard/Components/DashboardProfileWidgetShared";
import {
  ProfiledEntity,
  fetchProfiledEntities,
} from "../../Profiles/ProfilesApi";
import useProfileRequest, {
  ProfileRequestState,
} from "../../Profiles/UseProfileRequest";
import {
  PROFILED_SERVICE_ALL_VALUE,
  PROFILED_SERVICE_LOOKBACK_DAYS,
  ProfiledServiceChoice,
  getProfiledServiceChoices,
} from "./ProfiledServiceChoices";

/*
 * WHOSE PROFILES A WIDGET READS.
 *
 * The services - and hosts, clusters, container hosts - that sent profiles
 * in the last 30 days, busiest first, as the Profiler's own service picker
 * lists what is profiled: a profile's owner is often not a Service (the
 * eBPF profiler's samples belong to the cluster or host they ran on), so a
 * list of Services alone would leave those out. "All services" comes
 * first and is the default. A service the widget is pinned to that sent
 * nothing lately stays listed, under its name, so the setting never reads
 * as empty while the widget still reads it.
 */

export interface ComponentProps {
  value?: string | undefined;
  onChange: (value: string) => void;
}

const ENTITY_TYPES: ReadonlyArray<string> = Object.values(ServiceType);

const ProfiledServiceDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [now] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  const entities: ProfileRequestState<Array<ProfiledEntity>> =
    useProfileRequest<Array<ProfiledEntity>>("profiled-services", () => {
      return fetchProfiledEntities({
        window: {
          startTime: new Date(
            now.getTime() - PROFILED_SERVICE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
          ),
          endTime: now,
        },
      });
    });

  const selectedId: string | null = readProfileWidgetServiceId(props.value);

  const ids: Array<string> = useMemo(() => {
    const list: Array<string> = (entities.data || []).map(
      (entity: ProfiledEntity): string => {
        return entity.id;
      },
    );

    if (selectedId && !list.includes(selectedId)) {
      list.push(selectedId);
    }

    return list;
  }, [entities.data, selectedId]);

  const typeHints: Record<string, ServiceType | undefined> = useMemo(() => {
    const hints: Record<string, ServiceType | undefined> = {};

    for (const entity of entities.data || []) {
      if (ENTITY_TYPES.includes(entity.entityType)) {
        hints[entity.id] = entity.entityType as ServiceType;
      }
    }

    return hints;
  }, [entities.data]);

  const names: TelemetryEntityNameMap = useTelemetryEntityNames(ids, {
    typeHints,
  });

  const choices: Array<ProfiledServiceChoice> = getProfiledServiceChoices({
    entities: entities.data || [],
    selectedId,
    getName: (id: string): string | undefined => {
      return names[id]?.name;
    },
    getTypeLabel: (id: string): string | undefined => {
      const resolved: ResolvedTelemetryEntity | undefined = names[id];

      return resolved && resolved.entityType !== ServiceType.OpenTelemetry
        ? resolved.typeLabel
        : undefined;
    },
  });

  const options: Array<DropdownOption> = [
    // English: the Dropdown looks it up.
    { value: PROFILED_SERVICE_ALL_VALUE, label: "All services" },
    ...choices.map((choice: ProfiledServiceChoice): DropdownOption => {
      return {
        value: choice.id,
        label: choice.typeLabel
          ? `${choice.name} · ${translator.translateText(choice.typeLabel) || choice.typeLabel}`
          : choice.name,
        isUserContent: true,
      };
    }),
  ];

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === (selectedId || PROFILED_SERVICE_ALL_VALUE);
    },
  );

  return (
    <div>
      <Dropdown
        options={options}
        value={selected}
        isLoading={entities.isLoading}
        ariaLabel={translator.translateText("Service")}
        dataTestId="profiled-service-dropdown"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          const next: string =
            value === null || Array.isArray(value) ? "" : value.toString();

          props.onChange(next === PROFILED_SERVICE_ALL_VALUE ? "" : next);
        }}
      />
      {entities.error ? (
        <p className="mt-1 text-xs text-red-600">
          {translator.translateText(
            "The services that send profiles could not be loaded.",
          )}{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={entities.reload}
          >
            {translator.translateText("Try again")}
          </button>
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProfiledServiceDropdown;
