import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { HostCollectorOsType } from "Common/Types/HostCollector/HostCollector";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  describeHostCollectorConfigTarget,
  getHostCollectorConfigFormFields,
} from "../../Components/HostCollector/HostCollectorConfigForm";
import HostCollectorConfigOrder from "../../Components/HostCollector/HostCollectorConfigOrder";
import HostCollectorDefaultsCard from "../../Components/HostCollector/HostCollectorDefaultsCard";
import HostCollectorHostCount from "../../Components/HostCollector/HostCollectorHostCount";
import {
  HostCollectorConfigHostCounts,
  useHostCollectorConfigHostCounts,
} from "../../Components/HostCollector/UseHostCollectorHostCounts";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Hosts > Configuration > Collector Configs: the config.yaml OneUptime sends
 * to the hosts whose collector it manages.
 *
 *   - The top of the list says how a host gets its config, in three steps:
 *     a config picked for the host, else the first config of this list that
 *     applies to it, else OneUptime's default for its system.
 *   - Each row says who the config is for and how many hosts run it, with
 *     the ones it did not start on in red. Drag the rows to change the order.
 *   - The card under the list is OneUptime's defaults: what each system's
 *     hosts run when no config applies, and how many do. A default is where
 *     a config starts: "Create a config from it" opens Create on its system.
 *
 * Creating one asks only for a name, a system and labels; its YAML starts as
 * that system's default, and the config's own page edits it.
 */

// The dialog's title says "How Collector Configs work": the text starts below it.
const documentationMarkdown: string = `
Every host you add with the one-command install runs a config that OneUptime sends it. A host gets its config in this order:

1. **Picked for the host**: a config someone picked on the host's **Collector** page.
2. **The first config that applies**: checked from the top of this list.
3. **OneUptime's default** for the host's system, when no config applies.

A config applies to a host by:

- **System**: a config is for Linux, Windows or macOS hosts, or for hosts on any system.
- **Host labels**: a config with labels is only for hosts with at least one of them. Label hosts when you install them (\`--label env=production\`), on the Hosts page, or with label rules.

Drag the rows to change the order.

### Changing a config

Every saved change is checked and becomes a new version, and the hosts it applies to get it within about a minute. Each host shows the version it runs. A config that does not start on a host is rolled back there to the last one that worked, and the host shows why.

### What a config may do

A config OneUptime sends may read the host and the services on it and send that to this OneUptime, with the key each host was installed with. It may not send data anywhere else, read files or secrets through \`\${file:...}\` or similar, or run programs.
`;

const CollectorConfigs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  // How many hosts run each config of the page, and on how many it failed.
  const hostCounts: HostCollectorConfigHostCounts =
    useHostCollectorConfigHostCounts();

  // Every load of the list: the defaults card counts its hosts again with it.
  const [listLoads, setListLoads] = useState<number>(0);

  /*
   * The system of the default a Create was asked from ("Create a config
   * from it"): the form opens on it. Back to null once the form closes, so
   * the card's own Create starts empty, and the next one opens again.
   */
  const [createFromOsType, setCreateFromOsType] =
    useState<HostCollectorOsType | null>(null);

  const createGate: PermissionGateResult = PermissionGate.check(
    new HostCollectorConfig(),
    ModelAction.Create,
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
            "The config OneUptime sends to the hosts it manages. Each host runs the first config that applies to it, from the top: drag the rows to change the order.",
        }}
        helpContent={{
          title: "How Collector Configs work",
          description:
            "Which hosts get which config, how changes reach them, and what a config may do.",
          markdown: documentationMarkdown,
        }}
        /*
         * How a host gets its config, over the rows it explains. An empty
         * list leaves it out: its empty state says what every host runs.
         */
        topContent={<HostCollectorConfigOrder />}
        emptyState={{ hideTopContentWhileEmpty: true }}
        noItemsMessage="No Collector Configs yet. Every host runs OneUptime's default for its system, shown below."
        formFields={getHostCollectorConfigFormFields()}
        showCreateForm={createFromOsType !== null}
        createInitialValues={
          createFromOsType ? { osType: createFromOsType } : undefined
        }
        onCreateEditModalClose={() => {
          setCreateFromOsType(null);
        }}
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
        onFetchSuccess={(data: Array<HostCollectorConfig>) => {
          hostCounts.load(
            data.map((item: HostCollectorConfig): string => {
              return item._id?.toString() || "";
            }),
          );
          setListLoads((count: number): number => {
            return count + 1;
          });
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
            /*
             * "Linux hosts with env:production": which hosts the config is
             * for. Hosts, beside it, is how many run it now.
             */
            field: { osType: true },
            title: "Applies to",
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
            /*
             * Counted by the server for each config, so it cannot be sorted
             * or filtered on: keyed on the id the count is read by.
             */
            field: { _id: true },
            id: "hosts",
            title: "Hosts",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: HostCollectorConfig): ReactElement => {
              const configId: string = item._id?.toString() || "";
              return (
                <HostCollectorHostCount
                  count={hostCounts.counts[configId]}
                  dataTestId={`host-collector-config-hosts-${configId}`}
                />
              );
            },
          },
        ]}
      />

      <HostCollectorDefaultsCard
        onCreateFromDefault={
          createGate.isAllowed
            ? (osType: HostCollectorOsType) => {
                setCreateFromOsType(osType);
              }
            : undefined
        }
        refreshToken={listLoads}
      />
    </Fragment>
  );
};

export default CollectorConfigs;
