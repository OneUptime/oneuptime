import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { VMwareHostReportState } from "../../../Pages/VMware/Utils/VMwareHostData";

/*
 * Under an ESXi host's hero while vCenter is not reporting the host: what
 * that means for the numbers on the page and where to look next. Draws
 * nothing while the host reports.
 *
 * A host vCenter stops reporting is kept for 15 minutes and then leaves the
 * inventory, unless the whole vCenter went quiet (then its last inventory
 * is kept), so "Not reporting" is usually the vCenter's collection, and
 * "Not in inventory" a host that was removed, or that vCenter no longer
 * reaches.
 */

export interface ComponentProps {
  reportState: VMwareHostReportState;
  lastReportAt: Date | null;
  // The vCenter's overview: how its collection is doing.
  vcenterRoute: Route;
  // Every host of the vCenter.
  hostsRoute: Route;
}

const LINK_CLASS_NAME: string =
  "font-medium underline underline-offset-2 hover:no-underline";

const VMwareHostReportNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (props.reportState === VMwareHostReportState.NotReporting) {
    return (
      <Alert
        className="mb-6"
        dataTestId="vmware-host-report-notice"
        type={AlertType.WARNING}
        strongTitle={translator.translateTemplate(
          "No new data from vCenter since {{time}}",
          {
            time: props.lastReportAt
              ? OneUptimeDate.fromNow(props.lastReportAt)
              : tx("its last report"),
          },
        )}
        title={
          <span>
            {tx(
              "The numbers on this page stop there. The host may be disconnected from vCenter, in maintenance mode or powered off, or the vCenter stopped reporting.",
            )}{" "}
            <Link to={props.vcenterRoute} className={LINK_CLASS_NAME}>
              {tx("Check the vCenter")}
            </Link>
          </span>
        }
      />
    );
  }

  if (props.reportState === VMwareHostReportState.NoDataYet) {
    return (
      <Alert
        className="mb-6"
        dataTestId="vmware-host-report-notice"
        type={AlertType.INFO}
        strongTitle="Waiting for this host's first metrics"
        title="vCenter lists this host but has sent no metrics for it yet. They arrive with the next collection, every 2 minutes by default."
      />
    );
  }

  if (props.reportState === VMwareHostReportState.NotInInventory) {
    return (
      <Alert
        className="mb-6"
        dataTestId="vmware-host-report-notice"
        type={AlertType.INFO}
        strongTitle="This host is not in the vCenter's inventory"
        title={
          <span>
            {tx(
              "vCenter has not reported it for more than 15 minutes, so it was taken out of the inventory. Its earlier metrics are still below, and it comes back with the next collection that reports it.",
            )}{" "}
            <Link to={props.hostsRoute} className={LINK_CLASS_NAME}>
              {tx("See all hosts")}
            </Link>
          </span>
        }
      />
    );
  }

  return <></>;
};

export default VMwareHostReportNotice;
