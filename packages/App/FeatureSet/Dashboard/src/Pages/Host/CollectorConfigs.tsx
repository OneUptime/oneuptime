import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Card from "Common/UI/Components/Card/Card";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import CodeType from "Common/Types/Code/CodeType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import {
  describeHostCollectorConfigTarget,
  getHostCollectorConfigFormFields,
} from "../../Components/HostCollector/HostCollectorConfigForm";
import { DEFAULT_CONFIG_NAMES } from "../../Components/HostCollector/HostCollectorStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Hosts > Collector Configs: the config.yaml OneUptime sends to the hosts
 * whose collector it manages. A host runs the first config of this list
 * that is for its system and, when the config names labels, for a host with
 * one of them - drag the rows to change the order. A host no config applies
 * to runs OneUptime's default for its system, which the card under the list
 * shows.
 *
 * Creating one asks only for a name, a system and labels; its YAML starts as
 * that system's default, and the config's own page edits it.
 */

const documentationMarkdown: string = `
### How Collector Configs work

Every host you add with the one-command install runs a config that OneUptime sends it: the first config in this list that applies to it.

- **System**: a config is for Linux, Windows or macOS hosts, or for hosts on any system.
- **Host labels**: a config with labels is only for hosts with at least one of them. Label hosts when you install them (\`--label env=production\`), on the Hosts page, or with label rules.
- **Order**: a host runs the first config that applies to it. Drag the rows to change the order.

A host no config applies to runs **OneUptime's default** for its system. You can also pick a config for one host on its **Collector** page.

### Changing a config

Every saved change is checked and becomes a new version, and the hosts it applies to get it within about a minute. Each host shows the version it runs. A config that does not start on a host is rolled back there to the last one that worked, and the host shows why.

### What a config may do

A config OneUptime sends may read the host and the services on it and send that to this OneUptime, with the key each host was installed with. It may not send data anywhere else, read files or secrets through \`\${file:...}\` or similar, or run programs.
`;

const CollectorConfigs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [defaultShown, setDefaultShown] = useState<HostCollectorOsType | null>(
    null,
  );

  return (
    <Fragment>
      <ModelTable<HostCollectorConfig>
        modelType={HostCollectorConfig}
        id="host-collector-configs-table"
        name="Hosts > Collector Configs"
        userPreferencesKey="host-collector-configs-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createVerb="Create"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        viewPageRoute={Navigation.getCurrentRoute()}
        cardProps={{
          title: "Collector Configs",
          description:
            "The config OneUptime sends to the hosts it manages. A host runs the first one that applies to it; drag to change the order.",
        }}
        helpContent={{
          title: "How Collector Configs work",
          description:
            "Which hosts get which config, how changes reach them, and what a config may do.",
          markdown: documentationMarkdown,
        }}
        noItemsMessage="No Collector Configs yet. Every host runs OneUptime's default for its system."
        formFields={getHostCollectorConfigFormFields()}
        onCreateSuccess={(
          item: HostCollectorConfig,
        ): Promise<HostCollectorConfig> => {
          // A new config starts as the default: its page is where it is edited.
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_COLLECTOR_CONFIG_VIEW] as Route,
              { modelId: new ObjectID(item._id as string) },
            ),
          );
          return Promise.resolve(item);
        }}
        selectMoreFields={{
          osType: true,
          labels: {
            name: true,
            color: true,
          },
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { osType: true },
            title: "Hosts",
            type: FieldType.Element,
            getElement: (item: HostCollectorConfig): ReactElement => {
              const target: { template: string; labels: string } =
                describeHostCollectorConfigTarget({
                  osType: item.osType,
                  labelNames: (item.labels || []).map(
                    (label: Label): string => {
                      return label.name || "";
                    },
                  ),
                });
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateTemplate(target.template, {
                    labels: target.labels,
                  })}
                </span>
              );
            },
          },
          {
            field: { currentVersionNumber: true },
            title: "Version",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: HostCollectorConfig): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateTemplate("Version {{number}}", {
                    number: String(item.currentVersionNumber || 1),
                  })}
                </span>
              );
            },
          },
        ]}
      />

      <Card
        title="OneUptime defaults"
        description="What a host runs when no config here applies to it. On Linux it reads the journal and systemd units where the host has them."
      >
        <ul
          className="divide-y divide-gray-100"
          data-testid="host-collector-defaults"
        >
          {HOST_COLLECTOR_INSTALLABLE_OS_TYPES.map(
            (osType: HostCollectorOsType): ReactElement => {
              return (
                <li
                  key={osType}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="text-sm text-gray-900">
                    {translator.translateText(DEFAULT_CONFIG_NAMES[osType])}
                  </span>
                  <Button
                    title="View config"
                    icon={IconProp.Code}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    dataTestId={`host-collector-default-${osType}`}
                    onClick={() => {
                      setDefaultShown(osType);
                    }}
                  />
                </li>
              );
            },
          )}
        </ul>
      </Card>

      {defaultShown && (
        <Modal
          title={DEFAULT_CONFIG_NAMES[defaultShown]}
          description="To change what some or all of these hosts collect, create a Collector Config: it starts as this config. The default itself follows OneUptime's releases."
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setDefaultShown(null);
          }}
          closeButtonText="Close"
        >
          <CodeEditor
            type={CodeType.YAML}
            value={getHostCollectorDefaultConfig(defaultShown)}
            readOnly={true}
            dataTestId="host-collector-default-yaml"
            maxHeight="min(70vh, 36rem)"
          />
        </Modal>
      )}
    </Fragment>
  );
};

export default CollectorConfigs;
