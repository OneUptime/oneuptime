import {
  CustomDomainKind,
  CustomDomainModel,
  getCustomDomainInstallation,
} from "./CustomDomainKinds";
import CustomDomainDnsSetupModal from "./CustomDomainDnsSetupModal";
import {
  CustomDomainCopy,
  CustomDomainInstallation,
  CustomDomainState,
  getCustomDomainState,
} from "./CustomDomainCopy";
import PublicAddressCopy, {
  getAddressText,
  getNotLiveReason,
  getPublicAddresses,
  isCertificateNeededFor,
  isDnsSetupOffered,
  PUBLIC_ADDRESS_TEST_IDS,
  PublicAddress,
  PublicAddressKind,
} from "./PublicAddressCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "Common/Types/CustomDomain/CustomDomainCertificates";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Every address a status page, a public dashboard or a form answers at: its
 * custom domains first, then its address on OneUptime's own domain. Drawn
 * the same on a status page's Overview (the Status Page Link card), under a
 * dashboard's public choice on its Sharing page, and on a form's Share page
 * (the Share Link card). The rules - what is live,
 * the order, what a domain that is not live yet says - are in
 * PublicAddressCopy.
 *
 * - A live address is a link that opens in a new tab, with Copy link.
 * - A custom domain that is not live yet is not a link: it says so, and why,
 *   in the words of its row on the Custom Domains page - with DNS Setup,
 *   the same dialog that page opens, when there is something to do. Check
 *   now there reads the domains again.
 * - With no custom domain, one quiet line offers to add one, for whoever
 *   may add one, where the installation has custom domains of this kind.
 * - The domains are read only for someone who may read them; for anyone
 *   else the list is the OneUptime address alone. While they are read the
 *   list shows the shape of a row; when the read fails it shows the
 *   OneUptime address, says the custom domains could not be loaded, and
 *   offers to try again.
 */

export interface ComponentProps {
  // Whose custom domains: a status page's, a dashboard's or a form's.
  kind: CustomDomainKind;
  // The status page, dashboard or form.
  parentId: ObjectID;
  // Its address on OneUptime's own domain, which always works.
  oneUptimeUrl: URL;
  // Its Custom Domains page, where a domain is added.
  customDomainsRoute: Route;
  // A domain of the kind people use, for "such as status.example.com".
  exampleDomain: string;
  /*
   * A line about every address, right under them - before the offer to add
   * a domain, which is the least of what the list says.
   */
  note?: ReactNode | undefined;
}

enum LoadState {
  Loading = "Loading",
  Loaded = "Loaded",
  // The viewer may not read the custom domains: none are asked for.
  NotRead = "NotRead",
  Failed = "Failed",
}

// The columns a row needs: its name, its state, and DNS Setup's.
const DOMAIN_SELECT: Select<CustomDomainModel> = {
  _id: true,
  fullDomain: true,
  subdomain: true,
  isCnameVerified: true,
  isSslOrdered: true,
  isSslProvisioned: true,
  isCustomCertificate: true,
};

const DOMAIN_SORT: Sort<CustomDomainModel> = {
  fullDomain: SortOrder.Ascending,
};

// DNS Setup on a row: the size of Copy link (CopyTextButton, size sm).
const ROW_ACTION_CLASS_NAME: string =
  "inline-flex items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * A live address: only as wide as its words, so a click on the empty space
 * beside it opens nothing. The keyboard's focus ring is drawn inside its
 * line, round a little padding the negative margin gives back, so it never
 * covers the line under it.
 */
const ADDRESS_LINK_CLASS_NAME: string =
  "group -mx-1 flex min-w-0 items-center gap-1 rounded px-1 text-sm font-medium leading-6 text-gray-900 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

/*
 * The tile beside each address says what kind it is. On a phone it gives
 * its width to the address, which is what people read there.
 */
const ADDRESS_TILE_CLASS_NAME: string =
  "flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-100 text-gray-500 max-sm:hidden";

