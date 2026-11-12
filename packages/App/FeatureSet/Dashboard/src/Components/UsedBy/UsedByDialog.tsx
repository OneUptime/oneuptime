import UsedByApi from "./UsedByApi";
import UsedByGroups, { UsedByRowList } from "./UsedByRows";
import UsedByEmpty from "./UsedByEmpty";
import UsedByError from "./UsedByError";
import useUsedBySummary, { UseUsedBySummaryResult } from "./useUsedBySummary";
import {
  BACK_TO_ALL,
  CLOSE,
  COULD_NOT_LOAD_USED_BY,
  LOADING_USED_BY,
  SHOW_MORE,
  USED_BY_CARD_WORDS,
  getUsedByHiddenNote,
  getUsedByImpactSentence,
  getUsedByRelationTitle,
} from "./UsedByWords";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import ObjectID from "Common/Types/ObjectID";
import {
  USED_BY_PAGE_SIZE,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRow,
  UsedByRowKind,
  getUsedByRowKind,
  isUsedByNothing,
} from "Common/Types/UsedBy/UsedBy";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE FULL LIST OF WHAT REFERS TO A RECORD ("See all", #6813): one
 * relation's rows, a page at a time, read as they are asked for - so a
 * record used by thousands opens with fifty and reads fifty more on "Show
 * more". Opened without a relation (a label's Used by on Settings >
 * Labels), it lists every kind first, and "See all" moves to one kind's
 * rows with a way back.
 *
 * A short read that returns the person where they were: a dialog, not a
 * page (Docs/ux/README.md#dialogs-and-confirmations). Its one button
 * closes it.
 */

export interface ComponentProps {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  // The relation to list; without it, every kind is listed first.
  relation?: UsedByRelation | undefined;
  onClose: () => void;
}

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      rows: Array<UsedByRow>;
      count: number;
      hiddenCount: number;
      isLoadingMore: boolean;
      moreError: string;
    };

