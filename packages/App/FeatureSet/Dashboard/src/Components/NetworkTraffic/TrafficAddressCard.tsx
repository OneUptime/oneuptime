import NetworkAddressNameModal from "./NetworkAddressNameModal";
import {
  TRAFFIC_ADDRESS_SOURCE_LABELS,
  TrafficAddressLabel,
  getTrafficAddressText,
  hasRecordPage,
} from "./NetworkTrafficAddressNames";
import { TrafficAddressText } from "./TrafficAddress";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkAddressNameSource } from "Common/Types/NetFlow/NetworkAddressName";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  SentencePart,
  Translator,
  getSentenceParts,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * WHO AN ADDRESS IS, when a Traffic page is narrowed to it (issue #5340):
 * its name and where the name comes from ("Host", "DNS name", "Address
 * name"), the address - copyable - and the subnet it is in, with the next
 * step beside it:
 *
 *   - a name the project's inventory gives (a device, a host, a cloud
 *     resource) lives on that record: Open host, Open device...;
 *   - an address with no name, or only a DNS name, can be given one: Name
 *     this address;
 *   - a name someone gave it is changed where Address Names are kept,
 *     Network > Settings > Address Names: Edit in Settings goes there.
 *
 * Shown for one address at a time - "to or from", "from" or "to" alone - so
 * it never crowds a page that is not about one address.
 */

export interface ComponentProps {
  label: TrafficAddressLabel;
  // The reader may add Address Names.
  canName: boolean;
  // The reader may change them.
  canEditNames: boolean;
  // A name was saved: the page reads its names again.
  onNamed: () => void;
}

const SOURCE_ICONS: Record<NetworkAddressNameSource, IconProp> = {
  [NetworkAddressNameSource.AddressName]: IconProp.Label,
  [NetworkAddressNameSource.NetworkDevice]: IconProp.Signal,
  [NetworkAddressNameSource.Host]: IconProp.ServerStack,
  [NetworkAddressNameSource.CloudResource]: IconProp.Cloud,
  [NetworkAddressNameSource.KubernetesNode]: IconProp.Kubernetes,
  [NetworkAddressNameSource.KubernetesPod]: IconProp.Kubernetes,
  [NetworkAddressNameSource.Dns]: IconProp.Globe,
};

// Where the record the name is opens, when it is a page of the project's.
export function getRecordRoute(label: TrafficAddressLabel): Route | null {
  if (!hasRecordPage(label) || !label.resourceId) {
    return null;
  }

  const page: PageMap | null =
    label.source === NetworkAddressNameSource.NetworkDevice
      ? PageMap.NETWORK_DEVICE_VIEW
      : label.source === NetworkAddressNameSource.Host
        ? PageMap.HOST_VIEW
        : label.source === NetworkAddressNameSource.CloudResource
          ? PageMap.CLOUD_RESOURCE_VIEW
          : null;

  if (!page || !ObjectID.isValidUUID(label.resourceId)) {
    return null;
  }

  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(label.resourceId),
  });
}

/*
 * Whether the page offers to name the address: when nothing names it, or
 * only DNS does (a friendlier name helps). A name the inventory gives is
 * changed on its record, and one someone gave on Address Names.
 */
export function canNameAddress(label: TrafficAddressLabel): boolean {
  return !label.source || label.source === NetworkAddressNameSource.Dns;
}

// Where a name someone gave is changed: Network > Settings > Address Names.
export function getAddressNamesRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES] as Route,
  );
}

// Where the address is: a subnet someone named.
export const ADDRESS_IN_SUBNET: string = translationKey("In {{subnet}}");

/*
 * The card's links: words with a tint under the pointer. On a phone, where
 * they wrap under the address, their words start where the card's do.
 */
const CARD_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 max-sm:-ml-2";

const RECORD_LINK_TEXT: Partial<Record<NetworkAddressNameSource, string>> = {
  [NetworkAddressNameSource.NetworkDevice]: translationKey("Open device"),
  [NetworkAddressNameSource.Host]: translationKey("Open host"),
  [NetworkAddressNameSource.CloudResource]: translationKey(
    "Open cloud resource",
  ),
};

const TrafficAddressCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isNaming, setIsNaming] = useState<boolean>(false);
  const label: TrafficAddressLabel = props.label;
  const recordRoute: Route | null = getRecordRoute(label);
  const showNameButton: boolean = canNameAddress(label) && props.canName;
  const showEditInSettings: boolean =
    label.source === NetworkAddressNameSource.AddressName && props.canEditNames;

  const copyButton: ReactElement = (
    <CopyTextButton
      textToBeCopied={label.address}
      iconOnly={true}
      size="xs"
      title="Copy the address"
    />
  );

  // What the card says after the address: where the name is from, and the subnet.
  const facts: Array<ReactElement> = [
    <span key="source" data-testid="traffic-address-card-source">
      {label.source
        ? translator.translateText(TRAFFIC_ADDRESS_SOURCE_LABELS[label.source])
        : translator.translateText("No name yet")}
    </span>,
  ];

  if (label.subnetName) {
    // "In Mumbai office": the subnet's name as someone wrote it, the subnet under the pointer.
    facts.push(
      <span
        key="subnet"
        title={label.subnet || undefined}
        data-testid="traffic-address-card-subnet"
      >
        {getSentenceParts({
          translator: translator,
          template: ADDRESS_IN_SUBNET,
          slots: ["subnet"],
        }).map((part: SentencePart, index: number): ReactElement => {
          return part.kind === "slot" ? (
            <IsolatedText key={index} text={label.subnetName || ""} />
          ) : (
            <Fragment key={index}>{part.text}</Fragment>
          );
        })}
      </span>,
    );
  }

  return (
    <div
      className="mb-5 flex flex-col gap-3 rounded-lg bg-gray-50 px-4 py-3 ring-1 ring-inset ring-gray-200 sm:flex-row sm:items-center sm:justify-between"
      data-testid="traffic-address-card"
    >
      {/*
       * What the name is, in a tile beside both lines, so the address
       * line starts under the name, not under the icon.
       */}
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-white text-gray-500 ring-1 ring-inset ring-gray-200"
          data-testid="traffic-address-card-icon"
        >
          <Icon
            icon={label.source ? SOURCE_ICONS[label.source] : IconProp.Hashtag}
            className="h-4 w-4"
          />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {/*
             * The page's subject: a long name wraps (after its own dots
             * first) rather than being cut on a phone, two lines at most.
             */}
            <span
              className="line-clamp-2 min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
              title={getTrafficAddressText(label)}
              data-testid="traffic-address-card-name"
            >
              {label.name ? (
                <IsolatedText text={label.name} breaksLikeAName={true} />
              ) : (
                <TrafficAddressText address={label.address} />
              )}
            </span>
            {label.name ? <></> : copyButton}
          </div>
          <div
            className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500"
            data-testid="traffic-address-card-details"
          >
            {label.name ? (
              <span className="inline-flex items-center gap-x-1.5">
                <TrafficAddressText
                  address={label.address}
                  className="text-gray-700"
                />
                {copyButton}
              </span>
            ) : (
              <></>
            )}
            {/*
             * Where the name is from, and the subnet: after the address and
             * its copy button where there is room, on a line of their own
             * where there is not (always on a phone) - with no separator a
             * wrap could leave at the start of a line.
             */}
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 max-sm:basis-full">
              {facts.map((fact: ReactElement, index: number): ReactElement => {
                return (
                  <Fragment key={index}>
                    {index > 0 ? <span aria-hidden="true">·</span> : <></>}
                    {fact}
                  </Fragment>
                );
              })}
            </span>
          </div>
        </div>
      </div>
      {recordRoute || showNameButton || showEditInSettings ? (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 max-sm:pl-12">
          {recordRoute && label.source ? (
            <AppLink
              to={recordRoute}
              className={CARD_LINK_CLASS_NAME}
              dataTestId="traffic-address-card-open"
            >
              <span>
                {translator.translateText(
                  RECORD_LINK_TEXT[label.source] || "Open",
                )}
              </span>
              <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
            </AppLink>
          ) : (
            <></>
          )}
          {showEditInSettings ? (
            <AppLink
              to={getAddressNamesRoute()}
              className={CARD_LINK_CLASS_NAME}
              dataTestId="traffic-address-card-edit-in-settings"
            >
              <Icon icon={IconProp.Settings} className="h-3.5 w-3.5" />
              <span>{translator.translateText("Edit in Settings")}</span>
            </AppLink>
          ) : (
            <></>
          )}
          {showNameButton ? (
            <Button
              title="Name this address"
              icon={IconProp.Label}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setIsNaming(true);
              }}
              dataTestId="traffic-address-card-name-button"
            />
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {isNaming ? (
        <NetworkAddressNameModal
          address={label.address}
          onClose={() => {
            setIsNaming(false);
          }}
          onSaved={() => {
            setIsNaming(false);
            props.onNamed();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default TrafficAddressCard;