const PublicAddresses: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Whether this installation issues free certificates: without, a
   * verified domain is live, and no certificate is read to say so.
   */
  const installation: CustomDomainInstallation = getCustomDomainInstallation();
  const kind: CustomDomainKind = props.kind;
  const parentIdString: string = props.parentId.toString();

  const [domains, setDomains] = useState<Array<CustomDomainModel>>([]);
  const [certificates, setCertificates] = useState<
    Map<string, CustomDomainCertificate>
  >(new Map<string, CustomDomainCertificate>());
  const [loadState, setLoadState] = useState<LoadState>(LoadState.Loading);

  // The domain whose DNS Setup dialog is open.
  const [dnsSetupDomain, setDnsSetupDomain] =
    useState<CustomDomainModel | null>(null);

  // Bumped by every read: the answer to an older one is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const domainModel: CustomDomainModel = new kind.modelType();

  /*
   * Once the permission snapshot is in, someone who may not read the custom
   * domains is not asked about them. Before it is, the read is tried: the
   * server has the last word.
   */
  const isReadRefused: boolean =
    !PermissionGate.check(domainModel, ModelAction.Read).isAllowed &&
    PermissionGate.hasPermissionSnapshot();

  /*
   * Each domain's certificate - its expiry, and why its last order failed -
   * which tells an issued certificate from an expired one. Read only when a
   * domain needs it; when it cannot be read, each domain's own row decides,
   * as on the Custom Domains page.
   */
  const readCertificates: () => Promise<
    Map<string, CustomDomainCertificate>
  > = async (): Promise<Map<string, CustomDomainCertificate>> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/${domainModel.crudApiPath?.toString() || ""}/certificates/${parentIdString}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        return new Map<string, CustomDomainCertificate>();
      }

      return CustomDomainCertificates.fromJSON(response.data as JSONObject);
    } catch {
      return new Map<string, CustomDomainCertificate>();
    }
  };

  /*
   * Reads the custom domains, and their certificates when one needs them.
   * A quiet read (after DNS Setup's Check now) keeps the list on screen
   * until the answer is in.
   */
  const readDomains: (options: {
    isQuiet: boolean;
  }) => Promise<void> = async (options: {
    isQuiet: boolean;
  }): Promise<void> => {
    readRef.current += 1;
    const read: number = readRef.current;

    if (!options.isQuiet) {
      setLoadState(LoadState.Loading);
    }

    try {
      const query: Query<CustomDomainModel> = {
        projectId: ProjectUtil.getCurrentProjectId()!,
        [kind.parentColumn]: props.parentId,
      } as Query<CustomDomainModel>;

      const result: ListResult<CustomDomainModel> =
        await ModelAPI.getList<CustomDomainModel>({
          modelType: kind.modelType,
          query: query,
          select: DOMAIN_SELECT,
          sort: DOMAIN_SORT,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const nextCertificates: Map<string, CustomDomainCertificate> =
        result.data.some((domain: CustomDomainModel): boolean => {
          return isCertificateNeededFor(domain, installation);
        })
          ? await readCertificates()
          : new Map<string, CustomDomainCertificate>();

      if (read !== readRef.current) {
        return;
      }

      setDomains(result.data);
      setCertificates(nextCertificates);
      setLoadState(LoadState.Loaded);
    } catch {
      if (read !== readRef.current) {
        return;
      }

      setDomains([]);
      setCertificates(new Map<string, CustomDomainCertificate>());
      setLoadState(LoadState.Failed);
    }
  };

  useEffect(() => {
    setDnsSetupDomain(null);

    if (isReadRefused) {
      readRef.current += 1;
      setDomains([]);
      setCertificates(new Map<string, CustomDomainCertificate>());
      setLoadState(LoadState.NotRead);
      return;
    }

    void readDomains({ isQuiet: false });
  }, [parentIdString, isReadRefused]);

  const certificateOf: (
    domain: CustomDomainModel,
  ) => CustomDomainCertificate | undefined = (
    domain: CustomDomainModel,
  ): CustomDomainCertificate | undefined => {
    return domain.id ? certificates.get(domain.id.toString()) : undefined;
  };

  if (loadState === LoadState.Loading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3"
        data-testid={PUBLIC_ADDRESS_TEST_IDS.loading}
      >
        <Skeleton className="h-8 w-8 flex-none rounded-md max-sm:hidden" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
        <span className="sr-only">
          {translator.translateText(PublicAddressCopy.loading)}
        </span>
      </div>
    );
  }

  const addresses: Array<PublicAddress<CustomDomainModel>> =
    getPublicAddresses<CustomDomainModel>({
      domains: loadState === LoadState.Loaded ? domains : [],
      getCertificate: certificateOf,
      oneUptimeUrl: props.oneUptimeUrl.toString(),
      installation: installation,
    });

  /*
   * The quiet line for adding a domain: only once the domains were read and
   * there are none, where this installation serves custom domains of this
   * kind, for whoever may add one.
   */
  const isAddLineShown: boolean =
    loadState === LoadState.Loaded &&
    domains.length === 0 &&
    Boolean(kind.getCnameRecord()) &&
    PermissionGate.check(domainModel, ModelAction.Create).isAllowed;

  /*
   * What a row offers: Copy link on a live address; DNS Setup on a custom
   * domain that is not live yet, when there is something to do; else
   * nothing (a certificate being issued only needs waiting for).
   */
  const getRowAction: (
    address: PublicAddress<CustomDomainModel>,
    addressText: string,
  ) => ReactElement | null = (
    address: PublicAddress<CustomDomainModel>,
    addressText: string,
  ): ReactElement | null => {
    if (address.isLive) {
      return (
        <CopyTextButton
          textToBeCopied={address.url}
          label={PublicAddressCopy.copyLink}
          copiedLabel={PublicAddressCopy.copied}
          /*
           * Already in the reader's language (the address is a value in
           * it), so the button's own lookup finds nothing and keeps it.
           */
          title={translator.translateTemplate(PublicAddressCopy.copyLinkTo, {
            address: addressText,
          })}
          size="sm"
          variant="soft"
        />
      );
    }

    const domain: CustomDomainModel | undefined = address.domain;

    if (!domain || !isDnsSetupOffered(address, installation)) {
      return null;
    }

    /*
     * The size of Copy link beside it on the other rows, so the actions
     * line up; white, as the one thing on the list left to do. Named for
     * its domain, as Copy link is for its address: with two domains to set
     * up, a screen reader's list of buttons tells them apart.
     */
    const dnsSetupName: string = translator.translateTemplate(
      PublicAddressCopy.dnsSetupFor,
      { address: addressText },
    );

    return (
      <button
        type="button"
        className={ROW_ACTION_CLASS_NAME}
        aria-label={dnsSetupName}
        title={dnsSetupName}
        data-testid={PUBLIC_ADDRESS_TEST_IDS.dnsSetup}
        onClick={() => {
          setDnsSetupDomain(domain);
        }}
      >
        <Icon icon={IconProp.Globe} className="h-4 w-4" />
        <span>{translator.translateText(CustomDomainCopy.dnsSetupTitle)}</span>
      </button>
    );
  };

  const getRow: (address: PublicAddress<CustomDomainModel>) => ReactElement = (
    address: PublicAddress<CustomDomainModel>,
  ): ReactElement => {
    const addressText: string = getAddressText(address);
    const isCustomDomain: boolean =
      address.kind === PublicAddressKind.CustomDomain;
    const action: ReactElement | null = getRowAction(address, addressText);

    return (
      <li
        key={address.url}
        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid={PUBLIC_ADDRESS_TEST_IDS.row}
        data-kind={address.kind}
        data-live={address.isLive ? "true" : "false"}
        data-address={addressText}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            aria-hidden="true"
            className={ADDRESS_TILE_CLASS_NAME}
            data-testid={PUBLIC_ADDRESS_TEST_IDS.tile}
          >
            <Icon
              icon={isCustomDomain ? IconProp.Globe : IconProp.Link}
              className="h-4 w-4"
            />
          </div>
          <div className="min-w-0 flex-1">
            {address.isLive ? (
              /*
               * A plain anchor, not Link: the address is opened as stored,
               * never parsed - a name the URL type refuses (a label past
               * DNS's 63 characters) must not take the card down. Its own
               * line holds it at the width of its words, cut short when
               * the row has less.
               */
              <div className="flex min-w-0">
                <a
                  href={address.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ADDRESS_LINK_CLASS_NAME}
                  data-testid={PUBLIC_ADDRESS_TEST_IDS.link}
                >
                  {/*
                   * The whole address on hover: a long one is cut short to
                   * fit the row.
                   */}
                  <span className="min-w-0 truncate" title={address.url}>
                    {address.host}
                    {address.path ? (
                      <span className="font-normal text-gray-500 group-hover:text-indigo-600">
                        {address.path}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                  <Icon
                    icon={IconProp.ExternalLink}
                    className="h-3.5 w-3.5 flex-none text-gray-400 group-hover:text-indigo-600"
                  />
                  <span className="sr-only">
                    {" "}
                    {translator.translateText(PublicAddressCopy.opensInNewTab)}
                  </span>
                </a>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="min-w-0 truncate text-sm font-medium leading-6 text-gray-700"
                  title={address.url}
                >
                  {addressText}
                </span>
                <span
                  className="inline-flex flex-none items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                  data-testid={PUBLIC_ADDRESS_TEST_IDS.notLive}
                >
                  {translator.translateText(PublicAddressCopy.notLiveYet)}
                </span>
              </div>
            )}
            {address.isLive ? (
              <p className="text-xs text-gray-500">
                {translator.translateText(
                  isCustomDomain
                    ? PublicAddressCopy.customDomain
                    : PublicAddressCopy.oneUptimeAddress,
                )}
              </p>
            ) : (
              <p
                className="text-xs text-gray-500"
                data-testid={PUBLIC_ADDRESS_TEST_IDS.reason}
              >
                {translator.translateText(getNotLiveReason(address))}
              </p>
            )}
          </div>
        </div>
        {action ? (
          /*
           * Beside the address from sm up; under it on a phone, lined up
           * with its text (the tile is not drawn there).
           */
          <div className="flex flex-none items-center gap-2">{action}</div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <ul
        aria-label={translator.translateText(PublicAddressCopy.listLabel)}
        className="divide-y divide-gray-200 rounded-lg border border-gray-200"
        data-testid={PUBLIC_ADDRESS_TEST_IDS.list}
      >
        {addresses.map(getRow)}
      </ul>

      {loadState === LoadState.Failed ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500"
          data-testid={PUBLIC_ADDRESS_TEST_IDS.error}
        >
          <span>{translator.translateText(PublicAddressCopy.loadError)}</span>
          <button
            type="button"
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            onClick={() => {
              void readDomains({ isQuiet: false });
            }}
          >
            {translator.translateText(PublicAddressCopy.tryAgain)}
          </button>
        </div>
      ) : (
        <></>
      )}

      {props.note || <></>}

      {isAddLineShown ? (
        <p
          className="text-sm text-gray-500"
          data-testid={PUBLIC_ADDRESS_TEST_IDS.addCustomDomain}
        >
          <TranslatedSentence
            template={PublicAddressCopy.addCustomDomainSentence}
            slots={{
              example: (
                <span className="font-medium text-gray-700">
                  {props.exampleDomain}
                </span>
              ),
            }}
          />{" "}
          <Link
            to={props.customDomainsRoute}
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            {translator.translateText(PublicAddressCopy.addCustomDomainLink)}
          </Link>
        </p>
      ) : (
        <></>
      )}

      {dnsSetupDomain ? (
        <CustomDomainDnsSetupModal
          kind={kind}
          domain={dnsSetupDomain}
          hasExpiredCertificate={
            getCustomDomainState(
              dnsSetupDomain,
              certificateOf(dnsSetupDomain),
              undefined,
              installation,
            ) === CustomDomainState.CertificateExpired
          }
          checkNowGate={PermissionGate.check(domainModel, ModelAction.Update)}
          onClose={() => {
            setDnsSetupDomain(null);
          }}
          onVerified={() => {
            void readDomains({ isQuiet: true });
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PublicAddresses;
