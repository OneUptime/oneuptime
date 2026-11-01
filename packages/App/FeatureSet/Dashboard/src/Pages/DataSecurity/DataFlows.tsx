import PageComponentProps from "../PageComponentProps";
import { SensitivityPill } from "../../Components/DataSecurity/DataSecurityPills";
import FlowChain, {
  FLOW_KINDS,
  FLOW_KIND_AI_PROVIDER,
  FLOW_KIND_COPY,
  FLOW_KIND_EXTERNAL_HOST,
  FLOW_KIND_USES,
  rankFlowsByRisk,
} from "../../Components/DataSecurity/FlowChain";
import {
  DataTypeNamer,
  IssueDataTypeChips,
  readDataTypeIds,
  useDataTypeNamer,
} from "../../Components/DataSecurity/IssueDataTypes";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Orange500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Column from "Common/UI/Components/ModelTable/Column";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHERE DOES SENSITIVE DATA GO?
 *
 * Every flow OneUptime worked out from traces and scans: services sending
 * data to AI providers and to hosts outside your systems, stores holding
 * copies of other stores, and the services that read and write each store.
 * At the top, the riskiest chains - store, service, destination - drawn as
 * boxes; under them one list per kind of flow, with the columns that kind
 * is read by. A kind with no flows is left out.
 */

// The chains the top card draws.
const RISKIEST_CHAIN_COUNT: number = 5;

// The flows read to find the riskiest chains, the most recently seen first.
const FLOWS_READ_FOR_CHAINS: number = 500;

const CONFIRMED: string = translationKey("Confirmed");
const PATH_ONLY: string = translationKey("Path only");
const CONFIRMED_TOOLTIP: string = translationKey(
  "A scan found the data at the destination, not only the path to it.",
);
const CALLS: PluralTemplate = {
  one: "{{count}} call",
  other: "{{count}} calls",
};
const OVERLAP: string = translationKey("{{percent}}% of values");

interface FlowKindCopy {
  title: string;
  description: string;
}

const FLOW_KIND_COPY_TEXT: Record<string, FlowKindCopy> = {
  [FLOW_KIND_AI_PROVIDER]: {
    title: translationKey("Sent to AI Providers"),
    description: translationKey(
      "Services whose prompts can carry this data to an AI provider. Confirmed when a scan found it in their AI conversations.",
    ),
  },
  [FLOW_KIND_EXTERNAL_HOST]: {
    title: translationKey("Sent to External Hosts"),
    description: translationKey(
      "Services calling hosts outside your systems, seen in their traces.",
    ),
  },
  [FLOW_KIND_COPY]: {
    title: translationKey("Copies Between Stores"),
    description: translationKey(
      "Stores holding copies of another store's values, found from fingerprints of what the scans matched.",
    ),
  },
  [FLOW_KIND_USES]: {
    title: translationKey("Services Using Stores"),
    description: translationKey(
      "Which services read or write each store, from the service map.",
    ),
  },
};

const FLOW_SELECT: Select<DataSecurityFlow> = {
  _id: true,
  kind: true,
  sourceDataStoreId: true,
  sourceDataStore: { name: true, kind: true },
  serviceId: true,
  service: { name: true },
  destinationDataStoreId: true,
  destinationDataStore: { name: true, kind: true },
  destination: true,
  dataTypeIds: true,
  sensitivity: true,
  isConfirmed: true,
  overlapPercent: true,
  callCount: true,
  lastSeenAt: true,
};

