import ProjectSsoCopy, {
  SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID,
} from "./ProjectSsoCopy";
import {
  getProviderName,
  getProvidersNotFoundByEmail,
  SSO_PROVIDER_DOMAINS_SELECT,
  SsoProviderDomainsRow,
} from "./SsoProviderDomains";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Domain from "Common/Models/DatabaseModels/Domain";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { formatList, Translator } from "Common/UI/Utils/TranslateTemplate";
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
 * "SIGN IN WITH SSO" FINDS THESE PROVIDERS BY NOBODY'S EMAIL (#9918).
 *
 * Over the provider cards of Settings > SSO, while a SAML or OIDC provider
 * that is on lists no verified domain: "Sign in with SSO" finds a project's
 * provider by an address's domain alone (#9824), so nobody finds that one by
 * typing their email - after the upgrade, a provider whose project had no
 * verified domain of its own to give it, or one added since with none
 * picked. The notice names them and says what to do: pick one under Domains,
 * or, while the project has no verified domain at all, verify one first
 * (Verify a Domain opens Project Settings > Domains). The people it misses
 * meanwhile still sign in from the identity provider, and with the SSO
 * Sign-in Link card's link.
 *
 * It reads the providers of both kinds with their domains, and whether the
 * project has a verified domain, itself - every provider, whatever the
 * tables below are filtered to - but only once the page knows there is a
 * provider (`hasProviders`), and again each time a table reloads
 * (`refreshToken`), a burst of reloads read once. A read that fails draws
 * nothing: the rows' Domains column still says it.
 */

// A burst of table reloads - both tables load as the page opens - is read once.
export const SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS: number = 250;

export interface ComponentProps {
  projectId: ObjectID;
  // The tables hold a provider: before that there is nothing to say.
  hasProviders: boolean;
  // Changes each time a provider table reloads.
  refreshToken: number;
}

// What the notice last read.
interface NoticeRead {
  providers: Array<SsoProviderDomainsRow>;
  hasVerifiedDomain: boolean;
}

const SsoProvidersNotOfferedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [read, setRead] = useState<NoticeRead | null>(null);

  // Bumped by every read: an answer for one the page has moved on from is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const thisRead: number = readRef.current + 1;
    readRef.current = thisRead;

    if (!props.hasProviders) {
      setRead(null);
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      // Every provider of the kind, with its domains, the oldest first.
      void Promise.all([
        ModelAPI.getList<ProjectSSO>({
          modelType: ProjectSSO,
          query: {
            projectId: props.projectId,
          } as Query<ProjectSSO>,
          select: SSO_PROVIDER_DOMAINS_SELECT as unknown as Select<ProjectSSO>,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Ascending,
          } as Sort<ProjectSSO>,
        }),
        ModelAPI.getList<ProjectOIDC>({
          modelType: ProjectOIDC,
          query: {
            projectId: props.projectId,
          } as Query<ProjectOIDC>,
          select: SSO_PROVIDER_DOMAINS_SELECT as unknown as Select<ProjectOIDC>,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            createdAt: SortOrder.Ascending,
          } as Sort<ProjectOIDC>,
        }),
        // Whether there is a verified domain to pick at all.
        ModelAPI.getList<Domain>({
          modelType: Domain,
          query: {
            projectId: props.projectId,
            isVerified: true,
          },
          select: { _id: true },
          limit: 1,
          skip: 0,
          sort: {},
        }),
      ])
        .then(
          ([saml, oidc, verifiedDomains]: [
            ListResult<ProjectSSO>,
            ListResult<ProjectOIDC>,
            ListResult<Domain>,
          ]): void => {
            if (readRef.current !== thisRead) {
              return;
            }

            setRead({
              providers: [...saml.data, ...oidc.data],
              hasVerifiedDomain: verifiedDomains.data.length > 0,
            });
          },
        )
        .catch((): void => {
          if (readRef.current === thisRead) {
            setRead(null);
          }
        });
    }, SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [props.hasProviders, props.refreshToken, props.projectId.toString()]);

  if (!props.hasProviders || !read) {
    return <></>;
  }

  const notFound: Array<SsoProviderDomainsRow> = getProvidersNotFoundByEmail(
    read.providers,
  );

  if (notFound.length === 0) {
    return <></>;
  }

  // Each as its admin named it, in the reader's own list separators.
  const names: string = formatList(
    notFound
      .map((provider: SsoProviderDomainsRow): string => {
        return getProviderName(provider);
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      }),
    translator,
  );

  return (
    <Alert
      className="mb-5"
      type={AlertType.WARNING}
      dataTestId={SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID}
      title={translator.translatePlural(
        read.hasVerifiedDomain
          ? ProjectSsoCopy.notOfferedNotice
          : ProjectSsoCopy.notOfferedUntilVerifiedNotice,
        notFound.length,
        { names: names },
      )}
      {...(read.hasVerifiedDomain
        ? {}
        : {
            textOnRight: ProjectSsoCopy.verifyDomainAction,
            onClick: (): void => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_DOMAINS] as Route,
                ),
              );
            },
          })}
    />
  );
};

export default SsoProvidersNotOfferedNotice;
