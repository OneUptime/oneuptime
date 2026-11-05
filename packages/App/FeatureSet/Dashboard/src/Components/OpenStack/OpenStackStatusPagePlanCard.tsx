import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackStatusPagePlanGroup,
  OpenStackStatusPagePlanMonitor,
  OpenStackStatusPagePlanRow,
} from "Common/Types/OpenStack/OpenStackStatusPagePlan";
import Route from "Common/Types/API/Route";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackObjectivesMadeAnswer,
  OpenStackStatusPageMadeAnswer,
  OpenStackStatusPagePlanAnswer,
  fetchOpenStackStatusPagePlan,
  makeOpenStackObjectives,
  makeOpenStackStatusPage,
} from "../../Pages/OpenStack/Utils/OpenStackStatusPageReads";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * A STATUS PAGE FOR THIS CLOUD, IN ONE STEP.
 *
 * What it would make is shown first, monitor by monitor, and nothing is made until someone has read that.
 * What it makes is an ordinary status page: every group, row and monitor stays editable where it always is,
 * so this says so and links there rather than growing a second place to change them.
 */

export interface ComponentProps {
  openStackCloudId: ObjectID;
}

const OpenStackStatusPagePlanCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<OpenStackStatusPagePlanAnswer | null>(
    null,
  );
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isMaking, setIsMaking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [made, setMade] = useState<OpenStackStatusPageMadeAnswer | null>(null);
  const [objectives, setObjectives] =
    useState<OpenStackObjectivesMadeAnswer | null>(null);
  const [wantsObjectives, setWantsObjectives] = useState<boolean>(false);

  const open: (forObjectives: boolean) => Promise<void> = async (
    forObjectives: boolean,
  ): Promise<void> => {
    setIsReading(true);
    setError("");

    try {
      const read: OpenStackStatusPagePlanAnswer =
        await fetchOpenStackStatusPagePlan(props.openStackCloudId);
      setAnswer(read);
      setName(read.plan.name);
      setIsPublic(false);
      setWantsObjectives(forObjectives);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsReading(false);
  };

  const make: () => Promise<void> = async (): Promise<void> => {
    if (!answer) {
      return;
    }

    setIsMaking(true);
    setError("");

    try {
      if (wantsObjectives) {
        setObjectives(
          await makeOpenStackObjectives({
            openStackCloudId: props.openStackCloudId,
            planKey: answer.planKey,
          }),
        );
      } else {
        setMade(
          await makeOpenStackStatusPage({
            openStackCloudId: props.openStackCloudId,
            planKey: answer.planKey,
            name,
            isPublic,
          }),
        );
      }
      setAnswer(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsMaking(false);
  };

  const monitorLine: (
    monitor: OpenStackStatusPagePlanMonitor,
  ) => ReactElement = (
    monitor: OpenStackStatusPagePlanMonitor,
  ): ReactElement => {
    return (
      <li
        key={`${monitor.templateId}-${monitor.regionName || ""}`}
        className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm"
        data-testid="openstack-status-page-plan-monitor"
      >
        <span className="min-w-0 break-words text-gray-700">
          <bdi>{monitor.name}</bdi>
          {monitor.incidentsOpenedBy ? (
            <span className="block text-xs text-gray-500">
              {translator.translateTemplate(
                "For this row only. {{monitor}} goes on opening the incident, so one failure stays one incident.",
                { monitor: monitor.incidentsOpenedBy },
              )}
            </span>
          ) : (
            <></>
          )}
        </span>
        <span
          className={
            monitor.existingMonitorId
              ? "text-xs text-gray-500"
              : "text-xs font-medium text-amber-700"
          }
        >
          {monitor.existingMonitorId
            ? translator.translateText("Already there")
            : translator.translateText("Will be created")}
        </span>
      </li>
    );
  };

  const statusPageRoute: Route | null = made
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
        { modelId: new ObjectID(made.statusPageId) },
      )
    : null;

  return (
    <Card
      title={translationKey("A Status Page for This Cloud")}
      description={translationKey(
        "Regions as groups, and each region's services as rows, backed by the monitors that say whether they work. You see what it will create first, and everything stays editable afterwards.",
      )}
      buttons={[
        {
          title: translationKey("Create Status Page"),
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
          isLoading: isReading && !wantsObjectives,
          onClick: () => {
            void open(false);
          },
        },
        {
          title: translationKey("Create Objectives"),
          buttonStyle: ButtonStyleType.OUTLINE,
          icon: IconProp.Add,
          isLoading: isReading && wantsObjectives,
          onClick: () => {
            void open(true);
          },
        },
      ]}
    >
      <div data-testid="openstack-status-page-card">
        {error && !answer ? <ErrorMessage message={error} /> : <></>}
        {made && statusPageRoute ? (
          <p
            className="text-sm text-gray-700"
            data-testid="openstack-status-page-made"
          >
            {translator.translateText(
              "Your status page is ready. Who can read it, its groups and its rows are all on its own pages.",
            )}{" "}
            <Link to={statusPageRoute} className="text-indigo-600 underline">
              {translator.translateText("Open the status page")}
            </Link>
          </p>
        ) : (
          <></>
        )}
        {objectives ? (
          <p
            className="text-sm text-gray-700"
            data-testid="openstack-objectives-made"
          >
            {translator.translateTemplate(
              "{{made}} objectives created, and {{left}} already there. They stay editable under Service Level Objectives.",
              {
                made: String(objectives.objectivesMade),
                left: String(objectives.objectivesLeft),
              },
            )}
          </p>
        ) : (
          <></>
        )}
      </div>

      {answer ? (
        <Modal
          title={
            wantsObjectives
              ? translationKey("Objectives This Will Create")
              : translationKey("What This Will Create")
          }
          description={
            wantsObjectives
              ? translationKey(
                  "One objective per row: 99.9% of the last 30 days, from the uptime of its monitors and, where a check from outside is on, that check's.",
                )
              : translationKey(
                  "Nothing is created until you say so. A monitor that already watches a row is used as it is, so one failure stays one incident.",
                )
          }
          modalWidth={ModalWidth.Medium}
          submitButtonText={translationKey("Create")}
          isLoading={isMaking}
          error={error || undefined}
          disableSubmitButton={answer.plan.groups.length === 0}
          onClose={() => {
            setAnswer(null);
            setError("");
          }}
          onSubmit={() => {
            void make();
          }}
        >
          <div data-testid="openstack-status-page-plan">
            {answer.plan.groups.length === 0 ? (
              <p className="text-sm text-gray-700">
                {translator.translateText(
                  "OneUptime sees none of this cloud's services yet, so there is nothing to put on a page.",
                )}
              </p>
            ) : (
              <></>
            )}
            {!wantsObjectives && answer.plan.groups.length > 0 ? (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {translator.translateText("Name")}
                  </label>
                  <Input
                    value={name}
                    dataTestId="openstack-status-page-name"
                    onChange={(value: string) => {
                      setName(value);
                    }}
                  />
                </div>
                <div>
                  <Toggle
                    title={translator.translateText(
                      "Anyone with the link can read it",
                    )}
                    value={isPublic}
                    onChange={(value: boolean) => {
                      setIsPublic(value);
                    }}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {translator.translateText(
                      "Off, only the people you add can. An incident's title on it can name a host, and never names a project.",
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <></>
            )}
            {answer.plan.groups.map((group: OpenStackStatusPagePlanGroup) => {
              return (
                <div
                  key={group.name}
                  className="mb-3"
                  data-testid="openstack-status-page-plan-group"
                >
                  <div className="text-sm font-semibold text-gray-900">
                    <bdi>{group.name}</bdi>
                  </div>
                  {group.rows.map((row: OpenStackStatusPagePlanRow) => {
                    return (
                      <div key={row.service} className="mt-2 pl-3">
                        <div className="text-sm font-medium text-gray-800">
                          {translator.translateText(row.service)}
                        </div>
                        <ul className="pl-3">
                          {row.monitors.map(monitorLine)}
                          {wantsObjectives ? (
                            row.checkMonitors.map(monitorLine)
                          ) : (
                            <></>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default OpenStackStatusPagePlanCard;
