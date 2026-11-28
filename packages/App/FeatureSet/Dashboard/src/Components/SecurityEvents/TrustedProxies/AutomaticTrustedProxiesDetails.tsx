import { fetchAutomaticTrustedProxies } from "./AutomaticTrustedProxiesApi";
import {
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
  PASS_ON_CLIENT_IP_NOT_PRESERVED,
  PASS_ON_CLIENT_IP_UNKNOWN,
  PASS_ON_DESCRIPTION,
  PASS_ON_DUALSTACK,
  PASS_ON_GOOGLE_FRONT_ENDS,
  PASS_ON_PROXY_ONLY_SUBNET,
  PASS_ON_RANGES_UNREAD,
  PASS_ON_TCP_LISTENER,
  PASS_ON_TITLE,
  PRIVATE_ADDRESSES_OFF,
  PRIVATE_ADDRESSES_ON,
  PRIVATE_ADDRESSES_TITLE,
  PRIVATE_ADDRESSES_WARNING,
  TRUSTED_PROXIES_TEST_IDS,
} from "../SecurityTrustedProxiesCopy";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  AutomaticPassOnLoadBalancer,
  AutomaticTrustedEdge,
  AutomaticTrustedGoogleFrontEndLoadBalancer,
  AutomaticTrustedGoogleFrontEnds,
  AutomaticTrustedLoadBalancer,
  AutomaticTrustedProxies,
  PRIVATE_PROXY_RANGES,
} from "Common/Types/SecurityEvent/AutomaticTrustedProxies";
import { formatList } from "Common/Types/Translator";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { OWN_LOAD_BALANCER_PRODUCT_NAMES } from "Common/Utils/SecurityEvent/OwnLoadBalancers";
import {
  PASS_ON_LOAD_BALANCER_PRODUCT_NAMES,
  PassOnReason,
} from "Common/Utils/SecurityEvent/PassOnLoadBalancers";
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
 *     that bring them, or what keeps them untrusted (#11047). A Google Cloud
 *     proxy-only subnet only Application Load Balancers connect from is one
 *     of these lines (#11389);
 *   - the second switch, Private Addresses (#11389,
 *     Project.securityTrustPrivateAddresses): whether an address that is
 *     nobody's on the internet is trusted unlisted, with those ranges, and
 *     while it is on, what it risks;
 *   - what is never trusted, even listed (#11389): where the project's load
 *     balancers that pass on what a client wrote connect from, each with
 *     why - a Google Cloud proxy Network Load Balancer, an AWS Network Load
 *     Balancer that does not keep the client's address, a Classic one with
 *     a TCP listener;
 *   - each edge the project connected (Cloudflare), with how many ranges it
 *     publishes;
 *   - what is never trusted automatically - hosts, nodes, probes - and what
 *     to do when one of them is the project's proxy.
 *
 * The edges and the load balancers are read once, when the card is drawn
 * (fetchAutomaticTrustedProxies); flipping a switch reads nothing. A read
 * that fails says so where the load balancers would be, and the rest - what
 * needs no reading - is said all the same.
 */

export interface ComponentProps {
  // Whether the project's own load balancers are trusted: the switch above.
  isOn: boolean;
  // The project, whose Private Addresses switch is drawn here.
  projectId: ObjectID;
  // Whether it trusts private addresses, as its record was read.
  trustsPrivateAddresses: boolean;
  // Told whenever Private Addresses moves, for the fold's chip.
  onPrivateAddressesChange?: ((isOn: boolean) => void) | undefined;
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

// Each reason's sentence, but the one that names target groups.
const PASS_ON_REASON_SENTENCES: Readonly<
  Record<Exclude<PassOnReason, PassOnReason.ClientIpNotPreserved>, string>
> = {
  [PassOnReason.ProxyOnlySubnet]: PASS_ON_PROXY_ONLY_SUBNET,
  [PassOnReason.GoogleFrontEnds]: PASS_ON_GOOGLE_FRONT_ENDS,
  [PassOnReason.Dualstack]: PASS_ON_DUALSTACK,
  [PassOnReason.ClientIpUnknown]: PASS_ON_CLIENT_IP_UNKNOWN,
  [PassOnReason.TcpListener]: PASS_ON_TCP_LISTENER,
};

// Why a load balancer passes on what a client wrote, one sentence a reason.
export function describePassOnReasons(
  loadBalancer: AutomaticPassOnLoadBalancer,
  translator: Translator,
): Array<string> {
  const said: Array<string> = loadBalancer.reasons.map(
    (reason: PassOnReason): string => {
      if (reason === PassOnReason.ClientIpNotPreserved) {
        return translator.translatePlural(
          PASS_ON_CLIENT_IP_NOT_PRESERVED,
          Math.max(1, loadBalancer.targetGroups.length),
          {
            targetGroups: formatList(loadBalancer.targetGroups, translator),
          },
        );
      }

      const sentence: string = PASS_ON_REASON_SENTENCES[reason];

      return translator.translateText(sentence) || sentence;
    },
  );

  if (loadBalancer.areRangesIncomplete) {
    said.push(
      translator.translateText(PASS_ON_RANGES_UNREAD) || PASS_ON_RANGES_UNREAD,
    );
  }

  return said;
}

const AutomaticTrustedProxiesDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [proxies, setProxies] = useState<AutomaticTrustedProxies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trustsPrivateAddresses, setTrustsPrivateAddresses] = useState<boolean>(
    props.trustsPrivateAddresses,
  );

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

  const passOnLoadBalancers: Array<AutomaticPassOnLoadBalancer> =
    proxies?.passOnLoadBalancers || [];

  return (
    <div data-testid={TRUSTED_PROXIES_TEST_IDS.automatic}>
      <div data-testid={TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers}>
        {loadBalancers}
      </div>

      <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
        <li className="py-3">
          <ModelSwitchRow<Project>
            modelType={Project}
            modelId={props.projectId}
            column="securityTrustPrivateAddresses"
            initialValue={props.trustsPrivateAddresses}
            title={PRIVATE_ADDRESSES_TITLE}
            getDescription={(isOn: boolean): string => {
              return isOn ? PRIVATE_ADDRESSES_ON : PRIVATE_ADDRESSES_OFF;
            }}
            getWarning={(isOn: boolean): ReactNode => {
              return isOn
                ? translator.translateText(PRIVATE_ADDRESSES_WARNING) ||
                    PRIVATE_ADDRESSES_WARNING
                : undefined;
            }}
            onChange={(isOn: boolean): void => {
              setTrustsPrivateAddresses(isOn);
              props.onPrivateAddressesChange?.(isOn);
            }}
            dataTestId={TRUSTED_PROXIES_TEST_IDS.privateAddressesSwitch}
          />
          <p
            className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs ${
              trustsPrivateAddresses ? "text-gray-700" : "text-gray-500"
            }`}
            data-testid={TRUSTED_PROXIES_TEST_IDS.privateAddressRanges}
            data-trusted={trustsPrivateAddresses ? "true" : "false"}
          >
            {PRIVATE_PROXY_RANGES.map((range: string): ReactElement => {
              return <span key={range}>{range}</span>;
            })}
          </p>
        </li>

        {passOnLoadBalancers.length > 0 ? (
          <DetailRow
            icon={IconProp.NoSymbol}
            title={translator.translateText(PASS_ON_TITLE) || PASS_ON_TITLE}
            description={
              translator.translateText(PASS_ON_DESCRIPTION) ||
              PASS_ON_DESCRIPTION
            }
            dataTestId={TRUSTED_PROXIES_TEST_IDS.passOn}
          >
            <ul className="divide-y divide-gray-100">
              {passOnLoadBalancers.map(
                (
                  loadBalancer: AutomaticPassOnLoadBalancer,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={`${loadBalancer.kind}-${loadBalancer.name}-${index}`}
                      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4"
                      data-testid={`${TRUSTED_PROXIES_TEST_IDS.passOn}-row`}
                    >
                      <span className="shrink-0 break-all font-mono text-sm text-gray-900 sm:w-56">
                        {loadBalancer.ranges.length > 0 ? (
                          loadBalancer.ranges.join(", ")
                        ) : (
                          <TableEmptyValue />
                        )}
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
                        {PASS_ON_LOAD_BALANCER_PRODUCT_NAMES[loadBalancer.kind]}
                        {loadBalancer.where ? (
                          <>
                            <InlineSeparator />
                            {loadBalancer.where}
                          </>
                        ) : (
                          <></>
                        )}
                        {describePassOnReasons(loadBalancer, translator).map(
                          (reason: string): ReactElement => {
                            return (
                              <span key={reason} className="block">
                                {reason}
                              </span>
                            );
                          },
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          </DetailRow>
        ) : (
          <></>
        )}

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
