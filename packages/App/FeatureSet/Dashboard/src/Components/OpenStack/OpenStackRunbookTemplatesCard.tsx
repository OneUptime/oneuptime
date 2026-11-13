import Runbook from "Common/Models/DatabaseModels/Runbook";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_RUNBOOK_FIX_TIER_LABELS,
  OPENSTACK_RUNBOOK_TEMPLATES,
  OpenStackRunbookCheck,
  OpenStackRunbookFix,
  OpenStackRunbookTemplate,
  buildOpenStackRunbookSteps,
} from "Common/Types/OpenStack/OpenStackRunbookTemplates";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Runbooks for the common failures of an OpenStack cloud, ready to add: what to check and
 * which fix it may come to, with that fix's tier. One line each until someone opens one,
 * because this is read in the middle of a failure, and nobody wants six at once.
 *
 * Adding one writes an ordinary runbook of manual steps, which the team then owns and can
 * change. Nothing in it runs on its own: a change to the cloud goes through a fix.
 */

const TemplateRow: FunctionComponent<{
  template: OpenStackRunbookTemplate;
}> = (props: { template: OpenStackRunbookTemplate }): ReactElement => {
  const translator: Translator = useTranslator();
  const { template } = props;
  const [created, setCreated] = useState<ObjectID | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const add: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      const runbook: Runbook = new Runbook();

      runbook.projectId = ProjectUtil.getCurrentProjectId() as ObjectID;
      runbook.name = template.name;
      runbook.description = template.whenItIsFor;
      runbook.isEnabled = true;
      runbook.steps = buildOpenStackRunbookSteps(
        template,
      ) as unknown as JSONArray;

      const response: HTTPResponse<
        JSONObject | JSONArray | Runbook | Array<Runbook>
      > = await ModelAPI.create<Runbook>({
        model: runbook,
        modelType: Runbook,
      });

      setCreated((response.data as Runbook | undefined)?.id || null);
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <details
      className="border-b border-gray-100 py-2 last:border-b-0"
      data-testid={`openstack-runbook-${template.id}`}
    >
      <summary className="cursor-pointer text-sm font-medium text-gray-900">
        {translator.translateText(template.name)}
      </summary>
      <div className="mt-2 space-y-3 text-sm text-gray-700">
        <p>{translator.translateText(template.whenItIsFor)}</p>
        <div>
          <div className="text-xs font-medium uppercase text-gray-500">
            {translator.translateText("What to check")}
          </div>
          <ul className="mt-1 space-y-1">
            {template.checks.map(
              (check: OpenStackRunbookCheck): ReactElement => {
                return (
                  <li key={check.title}>
                    <div>{translator.translateText(check.title)}</div>
                    {check.command ? (
                      <code className="block break-words text-xs text-gray-600">
                        {check.command}
                      </code>
                    ) : (
                      <></>
                    )}
                    <div className="text-xs text-gray-500">
                      {translator.translateText(check.whatItSays)}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-gray-500">
            {translator.translateText("The fixes it may come to")}
          </div>
          <ul className="mt-1 space-y-1">
            {template.fixes.map((fix: OpenStackRunbookFix): ReactElement => {
              return (
                <li key={fix.title}>
                  <div>
                    {translator.translateText(fix.title)}
                    <span className="ml-2 text-xs text-gray-500">
                      {translator.translateText(
                        OPENSTACK_RUNBOOK_FIX_TIER_LABELS[fix.tier],
                      )}
                    </span>
                  </div>
                  {fix.command ? (
                    <code className="block break-words text-xs text-gray-600">
                      {fix.command}
                    </code>
                  ) : (
                    <></>
                  )}
                  <div className="text-xs text-gray-500">
                    {translator.translateText(fix.whatItDoes)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {error ? (
          <p className="text-red-700" data-testid="openstack-runbook-error">
            {error}
          </p>
        ) : (
          <></>
        )}
        {created ? (
          <Link
            to={
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUNBOOK_VIEW] as Route,
                { modelId: created },
              ) as Route
            }
            className="text-sm text-indigo-600 hover:underline"
          >
            {translator.translateText("Added. Open the runbook")}
          </Link>
        ) : (
          <Button
            title={translator.translateText("Add to my runbooks")}
            buttonStyle={ButtonStyleType.NORMAL}
            isLoading={isSaving}
            onClick={add}
            dataTestId={`openstack-runbook-add-${template.id}`}
          />
        )}
      </div>
    </details>
  );
};

const OpenStackRunbookTemplatesCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Card
      title={translator.translateText("Runbooks for the common failures")}
      description={translator.translateText(
        "What to check when one of these happens, and which fix it may come to. Adding one gives your team a runbook of its own to change: nothing in it runs on its own.",
      )}
    >
      <div data-testid="openstack-runbook-templates">
        {OPENSTACK_RUNBOOK_TEMPLATES.map(
          (template: OpenStackRunbookTemplate): ReactElement => {
            return <TemplateRow key={template.id} template={template} />;
          },
        )}
      </div>
    </Card>
  );
};

export default OpenStackRunbookTemplatesCard;
