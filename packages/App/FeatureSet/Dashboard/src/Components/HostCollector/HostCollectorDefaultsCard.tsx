import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CodeType from "Common/Types/Code/CodeType";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import {
  HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { DEFAULT_CONFIG_NAMES } from "./HostCollectorStatus";
import {
  HOST_COLLECTOR_DEFAULTS_DESCRIPTION,
  HOST_COLLECTOR_DEFAULT_SUMMARIES,
} from "./HostCollectorConfigFleet";
import HostCollectorHostCount from "./HostCollectorHostCount";
import { useHostCollectorDefaultHostCounts } from "./UseHostCollectorHostCounts";

/*
 * OneUptime's defaults, under the Collector Configs list: what a host runs
 * when no config of the list applies to it - the last of the three steps
 * the list's top names. One row per system: what its default collects, how
 * many hosts run it now, and its config.yaml.
 *
 * A default cannot be edited: it follows OneUptime's releases. Changing
 * what those hosts collect is a Collector Config of their system, which
 * starts as the default - so the config's dialog offers to create one,
 * for whoever may.
 */

export interface ComponentProps {
  /*
   * Opens the list's Create form on this system. Left out for a reader who
   * may not create a config: the dialog then only shows the default.
   */
  onCreateFromDefault?: ((osType: HostCollectorOsType) => void) | undefined;
  // Count the hosts again (the list was refreshed).
  refreshToken?: string | number | undefined;
}

const YAML_VIEW_MAX_HEIGHT: string = "min(70vh, 36rem)";

const HostCollectorDefaultsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [shown, setShown] = useState<HostCollectorOsType | null>(null);

  const counts: Dictionary<number> = useHostCollectorDefaultHostCounts({
    osTypes: HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
    refreshToken: props.refreshToken,
  });

  return (
    <Card
      title="OneUptime defaults"
      description={HOST_COLLECTOR_DEFAULTS_DESCRIPTION}
    >
      <ul
        className="divide-y divide-gray-100"
        data-testid="host-collector-defaults"
      >
        {HOST_COLLECTOR_INSTALLABLE_OS_TYPES.map(
          (osType: HostCollectorOsType): ReactElement => {
            const count: number | undefined = counts[osType];

            return (
              <li
                key={osType}
                /*
                 * On a phone the count and the button go under the name (a
                 * Button is as wide as its row there), instead of squeezing
                 * the name into a column a word wide.
                 */
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
                data-testid={`host-collector-default-row-${osType}`}
              >
                <div className="min-w-0 sm:flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {translator.translateText(DEFAULT_CONFIG_NAMES[osType])}
                  </p>
                  <p
                    className="mt-0.5 text-sm text-gray-500"
                    data-testid={`host-collector-default-summary-${osType}`}
                  >
                    {translator.translateText(
                      HOST_COLLECTOR_DEFAULT_SUMMARIES[osType],
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:flex-none">
                  <span className="min-w-[5rem]">
                    <HostCollectorHostCount
                      count={
                        count === undefined
                          ? undefined
                          : { hosts: count, failed: 0 }
                      }
                      dataTestId={`host-collector-default-hosts-${osType}`}
                    />
                  </span>
                  <div className="[&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
                    <Button
                      title="View config"
                      icon={IconProp.Code}
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      dataTestId={`host-collector-default-${osType}`}
                      onClick={() => {
                        setShown(osType);
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          },
        )}
      </ul>

      {shown ? (
        <Modal
          title={DEFAULT_CONFIG_NAMES[shown]}
          description="To change what these hosts collect, create a Collector Config: it starts as this config. The default itself follows OneUptime's releases."
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShown(null);
          }}
          closeButtonText="Close"
          // Where a change to what these hosts collect starts.
          submitButtonText={
            props.onCreateFromDefault ? "Create a config from it" : undefined
          }
          onSubmit={
            props.onCreateFromDefault
              ? () => {
                  const osType: HostCollectorOsType = shown;
                  setShown(null);
                  props.onCreateFromDefault?.(osType);
                }
              : undefined
          }
        >
          <CodeEditor
            type={CodeType.YAML}
            value={getHostCollectorDefaultConfig(shown)}
            readOnly={true}
            dataTestId="host-collector-default-yaml"
            maxHeight={YAML_VIEW_MAX_HEIGHT}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default HostCollectorDefaultsCard;
