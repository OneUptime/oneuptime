import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceTopologyMap, {
  ResourceTopologyArrangement,
} from "./ResourceTopologyMap";
import { tx } from "./ResourceTopologyNodes";

/*
 * A resource's Topology page: its map in a card, with what it takes to get
 * there — a loader, an error you can retry, and an empty state that says
 * when the map will appear — plus a way back to the resource on the master
 * Topology, and a refresh that keeps the view where it is.
 */

export interface ResourceTopologyData {
  arrangements: Array<ResourceTopologyArrangement>;
  issuesArePartial: boolean;
  /* Open incidents or alerts could not be read: the map may miss some. */
  issuesAreUnreadable?: boolean | undefined;
  /* The resource on the master Topology, when it is drawn there. */
  masterTopologyRoute: Route | null;
}

export interface ComponentProps {
  load: () => Promise<ResourceTopologyData>;
  /* Under the card's title: what this map shows. */
  description: string;
  searchPlaceholder: string;
  /* Why there is nothing to draw yet, and what makes it appear. */
  emptyDescription: string;
  emptyActionRoute?: Route | undefined;
  /* The words of that link: "Set up the VMware agent". */
  actionText?: string | undefined;
}

type LoadState = "loading" | "ready" | "error";

const ResourceTopologyPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<ResourceTopologyData | null>(null);
  const [error, setError] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const loadRef: React.MutableRefObject<() => Promise<ResourceTopologyData>> =
    useRef<() => Promise<ResourceTopologyData>>(props.load);
  loadRef.current = props.load;
  const generation: React.MutableRefObject<number> = useRef<number>(0);

  const load: (refresh: boolean) => Promise<void> = useCallback(
    async (refresh: boolean): Promise<void> => {
      const current: number = ++generation.current;

      if (refresh) {
        setIsRefreshing(true);
      } else {
        setState("loading");
      }

      try {
        const result: ResourceTopologyData = await loadRef.current();

        if (current !== generation.current) {
          return;
        }

        setData(result);
        setState("ready");
      } catch (err) {
        if (current !== generation.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));

        // A failed refresh keeps the map that is on screen.
        if (!refresh) {
          setState("error");
        }
      } finally {
        if (current === generation.current) {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    load(false).catch(() => {
      // load reports its own errors
    });

    return () => {
      generation.current++;
    };
  }, []);

  const hasParts: boolean = Boolean(
    data?.arrangements.some((arrangement: ResourceTopologyArrangement) => {
      return arrangement.graph.nodes.size > 1;
    }),
  );

  const buttons: Array<ReactElement> = [];

  if (data?.masterTopologyRoute) {
    buttons.push(
      <Link
        key="master"
        to={data.masterTopologyRoute}
        dataTestId="resource-topology-master-link"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <>
          <Icon icon={IconProp.FlowDiagram} className="h-4 w-4" />
          {tx("Open in Topology", translator)}
        </>
      </Link>,
    );
  }

  if (state === "ready") {
    buttons.push(
      <button
        key="refresh"
        type="button"
        data-testid="resource-topology-refresh"
        aria-label={tx("Refresh topology", translator)}
        title={tx("Refresh topology", translator)}
        disabled={isRefreshing}
        className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        onClick={() => {
          load(true).catch(() => {
            // load reports its own errors
          });
        }}
      >
        <Icon
          icon={IconProp.Refresh}
          className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
        />
      </button>,
    );
  }

  const renderBody: () => ReactElement = (): ReactElement => {
    if (state === "loading") {
      return (
        <div role="status" aria-live="polite" className="py-12">
          <ComponentLoader />
          <p className="mt-2 text-center text-sm text-gray-500">
            {tx("Loading topology…", translator)}
          </p>
        </div>
      );
    }

    if (state === "error" || !data) {
      // The way forward sits centred under the message, as on every list.
      return (
        <div role="alert" data-testid="resource-topology-error">
          <ErrorMessage
            message={error || tx("Could not load the topology.", translator)}
            action={
              <button
                type="button"
                data-testid="resource-topology-retry"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                onClick={() => {
                  load(false).catch(() => {
                    // load reports its own errors
                  });
                }}
              >
                {tx("Try again", translator)}
              </button>
            }
          />
        </div>
      );
    }

    if (!hasParts) {
      return (
        <EmptyState
          id="resource-topology-empty"
          icon={IconProp.FlowDiagram}
          title="Nothing to draw yet"
          description={props.emptyDescription}
          footer={
            props.emptyActionRoute && props.actionText ? (
              <Link
                to={props.emptyActionRoute}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {tx(props.actionText, translator)}
              </Link>
            ) : undefined
          }
        />
      );
    }

    return (
      <ResourceTopologyMap
        arrangements={data.arrangements}
        searchPlaceholder={props.searchPlaceholder}
        issuesArePartial={data.issuesArePartial}
        issuesAreUnreadable={data.issuesAreUnreadable}
      />
    );
  };

  return (
    <Card title="Topology" description={props.description} buttons={buttons}>
      {renderBody()}
    </Card>
  );
};

export default ResourceTopologyPage;
