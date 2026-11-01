import PageComponentProps from "../../PageComponentProps";
import { getDataSecurityBreadcrumbs } from "../../../Utils/Breadcrumbs/DataSecurityBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import DataSecurityIssueViewContext, {
  DATA_SECURITY_ISSUE_VIEW_SELECT,
} from "./IssueViewContext";
import DataSecurityIssueSideMenu from "./SideMenu";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import { JSONObject } from "Common/Types/JSON";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import Page from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

// What the page says in place of the issue when there is none to show.
export const ISSUE_NOT_FOUND: string = translationKey(
  "This issue is not here. It may have been deleted, or it belongs to another project.",
);

/*
 * The issue as it was last read, stamped with the id it was read for, so
 * an issue read for the page the reader just left is never shown for the
 * one they are on.
 */
interface LoadedIssue {
  issueId: string;
  issue: DataSecurityIssue | null;
  // Why it could not be read; "" when it was, or when it is not there.
  error: string;
}

/*
 * One data security issue, worked on pages of its own under a side menu
 * of its own (IssueViewMenu.ts): its Overview - what is wrong, why it
 * matters, how to fix it - its Timeline, and under Advanced, Delete Issue.
 *
 * The layout reads the issue once for all of them and again after every
 * change, names it in the trail, and says so in place of its pages when
 * it is not there, or the reader may not read it.
 */
const DataSecurityIssueViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  // Keyed on the id's string: a new ObjectID is built on every render.
  const issueIdString: string = id || "";
  const issueId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(issueIdString);
  }, [issueIdString]);
  const isIdValid: boolean = ObjectID.isValidUUID(issueIdString);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [loaded, setLoaded] = useState<LoadedIssue | null>(null);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  // Bumped by every read: a read only lands while no newer one has started.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    let result: LoadedIssue;

    if (!isIdValid) {
      result = { issueId: issueIdString, issue: null, error: "" };
    } else {
      try {
        const item: DataSecurityIssue | null =
          await ModelAPI.getItem<DataSecurityIssue>({
            modelType: DataSecurityIssue,
            id: issueId,
            select: DATA_SECURITY_ISSUE_VIEW_SELECT,
          });

        result = { issueId: issueIdString, issue: item, error: "" };
      } catch (err) {
        result = {
          issueId: issueIdString,
          issue: null,
          error: API.getFriendlyMessage(err),
        };
      }
    }

    if (readNumber !== latestReadRef.current) {
      return;
    }

    setLoaded((previous: LoadedIssue | null): LoadedIssue => {
      // A read again that fails keeps the issue already on screen.
      if (
        result.error &&
        previous &&
        previous.issueId === result.issueId &&
        previous.issue
      ) {
        return previous;
      }

      return result;
    });
  }, [issueIdString]);

  useEffect(() => {
    void load();

    return () => {
      latestReadRef.current++;
    };
  }, [load]);

  const refresh: () => void = useCallback((): void => {
    void load();
    setRefreshToggle(Date.now().toString());
    // The side menu's count of open issues.
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  }, [load]);

  const updateIssue: (data: JSONObject) => Promise<void> = useCallback(
    async (data: JSONObject): Promise<void> => {
      setIsWorking(true);

      try {
        await ModelAPI.updateById<DataSecurityIssue>({
          modelType: DataSecurityIssue,
          id: issueId,
          data: data,
        });
      } finally {
        setIsWorking(false);
      }

      refresh();
    },
    [issueIdString, refresh],
  );

  const isCurrentIssueLoaded: boolean =
    loaded !== null && loaded.issueId === issueIdString;
  const issue: DataSecurityIssue | null = isCurrentIssueLoaded
    ? loaded!.issue
    : null;

  const context: DataSecurityIssueViewContext | null =
    useMemo((): DataSecurityIssueViewContext | null => {
      if (!issue) {
        return null;
      }

      return {
        issueId: issueId,
        issue: issue,
        refreshToggle: refreshToggle,
        isWorking: isWorking,
        refresh: refresh,
        updateIssue: updateIssue,
      };
    }, [issue, refreshToggle, isWorking, refresh, updateIssue]);

  const breadcrumbs: Array<Link> | undefined = nameRecordInTrail({
    links: getDataSecurityBreadcrumbs(path),
    recordId: issueIdString,
    recordName: issue
      ? translator.translateText(issue.title) || issue.title || null
      : null,
  });

  const sideMenu: ReactElement = (
    <DataSecurityIssueSideMenu modelId={issueId} />
  );

  if (!isCurrentIssueLoaded) {
    return (
      <Page breadcrumbLinks={breadcrumbs} sideMenu={sideMenu} isLoading={true}>
        <></>
      </Page>
    );
  }

  if (!issue) {
    const readGate: PermissionGateResult = PermissionGate.check(
      new DataSecurityIssue(),
      ModelAction.Read,
    );

    return (
      <Page
        breadcrumbLinks={breadcrumbs}
        error={
          loaded!.error ||
          (!readGate.isAllowed && readGate.disabledReason) ||
          translator.translateText(ISSUE_NOT_FOUND) ||
          ISSUE_NOT_FOUND
        }
      >
        <></>
      </Page>
    );
  }

  return (
    <Page breadcrumbLinks={breadcrumbs} sideMenu={sideMenu}>
      {/* Each page of the issue starts afresh for another issue. */}
      <React.Fragment key={issueIdString}>
        <Outlet context={context} />
      </React.Fragment>
    </Page>
  );
};

export default DataSecurityIssueViewLayout;
