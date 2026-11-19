import {
  CustomRoleSummary,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "../CustomRole/CustomRoleOptions";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  WorkflowRunAs,
  readWorkflowRunAs,
} from "Common/Types/Workflow/WorkflowRunAs";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import {
  canCurrentUserGiveWorkflowRunAs,
  getWorkflowRunAsLockedReasons,
} from "Common/UI/Components/Workflow/WorkflowRunAsGate";
import {
  getLockedReason,
  getWorkflowEditGate,
} from "Common/UI/Components/Workflow/WorkflowRunGate";
import API from "Common/UI/Utils/API/API";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast, { CHANGES_SAVED } from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A WORKFLOW RUNS AS (#9695), on its Settings page, under More
 * settings: most workflows never need anything but Default.
 *
 * The card says what the workflow's steps may do, and - for Project Owner
 * or a custom role - whose permissions it runs with, since when, and who
 * may change it. Change Run As offers only what the signed-in person could
 * give a team themselves (WorkflowRunAsGate, the server's rule), warns
 * before Project Owner, and says that the workflow runs with their
 * permissions. Someone who may not change a workflow that runs as more
 * than Default sees why, on the locked button. The server decides every
 * save (WorkflowRunAsAuthority).
 */

// The card's place on the page: "#run-as" opens More settings at it.
export const WORKFLOW_RUN_AS_PLACE: string = "run-as";

export const WorkflowRunAsCardCopy: {
  readonly title: string;
  readonly description: string;
  readonly change: string;
  readonly modalTitle: string;
  readonly modalDescription: string;
  readonly defaultTitle: string;
  readonly defaultDescription: string;
  readonly ownerTitle: string;
  readonly ownerDescription: string;
  readonly roleTitle: string;
  readonly roleDescription: string;
  readonly roleField: string;
  readonly roleFieldDescription: string;
  readonly ownerWarning: string;
  readonly roleNote: string;
  readonly yourPermissions: string;
  readonly newTriggerKeys: string;
  readonly ownerOnly: string;
  readonly noRoleToGive: string;
  readonly runsWithDefault: string;
  readonly runsWithOwner: string;
  readonly runsWithRole: string;
  readonly givenBy: string;
  readonly givenByNobody: string;
  readonly changedByOwners: string;
  readonly changedByRoleHolders: string;
  readonly runsWithUnnamedRole: string;
  readonly changedByUnnamedRoleHolders: string;
  readonly roleDeleted: string;
} = {
  title: translationKey("Run As"),
  description: translationKey(
    "What this workflow's steps can do in the project.",
  ),
  change: translationKey("Change Run As"),
  modalTitle: translationKey("Change Run As"),
  modalDescription: translationKey(
    "Choose what this workflow's steps can do. You can only choose permissions you have yourself.",
  ),
  defaultTitle: translationKey("Default"),
  defaultDescription: translationKey(
    "What a Project Admin can do, except change who has access, read stored credentials or see private incidents.",
  ),
  ownerTitle: translationKey("Project Owner"),
  ownerDescription: translationKey(
    "Everything a Project Owner can do here, including giving teams permissions and roles and changing who is on them.",
  ),
  roleTitle: translationKey("A custom role"),
  roleDescription: translationKey(
    "Exactly what one of your custom roles allows, and nothing more.",
  ),
  roleField: translationKey("Custom Role"),
  roleFieldDescription: translationKey(
    "Only the roles you could give a team yourself are listed.",
  ),
  ownerWarning: translationKey(
    "Its steps will be able to do anything a Project Owner can, including giving any team any permission. Only Project Owners will be able to change this workflow or run it by hand.",
  ),
  roleNote: translationKey(
    "Its steps will be able to do what this role allows, teams included if the role may change them. Only people who have all of the role's permissions will be able to change this workflow or run it by hand.",
  ),
  /*
   * The server gives a workflow new trigger keys when it is raised, or
   * raised to something else (WorkflowService.giveNewTriggerKeys).
   */
  newTriggerKeys: translationKey(
    "It also gets a new webhook URL and incoming email address, so anything that calls the old ones needs the new ones.",
  ),
  yourPermissions: translationKey(
    "It runs with your permissions: if you lose them or leave the project, it stops running until someone who has them chooses Run As again.",
  ),
  ownerOnly: translationKey("Project Owner is offered to Project Owners only."),
  noRoleToGive: translationKey(
    "None of the project's custom roles is one you could give a team yourself.",
  ),
  runsWithDefault: translationKey(
    "Its steps can do what a Project Admin can, except change who has access to the project, read stored credentials, or see private incidents, alerts and episodes.",
  ),
  runsWithOwner: translationKey(
    "Its steps can do anything a Project Owner can in this project, including giving teams permissions and roles and changing who is on them.",
  ),
  runsWithRole: translationKey(
    "Its steps can do exactly what the custom role {{roleName}} allows.",
  ),
  givenBy: translationKey(
    "It runs with the permissions of {{name}}, who gave them {{time}}. If they lose them or leave the project, it stops running until someone who has them chooses Run As again.",
  ),
  givenByNobody: translationKey(
    "Nobody who still has these permissions has given them to this workflow, so it doesn't run. Someone who has them can choose Run As again.",
  ),
  changedByOwners: translationKey(
    "Only Project Owners can change this workflow or run it by hand. Anyone who can edit it can still turn it off.",
  ),
  changedByRoleHolders: translationKey(
    "Only people who have every permission in {{roleName}} can change this workflow or run it by hand. Anyone who can edit it can still turn it off.",
  ),
  // A role the viewer can't read by name: there, but not listed for them.
  runsWithUnnamedRole: translationKey(
    "Its steps can do exactly what one of the project's custom roles allows.",
  ),
  changedByUnnamedRoleHolders: translationKey(
    "Only people who have every permission in that role can change this workflow or run it by hand. Anyone who can edit it can still turn it off.",
  ),
  /*
   * The role was deleted (its id cleared with it): the runs stop, and the
   * server lets anyone who may edit the workflow choose again.
   */
  roleDeleted: translationKey(
    "The custom role this workflow runs as was deleted, so it doesn't run. Anyone who can edit it can choose what it runs as.",
  ),
};

const RUN_AS_KEY: string = "runAs";
const ROLE_KEY: string = "runAsCustomRoleId";

// What the folded More settings header says of the card.
export interface WorkflowRunAsSummary {
  isRaised: boolean;
  value: string;
}

export interface ComponentProps {
  workflowId: ObjectID;
  onRunAsChange?: ((summary: WorkflowRunAsSummary) => void) | undefined;
}

// A workflow's Run As as the card read it.
interface Loaded {
  runAs: WorkflowRunAs;
  roleId: string | null;
  givenByName: string | null;
  givenAt: Date | null;
}

const WorkflowRunAsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [roles, setRoles] = useState<Array<CustomRoleSummary>>([]);
  const [roleGrants, setRoleGrants] = useState<
    Map<string, Array<TeamPermissionGrant>>
  >(new Map());
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const workflow: Workflow | null = await ModelAPI.getItem<Workflow>({
        modelType: Workflow,
        id: props.workflowId,
        select: {
          runAs: true,
          runAsCustomRoleId: true,
          runAsGivenAt: true,
          runAsGivenByUser: {
            name: true,
            email: true,
          },
        },
      });

      if (!workflow) {
        setError(translator.translateText("Workflow not found") || "");
        setIsLoading(false);
        return;
      }

      setLoaded({
        runAs: readWorkflowRunAs(workflow.runAs) || WorkflowRunAs.ProjectOwner,
        roleId: workflow.runAsCustomRoleId?.toString().toLowerCase() || null,
        givenByName:
          workflow.runAsGivenByUser?.name?.toString() ||
          workflow.runAsGivenByUser?.email?.toString() ||
          null,
        givenAt: workflow.runAsGivenAt
          ? OneUptimeDate.fromString(workflow.runAsGivenAt)
          : null,
      });

      /*
       * The project's custom roles and what each holds, for the choice and
       * for who may change a workflow that runs as one. Someone who may not
       * read them is offered none, and the server still decides.
       */
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        try {
          setRoles(await loadCustomRoles({ projectId: projectId }));
          setRoleGrants(await loadCustomRoleGrants({ projectId: projectId }));
        } catch {
          setRoles([]);
          setRoleGrants(new Map());
        }
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, [props.workflowId.toString()]);

  const grantsOf: (roleId: string | null) => Array<TeamPermissionGrant> = (
    roleId: string | null,
  ): Array<TeamPermissionGrant> => {
    for (const [id, grants] of roleGrants) {
      if (id.toLowerCase() === (roleId || "")) {
        return grants;
      }
    }

    return [];
  };

  const roleNameOf: (roleId: string | null) => string | null = (
    roleId: string | null,
  ): string | null => {
    return (
      roles.find((role: CustomRoleSummary): boolean => {
        return role.id.toLowerCase() === (roleId || "");
      })?.name || null
    );
  };

  const currentRoleName: string | null = roleNameOf(loaded?.roleId || null);
  const isRaised: boolean = Boolean(
    loaded && loaded.runAs !== WorkflowRunAs.Default,
  );

  useEffect(() => {
    if (!loaded) {
      return;
    }

    props.onRunAsChange?.({
      isRaised: isRaised,
      value:
        loaded.runAs === WorkflowRunAs.ProjectOwner
          ? translator.translateText(WorkflowRunAsCardCopy.ownerTitle) || ""
          : loaded.runAs === WorkflowRunAs.CustomRole
            ? currentRoleName ||
              translator.translateText(WorkflowRunAsCardCopy.roleTitle) ||
              ""
            : translator.translateText(WorkflowRunAsCardCopy.defaultTitle) ||
              "",
    });
  }, [loaded, currentRoleName]);

  // The roles the signed-in person could give a team, so a workflow too.
  const givableRoles: Array<CustomRoleSummary> = roles.filter(
    (role: CustomRoleSummary): boolean => {
      return canCurrentUserGiveWorkflowRunAs({
        runAs: WorkflowRunAs.CustomRole,
        roleGrants: grantsOf(role.id.toLowerCase()),
      });
    },
  );
  const canGiveOwner: boolean = canCurrentUserGiveWorkflowRunAs({
    runAs: WorkflowRunAs.ProjectOwner,
  });

  // Why Change Run As is locked: no edit of workflows, or a Run As they lack.
  const lockedReason: string | undefined =
    getLockedReason(getWorkflowEditGate()) ||
    (loaded
      ? getWorkflowRunAsLockedReasons({
          state: {
            runAs: loaded.runAs,
            roleName: currentRoleName || undefined,
            roleGrants: grantsOf(loaded.roleId),
          },
          mayAct: canCurrentUserGiveWorkflowRunAs({
            runAs: loaded.runAs,
            roleGrants:
              loaded.runAs === WorkflowRunAs.CustomRole &&
              !roles.some((role: CustomRoleSummary): boolean => {
                return role.id.toLowerCase() === loaded.roleId;
              })
                ? []
                : grantsOf(loaded.roleId),
          }),
          translator: translator,
        }).change
      : undefined);

  const options: Array<CardSelectOption> = [
    {
      value: WorkflowRunAs.Default,
      title: WorkflowRunAsCardCopy.defaultTitle,
      description: WorkflowRunAsCardCopy.defaultDescription,
      icon: IconProp.Workflow,
    },
    ...(canGiveOwner
      ? [
          {
            value: WorkflowRunAs.ProjectOwner,
            title: WorkflowRunAsCardCopy.ownerTitle,
            description: WorkflowRunAsCardCopy.ownerDescription,
            icon: IconProp.ShieldCheck,
          },
        ]
      : []),
    ...(givableRoles.length > 0
      ? [
          {
            value: WorkflowRunAs.CustomRole,
            title: WorkflowRunAsCardCopy.roleTitle,
            description: WorkflowRunAsCardCopy.roleDescription,
            icon: IconProp.Identification,
          },
        ]
      : []),
  ];

  const save: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    setIsSaving(true);
    setSaveError("");

    const runAs: WorkflowRunAs =
      readWorkflowRunAs(values[RUN_AS_KEY]) || WorkflowRunAs.Default;

    try {
      await ModelAPI.updateById<Workflow>({
        modelType: Workflow,
        id: props.workflowId,
        data: {
          runAs: runAs,
          runAsCustomRoleId:
            runAs === WorkflowRunAs.CustomRole
              ? new ObjectID(String(values[ROLE_KEY]))
              : null,
        } as JSONObject,
      });

      Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
      setShowModal(false);
      await load();
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  /*
   * Whether saving `values` raises the workflow, or raises it to something
   * else - which gives it new trigger keys (WorkflowService
   * .changesWhatItRunsAs). Choosing the same again keeps them.
   */
  const givesNewTriggerKeys: (values: FormValues<JSONObject>) => boolean = (
    values: FormValues<JSONObject>,
  ): boolean => {
    const picked: unknown = (values as JSONObject)[RUN_AS_KEY];

    if (
      picked !== WorkflowRunAs.ProjectOwner &&
      picked !== WorkflowRunAs.CustomRole
    ) {
      return false;
    }

    if (!loaded || picked !== loaded.runAs) {
      return true;
    }

    const pickedRole: string = String(
      (values as JSONObject)[ROLE_KEY] || "",
    ).toLowerCase();

    return (
      picked === WorkflowRunAs.CustomRole &&
      Boolean(pickedRole) &&
      pickedRole !== (loaded.roleId || "")
    );
  };

  // What the footer under the choice says of what was picked.
  const getChoiceFooter: (
    values: FormValues<JSONObject>,
  ) => ReactElement | undefined = (
    values: FormValues<JSONObject>,
  ): ReactElement | undefined => {
    const picked: unknown = (values as JSONObject)[RUN_AS_KEY];
    const hidden: Array<string> = [
      ...(canGiveOwner ? [] : [WorkflowRunAsCardCopy.ownerOnly]),
      ...(roles.length > 0 && givableRoles.length === 0
        ? [WorkflowRunAsCardCopy.noRoleToGive]
        : []),
    ];

    return (
      <div className="mt-3 space-y-3" data-testid="workflow-run-as-footer">
        {picked === WorkflowRunAs.ProjectOwner ? (
          <Alert
            type={AlertType.WARNING}
            // Alert says its title in the reader's language.
            title={WorkflowRunAsCardCopy.ownerWarning}
            dataTestId="workflow-run-as-owner-warning"
          />
        ) : (
          <></>
        )}
        {picked === WorkflowRunAs.CustomRole ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(WorkflowRunAsCardCopy.roleNote)}
          </p>
        ) : (
          <></>
        )}
        {picked === WorkflowRunAs.ProjectOwner ||
        picked === WorkflowRunAs.CustomRole ? (
          <p
            className="text-sm text-gray-600"
            data-testid="workflow-run-as-your-permissions"
          >
            {translator.translateText(WorkflowRunAsCardCopy.yourPermissions)}
          </p>
        ) : (
          <></>
        )}
        {givesNewTriggerKeys(values) ? (
          <p
            className="text-sm text-gray-600"
            data-testid="workflow-run-as-new-keys"
          >
            {translator.translateText(WorkflowRunAsCardCopy.newTriggerKeys)}
          </p>
        ) : (
          <></>
        )}
        {hidden.map((line: string): ReactElement => {
          return (
            <p key={line} className="text-sm text-gray-500">
              {translator.translateText(line)}
            </p>
          );
        })}
      </div>
    );
  };

  const describeCurrent: () => Array<string> = (): Array<string> => {
    if (!loaded) {
      return [];
    }

    if (loaded.runAs === WorkflowRunAs.Default) {
      return [
        translator.translateText(WorkflowRunAsCardCopy.runsWithDefault) || "",
      ];
    }

    const isRole: boolean = loaded.runAs === WorkflowRunAs.CustomRole;

    if (isRole && !loaded.roleId) {
      return [
        translator.translateText(WorkflowRunAsCardCopy.roleDeleted) || "",
      ];
    }

    const lines: Array<string> = [
      !isRole
        ? translator.translateText(WorkflowRunAsCardCopy.runsWithOwner) || ""
        : currentRoleName
          ? translator.translateTemplate(WorkflowRunAsCardCopy.runsWithRole, {
              roleName: currentRoleName,
            })
          : translator.translateText(
              WorkflowRunAsCardCopy.runsWithUnnamedRole,
            ) || "",
    ];

    lines.push(
      loaded.givenByName && loaded.givenAt
        ? translator.translateTemplate(WorkflowRunAsCardCopy.givenBy, {
            name: loaded.givenByName,
            time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              loaded.givenAt,
            ),
          })
        : translator.translateText(WorkflowRunAsCardCopy.givenByNobody) || "",
    );

    lines.push(
      !isRole
        ? translator.translateText(WorkflowRunAsCardCopy.changedByOwners) || ""
        : currentRoleName
          ? translator.translateTemplate(
              WorkflowRunAsCardCopy.changedByRoleHolders,
              { roleName: currentRoleName },
            )
          : translator.translateText(
              WorkflowRunAsCardCopy.changedByUnnamedRoleHolders,
            ) || "",
    );

    return lines;
  };

  const pillText: string = !loaded
    ? ""
    : loaded.runAs === WorkflowRunAs.ProjectOwner
      ? WorkflowRunAsCardCopy.ownerTitle
      : loaded.runAs === WorkflowRunAs.CustomRole
        ? currentRoleName || WorkflowRunAsCardCopy.roleTitle
        : WorkflowRunAsCardCopy.defaultTitle;

  return (
    <Card
      id={WORKFLOW_RUN_AS_PLACE}
      title={WorkflowRunAsCardCopy.title}
      description={WorkflowRunAsCardCopy.description}
      buttons={[
        {
          title: WorkflowRunAsCardCopy.change,
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Edit,
          disabled: isLoading || Boolean(lockedReason) || !loaded,
          tooltip: lockedReason,
          onClick: (): void => {
            setSaveError("");
            setShowModal(true);
          },
        },
      ]}
    >
      <div data-testid="workflow-run-as-card">
        {isLoading ? <DetailListSkeleton fields={2} /> : <></>}
        {!isLoading && error ? <ErrorMessage message={error} /> : <></>}
        {!isLoading && !error && loaded ? (
          <div className="space-y-2">
            <div data-testid="workflow-run-as-current">
              <Pill
                text={pillText}
                tone={isRaised ? PillTone.Warning : PillTone.Neutral}
                isMinimal={true}
                // A custom role's name as it was typed, never looked up.
                isUserContent={
                  loaded.runAs === WorkflowRunAs.CustomRole &&
                  Boolean(currentRoleName)
                }
              />
            </div>
            {describeCurrent().map((line: string): ReactElement => {
              return (
                <p key={line} className="text-sm text-gray-600">
                  {line}
                </p>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>

      {showModal && loaded ? (
        <BasicFormModal<JSONObject>
          title={WorkflowRunAsCardCopy.modalTitle}
          description={WorkflowRunAsCardCopy.modalDescription}
          submitButtonText="Save"
          isSubmitting={isSaving}
          error={saveError || undefined}
          onClose={(): void => {
            setShowModal(false);
          }}
          onSubmit={(values: JSONObject): void => {
            void save(values);
          }}
          formProps={{
            name: "Workflow Run As",
            initialValues: {
              [RUN_AS_KEY]: loaded.runAs,
              [ROLE_KEY]: loaded.roleId || undefined,
            },
            fields: [
              {
                field: { [RUN_AS_KEY]: true },
                title: "Runs As",
                fieldType: FormFieldSchemaType.CardSelect,
                required: true,
                cardSelectOptions: options,
                cardSelectSingleColumn: true,
                getFooterElement: getChoiceFooter,
              },
              {
                field: { [ROLE_KEY]: true },
                title: WorkflowRunAsCardCopy.roleField,
                description: WorkflowRunAsCardCopy.roleFieldDescription,
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                // A role's name as it was typed, never looked up.
                dropdownOptions: givableRoles.map((role: CustomRoleSummary) => {
                  return {
                    label: role.name,
                    value: role.id,
                    isUserContent: true,
                  };
                }),
                showIf: (values: FormValues<JSONObject>): boolean => {
                  return (
                    (values as JSONObject)[RUN_AS_KEY] ===
                    WorkflowRunAs.CustomRole
                  );
                },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default WorkflowRunAsCard;
