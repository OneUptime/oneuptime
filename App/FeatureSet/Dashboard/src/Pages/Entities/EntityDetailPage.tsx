import PageComponentProps from "../PageComponentProps";
import TracesViewer from "../../Components/Traces/TracesViewer";
import LogsViewer from "../../Components/Logs/LogsViewer";
import MetricsViewer from "../../Components/Metrics/MetricsViewer";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Page from "Common/UI/Components/Page/Page";
import Card from "Common/UI/Components/Card/Card";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/**
 * Entity detail — the cross-cutting "everything about this entity" view.
 * Beyond metadata + its relationships, it surfaces the entity's telemetry
 * via the `entityKeys` membership read (`hasAny(entityKeys, [key])`), so you
 * see e.g. every span that touched a k8s pod — even spans primarily owned by
 * a service. This is the payoff of the entity model's read path.
 */
const EntityDetailPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [entity, setEntity] = useState<TelemetryEntity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const item: TelemetryEntity | null =
          await ModelAPI.getItem<TelemetryEntity>({
            modelType: TelemetryEntity,
            id: modelId,
            select: {
              entityType: true,
              displayName: true,
              entityKey: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
          });
        setEntity(item);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  if (isLoading) {
    return (
      <Page title="Entity" breadcrumbLinks={[]}>
        <ComponentLoader />
      </Page>
    );
  }

  if (error || !entity || !entity.entityKey) {
    return (
      <Page title="Entity" breadcrumbLinks={[]}>
        <ErrorMessage message={error || "Entity not found."} />
      </Page>
    );
  }

  const entityKey: string = entity.entityKey;

  return (
    <Page title={entity.displayName || "Entity"} breadcrumbLinks={[]}>
      <Fragment>
        <Card
          title={entity.displayName || entityKey}
          description={`Entity type: ${entity.entityType || "unknown"} · key: ${entityKey}`}
        />

        <ModelTable<TelemetryEntityRelationship>
          modelType={TelemetryEntityRelationship}
          id="entity-relationships-table"
          userPreferencesKey="entity-relationships-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          singularName="Relationship"
          pluralName="Relationships"
          name="Relationships"
          sortBy="lastSeenAt"
          sortOrder={SortOrder.Descending}
          cardProps={{
            title: "Relationships",
            description:
              "How this entity relates to others (runs-on, member-of, hosted-on, part-of), inferred from telemetry co-occurrence.",
          }}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            fromEntityKey: entityKey,
          }}
          showRefreshButton={true}
          noItemsMessage={"No relationships discovered for this entity yet."}
          filters={[
            {
              field: { relationshipType: true },
              title: "Relationship",
              type: FieldType.Text,
            },
            {
              field: { toEntityKey: true },
              title: "To Entity (key)",
              type: FieldType.Text,
            },
          ]}
          columns={[
            {
              field: { relationshipType: true },
              title: "Relationship",
              type: FieldType.Text,
            },
            {
              field: { toEntityKey: true },
              title: "To Entity (key)",
              type: FieldType.Text,
            },
            {
              field: { lastSeenAt: true },
              title: "Last Seen",
              type: FieldType.DateTime,
            },
          ]}
        />

        <Card
          title="Telemetry"
          description="All telemetry that belongs to this entity — found via entityKeys membership, so it includes signals primarily owned by other entities (e.g. a service-owned span that ran on this host/pod)."
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
                    id="entity-logs"
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
            ] as Array<Tab>
          }
        />
      </Fragment>
    </Page>
  );
};

export default EntityDetailPage;
