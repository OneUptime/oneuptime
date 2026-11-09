import WorkflowVersionPreview from "./WorkflowVersionPreview";
import { WorkflowViewOnlyContext } from "./WorkflowViewOnly";
import {
  WORKFLOW_VERSIONS_PER_PAGE,
  WorkflowVersionCopy,
  WorkflowVersionRow,
  WorkflowVersionSavedBy,
  WorkflowVersionText,
  canPreviewWorkflowVersion,
  getWorkflowVersionHeadline,
  getWorkflowVersionLines,
  describeWorkflowVersionSavedBy,
  getWorkflowVersionSavedBy,
} from "./WorkflowVersionPresentation";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "../Feed/FeedTime";
import Pill, { PillSize } from "../Pill/Pill";
import SideOver from "../SideOver/SideOver";
import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import { Translator, getInlineSeparator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import WorkflowVersion from "../../../Models/DatabaseModels/WorkflowVersion";
import Select from "../../../Types/BaseDatabase/Select";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Green } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata from "../../../Types/Workflow/Component";
import { SavedWorkflowGraph } from "../../../Utils/Workflow/WorkflowGraphSnapshot";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE BUILDER'S VERSION HISTORY (issue #6188): every saved version of the
 * workflow, newest first - who saved it, when, and what it changed - in a
 * panel beside the canvas, which stays where it is. An earlier version opens
 * in a preview (WorkflowVersionPreview), from where it is restored.
 *
 * Whoever may open the workflow may read its history; restoring takes
 * permission to edit it, and someone without it is told why. The list reads
 * again after every save (refreshToken), so a restore shows up as the
 * newest version as soon as it is saved.
 */

export interface ComponentProps {
  workflowId: ObjectID;
  // Moves on with every save of the workflow, for the list to read again.
  refreshToken: number;
  // The graph on the canvas, as it is saved.
  currentGraph: SavedWorkflowGraph;
  components: Array<ComponentMetadata>;
  /*
   * Why the reader may not restore a version (the builder's edit gate), if
   * not: the history is then a view (WorkflowViewOnly).
   */
  restoreDisabledReason?: string | undefined;
  onRestore: (data: { versionNumber: number; graph: JSONObject }) => void;
  onClose: () => void;
}

const VERSION_SELECT: Select<WorkflowVersion> = {
  _id: true,
  versionNumber: true,
  versionType: true,
  changes: true,
  changeCount: true,
  restoredFromVersionNumber: true,
  createdAt: true,
  updatedAt: true,
  createdByUser: {
    name: true,
    email: true,
  },
  // Ask AI, when it saved the version for that person (issue #6258).
  savedThrough: true,
};

const toRow: (version: WorkflowVersion) => WorkflowVersionRow = (
  version: WorkflowVersion,
): WorkflowVersionRow => {
  return {
    versionNumber: version.versionNumber || 0,
    versionType: version.versionType,
    changes: Array.isArray(version.changes)
      ? version.changes.filter((line: unknown): line is string => {
          return typeof line === "string";
        })
      : [],
    changeCount: version.changeCount || 0,
    restoredFromVersionNumber:
      typeof version.restoredFromVersionNumber === "number"
        ? version.restoredFromVersionNumber
        : null,
    savedBy:
      version.createdByUser?.name?.toString() ||
      version.createdByUser?.email?.toString() ||
      "",
    savedThrough: version.savedThrough || null,
  };
};

// When a version was last saved: the newest save it took in.
const getSavedAt: (version: WorkflowVersion) => Date | null = (
  version: WorkflowVersion,
): Date | null => {
  const value: Date | undefined = version.updatedAt || version.createdAt;

  return value ? OneUptimeDate.fromString(value) : null;
};

const SavedByAndWhen: FunctionComponent<{
  version: WorkflowVersion;
  translator: Translator;
}> = (props: {
  version: WorkflowVersion;
  translator: Translator;
}): ReactElement => {
  const savedBy: WorkflowVersionSavedBy = getWorkflowVersionSavedBy(
    toRow(props.version),
  );
  const savedAt: Date | null = getSavedAt(props.version);
  const clock: FeedClock = getFeedClock({
    language: props.translator.language,
  });

  return (
    <p className="mt-0.5 text-xs text-gray-500">
      {savedBy ? (
        <span dir="auto" data-testid="workflow-version-saved-by">
          {describeWorkflowVersionSavedBy({
            savedBy,
            translator: props.translator,
          })}
        </span>
      ) : (
        <></>
      )}
      {savedBy && savedAt ? (
        <span aria-hidden="true">
          {getInlineSeparator(props.translator.language)}
        </span>
      ) : (
        <></>
      )}
      {savedAt ? (
        <time
          dateTime={savedAt.toISOString()}
          title={formatFeedFullTime(savedAt, clock)}
        >
          {formatFeedTimeAgo(savedAt, clock) || OneUptimeDate.fromNow(savedAt)}
        </time>
      ) : (
        <></>
      )}
    </p>
  );
};

