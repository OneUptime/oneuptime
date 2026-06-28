import EnterpriseFeatureUpgrade from "../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  featureName: string;
  featureDescription: string;
}

/*
 * Shared "this is an Enterprise feature" screen for the instance-health pages
 * that are gated behind the Enterprise Edition (overview, datastore health,
 * diagnostic logs, query console). Keeping the benefits list in one place keeps
 * every gated page consistent. The note reminds Community operators that the
 * non-gated tools (Migrations, Support Bundle) remain reachable from the side
 * menu, so the landing page is not a dead-end paywall for them.
 */
const EnterpriseHealthUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <EnterpriseFeatureUpgrade
        title="Instance health"
        description="Operational health of this OneUptime instance."
        featureName={props.featureName}
        featureDescription={props.featureDescription}
        benefits={[
          {
            icon: IconProp.Activity,
            title: "Live component health",
            subtitle:
              "Postgres, ClickHouse, Redis and queue health at a glance.",
          },
          {
            icon: IconProp.Database,
            title: "Datastore capacity",
            subtitle:
              "Track database disk and memory utilization before you run out.",
          },
          {
            icon: IconProp.Terminal,
            title: "Query console",
            subtitle:
              "Run ad-hoc Postgres, ClickHouse and Redis queries from the dashboard.",
          },
          {
            icon: IconProp.List,
            title: "Diagnostics & logs",
            subtitle:
              "Datastore diagnostics, job backlogs and recent logs in one place.",
          },
        ]}
      />
      <Alert
        type={AlertType.INFO}
        strongTitle="Available on every edition"
        title="Migrations and the Support Bundle work on the Community Edition too — find them in the menu on the left."
        className="mt-5"
      />
    </div>
  );
};

export default EnterpriseHealthUpgrade;
