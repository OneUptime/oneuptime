import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import MigrationStatus from "./MigrationStatus";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthMigrations: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Migrations"
      currentRoute={RouteMap[PageMap.HEALTH_MIGRATIONS] as Route}
    >
      <MigrationStatus />
    </HealthPage>
  );
};

export default HealthMigrations;
