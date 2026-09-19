import EnterpriseFeatureUpgrade from "../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  featureName: string;
  featureDescription: string;
  /*
   * The reminder that the Community tools stay reachable. On by default; off
   * where the upsell is one section of a page that already shows them.
   */
  showEveryEditionNote?: boolean | undefined;
}

const ENTERPRISE_OVERVIEW_URL: string =
  "https://oneuptime.com/enterprise/overview";

export const ENTERPRISE_HEALTH_NOTE_DESCRIPTION: string =
  "Live PostgreSQL, ClickHouse cluster and Valkey health, background queues, diagnostic logs, telemetry ingestion and the query console are part of the OneUptime Enterprise Edition.";

export const EVERY_EDITION_HEALTH_NOTE: string =
  "ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle work on the Community Edition too — find them in the menu on the left.";

/*
 * Shared "this is an Enterprise feature" screen for the OneUptime Health pages
 * whose content is an Enterprise feature (live datastore health, background
 * queues, diagnostic logs, telemetry ingestion, the query console). Keeping
 * the benefits list in one place keeps every gated page consistent. The note
 * reminds Community operators that the Community tools (ClickHouse capacity
 * and pruning, the instance log, probes, migrations, the support bundle)
 * remain reachable from the side menu, so no Health page is a dead-end
 * paywall for them.
 */
const EnterpriseHealthUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <EnterpriseFeatureUpgrade
        title="OneUptime Health"
        description="Operational health of this OneUptime instance."
        featureName={props.featureName}
        featureDescription={props.featureDescription}
        benefits={[
          {
            icon: IconProp.Activity,
            title: "Live component health",
            subtitle:
              "Postgres, ClickHouse, Valkey and queue health at a glance.",
          },
          {
            icon: IconProp.Database,
            title: "Datastore health alerts",
            subtitle:
              "PostgreSQL and Valkey storage, connection and memory alerts before you run out.",
          },
          {
            icon: IconProp.Terminal,
            title: "Query console",
            subtitle:
              "Run ad-hoc Postgres, ClickHouse and Valkey queries from the dashboard.",
          },
          {
            icon: IconProp.List,
            title: "Diagnostics & logs",
            subtitle:
              "Datastore diagnostics, job backlogs and recent logs in one place.",
          },
        ]}
      />
      {props.showEveryEditionNote === false ? (
        <></>
      ) : (
        <Alert
          type={AlertType.INFO}
          strongTitle="Available on every edition"
          title={EVERY_EDITION_HEALTH_NOTE}
          className="mt-5"
        />
      )}
    </div>
  );
};

/*
 * The compact version, for the Health landing page on the Community Edition:
 * the page itself is useful there (ClickHouse capacity and the tools that work
 * on every edition), so the Enterprise part is a note above it rather than a
 * full-page upsell.
 */
export const EnterpriseHealthNote: FunctionComponent = (): ReactElement => {
  return (
    <Card
      title="Live instance health"
      description={ENTERPRISE_HEALTH_NOTE_DESCRIPTION}
      buttons={[
        {
          title: "Learn about Enterprise Edition",
          icon: IconProp.Info,
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: () => {
            window.open(ENTERPRISE_OVERVIEW_URL, "_blank");
          },
        },
      ]}
    />
  );
};

export default EnterpriseHealthUpgrade;
