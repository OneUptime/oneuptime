import MonitorTable from "../../Components/Monitor/MonitorTable";
import ActiveMonitorLimitNotice, {
  ActiveMonitorLimitNoticeShowWhen,
} from "../../Components/Monitor/ActiveMonitorLimitNotice";
import { ALL_MONITORS_TABLE_ID } from "../../Components/Monitor/MonitorFacets";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useCreatePageFirstRun, {
  CreatePageFirstRun,
} from "../../Components/ProductOnboarding/UseCreatePageFirstRun";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";
import PageMap from "../../Utils/PageMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  MONITORS_IMPORT_OFFER,
  withToolImportOffer,
} from "../../Components/ToolImport/ToolImportOffer";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const MonitorPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // Until the first one, the page explains the product under the empty table.
  const firstRun: CreatePageFirstRun = useCreatePageFirstRun<Monitor>({
    modelType: Monitor,
    product: ProductKey.Monitors,
    startTitle: "Create Monitor",
    createPage: PageMap.MONITOR_CREATE,
  });
  return (
    <Fragment>
      {/*
       * A project past its plan's limit on active monitors is told so where
       * its monitors are: they keep running, and no more can be added.
       */}
      <ActiveMonitorLimitNotice
        showWhen={ActiveMonitorLimitNoticeShowWhen.OverLimit}
      />
      <MonitorTable
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        saveFilterProps={{
          /*
           * Also the URL namespace this table's chips are persisted under, so a
           * link built elsewhere (see MonitorListFacetRoute) can land the list
           * with a chip already set. Shared rather than spelled twice.
           */
          tableId: ALL_MONITORS_TABLE_ID,
        }}
        videoLink={URL.fromString("https://youtu.be/_fQ_F4EisBQ")}
        /*
         * Beside the empty list's Create, a link to bring the monitors over
         * from UptimeRobot, Pingdom and the rest (ToolImportOffer).
         */
        emptyState={withToolImportOffer({
          emptyState: firstRun.emptyState,
          offer: MONITORS_IMPORT_OFFER,
          translator: translator,
        })}
        refreshToggle={firstRun.refreshToken}
      />
      {firstRun.showcase}
    </Fragment>
  );
};

export default MonitorPage;
