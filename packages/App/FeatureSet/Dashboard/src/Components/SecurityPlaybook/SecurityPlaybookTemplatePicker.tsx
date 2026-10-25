import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "./SecurityPlaybookTemplates";
import {
  PLAYBOOK_TEMPLATES_DESCRIPTION,
  PLAYBOOK_TEMPLATES_TITLE,
  PLAYBOOK_NOT_ADDED_TITLE,
  findPlaybookOfTemplate,
  getTemplateStepCount,
} from "./SecurityPlaybookTemplateModel";
import {
  TurnOnRecommendedProblem,
  describeAddFailure,
} from "../SecurityOverview/SecuritySetupModel";
import SecurityTurnOnProblems, {
  bringProblemsIntoView,
} from "../SecurityOverview/SecurityTurnOnProblems";
import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "../SecurityCase/SecurityCaseValues";
import useSecurityCaseValues from "../SecurityCase/useSecurityCaseValues";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { buildSecurityPlaybookFromTemplate } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export function getPlaybookViewRoute(id: ObjectID): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_PLAYBOOK_VIEW] as Route,
    { modelId: id },
  );
}

export interface ComponentProps {
  /*
   * In place of an empty list: the heading, and a way to start blank
   * (onCreateBlank). From the list's Create from Template, neither: the
   * dialog has its own title.
   */
  showIntro?: boolean | undefined;
  onCreateBlank?: (() => void) | undefined;
}

export const PLAYBOOK_TEMPLATE_PICKER_TEST_ID: string =
  "security-playbook-templates";

/*
 * The playbook templates, each a working playbook in one click: Add
 * Playbook saves it as it is - on, with its trigger and its steps, naming
 * the project's own case priorities and statuses - and opens it to change.
 *
 * A template the project has a playbook of already (by its name, in English
 * or as the reader's language words it) says Added, with View to open that
 * playbook, as the Rule Library and Free Lists mark what is added: picking
 * it again made a second playbook doing the same thing.
 *
 * Shown in place of an empty list, and from the list's Create from Template
 * once there are playbooks - as the grouping rules' templates are.
 */
const SecurityPlaybookTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = `security-playbook-templates-${useId()}`;
  // The project's case priorities and statuses, which a template's steps name.
  const { values } = useSecurityCaseValues();
  // The project's playbooks, for which templates are added; null until read.
  const [playbooks, setPlaybooks] = useState<Array<SecurityPlaybook> | null>(
    null,
  );
  // Why the template picked last could not become a playbook, as the Rule Library says a rule's.
  const [failure, setFailure] = useState<TurnOnRecommendedProblem | null>(null);
  const [creatingKey, setCreatingKey] = useState<string>("");
  const failureRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityPlaybook(),
    ModelAction.Create,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<SecurityPlaybook> =
          await ModelAPI.getList<SecurityPlaybook>({
            modelType: SecurityPlaybook,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: { _id: true, name: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        if (isCurrent) {
          setPlaybooks(result.data);
        }
      } catch {
        // Not known: every template offers Add, as before the list was read.
        if (isCurrent) {
          setPlaybooks([]);
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, []);

  // On a phone the tile picked can sit a screen below the box that says why.
  useEffect(() => {
    if (failure) {
      bringProblemsIntoView(failureRef.current, "nearest");
    }
  }, [failure]);

  const createFromTemplate: (
    template: SecurityPlaybookTemplate,
  ) => Promise<void> = async (
    template: SecurityPlaybookTemplate,
  ): Promise<void> => {
    setCreatingKey(template.key);
    setFailure(null);

    const name: string =
      translator.translateText(template.name) || template.name;

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
      // The priorities and statuses the template's steps name, as the project has them.
      const caseValues: SecurityCaseValueLists =
        values || (await getSecurityCaseValues(projectId));

      /*
       * The record Turn on recommended makes from a template too
       * (SecurityTemplateRecords), named as the reader's language words
       * it - which SecurityTemplatesCreatable holds to the name's width in
       * every language.
       */
      const playbook: SecurityPlaybook = buildSecurityPlaybookFromTemplate({
        projectId: projectId,
        template: template.definition,
        priorities: caseValues.priorities,
        statuses: caseValues.statuses,
        name,
        description:
          translator.translateText(template.description) ||
          template.description,
      });

      const response: { data: unknown } =
        await ModelAPI.create<SecurityPlaybook>({
          model: playbook,
          modelType: SecurityPlaybook,
        });

      const created: { _id?: string } = response.data as { _id?: string };

      if (created?._id) {
        Navigation.navigate(getPlaybookViewRoute(new ObjectID(created._id)));
      }
    } catch (err) {
      /*
       * Why, in the product's words - the role, the plan, a record OneUptime
       * would not save, or a failure on its side - never a server's raw
       * sentence in grey.
       */
      setFailure({
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Add,
        name,
        ...describeAddFailure(err),
      });
    }

    setCreatingKey("");
  };

  return (
    <section
      className="mx-auto max-w-4xl text-left"
      aria-labelledby={props.showIntro ? headingId : undefined}
      data-testid={PLAYBOOK_TEMPLATE_PICKER_TEST_ID}
    >
      {props.showIntro ? (
        <div className="mb-5 flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50"
            aria-hidden="true"
          >
            <Icon icon={IconProp.Bolt} className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h3
              id={headingId}
              className="text-base font-semibold text-gray-900"
            >
              {translator.translateText(PLAYBOOK_TEMPLATES_TITLE)}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(PLAYBOOK_TEMPLATES_DESCRIPTION)}
            </p>
          </div>
        </div>
      ) : (
        <></>
      )}

      {failure ? (
        <div className="mb-4" ref={failureRef}>
          <SecurityTurnOnProblems
            problems={[failure]}
            title={
              translator.translateText(PLAYBOOK_NOT_ADDED_TITLE) ||
              PLAYBOOK_NOT_ADDED_TITLE
            }
            dataTestId="security-playbook-template-problems"
          />
        </div>
      ) : (
        <></>
      )}

      <ul role="list" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {SECURITY_PLAYBOOK_TEMPLATES.map(
          (template: SecurityPlaybookTemplate): ReactElement => {
            const name: string =
              translator.translateText(template.name) || template.name;
            const added: SecurityPlaybook | undefined = playbooks
              ? findPlaybookOfTemplate(playbooks, template, [name])
              : undefined;
            const stepCount: number = getTemplateStepCount(template);

            return (
              <li
                key={template.key}
                className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                data-testid={`security-playbook-template-tile-${template.key}`}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div
                    aria-hidden="true"
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
                  >
                    <Icon icon={template.icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900">
                      {name}
                    </h4>
                    {/* When it runs, and how much it does: the template's facts, on one line. */}
                    <p className="text-xs text-gray-500">
                      {translator.translateText(template.trigger) ||
                        template.trigger}
                      {" · "}
                      {translator.translatePlural(
                        { one: "{{count}} step", other: "{{count}} steps" },
                        stepCount,
                      )}
                    </p>
                  </div>
                </div>
                <p className="mt-2 flex-1 text-sm text-gray-600">
                  {translator.translateText(template.description)}
                </p>
                {/* As a Free List's tile ends: Added on the left, the action on the right. */}
                <div className="mt-4 flex min-h-[2rem] flex-wrap items-center justify-end gap-2">
                  {added && added._id ? (
                    <>
                      <div
                        className="me-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                        data-testid={`security-playbook-template-added-${template.key}`}
                      >
                        <Icon icon={IconProp.Check} className="h-4 w-4" />
                        {translator.translateText("Added")}
                      </div>
                      <Button
                        title="View"
                        ariaLabel={`${translator.translateText("View") || "View"}: ${name}`}
                        icon={IconProp.ArrowRight}
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        dataTestId={`security-playbook-template-view-${template.key}`}
                        onClick={() => {
                          Navigation.navigate(
                            getPlaybookViewRoute(
                              new ObjectID(added._id!.toString()),
                            ),
                          );
                        }}
                      />
                    </>
                  ) : (
                    <Button
                      title="Add Playbook"
                      ariaLabel={`${translator.translateText("Add Playbook") || "Add Playbook"}: ${name}`}
                      icon={IconProp.Add}
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      isLoading={creatingKey === template.key}
                      disabled={!createGate.isAllowed || Boolean(creatingKey)}
                      tooltip={
                        createGate.isAllowed
                          ? undefined
                          : createGate.disabledReason
                      }
                      dataTestId={`security-playbook-template-${template.key}`}
                      onClick={() => {
                        void createFromTemplate(template);
                      }}
                    />
                  )}
                </div>
              </li>
            );
          },
        )}
      </ul>

      {props.onCreateBlank ? (
        <div className="mt-5 flex justify-center">
          <Button
            title="Create a blank playbook"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={!createGate.isAllowed}
            tooltip={
              createGate.isAllowed ? undefined : createGate.disabledReason
            }
            dataTestId="security-playbook-create-blank"
            onClick={props.onCreateBlank}
          />
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default SecurityPlaybookTemplatePicker;
