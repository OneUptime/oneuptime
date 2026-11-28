import { fetchAutomaticTrustedProxies } from "./AutomaticTrustedProxiesApi";
import {
  ALWAYS_TRUSTED_DESCRIPTION,
  ALWAYS_TRUSTED_TITLE,
  EDGE_TRUSTED_DESCRIPTION,
  GOOGLE_FRONT_ENDS_FOR,
  GOOGLE_FRONT_ENDS_TITLE,
  GOOGLE_FRONT_ENDS_UNREAD,
  GOOGLE_FRONT_ENDS_WITHHELD,
  NEVER_TRUSTED_DESCRIPTION,
  NEVER_TRUSTED_TITLE,
  OWN_LOAD_BALANCERS_MORE,
  OWN_LOAD_BALANCERS_NONE,
  OWN_LOAD_BALANCERS_NOT_TRUSTED,
  OWN_LOAD_BALANCERS_UNREAD,
  TRUSTED_PROXIES_TEST_IDS,
} from "../SecurityTrustedProxiesCopy";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ALWAYS_TRUSTED_PROXY_RANGES,
  AutomaticTrustedEdge,
  AutomaticTrustedGoogleFrontEndLoadBalancer,
  AutomaticTrustedGoogleFrontEnds,
  AutomaticTrustedLoadBalancer,
  AutomaticTrustedProxies,
} from "Common/Types/SecurityEvent/AutomaticTrustedProxies";
import { formatList } from "Common/Types/Translator";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { OWN_LOAD_BALANCER_PRODUCT_NAMES } from "Common/Utils/SecurityEvent/OwnLoadBalancers";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * WHAT SECURITY EVENTS TRUSTS WITHOUT BEING TOLD, AND WHY (#10546): the
 * lines under Trusted Automatically's switch.
 *
 *   - the project's own load balancers, right under the switch they turn
 *     on and off: each address, then the load balancer's name, its kind as
 *     its cloud names the product, and the cloud account it is in - said
 *     not to be trusted while the switch is off - and on the last line
 *     Google's front ends, with the Google Cloud Application Load Balancers
 *     that bring them, or what keeps them untrusted (#11047);
 *   - the private addresses every project trusts, always, with their ranges;
 *   - each edge the project connected (Cloudflare), with how many ranges it
 *     publishes;
 *   - what is never trusted automatically - hosts, nodes, probes - and what
 *     to do when one of them is the project's proxy.
 *
 * The edges and the load balancers are read once, when the card is drawn
 * (fetchAutomaticTrustedProxies); flipping the switch reads nothing. A read
 * that fails says so where the load balancers would be, and the rest - what
 * needs no reading - is said all the same.
 */

export interface ComponentProps {
  // Whether the project's own load balancers are trusted: the switch above.
  isOn: boolean;
}

function DetailRow(props: {
  icon: IconProp;
  title: string;
  description: string;
  dataTestId: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <li className="flex items-start gap-3 py-3" data-testid={props.dataTestId}>
      <Icon
        icon={props.icon}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-gray-900">{props.title}</p>
        <p className="text-sm text-gray-600">{props.description}</p>
        {props.children}
      </div>
    </li>
  );
}

const AutomaticTrustedProxiesDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [proxies, setProxies] = useState<AutomaticTrustedProxies | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchAutomaticTrustedProxies()
      .then((read: AutomaticTrustedProxies) => {
        if (isCurrent) {
          setProxies(read);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(caught));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const loadBalancers: ReactElement = ((): ReactElement => {
    if (error) {
      return (
        <div className="text-sm text-gray-600">
          <ErrorInSentence message={error} showWhereToLook={true} />
        </div>
      );
    }

    if (!proxies) {
      return <TableSkeleton rows={2} columns={2} hasHeader={false} />;
    }

    if (!proxies.areLoadBalancersRead) {
      return (
        <p className="text-sm text-gray-600">
          {translator.translateText(OWN_LOAD_BALANCERS_UNREAD)}
        </p>
      );
    }

    const googleFrontEnds: AutomaticTrustedGoogleFrontEnds | null =
      proxies.googleFrontEnds;

    if (proxies.loadBalancers.length === 0 && !googleFrontEnds) {
      return (
        <p className="text-sm text-gray-600">
          {translator.translateText(OWN_LOAD_BALANCERS_NONE)}
        </p>
      );
    }

    // Load balancers by their names, as the reader's language lists names.
    const namesOf: (
      loadBalancers: Array<AutomaticTrustedGoogleFrontEndLoadBalancer>,
    ) => string = (
      loadBalancers: Array<AutomaticTrustedGoogleFrontEndLoadBalancer>,
    ): string => {
      return formatList(
        loadBalancers
          .map((loadBalancer: AutomaticTrustedGoogleFrontEndLoadBalancer) => {
            return loadBalancer.name;
          })
          .filter(Boolean),
        translator,
      );
    };

    /*
     * Why Google's front ends are trusted, or are not: the load balancers
     * that bring them; a TCP or SSL proxy that keeps them untrusted; a read
     * that may have left one out.
     */
    const googleFrontEndsWhy: string = ((): string => {
      if (!googleFrontEnds) {
        return "";
      }

      if (googleFrontEnds.withheldBy.length > 0) {
        return translator.translatePlural(
          GOOGLE_FRONT_ENDS_WITHHELD,
          googleFrontEnds.withheldBy.length,
          { loadBalancers: namesOf(googleFrontEnds.withheldBy) },
        );
      }

      if (googleFrontEnds.isWithheldForIncompleteRead) {
        return (
          translator.translateText(GOOGLE_FRONT_ENDS_UNREAD) ||
          GOOGLE_FRONT_ENDS_UNREAD
        );
      }

      return translator.translateTemplate(GOOGLE_FRONT_ENDS_FOR, {
        loadBalancers: namesOf(googleFrontEnds.broughtBy),
      });
    })();

    return (
      <div className="space-y-2">
        <ul className="divide-y divide-gray-100">
          {proxies.loadBalancers.map(
            (
              loadBalancer: AutomaticTrustedLoadBalancer,
              index: number,
            ): ReactElement => {
              return (
                <li
                  key={`${loadBalancer.kind}-${loadBalancer.name}-${index}`}
                  className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4"
                  data-testid={`${TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers}-row`}
                >
                  <span className="shrink-0 break-all font-mono text-sm text-gray-900 sm:w-56">
                    {loadBalancer.addresses.join(", ")}
                  </span>
                  <span className="text-sm text-gray-600">
                    {loadBalancer.name ? (
                      <>
                        <span className="text-gray-900">
                          {loadBalancer.name}
                        </span>
                        <InlineSeparator />
                      </>
                    ) : (
                      <></>
                    )}
                    {OWN_LOAD_BALANCER_PRODUCT_NAMES[loadBalancer.kind]}
                    {loadBalancer.where ? (
                      <>
                        <InlineSeparator />
                        {loadBalancer.where}
                      </>
                    ) : (
                      <></>
                    )}
                  </span>
                </li>
              );
            },
          )}
          {googleFrontEnds ? (
            <li
              className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4"
              data-testid={TRUSTED_PROXIES_TEST_IDS.googleFrontEnds}
              data-trusted={googleFrontEnds.isTrusted ? "true" : "false"}
            >
              <span className="shrink-0 break-all font-mono text-sm text-gray-900 sm:w-56">
                {googleFrontEnds.ranges.join(", ")}
              </span>
              <span className="text-sm text-gray-600">
                <span className="text-gray-900">
                  {translator.translateText(GOOGLE_FRONT_ENDS_TITLE) ||
                    GOOGLE_FRONT_ENDS_TITLE}
                </span>
                <InlineSeparator />
                {googleFrontEndsWhy}
              </span>
            </li>
          ) : (
            <></>
          )}
        </ul>
        {!props.isOn ? (
          <p className="text-xs text-gray-500">
            {translator.translateText(OWN_LOAD_BALANCERS_NOT_TRUSTED)}
          </p>
        ) : (
          <></>
        )}
        {!proxies.areLoadBalancersComplete ? (
          <p className="text-xs text-gray-500">
            {translator.translateText(OWN_LOAD_BALANCERS_MORE)}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  })();

  return (
    <div data-testid={TRUSTED_PROXIES_TEST_IDS.automatic}>
      <div data-testid={TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers}>
        {loadBalancers}
      </div>

      <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
        <DetailRow
          icon={IconProp.Lock}
          title={
            translator.translateText(ALWAYS_TRUSTED_TITLE) ||
            ALWAYS_TRUSTED_TITLE
          }
          description={
            translator.translateText(ALWAYS_TRUSTED_DESCRIPTION) ||
            ALWAYS_TRUSTED_DESCRIPTION
          }
          dataTestId={TRUSTED_PROXIES_TEST_IDS.alwaysTrusted}
        >
          <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-gray-700">
            {ALWAYS_TRUSTED_PROXY_RANGES.map((range: string): ReactElement => {
              return <span key={range}>{range}</span>;
            })}
          </p>
        </DetailRow>

        {(proxies?.edges || []).map((edge: AutomaticTrustedEdge) => {
          return (
            <DetailRow
              key={edge.name}
              icon={IconProp.Cloud}
              title={edge.name}
              description={translator.translatePlural(
                EDGE_TRUSTED_DESCRIPTION,
                edge.rangeCount,
              )}
              dataTestId={TRUSTED_PROXIES_TEST_IDS.edges}
            />
          );
        })}

        <DetailRow
          icon={IconProp.NoSymbol}
          title={
            translator.translateText(NEVER_TRUSTED_TITLE) || NEVER_TRUSTED_TITLE
          }
          description={
            translator.translateText(NEVER_TRUSTED_DESCRIPTION) ||
            NEVER_TRUSTED_DESCRIPTION
          }
          dataTestId={TRUSTED_PROXIES_TEST_IDS.neverTrusted}
        />
      </ul>
    </div>
  );
};

export default AutomaticTrustedProxiesDetails;
