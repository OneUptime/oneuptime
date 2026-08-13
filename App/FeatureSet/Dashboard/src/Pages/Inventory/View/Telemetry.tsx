import PageComponentProps from "../../PageComponentProps";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import LogsViewer from "../../../Components/Logs/LogsViewer";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import ExceptionsTable from "../../../Components/Exceptions/ExceptionsTable";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Every signal that belongs to this item.
 *
 * Membership is read through `entityKeys` rather than through the signal's
 * primary owner, which is the whole point of the entity model's read path: a
 * span owned by the `checkout` service but executed on this pod belongs to
 * both, and asking "what ran on this pod" has to return it. A primary-owner
 * query would return nothing at all for a pod.
 */

const InventoryItemTelemetry: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item?.entityKey) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  const entityKey: string = item.entityKey;

  return (
    <Fragment>
      <Card
        title="Telemetry"
        description="Everything that mentions this item — including signals another item owns, such as a service's span that happened to run here."
      />
      <Tabs
        onTabChange={() => {
          // no-op: each tab self-fetches on render
        }}
        tabs={
          [
            {
              name: "Traces",
              children: <TracesViewer entityKeysFilter={[entityKey]} />,
            },
            {
              name: "Logs",
              children: (
                <LogsViewer
                  id="inventory-item-logs"
                  logQuery={
                    {
                      entityKeys: new Includes([entityKey]),
                    } as Query<Log>
                  }
                />
              ),
            },
            {
              name: "Metrics",
              children: <MetricsViewer entityKeysFilter={[entityKey]} />,
            },
            {
              name: "Exceptions",
              children: (
                <ExceptionsTable
                  query={{}}
                  title="Exceptions"
                  description="Exception groups whose instances belong to this item."
                  entityKeys={[entityKey]}
                />
              ),
            },
            {
              name: "Profiles",
              children: <ProfileTable entityKeys={[entityKey]} />,
            },
          ] as Array<Tab>
        }
      />
    </Fragment>
  );
};

export default InventoryItemTelemetry;
