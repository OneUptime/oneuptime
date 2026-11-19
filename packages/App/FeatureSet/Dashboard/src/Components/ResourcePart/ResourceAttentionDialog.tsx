import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ButtonSize,
  ButtonStyleType,
  OUTLINE_BUTTON_CLASS_NAME,
  OUTLINE_BUTTON_HOVER_CLASS_NAMES,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionCurrent,
  ResourceAttentionItem,
} from "./ResourceAttention";
import ResourceAttentionRow from "./ResourceAttentionRow";

/*
 * WHAT FAILED, AND WHY: THE DIALOG A COUNT OR A HEALTH PILL OPENS.
 *
 * "3 Failed" on a Kubernetes cluster's hero, "Degraded" beside a host's
 * name: a count or a state on its own tells the reader that something is
 * wrong, never what or why (#9537). Pressed, it opens this list - each part
 * that failed, the most urgent first, with why in the resource's own words,
 * which one it is (its namespace, its owner), since when, what the resource
 * reported about it lately, and View, a step from its own page.
 *
 * Shared by every resource product: a page hands it the parts it already
 * holds (items), or a read that fetches them when the dialog opens (load),
 * so a count that is rarely pressed costs nothing until it is. While the
 * read runs it draws the list's shape; a read that failed says why, with
 * Try again; a read that finds nothing any more says so in the page's
 * words (emptyMessage) - the count was read a moment before.
 *
 * It is read and left: one way out, Close, and no primary action.
 */

export interface ResourceAttentionDialogRead {
  items: Array<ResourceAttentionItem>;
  // More matched than one read lists: the most urgent are shown.
  isTruncated?: boolean | undefined;
}

export interface ComponentProps {
  /*
   * In the reader's words already, a count in it: "3 failed pods". A page
   * builds it with translatePlural, so it is never looked up again.
   */
  title: string;
  // What the list is, in English - one fixed sentence, looked up here.
  description?: string | undefined;
  // The parts, when the page holds them; else `load` reads them on open.
  items?: Array<ResourceAttentionItem> | undefined;
  load?: (() => Promise<ResourceAttentionDialogRead>) | undefined;
  // What it says when nothing matches any more, in English.
  emptyMessage: string;
  // What failed while reading, in English: "Couldn't read the failed pods."
  whatFailed?: string | undefined;
  // Prefix of its test ids.
  testId: string;
  onClose: () => void;
  // False when every row is the same kind of part (a list of pods).
  showKind?: boolean | undefined;
  /*
   * The part whose page this is, when the list is about it and what it
   * runs (its hero's status, pressed): its row reads "This node", as in
   * its Needs attention card, with no View - that is the page the reader
   * is on.
   */
  current?: ResourceAttentionCurrent | undefined;
}

// The View link's look: the shared plain button, tinted indigo for View.
export const RESOURCE_ATTENTION_VIEW_LINK_CLASS_NAME: string = `${OUTLINE_BUTTON_CLASS_NAME} ${
  OUTLINE_BUTTON_HOVER_CLASS_NAMES[ButtonStyleType.HOVER_PRIMARY_OUTLINE]
} ${ButtonSize.Small} flex-none gap-1 [@media(pointer:coarse)]:min-h-11`;

const ResourceAttentionDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [read, setRead] = useState<ResourceAttentionDialogRead | null>(
    props.items ? { items: props.items } : null,
  );
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(!props.items);
  // Only the newest read's answer counts: a slow first one never wins.
  const readCount: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * The page hands a new `load` each time it draws - an Overview draws
   * every few seconds while it refreshes - so the dialog reads once when
   * it opens, and again only on Try again, with the latest one handed.
   */
  const loadRef: React.MutableRefObject<
    (() => Promise<ResourceAttentionDialogRead>) | undefined
  > = useRef(props.load);
  loadRef.current = props.load;

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const loadItems: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const load: (() => Promise<ResourceAttentionDialogRead>) | undefined =
        loadRef.current;
      if (!load) {
        return;
      }
      const thisRead: number = ++readCount.current;
      setIsLoading(true);
      setError("");
      try {
        const result: ResourceAttentionDialogRead = await load();
        if (thisRead === readCount.current) {
          setRead(result);
        }
      } catch (err) {
        if (thisRead === readCount.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (thisRead === readCount.current) {
          setIsLoading(false);
        }
      }
    }, []);

  // Once, when the dialog opens: a read for what the page does not hold.
  useEffect(() => {
    if (!props.items) {
      void loadItems();
    }
  }, []);

  // What the page holds, kept current while the dialog is open.
  useEffect(() => {
    if (props.items) {
      setRead({ items: props.items });
      setIsLoading(false);
    }
  }, [props.items]);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !read) {
      return (
        <div data-testid={`${props.testId}-loading`}>
          <CardListSkeleton count={3} lines={2} />
        </div>
      );
    }

    if (error) {
      return (
        <div data-testid={`${props.testId}-error`}>
          <ErrorMessage
            message={error}
            whatFailed={props.whatFailed ? tx(props.whatFailed) : undefined}
            onRefreshClick={() => {
              void loadItems();
            }}
          />
        </div>
      );
    }

    const items: Array<ResourceAttentionItem> = read?.items || [];

    if (items.length === 0) {
      return (
        <div
          data-testid={`${props.testId}-empty`}
          className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-none text-emerald-500"
          />
          <span>{tx(props.emptyMessage)}</span>
        </div>
      );
    }

    const now: Date = new Date();

    return (
      <div>
        <ul
          data-testid={`${props.testId}-list`}
          className="divide-y divide-gray-100"
        >
          {items.map((item: ResourceAttentionItem): ReactElement => {
            const isCurrent: boolean = Boolean(
              props.current && props.current.key === item.key,
            );
            return (
              <li
                key={item.key}
                data-testid={`${props.testId}-item`}
                data-key={item.key}
                data-severity={item.severity}
                data-current={isCurrent ? "true" : undefined}
                className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"
              >
                <ResourceAttentionRow
                  item={item}
                  testId={props.testId}
                  showKind={props.showKind}
                  currentLabel={
                    isCurrent && props.current ? props.current.label : undefined
                  }
                  areFactsLinked={true}
                  now={now}
                />
                {item.route && !isCurrent ? (
                  <Link
                    to={item.route}
                    dataTestId={`${props.testId}-view`}
                    className={RESOURCE_ATTENTION_VIEW_LINK_CLASS_NAME}
                  >
                    <>
                      {tx("View")}
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-3.5 w-3.5"
                      />
                    </>
                  </Link>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
        {read?.isTruncated ? (
          <p
            data-testid={`${props.testId}-truncated`}
            className="mt-4 text-xs text-gray-500"
          >
            {translator.translatePlural(
              {
                one: "Showing the first {{count}}, the most urgent first.",
                other: "Showing the first {{count}}, the most urgent first.",
              },
              items.length,
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={props.title}
      isTitleTranslated={true}
      description={props.description}
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div data-testid={props.testId}>{renderBody()}</div>
    </Modal>
  );
};

export default ResourceAttentionDialog;
