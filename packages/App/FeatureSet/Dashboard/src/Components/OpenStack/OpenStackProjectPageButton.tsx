import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackProjectPagePlanRow } from "Common/Types/OpenStack/OpenStackStatusPagePlan";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackProjectPagePlanAnswer,
  OpenStackStatusPageMadeAnswer,
  fetchOpenStackProjectPagePlan,
  makeOpenStackProjectPage,
} from "../../Pages/OpenStack/Utils/OpenStackStatusPageReads";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * A PRIVATE STATUS PAGE FOR ONE PROJECT.
 *
 * Rows for what the project uses, which go red only when a failure reaches it. Nobody can read it until they
 * are added as its private users, on its own page, which is where this sends you.
 */

export interface ComponentProps {
  openStackCloudId: ObjectID;
  openStackProjectId: string;
}

const OpenStackProjectPageButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [plan, setPlan] = useState<OpenStackProjectPagePlanAnswer | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [made, setMade] = useState<OpenStackStatusPageMadeAnswer | null>(null);

  const privateUsersRoute: Route | null = made
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS] as Route,
        { modelId: new ObjectID(made.statusPageId) },
      )
    : null;

  return (
    <Card
      title={translationKey("A Private Status Page for This Project")}
      description={translationKey(
        "For the people who use this project: only its own services, going red only when a failure reaches it. Nothing about any other project can be read through it.",
      )}
      buttons={[
        {
          title: translationKey("Create Private Page"),
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
          isLoading: isBusy && !plan,
          onClick: () => {
            setIsBusy(true);
            setError("");
            fetchOpenStackProjectPagePlan({
              openStackCloudId: props.openStackCloudId,
              openStackProjectId: props.openStackProjectId,
            })
              .then(setPlan)
              .catch((err: unknown) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsBusy(false);
              });
          },
        },
      ]}
    >
      <div data-testid="openstack-project-page">
        {error && !plan ? <ErrorMessage message={error} /> : <></>}
        {made && privateUsersRoute ? (
          <p
            className="text-sm text-gray-700"
            data-testid="openstack-project-page-made"
          >
            {translator.translateText(
              "The page is ready, and nobody can read it yet.",
            )}{" "}
            <Link to={privateUsersRoute} className="text-indigo-600 underline">
              {translator.translateText("Add who can read it")}
            </Link>
          </p>
        ) : (
          <></>
        )}
      </div>

      {plan ? (
        <Modal
          title={translationKey("What This Will Create")}
          description={translationKey(
            "A private status page, and a row for each of these. Whoever you add as a private user of the page reads it, and nobody else.",
          )}
          modalWidth={ModalWidth.Medium}
          submitButtonText={translationKey("Create")}
          isLoading={isBusy}
          error={error || undefined}
          disableSubmitButton={!plan.isProjectInCloud || plan.rows.length === 0}
          onClose={() => {
            setPlan(null);
            setError("");
          }}
          onSubmit={() => {
            setIsBusy(true);
            setError("");
            makeOpenStackProjectPage({
              openStackCloudId: props.openStackCloudId,
              openStackProjectId: props.openStackProjectId,
            })
              .then((answer: OpenStackStatusPageMadeAnswer) => {
                setMade(answer);
                setPlan(null);
              })
              .catch((err: unknown) => {
                setError(API.getFriendlyMessage(err));
              })
              .finally(() => {
                setIsBusy(false);
              });
          }}
        >
          <ul
            className="space-y-1 text-sm text-gray-700"
            data-testid="openstack-project-page-plan"
          >
            {plan.rows.length === 0 ? (
              <li>
                {translator.translateText(
                  "This project holds nothing to show yet.",
                )}
              </li>
            ) : (
              <></>
            )}
            {plan.rows.map((row: OpenStackProjectPagePlanRow) => {
              return (
                <li key={row.monitorName} className="break-words">
                  <bdi>{row.monitorName}</bdi>
                </li>
              );
            })}
          </ul>
        </Modal>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default OpenStackProjectPageButton;