// Who saved a version and when, as one line of text, for its preview.
const describeSavedByAndWhen: (
  version: WorkflowVersion,
  translator: Translator,
) => string = (version: WorkflowVersion, translator: Translator): string => {
  const savedBy: WorkflowVersionSavedBy = getWorkflowVersionSavedBy(
    toRow(version),
  );
  const savedAt: Date | null = getSavedAt(version);
  const clock: FeedClock = getFeedClock({ language: translator.language });

  return [
    describeWorkflowVersionSavedBy({ savedBy, translator }),
    savedAt
      ? formatFeedTimeAgo(savedAt, clock) || OneUptimeDate.fromNow(savedAt)
      : "",
  ]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(getInlineSeparator(translator.language));
};

const VersionItem: FunctionComponent<{
  version: WorkflowVersion;
  isNewest: boolean;
  canPreview: boolean;
  onPreview: () => void;
  translator: Translator;
}> = (props: {
  version: WorkflowVersion;
  isNewest: boolean;
  canPreview: boolean;
  onPreview: () => void;
  translator: Translator;
}): ReactElement => {
  const translator: Translator = props.translator;
  const row: WorkflowVersionRow = toRow(props.version);
  const headline: WorkflowVersionText | null = getWorkflowVersionHeadline(row);
  const shown: { lines: Array<string>; moreCount: number } =
    getWorkflowVersionLines(row);

  return (
    <li
      className="flex items-start justify-between gap-3 py-4"
      data-testid={`workflow-version-${row.versionNumber}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {translator.translateTemplate(WorkflowVersionCopy.versionTitle, {
              number: translator.formatNumber(row.versionNumber),
            })}
          </span>
          {props.isNewest ? (
            <Pill
              text={WorkflowVersionCopy.current}
              color={Green}
              size={PillSize.Small}
            />
          ) : (
            <></>
          )}
        </div>
        <SavedByAndWhen version={props.version} translator={translator} />
        {headline ? (
          <p
            className="mt-2 text-sm text-gray-700"
            data-testid="workflow-version-headline"
          >
            {translator.translateTemplate(
              headline.template,
              typeof headline.versionNumber === "number"
                ? { number: translator.formatNumber(headline.versionNumber) }
                : {},
            )}
          </p>
        ) : (
          <></>
        )}
        {shown.lines.length > 0 ? (
          <ul
            className="mt-2 list-disc space-y-1 ps-5 text-sm text-gray-700"
            data-testid="workflow-version-changes"
          >
            {shown.lines.map((line: string, index: number) => {
              return (
                <li key={index} dir="auto" className="break-words">
                  {line}
                </li>
              );
            })}
          </ul>
        ) : (
          <></>
        )}
        {shown.moreCount > 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            {translator.translatePlural(
              WorkflowVersionCopy.moreChanges,
              shown.moreCount,
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
      {props.canPreview ? (
        <Button
          title={WorkflowVersionCopy.preview}
          icon={IconProp.Eye}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          className="shrink-0"
          dataTestId={`workflow-version-preview-${row.versionNumber}`}
          onClick={props.onPreview}
        />
      ) : (
        <></>
      )}
    </li>
  );
};

const WorkflowVersionHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * Anyone who may open the workflow may read its history. For someone who
   * may not change it, the builder hands the edit gate's reason, and the
   * history is a view, as the canvas is with the same reason: the preview a
   * row opens is there to be read, and offers no Restore.
   */
  const isViewOnly: boolean = Boolean(props.restoreDisabledReason);
  const [versions, setVersions] = useState<Array<WorkflowVersion>>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [previewed, setPreviewed] = useState<WorkflowVersion | null>(null);

  // A read that a newer one has replaced lands nowhere.
  const readRef: React.MutableRefObject<number> = useRef<number>(0);
  // How many versions the list shows, for a read after a save to keep them.
  const shownCountRef: React.MutableRefObject<number> = useRef<number>(0);
  shownCountRef.current = versions.length;

  const readVersions: (data: {
    skip: number;
    limit: number;
  }) => Promise<ListResult<WorkflowVersion>> = async (data: {
    skip: number;
    limit: number;
  }): Promise<ListResult<WorkflowVersion>> => {
    return await ModelAPI.getList<WorkflowVersion>({
      modelType: WorkflowVersion,
      query: {
        workflowId: props.workflowId,
      },
      skip: data.skip,
      limit: data.limit,
      select: VERSION_SELECT,
      sort: {
        versionNumber: SortOrder.Descending,
      },
    });
  };

  useEffect(() => {
    const read: number = ++readRef.current;

    const load: () => Promise<void> = async (): Promise<void> => {
      setError("");

      try {
        const result: ListResult<WorkflowVersion> = await readVersions({
          skip: 0,
          limit: Math.max(WORKFLOW_VERSIONS_PER_PAGE, shownCountRef.current),
        });

        if (read !== readRef.current) {
          return;
        }

        setVersions(result.data);
        setTotal(result.count);
      } catch (err) {
        if (read === readRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (read === readRef.current) {
        setIsLoading(false);
      }
    };

    void load();
  }, [props.refreshToken, props.workflowId.toString()]);

  const showMore: () => Promise<void> = async (): Promise<void> => {
    const read: number = ++readRef.current;
    setIsLoadingMore(true);

    try {
      const result: ListResult<WorkflowVersion> = await readVersions({
        skip: versions.length,
        limit: WORKFLOW_VERSIONS_PER_PAGE,
      });

      if (read === readRef.current) {
        setVersions([...versions, ...result.data]);
        setTotal(result.count);
      }
    } catch (err) {
      if (read === readRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    }

    if (read === readRef.current) {
      setIsLoadingMore(false);
    }
  };

  const newestVersionNumber: number | null =
    versions.length > 0 ? versions[0]?.versionNumber || null : null;

  const getList: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error && versions.length === 0) {
      return <ErrorMessage message={error} />;
    }

    if (versions.length === 0) {
      return (
        <p
          className="py-6 text-sm text-gray-500"
          data-testid="workflow-version-history-empty"
        >
          {translator.translateText(WorkflowVersionCopy.noVersions)}
        </p>
      );
    }

    return (
      <div>
        <ul
          className="divide-y divide-gray-200"
          data-testid="workflow-version-list"
        >
          {versions.map((version: WorkflowVersion) => {
            const versionNumber: number = version.versionNumber || 0;

            return (
              <VersionItem
                key={version._id || String(versionNumber)}
                version={version}
                isNewest={versionNumber === newestVersionNumber}
                canPreview={canPreviewWorkflowVersion({
                  versionNumber,
                  newestVersionNumber,
                })}
                onPreview={() => {
                  setPreviewed(version);
                }}
                translator={translator}
              />
            );
          })}
        </ul>
        {error ? <ErrorMessage message={error} /> : <></>}
        {versions.length < total ? (
          <div className="pt-2 pb-4">
            <Button
              title={WorkflowVersionCopy.showMore}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={isLoadingMore}
              dataTestId="workflow-version-history-show-more"
              onClick={() => {
                void showMore();
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <>
      <SideOver
        title={WorkflowVersionCopy.panelTitle}
        description={WorkflowVersionCopy.panelDescription}
        onClose={props.onClose}
      >
        <div data-testid="workflow-version-history">{getList()}</div>
      </SideOver>

      {previewed && previewed.id ? (
        <WorkflowViewOnlyContext.Provider value={isViewOnly}>
          <WorkflowVersionPreview
            workflowId={props.workflowId}
            versionId={previewed.id}
            versionNumber={previewed.versionNumber || 0}
            description={describeSavedByAndWhen(previewed, translator)}
            currentGraph={props.currentGraph}
            components={props.components}
            restoreDisabledReason={props.restoreDisabledReason}
            onRestore={(graph: JSONObject) => {
              props.onRestore({
                versionNumber: previewed.versionNumber || 0,
                graph,
              });
              setPreviewed(null);
            }}
            onClose={() => {
              setPreviewed(null);
            }}
          />
        </WorkflowViewOnlyContext.Provider>
      ) : (
        <></>
      )}
    </>
  );
};

export default WorkflowVersionHistory;
