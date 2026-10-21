import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Route from "Common/Types/API/Route";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { DatabaseAgentEngine } from "../../Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DATABASE_AGENT_SYSTEM_OPTIONS,
  DEFAULT_DATABASE_AGENT_SYSTEM,
  DatabaseDocumentationTarget,
  getDatabaseAgentEngine,
  getDatabaseAgentSetupGuide,
  getDatabaseHealthMonitorCreateUrl,
  getDatabaseOwnCollectorSetupGuide,
  resolveDatabaseAgentSystem,
} from "../../Pages/Database/Utils/DocumentationMarkdown";

/*
 * The Database Agent install guide with the viewer's ingestion key filled
 * in. Two uses:
 *
 *   - the product Documentation page and the empty list: no `database`, an
 *     engine picker over every engine the agent monitors (MariaDB, Valkey
 *     and OpenSearch included — they run their family's config);
 *   - a database's Documentation tab: `database` prefills the guide for that
 *     row — its identity and its oneuptime.database.server.id — for the
 *     row's own engine, so there is no picker. An engine the agent has no
 *     config for gets the "use your own collector" guide instead: its
 *     receiver, its Prometheus endpoint or its cloud monitoring API, from
 *     the engine catalog.
 */

export interface ComponentProps {
  title: string;
  description: string;
  database?: DatabaseDocumentationTarget | undefined;
}

const DatabaseDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rowEngine: DatabaseAgentEngine | null = props.database
    ? getDatabaseAgentEngine(props.database.dbSystem)
    : null;

  // Opens the monitor form with the Database Health type already picked.
  const databaseHealthMonitorUrl: string = getDatabaseHealthMonitorCreateUrl(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_CREATE] as Route,
    ).toString(),
  );

  // The row's recommended monitors (a database's own tab only).
  const recommendationsUrl: string | undefined = props.database
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS] as Route,
        { modelId: props.database.id },
      ).toString()
    : undefined;

  const getContent: (context: SetupGuideRenderContext) => SetupGuideContent = (
    context: SetupGuideRenderContext,
  ): SetupGuideContent => {
    if (props.database && !rowEngine) {
      return getDatabaseOwnCollectorSetupGuide({
        oneuptimeUrl: context.oneuptimeUrl,
        apiKey: context.apiKey,
        hasApiKey: context.hasApiKey,
        database: props.database,
        databaseHealthMonitorUrl: databaseHealthMonitorUrl,
        recommendationsUrl: recommendationsUrl,
      });
    }

    /*
     * A database's own tab always uses the row's engine; the picker is only
     * for the product page, where the user says what they run.
     */
    const system: string = props.database
      ? props.database.dbSystem || ""
      : resolveDatabaseAgentSystem(context.option);

    return getDatabaseAgentSetupGuide({
      oneuptimeUrl: context.oneuptimeUrl,
      apiKey: context.apiKey,
      hasApiKey: context.hasApiKey,
      engine: rowEngine || getDatabaseAgentEngine(system) || "postgresql",
      system: system,
      database: props.database,
      databaseHealthMonitorUrl: databaseHealthMonitorUrl,
      recommendationsUrl: recommendationsUrl,
    });
  };

  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Database}
      newKeyName={translationKey("Databases key")}
      optionsLabel="Which database engine?"
      options={props.database ? undefined : DATABASE_AGENT_SYSTEM_OPTIONS}
      optionsLayout="pills"
      initialOption={props.database ? undefined : DEFAULT_DATABASE_AGENT_SYSTEM}
      keyStepDescription="The agent sends the database's engine metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
      getContent={getContent}
    />
  );
};

export default DatabaseDocumentationCard;
