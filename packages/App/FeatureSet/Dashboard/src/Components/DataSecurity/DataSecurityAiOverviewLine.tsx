import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { DataSecurityAiOverviewCopy } from "./DataSecurityAiCopy";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import {
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "Common/Types/DataSecurity/DataSecurityAi";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE OVERVIEW'S LINE ABOUT ONEUPTIME AI (#10364): what it contained this
 * week - the containing changes it made, approved or without asking, not
 * undone since - and how many of its proposals wait for a person, with the
 * way to Data Security → AI. Nothing at all while both are none, or when
 * the reader may not read OneUptime AI's proposals: a project without AI
 * sees the Overview as it was.
 */

export const DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID: string =
  "data-security-ai-overview-line";

const WEEK_IN_DAYS: number = 7;

export interface DataSecurityAiOverviewCounts {
  containedThisWeek: number;
  waiting: number;
}

export async function readDataSecurityAiOverviewCounts(): Promise<DataSecurityAiOverviewCounts> {
  const weekAgo: Date = OneUptimeDate.addRemoveDays(
    OneUptimeDate.getCurrentDate(),
    -WEEK_IN_DAYS,
  );

  const [containedThisWeek, waiting]: [number, number] = await Promise.all([
    ModelAPI.count<DataSecurityAiProposal>({
      modelType: DataSecurityAiProposal,
      query: {
        work: DataSecurityAiWork.Contain,
        status: new Includes([
          DataSecurityAiProposalStatus.Applied,
          DataSecurityAiProposalStatus.AppliedWithoutAsking,
        ]),
        appliedAt: new GreaterThanOrEqual<Date>(weekAgo),
      },
    }),
    ModelAPI.count<DataSecurityAiProposal>({
      modelType: DataSecurityAiProposal,
      query: { status: DataSecurityAiProposalStatus.Proposed },
    }),
  ]);

  return { containedThisWeek, waiting };
}

const DataSecurityAiOverviewLine: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [counts, setCounts] = useState<DataSecurityAiOverviewCounts | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    readDataSecurityAiOverviewCounts()
      .then((read: DataSecurityAiOverviewCounts) => {
        if (isCurrent) {
          setCounts(read);
        }
      })
      .catch(() => {
        // A read the reader may not make is nothing to say.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (!counts || (counts.containedThisWeek === 0 && counts.waiting === 0)) {
    return <></>;
  }

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-700 md:px-6"
      data-testid={DATA_SECURITY_AI_OVERVIEW_LINE_TEST_ID}
    >
      {counts.containedThisWeek > 0 ? (
        <span>
          {translator.translatePlural(
            DataSecurityAiOverviewCopy.contained,
            counts.containedThisWeek,
          )}{" "}
        </span>
      ) : (
        <></>
      )}
      {counts.waiting > 0 ? (
        <span>
          {translator.translatePlural(
            DataSecurityAiOverviewCopy.waiting,
            counts.waiting,
          )}{" "}
        </span>
      ) : (
        <></>
      )}
      <Link
        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATA_SECURITY_AI] as Route,
        )}
      >
        {translator.translateText(DataSecurityAiOverviewCopy.open)}
      </Link>
    </div>
  );
};

export default DataSecurityAiOverviewLine;