const RelationRows: FunctionComponent<{
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  relation: UsedByRelation;
}> = (props: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  relation: UsedByRelation;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState<number>(0);
  const recordIdString: string = props.recordId.toString();
  const isCurrent: MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isCurrent.current = true;

    return () => {
      isCurrent.current = false;
    };
  }, []);

  const readPage: (skip: number) => Promise<UsedByPage> = (
    skip: number,
  ): Promise<UsedByPage> => {
    return UsedByApi.getPage({
      recordKind: props.recordKind,
      recordId: new ObjectID(recordIdString),
      relation: props.relation,
      skip: skip,
      limit: USED_BY_PAGE_SIZE,
    });
  };

  useEffect(() => {
    let isThisRead: boolean = true;
    setState({ status: "loading" });

    readPage(0)
      .then((page: UsedByPage) => {
        if (isThisRead) {
          setState({
            status: "loaded",
            rows: page.rows,
            count: page.count,
            hiddenCount: page.hiddenCount,
            isLoadingMore: false,
            moreError: "",
          });
        }
      })
      .catch((error: unknown) => {
        if (isThisRead) {
          setState({
            status: "error",
            message:
              error instanceof Error && error.message
                ? error.message
                : COULD_NOT_LOAD_USED_BY,
          });
        }
      });

    return () => {
      isThisRead = false;
    };
  }, [props.recordKind, recordIdString, props.relation, retryCount]);

  if (state.status === "loading") {
    return (
      <div
        role="status"
        aria-label={translator.translateText(LOADING_USED_BY)}
        className="space-y-2 animate-pulse"
        data-testid="used-by-dialog-loading"
      >
        <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        <div className="h-4 w-1/2 rounded bg-gray-100"></div>
        <div className="h-4 w-3/5 rounded bg-gray-100"></div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <UsedByError
        message={state.message}
        onTryAgain={() => {
          setRetryCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  }

  const loaded: Extract<PageState, { status: "loaded" }> = state;
  const hiddenNote: string = getUsedByHiddenNote(loaded, translator);
  const hasMore: boolean = loaded.rows.length < loaded.count;

  const showMore: () => void = (): void => {
    setState({ ...loaded, isLoadingMore: true, moreError: "" });

    readPage(loaded.rows.length)
      .then((page: UsedByPage) => {
        if (!isCurrent.current) {
          return;
        }

        const seen: Set<string> = new Set<string>(
          loaded.rows.map((row: UsedByRow): string => {
            return row.id;
          }),
        );

        setState({
          status: "loaded",
          rows: [
            ...loaded.rows,
            ...page.rows.filter((row: UsedByRow): boolean => {
              return !seen.has(row.id);
            }),
          ],
          count: page.count,
          hiddenCount: page.hiddenCount,
          isLoadingMore: false,
          moreError: "",
        });
      })
      .catch((error: unknown) => {
        if (!isCurrent.current) {
          return;
        }

        setState({
          ...loaded,
          isLoadingMore: false,
          moreError:
            error instanceof Error && error.message
              ? error.message
              : COULD_NOT_LOAD_USED_BY,
        });
      });
  };

  return (
    <div data-testid="used-by-dialog-rows">
      <p className="text-sm text-gray-700" data-testid="used-by-dialog-impact">
        {getUsedByImpactSentence(
          { relation: props.relation, ...loaded },
          translator,
        )}
      </p>
      <div className="mt-3 max-h-[60vh] overflow-y-auto">
        <UsedByRowList
          rows={loaded.rows}
          rowKind={getRowKindOf(props.relation)}
        />
      </div>
      {hiddenNote ? (
        <p className="mt-2 text-xs text-gray-500" data-testid="used-by-hidden">
          {hiddenNote}
        </p>
      ) : (
        <></>
      )}
      {loaded.moreError ? (
        <div className="mt-2">
          <UsedByError message={loaded.moreError} onTryAgain={showMore} />
        </div>
      ) : (
        <></>
      )}
      {hasMore && !loaded.moreError ? (
        <button
          type="button"
          className={`mt-3 text-sm font-medium text-indigo-700 ${getHandDrawnButtonStateClassName(
            {
              isBusy: loaded.isLoadingMore,
              hoverClassName: "hover:underline",
            },
          )}`}
          data-testid="used-by-show-more"
          disabled={loaded.isLoadingMore}
          aria-busy={loaded.isLoadingMore}
          onClick={showMore}
        >
          {translator.translateText(SHOW_MORE)}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

// What a relation's rows are, as the kinds list it.
function getRowKindOf(relation: UsedByRelation): UsedByRowKind {
  return getUsedByRowKind(relation) || UsedByRowKind.Monitor;
}

const EverythingThatUsesIt: FunctionComponent<{
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  onSeeAll: (relation: UsedByRelation) => void;
}> = (props: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  onSeeAll: (relation: UsedByRelation) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const used: UseUsedBySummaryResult = useUsedBySummary({
    recordKind: props.recordKind,
    recordId: props.recordId,
  });

  if (used.state.status === "loading") {
    return (
      <div
        role="status"
        aria-label={translator.translateText(LOADING_USED_BY)}
        className="space-y-2 animate-pulse"
        data-testid="used-by-dialog-loading"
      >
        <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        <div className="h-4 w-1/2 rounded bg-gray-100"></div>
      </div>
    );
  }

  if (used.state.status === "error") {
    return <UsedByError message={used.state.message} onTryAgain={used.retry} />;
  }

  if (isUsedByNothing(used.state.summary)) {
    return <UsedByEmpty recordKind={props.recordKind} />;
  }

  return (
    <UsedByGroups summary={used.state.summary} onSeeAll={props.onSeeAll} />
  );
};

const UsedByDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [relation, setRelation] = useState<UsedByRelation | undefined>(
    props.relation,
  );

  // Opened on one relation, or moved to one from everything.
  useEffect(() => {
    ProductEvents.send(ProductEventName.UsedByListOpened, {
      record_kind: props.recordKind,
      relation: relation || "all",
    });
  }, [relation]);

  const title: string = relation
    ? getUsedByRelationTitle(relation, translator)
    : USED_BY_CARD_WORDS[props.recordKind].title;

  return (
    <Modal
      title={title}
      description={
        relation ? undefined : USED_BY_CARD_WORDS[props.recordKind].description
      }
      onClose={props.onClose}
      /*
       * A list to read: its one button closes it (no Cancel beside a
       * Close - two ways out), as do the header's X and Escape.
       */
      closeButtonText={CLOSE}
      modalWidth={ModalWidth.Medium}
    >
      <div data-testid="used-by-dialog">
        {relation && !props.relation ? (
          <button
            type="button"
            className="mb-3 text-sm font-medium text-indigo-700 hover:underline"
            data-testid="used-by-back"
            onClick={() => {
              setRelation(undefined);
            }}
          >
            {translator.translateText(BACK_TO_ALL)}
          </button>
        ) : (
          <></>
        )}
        {relation ? (
          <RelationRows
            recordKind={props.recordKind}
            recordId={props.recordId}
            relation={relation}
          />
        ) : (
          <EverythingThatUsesIt
            recordKind={props.recordKind}
            recordId={props.recordId}
            onSeeAll={(next: UsedByRelation) => {
              setRelation(next);
            }}
          />
        )}
      </div>
    </Modal>
  );
};

export default UsedByDialog;
