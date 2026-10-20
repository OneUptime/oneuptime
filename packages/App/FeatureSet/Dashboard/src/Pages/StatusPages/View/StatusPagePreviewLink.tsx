import {
  STATUS_PAGE_EXAMPLE_DOMAIN,
  STATUS_PAGE_LINK_ACCESS_TEST_ID,
  STATUS_PAGE_LINK_TEST_ID,
  StatusPageOverviewCopy,
} from "../../../Components/StatusPage/StatusPageOverviewCopy";
import {
  getStatusPageAccessSelect,
  getStatusPageAccessState,
} from "../../../Components/StatusPage/StatusPageAccessCopy";
import { STATUS_PAGE_CUSTOM_DOMAINS } from "../../../Components/CustomDomain/CustomDomainKinds";
import PublicAddresses from "../../../Components/CustomDomain/PublicAddresses";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  getStatusPageAccess,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * "Status Page Link", first on a status page's Overview: where visitors find
 * the page. Every address it answers at - its custom domains first, each live
 * one to open and copy, each one not live yet saying why, with DNS Setup when
 * there is something to do - then its address on OneUptime's own domain
 * (PublicAddresses, which a dashboard's Sharing page draws too). It used to
 * show that last address alone, whatever custom domains the page had.
 *
 * Under the addresses, when the page is not public, one line says that
 * visitors sign in or enter the password, with Change access - a link to a
 * private page asks every visitor for that first.
 */
const StatusPagePreviewLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelIdString: string = props.modelId.toString();

  // Who can see the page, once read: null until then, or if it cannot be.
  const [access, setAccess] = useState<StatusPageAccess | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    const readAccess: () => Promise<void> = async (): Promise<void> => {
      try {
        const statusPage: StatusPage | null =
          await ModelAPI.getItem<StatusPage>({
            modelType: StatusPage,
            id: props.modelId,
            select: getStatusPageAccessSelect(),
          });

        if (isCurrent) {
          setAccess(
            statusPage
              ? getStatusPageAccess(getStatusPageAccessState(statusPage))
              : null,
          );
        }
      } catch {
        // The line is a note, never a reason for an error on the Overview.
        if (isCurrent) {
          setAccess(null);
        }
      }
    };

    setAccess(null);
    void readAccess();

    return () => {
      isCurrent = false;
    };
  }, [modelIdString]);

  const oneUptimeUrl: URL = URL.fromString(
    `${STATUS_PAGE_URL.toString()}/${modelIdString}`,
  );

  const accessSentence: string | null =
    access === StatusPageAccess.SignIn
      ? StatusPageOverviewCopy.linkCardSignInRequired
      : access === StatusPageAccess.Password
        ? StatusPageOverviewCopy.linkCardPasswordRequired
        : null;

  const accessNote: ReactElement | undefined = accessSentence ? (
    <div
      className="flex items-start gap-2 text-sm text-gray-500"
      data-testid={STATUS_PAGE_LINK_ACCESS_TEST_ID}
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <p>
        {translator.translateText(accessSentence)}{" "}
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS] as Route,
            { modelId: props.modelId },
          )}
          className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {translator.translateText(
            StatusPageOverviewCopy.linkCardChangeAccess,
          )}
        </Link>
      </p>
    </div>
  ) : undefined;

  return (
    <Card
      title={StatusPageOverviewCopy.linkCardTitle}
      description={StatusPageOverviewCopy.linkCardDescription}
    >
      <div data-testid={STATUS_PAGE_LINK_TEST_ID}>
        <PublicAddresses
          kind={STATUS_PAGE_CUSTOM_DOMAINS}
          parentId={props.modelId}
          oneUptimeUrl={oneUptimeUrl}
          customDomainsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
            { modelId: props.modelId },
          )}
          exampleDomain={STATUS_PAGE_EXAMPLE_DOMAIN}
          note={accessNote}
        />
      </div>
    </Card>
  );
};

export default StatusPagePreviewLink;