const ConfirmedPill: FunctionComponent<{ isConfirmed: boolean }> = (props: {
  isConfirmed: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tooltip: string =
    translator.translateText(CONFIRMED_TOOLTIP) || CONFIRMED_TOOLTIP;

  return props.isConfirmed ? (
    <Pill text={CONFIRMED} color={Orange500} tooltip={tooltip} />
  ) : (
    <Pill text={PATH_ONLY} color={Gray500} tooltip={tooltip} />
  );
};

// How busy a flow is, or for a copy how much of the source it holds.
const FlowVolume: FunctionComponent<{ flow: DataSecurityFlow }> = (props: {
  flow: DataSecurityFlow;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.flow.kind === FLOW_KIND_COPY) {
    return (
      <span className="whitespace-nowrap text-sm tabular-nums text-gray-700">
        {translator.translateTemplate(OVERLAP, {
          percent: translator.formatNumber(
            Math.round(props.flow.overlapPercent || 0),
          ),
        })}
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-sm tabular-nums text-gray-700">
      {translator.translatePlural(CALLS, props.flow.callCount || 0, {
        count: translator.formatNumber(props.flow.callCount || 0),
      })}
    </span>
  );
};

const FlowKindTable: FunctionComponent<{
  kind: string;
  namer: DataTypeNamer;
}> = (props: { kind: string; namer: DataTypeNamer }): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const copy: FlowKindCopy = FLOW_KIND_COPY_TEXT[props.kind] || {
    title: props.kind,
    description: "",
  };
  const isCopy: boolean = props.kind === FLOW_KIND_COPY;
  const isUses: boolean = props.kind === FLOW_KIND_USES;
  const tableKey: string = `data-security-flows-${props.kind
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")}`;

  const columns: Array<Column<DataSecurityFlow>> = [
    {
      field: {
        sourceDataStore: { name: true },
        service: { name: true },
        destinationDataStore: { name: true },
        destination: true,
      },
      title: "Flow",
      type: FieldType.Element,
      disableSort: true,
      isNotCustomizable: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xl",
      getElement: (flow: DataSecurityFlow): ReactElement => {
        return <FlowChain flow={flow} />;
      },
    },
    {
      field: { dataTypeIds: true },
      title: "Data Types",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      getElement: (flow: DataSecurityFlow): ReactElement => {
        return (
          <IssueDataTypeChips
            dataTypeIds={readDataTypeIds(flow.dataTypeIds)}
            namer={props.namer}
            limit={2}
          />
        );
      },
    },
    {
      field: { sensitivity: true },
      title: "Sensitivity",
      type: FieldType.Element,
      disableSort: true,
      getElement: (flow: DataSecurityFlow): ReactElement => {
        return <SensitivityPill sensitivity={flow.sensitivity} />;
      },
    },
  ];

  // A service using a store is a path by nature: nothing to confirm.
  if (!isUses) {
    columns.push({
      field: { isConfirmed: true },
      title: "Confirmed",
      type: FieldType.Element,
      disableSort: true,
      getElement: (flow: DataSecurityFlow): ReactElement => {
        return <ConfirmedPill isConfirmed={Boolean(flow.isConfirmed)} />;
      },
    });
  }

  columns.push(
    isCopy
      ? {
          field: { overlapPercent: true },
          title: "Overlap",
          type: FieldType.Element,
          getElement: (flow: DataSecurityFlow): ReactElement => {
            return <FlowVolume flow={flow} />;
          },
        }
      : {
          field: { callCount: true },
          title: "Calls",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (flow: DataSecurityFlow): ReactElement => {
            return <FlowVolume flow={flow} />;
          },
        },
    {
      field: { lastSeenAt: true },
      title: "Last Seen",
      type: FieldType.Element,
      hideOnMobile: true,
      isHiddenByDefault: true,
      getElement: (flow: DataSecurityFlow): ReactElement => {
        return <IssueMoment value={flow.lastSeenAt} />;
      },
    },
  );

  return (
    <ModelTable<DataSecurityFlow>
      modelType={DataSecurityFlow}
      id={tableKey}
      name={`Data Security > Data Flows > ${props.kind}`}
      userPreferencesKey={tableKey}
      query={{
        ...(projectId ? { projectId: projectId } : {}),
        kind: props.kind,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy={isCopy ? "overlapPercent" : "callCount"}
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: copy.title,
        description: copy.description,
      }}
      noItemsMessage="No flows of this kind yet."
      showRefreshButton={true}
      selectMoreFields={{
        kind: true,
        sourceDataStoreId: true,
        serviceId: true,
        destinationDataStoreId: true,
        callCount: true,
        overlapPercent: true,
      }}
      filters={[]}
      columns={columns}
    />
  );
};

const DataSecurityDataFlowsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const namer: DataTypeNamer = useDataTypeNamer();

  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [riskiest, setRiskiest] = useState<Array<DataSecurityFlow>>([]);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const projectQuery: { projectId?: ObjectID } = projectId
      ? { projectId: projectId }
      : {};

    setError("");

    Promise.all([
      Promise.all(
        FLOW_KINDS.map((kind: string): Promise<number> => {
          return ModelAPI.count<DataSecurityFlow>({
            modelType: DataSecurityFlow,
            query: { ...projectQuery, kind: kind },
          });
        }),
      ),
      ModelAPI.getList<DataSecurityFlow>({
        modelType: DataSecurityFlow,
        query: { ...projectQuery },
        limit: FLOWS_READ_FOR_CHAINS,
        skip: 0,
        select: FLOW_SELECT,
        sort: { lastSeenAt: SortOrder.Descending },
      }),
    ])
      .then(
        ([kindCounts, flows]: [
          Array<number>,
          ListResult<DataSecurityFlow>,
        ]) => {
          if (!isCurrent) {
            return;
          }

          const byKind: Record<string, number> = {};

          FLOW_KINDS.forEach((kind: string, index: number) => {
            byKind[kind] = kindCounts[index] || 0;
          });

          setCounts(byKind);
          setRiskiest(
            rankFlowsByRisk(flows.data).slice(0, RISKIEST_CHAIN_COUNT),
          );
        },
      )
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const title: string = translationKey("Riskiest Flows");
  const description: string = translationKey(
    "Where the most sensitive data travels furthest: the store it comes from, the service it passes through and where it ends up.",
  );

  if (error) {
    return (
      <Card title={title} description={description}>
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setCounts(null);
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </Card>
    );
  }

  if (!counts) {
    return (
      <Card title={title} description={description}>
        <ComponentLoader />
      </Card>
    );
  }

  const kindsWithFlows: Array<string> = FLOW_KINDS.filter(
    (kind: string): boolean => {
      return (counts[kind] || 0) > 0;
    },
  );

  if (kindsWithFlows.length === 0) {
    return (
      <Card title="Data Flows" description={description}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Share}
          title="No data flows seen yet"
          description="Flows show once traces show services using your stores, or a scan finds copies between stores."
          isCompact={true}
        />
      </Card>
    );
  }

  return (
    <>
      <Card title={title} description={description}>
        <ul
          className="divide-y divide-gray-100"
          data-testid="data-security-riskiest-flows"
        >
          {riskiest.map(
            (flow: DataSecurityFlow, index: number): ReactElement => {
              return (
                <li
                  key={flow._id?.toString() || index}
                  className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <FlowChain flow={flow} size="large" />
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">
                      {translator.translateText(flow.kind) || flow.kind}
                    </span>
                    <SensitivityPill sensitivity={flow.sensitivity} />
                    {flow.kind !== FLOW_KIND_USES ? (
                      <ConfirmedPill isConfirmed={Boolean(flow.isConfirmed)} />
                    ) : (
                      <></>
                    )}
                    <FlowVolume flow={flow} />
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </Card>

      {kindsWithFlows.map((kind: string): ReactElement => {
        return <FlowKindTable key={kind} kind={kind} namer={namer} />;
      })}
    </>
  );
};

export default DataSecurityDataFlowsPage;
