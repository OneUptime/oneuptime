import {
  HostCollectorOsType,
  getHostCollectorOsType,
  isHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorConfigCandidate,
  HostCollectorConfigChoice,
  HostCollectorConfigChoiceReason,
  chooseHostCollectorConfig,
} from "Common/Utils/HostCollector/HostCollectorConfigResolution";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { HostCollectorTranslatableText } from "./HostCollectorStatus";

/*
 * Which config a managed host runs, as its Collector page says it and lets
 * people change it: automatically (the first Collector Config in the list
 * that applies to the host - the rule the server follows,
 * HostCollectorConfigResolution), or one config picked for this host.
 *
 * React-free: App tests read it.
 */

// The choice that follows the list instead of naming a config.
export const AUTOMATIC_HOST_COLLECTOR_CONFIG: string = "automatic";

// A project's Collector Config, as the choice reads it.
export interface HostCollectorConfigChoiceOption {
  id: string;
  name: string;
  osType: string | null | undefined;
  labelIds: Array<string>;
  order: number;
}

// The host, as the choice reads it.
export interface HostCollectorConfigChoiceHost {
  osType: string | null | undefined;
  labelIds: Array<string>;
  collectorConfigId: string | null | undefined;
  isCollectorConfigPinned: boolean | null | undefined;
}

function toCandidate(
  option: HostCollectorConfigChoiceOption,
): HostCollectorConfigCandidate {
  return {
    id: option.id,
    osType: isHostCollectorOsType(option.osType)
      ? option.osType
      : HostCollectorOsType.Linux,
    labelIds: option.labelIds,
    order: option.order,
  };
}

/*
 * The config the host would run automatically: the first in the list that
 * applies to it, or null for OneUptime's default.
 */
export function getAutomaticHostCollectorConfigId(data: {
  configs: Array<HostCollectorConfigChoiceOption>;
  host: HostCollectorConfigChoiceHost;
}): string | null {
  const choice: HostCollectorConfigChoice = chooseHostCollectorConfig(
    data.configs.map(toCandidate),
    {
      osType: getHostCollectorOsType(data.host.osType),
      labelIds: data.host.labelIds,
      pinnedConfigId: null,
    },
  );

  return choice.reason === HostCollectorConfigChoiceReason.Default
    ? null
    : choice.configId;
}

/*
 * The configs that can be picked for this host: those for its system and
 * those for any system. A config for another system would only fail there.
 */
export function getPickableHostCollectorConfigs(data: {
  configs: Array<HostCollectorConfigChoiceOption>;
  host: HostCollectorConfigChoiceHost;
}): Array<HostCollectorConfigChoiceOption> {
  const osType: HostCollectorOsType | null = getHostCollectorOsType(
    data.host.osType,
  );

  return data.configs.filter(
    (config: HostCollectorConfigChoiceOption): boolean => {
      return (
        config.osType === HostCollectorOsType.Any ||
        (osType !== null && config.osType === osType)
      );
    },
  );
}

// What the picker starts on: the picked config, or automatic.
export function getCurrentHostCollectorConfigChoice(
  host: HostCollectorConfigChoiceHost,
): string {
  if (host.isCollectorConfigPinned && host.collectorConfigId) {
    return host.collectorConfigId;
  }

  return AUTOMATIC_HOST_COLLECTOR_CONFIG;
}

/*
 * What saving a choice writes to the host. Automatic writes the config the
 * list gives it now, so the page is right at once; the server keeps it right
 * from then on, as configs and labels change.
 */
export function getHostCollectorConfigChoiceUpdate(data: {
  choice: string;
  configs: Array<HostCollectorConfigChoiceOption>;
  host: HostCollectorConfigChoiceHost;
}): { collectorConfigId: string | null; isCollectorConfigPinned: boolean } {
  const picked: HostCollectorConfigChoiceOption | undefined =
    data.choice === AUTOMATIC_HOST_COLLECTOR_CONFIG
      ? undefined
      : getPickableHostCollectorConfigs({
          configs: data.configs,
          host: data.host,
        }).find((config: HostCollectorConfigChoiceOption): boolean => {
          return config.id === data.choice;
        });

  if (picked) {
    return { collectorConfigId: picked.id, isCollectorConfigPinned: true };
  }

  return {
    collectorConfigId: getAutomaticHostCollectorConfigId({
      configs: data.configs,
      host: data.host,
    }),
    isCollectorConfigPinned: false,
  };
}

// How the host came to run its config, in a few words.
export function describeHostCollectorConfigChoice(
  host: Pick<
    HostCollectorConfigChoiceHost,
    "collectorConfigId" | "isCollectorConfigPinned"
  >,
): HostCollectorTranslatableText {
  if (host.isCollectorConfigPinned && host.collectorConfigId) {
    return { template: translationKey("Picked for this host"), values: {} };
  }

  if (host.collectorConfigId) {
    return {
      template: translationKey("The first Collector Config that applies"),
      values: {},
    };
  }

  return {
    template: translationKey("No Collector Config applies to this host"),
    values: {},
  };
}
