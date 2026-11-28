import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import SecurityEventConnectionsTable from "../../Components/SecurityEvents/SecurityEventConnectionsTable";
import SecurityEventDestinationsTable from "../../Components/SecurityEvents/SecurityEventDestinationsTable";
import SecurityLogsSourceCard from "../../Components/SecurityEvents/SecurityLogsSourceCard";
import SecurityTelemetrySourcesCard from "../../Components/SecurityEvents/SecurityTelemetrySourcesCard";
import SecurityTrustedProxiesCard, {
  TRUSTED_PROXIES_CARD_KEY,
} from "../../Components/SecurityEvents/SecurityTrustedProxiesCard";
import {
  ACCESS_LOG_FORMAT_GIVEN,
  ACCESS_LOGS_TITLE,
  CONNECTIONS_MORE_SETTINGS_DESCRIPTION,
  TRUSTED_AUTOMATICALLY_TITLE,
  TRUSTED_PROXIES_TEST_IDS,
  TRUSTED_PROXIES_TITLE,
} from "../../Components/SecurityEvents/SecurityTrustedProxiesCopy";
import SecurityAccessLogsCard, {
  ACCESS_LOGS_CARD_KEY,
} from "../../Components/SecurityEvents/TrustedProxies/SecurityAccessLogsCard";
import SecurityTrustedAutomaticallyCard, {
  TRUSTED_AUTOMATICALLY_CARD_KEY,
} from "../../Components/SecurityEvents/TrustedProxies/SecurityTrustedAutomaticallyCard";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import {
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Security Events > Connections: where security events come from and where
 * they go, top to bottom.
 *
 *   Your logs             the logs the project already sends, read for
 *                         sign-ins, sudo, Kubernetes audit, CloudTrail,
 *                         security products' CEF and LEEF, firewalls' own
 *                         syslog and web attacks - one switch, and which
 *                         of their threats open cases
 *   Your OneUptime data   the project's traces, network flows, audit log,
 *                         session replays and the audit logs of the cloud
 *                         accounts connected under Cloud - one switch each
 *   Your security tools   the security products OneUptime imports from
 *   Send to your SIEM     the SIEMs OneUptime sends what it finds to
 *   More settings         Trusted Proxies: the proxies the project's apps
 *                         sit behind, whose forwarded client address the
 *                         scans trust (#10416); Trusted Automatically: what
 *                         they trust without being listed, and the switch
 *                         for the project's own load balancers (#10546);
 *                         Access Logs: whether its access logs end with
 *                         X-Forwarded-For (#10548), and the format they
 *                         are written in (#11048) - optional, and about
 *                         the project's own infrastructure, so folded
 *
 * Each card owns its own state, so the page is only the plan gate in front
 * of them.
 */
const SecurityEventsConnectionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // How many proxies the project trusts, for the folded header's chip.
  const [trustedProxyCount, setTrustedProxyCount] = useState<number>(0);
  /*
   * The two switches, for the folded header's chips: each named only while
   * it is not where a project starts - its own load balancers trusted, its
   * access logs not read for the header.
   */
  const [isTrustingOwnLoadBalancers, setIsTrustingOwnLoadBalancers] =
    useState<boolean>(true);
  const [isReadingAccessLogHeader, setIsReadingAccessLogHeader] =
    useState<boolean>(false);
  // Whether the project gave its access logs' own format (#11048).
  const [hasAccessLogFormat, setHasAccessLogFormat] = useState<boolean>(false);

  /*
   * Same reseller-telemetry gate as every other Security Events page —
   * polled records land in the telemetry-billed security event stream, so a
   * plan without telemetry features has nowhere to put them.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  return (
    <div className="space-y-6">
      <SecurityLogsSourceCard />
      <SecurityTelemetrySourcesCard />
      <SecurityEventConnectionsTable />
      <SecurityEventDestinationsTable />

      <AdvancedPageSection
        description={CONNECTIONS_MORE_SETTINGS_DESCRIPTION}
        items={[
          foldedSectionItem(TRUSTED_PROXIES_TITLE, {
            key: TRUSTED_PROXIES_CARD_KEY,
            isSet: trustedProxyCount > 0,
            value: translator.formatNumber(trustedProxyCount),
          }),
          foldedSectionItem(TRUSTED_AUTOMATICALLY_TITLE, {
            key: TRUSTED_AUTOMATICALLY_CARD_KEY,
            isSet: !isTrustingOwnLoadBalancers,
            value: FOLDED_SECTION_OFF,
            translateValue: true,
          }),
          // On, or reading the project's own format: what a project starts without.
          foldedSectionItem(ACCESS_LOGS_TITLE, {
            key: ACCESS_LOGS_CARD_KEY,
            isSet: isReadingAccessLogHeader || hasAccessLogFormat,
            value: hasAccessLogFormat
              ? ACCESS_LOG_FORMAT_GIVEN
              : FOLDED_SECTION_ON,
            translateValue: true,
          }),
        ]}
        dataTestId={TRUSTED_PROXIES_TEST_IDS.fold}
      >
        <SecurityTrustedProxiesCard onLoaded={setTrustedProxyCount} />
        <SecurityTrustedAutomaticallyCard
          onChange={setIsTrustingOwnLoadBalancers}
        />
        <SecurityAccessLogsCard
          onChange={setIsReadingAccessLogHeader}
          onFormatChange={setHasAccessLogFormat}
        />
      </AdvancedPageSection>
    </div>
  );
};

export default SecurityEventsConnectionsPage;
