import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import CloudWafAccessPanel from "./CloudWafAccessPanel";
import {
  CloudWafWebAclCell,
  CloudWafClientAddressCell,
  CloudWafStatusCell,
  getClientAddressOptions,
  getRowClientAddresses,
  readClientAddress,
  readCloudWafKind,
  readCloudWafStatus,
  writeLeftInCloud,
} from "./CloudWafCells";
import {
  CloudWafAccess,
  CloudWafCandidate,
  CloudWafCandidates,
  CloudWafCheck,
  checkCloudWaf,
  putBackCloudWaf,
  readCloudWafCandidates,
  removeCloudWaf,
} from "./CloudWafApi";
import {
  ACCESS_NEEDED_TO_ADD,
  ADDED_NOT_ENFORCING_TOAST,
  ADDED_TOAST,
  ADD_VERB,
  ADD_WAF_DESCRIPTION,
  ADD_WAF_TITLE,
  ALL_WAFS_PICKED,
  CHANGED_CLIENT_ADDRESS_TOAST,
  CHANGE_CLIENT_ADDRESS_ACTION,
  CHANGE_CLIENT_ADDRESS_TITLE,
  CHECKED_COLUMN_TITLE,
  CHECKED_TOAST,
  CHECK_AGAIN_ACTION,
  CLIENT_ADDRESS_COLUMN_TITLE,
  CLIENT_ADDRESS_FIELD_DESCRIPTION,
  CLIENT_ADDRESS_FIELD_TITLE,
  CLOUD_ARMOR_CLIENT_ADDRESS_DESCRIPTION,
  CLOUD_ARMOR_GLOBAL_LOCATION,
  CLOUD_WAFS_DESCRIPTION,
  CLOUD_WAFS_EMPTY_DESCRIPTION,
  CLOUD_WAFS_EMPTY_TITLE,
  CLOUD_WAFS_TITLE,
  CLOUD_WAF_TEST_IDS,
  FRONT_DOOR_CLIENT_ADDRESS_DESCRIPTION,
  KEEP_IN_CLOUD_FIELD_DESCRIPTION,
  KEEP_IN_CLOUD_FIELD_TITLE,
  KEEP_IN_POLICY_FIELD_DESCRIPTION,
  LEFT_IN_AZURE_TITLE,
  LEFT_IN_CLOUD_ARMOR_TITLE,
  LEFT_IN_CLOUD_DESCRIPTION,
  LEFT_IN_CLOUD_TITLE,
  LEFT_IN_POLICY_DESCRIPTION,
  NO_CLOUD_CONNECTION,
  NO_WAFS,
  OPEN_CLOUD_CONNECTIONS,
  PUT_BACK_TOAST,
  PUT_IT_BACK_ACTION,
  REMOVED_TOAST,
  REMOVE_ACTION,
  REMOVE_AZURE_DESCRIPTION,
  REMOVE_CLOUD_ARMOR_DESCRIPTION,
  REMOVE_DESCRIPTION,
  REMOVE_TITLE,
  SHOW_RULE_ACTION,
  STATUS_COLUMN_TITLE,
  TURN_ON_BLOCKING,
  TURN_ON_POLICY_BLOCKING,
  WAF_COLUMN_TITLE,
  WAF_FIELD_DESCRIPTION,
  WAF_FIELD_TITLE,
  WAF_PLURAL,
  WAF_SINGULAR,
  WEB_ACLS_NOT_READ,
  WEB_ACL_OPTION,
} from "./CloudWafCopy";
import CloudWafRuleModal from "./CloudWafRuleModal";
import SecurityBlockCloudWaf from "Common/Models/DatabaseModels/SecurityBlockCloudWaf";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  AZURE_WAF_KIND_TITLES,
  AzureWafPolicyKind,
} from "Common/Types/CloudConnection/AzureWafBlocklist";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockCloudWafKind } from "Common/Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import { wordSecurityBlockReason } from "Common/Types/SecurityBlocklist/SecurityBlockReason";
import ActionButtonSchema, {
  RowActionContext,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import {
  Translator,
  composedValue,
  formatList,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST > CLOUD WAFS (#10344, #10348,
 * #10349): the cloud WAFs the blocklist is enforced in - AWS WAF web ACLs,
 * Azure Application Gateway and Front Door WAF policies, Google Cloud Armor
 * security policies - listed the same way: each by its name and where it
 * is, where it reads the client's address, and where it stands: enforcing,
 * applying, waiting for its team's rule, without a free priority, changed
 * by hand, or not enforcing, and why.
 *
 * Add WAF picks one from the project's inventory - of a connection whose
 * blocking setting is on - and sets it up at once. An Azure WAF or Cloud
 * Armor policy is added only once its connection may write it: the dialog
 * asks the cloud, writing nothing, and gives the exact lines that grant
 * what is missing. Where the client's address is read folds under More
 * fields, defaulting to the address that connected.
 *
 * On each row: Show Rule (AWS WAF's rule as Terraform and CloudFormation),
 * Check Again, Put It Back (OneUptime's rules changed by hand, written
 * again), Client Address, and Remove - which takes OneUptime's rules out
 * first, or leaves them, naming what stays, when OneUptime may no longer
 * write them. Each takes a role that may change where the blocklist is
 * enforced (Project Owner, Project Admin, Security Admin).
 */

const WAF_FIELD: string = "cloudResourceId";
const KEEP_IN_CLOUD_FIELD: string = "keepInCloud";
const ACCESS_FIELD: string = "access";
const CHANGE_CLIENT_ADDRESS_FIELD: string = "clientAddress";

// One field of where the client's address is read for each set of choices a kind has.
const CLIENT_ADDRESS_FIELDS: Readonly<Record<string, string>> = {
  [SecurityBlockCloudWafKind.AwsWebAcl]: "clientAddressAws",
  [SecurityBlockCloudWafKind.AzureFrontDoor]: "clientAddressFrontDoor",
  [SecurityBlockCloudWafKind.CloudArmor]: "clientAddressCloudArmor",
};

const CLOSE: string = translationKey("Close");

type Dialog =
  | { kind: "add" }
  | { kind: "rule"; row: SecurityBlockCloudWaf }
  | {
      kind: "clientAddress";
      row: SecurityBlockCloudWaf;
      context?: RowActionContext;
    }
  | { kind: "remove"; row: SecurityBlockCloudWaf; context?: RowActionContext }
  | {
      kind: "left";
      name: string;
      cloudProvider: string;
      items: Array<SecurityBlockCloudWafLeftItem>;
    };

// Words of this card in the reader's language, or as written when not translated.
function say(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

function isPolicyKind(kind: SecurityBlockCloudWafKind | null): boolean {
  return (
    kind === SecurityBlockCloudWafKind.AzureApplicationGateway ||
    kind === SecurityBlockCloudWafKind.AzureFrontDoor ||
    kind === SecurityBlockCloudWafKind.CloudArmor
  );
}

// Why some WAFs are not offered, and what lets them be: one line each.
export function getCloudWafAddNotes(data: {
  translator: Translator;
  candidates: CloudWafCandidates;
}): Array<string> {
  const { translator, candidates } = data;

  if (candidates.connections.length === 0) {
    return [say(translator, NO_CLOUD_CONNECTION)];
  }

  if (candidates.candidates.length === 0) {
    return [say(translator, NO_WAFS)];
  }

  const notes: Array<string> = [];
  const offFor: (isAws: boolean) => Array<string> = (
    isAws: boolean,
  ): Array<string> => {
    return Array.from(
      new Set(
        candidates.candidates
          .filter((candidate: CloudWafCandidate): boolean => {
            return (
              !candidate.isBlockingOn &&
              !candidate.isPicked &&
              (candidate.cloudProvider === CloudProvider.AWS) === isAws
            );
          })
          .map((candidate: CloudWafCandidate): string => {
            return candidate.connectionName;
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
      ),
    );
  };

  for (const [isAws, template] of [
    [true, TURN_ON_BLOCKING],
    [false, TURN_ON_POLICY_BLOCKING],
  ] as Array<[boolean, string]>) {
    const names: Array<string> = offFor(isAws);

    if (names.length > 0) {
      notes.push(
        translator.translateTemplate(template, {
          connections: composedValue((words: Translator): string => {
            return formatList(names, words);
          }),
        }),
      );
    }
  }

  if (
    candidates.candidates.some((candidate: CloudWafCandidate): boolean => {
      return (
        candidate.isBlockingOn &&
        !candidate.isListed &&
        candidate.cloudProvider === CloudProvider.AWS
      );
    })
  ) {
    notes.push(say(translator, WEB_ACLS_NOT_READ));
  }

  // A policy OneUptime cannot hold the blocklist in says why, in the reader's words.
  for (const candidate of candidates.candidates) {
    if (candidate.isBlockingOn && !candidate.isListed) {
      const refusal: string = candidate.refusalReason
        ? wordSecurityBlockReason(candidate.refusalReason, translator)
        : candidate.refusal;

      if (refusal) {
        notes.push(refusal);
      }
    }
  }

  if (getCloudWafOptions({ translator, candidates }).length === 0) {
    notes.push(say(translator, ALL_WAFS_PICKED));
  }

  return Array.from(new Set(notes));
}

// Where a candidate is, in the list: "eu-west-1", "CloudFront", "Front Door", "Cloud Armor, global".
function writeCandidateWhere(candidate: CloudWafCandidate): string {
  if (candidate.kind === SecurityBlockCloudWafKind.AzureApplicationGateway) {
    return AZURE_WAF_KIND_TITLES[AzureWafPolicyKind.ApplicationGateway];
  }

  if (candidate.kind === SecurityBlockCloudWafKind.AzureFrontDoor) {
    return AZURE_WAF_KIND_TITLES[AzureWafPolicyKind.FrontDoor];
  }

  if (candidate.kind === SecurityBlockCloudWafKind.CloudArmor) {
    const place: string =
      candidate.region && candidate.region !== "global"
        ? candidate.region
        : CLOUD_ARMOR_GLOBAL_LOCATION;

    return `Cloud Armor, ${place}`;
  }

  return candidate.isCloudFront ? "CloudFront" : candidate.region;
}

// The WAFs that may be picked: of a connection that may block, read whole, not picked yet.
export function getCloudWafOptions(data: {
  translator: Translator;
  candidates: CloudWafCandidates;
}): Array<DropdownOption> {
  return data.candidates.candidates
    .filter((candidate: CloudWafCandidate): boolean => {
      return (
        candidate.isBlockingOn && candidate.isListed && !candidate.isPicked
      );
    })
    .map((candidate: CloudWafCandidate): DropdownOption => {
      return {
        label: data.translator.translateTemplate(WEB_ACL_OPTION, {
          name: candidate.name,
          where: writeCandidateWhere(candidate),
          connection: candidate.connectionName,
        }),
        value: candidate.cloudResourceId,
        // Names the cloud and the person gave, put in the reader's words here: drawn as it is, the page's way.
        isUserContent: true,
        isInPageDirection: true,
      };
    });
}

// The field that holds where a candidate reads the client's address, when it has a choice.
export function getClientAddressField(
  candidate: CloudWafCandidate | undefined,
): string | null {
  if (!candidate?.kind || candidate.clientAddresses.length < 2) {
    return null;
  }

  return CLIENT_ADDRESS_FIELDS[candidate.kind] || null;
}

export interface ComponentProps {
  // Told once a WAF is added, checked or removed: where the blocklist is enforced changed.
  onChanged: () => void;
}

const BlocklistCloudWafs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [candidates, setCandidates] = useState<CloudWafCandidates | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // What the access check last found of each policy picked in Add WAF.
  const [accessByResource, setAccessByResource] = useState<
    Map<string, CloudWafAccess | null>
  >(new Map());
  const moreFields: FormFieldCollapsibleSection<JSONObject> = useRef(
    getAdvancedFormSection<JSONObject>(),
  ).current;

  // Adding, checking and removing write the customer's cloud: the create role.
  const writeGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlockCloudWaf(),
    ModelAction.Create,
  );

  const refresh: VoidFunction = (): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
    props.onChanged();
  };

  const close: VoidFunction = (): void => {
    setDialog(null);
    setError(undefined);
    setIsSubmitting(false);
  };

  // The candidates are read each time Add WAF opens: a connection may have changed.
  useEffect(() => {
    if (dialog?.kind !== "add") {
      return;
    }

    let isCurrent: boolean = true;

    setCandidates(null);
    setAccessByResource(new Map());
    readCloudWafCandidates()
      .then((found: CloudWafCandidates) => {
        if (isCurrent) {
          setCandidates(found);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setCandidates({ candidates: [], connections: [] });
          setError(API.getFriendlyMessage(caught));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dialog?.kind]);

  if (!projectId) {
    return <></>;
  }

  const candidateOf: (values: JSONObject) => CloudWafCandidate | undefined = (
    values: JSONObject,
  ): CloudWafCandidate | undefined => {
    const cloudResourceId: string = String(values[WAF_FIELD] || "");

    return candidates?.candidates.find(
      (candidate: CloudWafCandidate): boolean => {
        return candidate.cloudResourceId === cloudResourceId;
      },
    );
  };

  const add: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const picked: CloudWafCandidate | undefined = candidateOf(values);
    const cloudResourceId: string = String(values[WAF_FIELD] || "");

    // An Azure WAF or Cloud Armor policy waits for its connection's access.
    if (
      picked &&
      isPolicyKind(picked.kind) &&
      !accessByResource.get(cloudResourceId)?.isGranted
    ) {
      setError(say(translator, ACCESS_NEEDED_TO_ADD));
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const field: string | null = getClientAddressField(picked);
      const model: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();
      model.cloudResourceId = new ObjectID(cloudResourceId);
      model.clientAddress = field
        ? readClientAddress(values[field])
        : picked?.clientAddresses[0] || SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS;

      const created: JSONObject = (
        await ModelAPI.create<SecurityBlockCloudWaf>({
          model,
          modelType: SecurityBlockCloudWaf,
        })
      ).data as JSONObject;
      const id: string = String(created?.["_id"] || "");
      const name: string = picked?.name || "";

      // Set up at once: AWS WAF's IP sets made and its rule placed, a policy read and set up.
      let check: CloudWafCheck | null = null;

      if (id) {
        try {
          check = await checkCloudWaf(new ObjectID(id));
        } catch {
          // Added: the next pass sets it up, and its status says how that went.
          check = null;
        }
      }

      Toast.success(
        translator.translateTemplate(
          check?.status === SecurityBlockCloudWafStatus.Enforcing
            ? ADDED_TOAST
            : ADDED_NOT_ENFORCING_TOAST,
          { name },
        ),
      );
      close();
      refresh();
    } catch (caught) {
      setError(API.getFriendlyMessage(caught));
      setIsSubmitting(false);
    }
  };

  const actionButtons: Array<ActionButtonSchema<SecurityBlockCloudWaf>> = [
    {
      title: SHOW_RULE_ACTION,
      icon: IconProp.Code,
      buttonStyleType: ButtonStyleType.OUTLINE,
      // AWS WAF's rule as code: an Azure WAF or Cloud Armor policy's rules are OneUptime's alone.
      isVisible: (row: SecurityBlockCloudWaf): boolean => {
        return readCloudWafKind(row) === SecurityBlockCloudWafKind.AwsWebAcl;
      },
      onClick: (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
      ): void => {
        setDialog({ kind: "rule", row });
        onCompleteAction();
      },
    },
    {
      title: PUT_IT_BACK_ACTION,
      icon: IconProp.ArrowUturnLeft,
      buttonStyleType: ButtonStyleType.NORMAL,
      disabled: !writeGate.isAllowed && Boolean(writeGate.disabledReason),
      tooltip: writeGate.isAllowed ? undefined : writeGate.disabledReason,
      isVisible: (row: SecurityBlockCloudWaf): boolean => {
        return (
          isPolicyKind(readCloudWafKind(row)) &&
          readCloudWafStatus(row) === SecurityBlockCloudWafStatus.Drifted
        );
      },
      onClick: async (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        context?: RowActionContext,
      ): Promise<void> => {
        try {
          await putBackCloudWaf(row.id!);
          Toast.success(
            translator.translateTemplate(PUT_BACK_TOAST, {
              name: row.name || "",
            }),
          );
          onCompleteAction();
          context?.refresh();
          refresh();
        } catch (caught) {
          onError(caught as Error);
        }
      },
    },
    {
      title: CHECK_AGAIN_ACTION,
      icon: IconProp.Refresh,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !writeGate.isAllowed && Boolean(writeGate.disabledReason),
      tooltip: writeGate.isAllowed ? undefined : writeGate.disabledReason,
      onClick: async (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        context?: RowActionContext,
      ): Promise<void> => {
        try {
          await checkCloudWaf(row.id!);
          Toast.success(
            translator.translateTemplate(CHECKED_TOAST, {
              name: row.name || "",
            }),
          );
          onCompleteAction();
          context?.refresh();
          refresh();
        } catch (caught) {
          onError(caught as Error);
        }
      },
    },
    {
      title: CHANGE_CLIENT_ADDRESS_ACTION,
      icon: IconProp.Edit,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !writeGate.isAllowed && Boolean(writeGate.disabledReason),
      tooltip: writeGate.isAllowed ? undefined : writeGate.disabledReason,
      // Only where the WAF can read the client's address in more than one place.
      isVisible: (row: SecurityBlockCloudWaf): boolean => {
        return getRowClientAddresses(row).length > 1;
      },
      onClick: (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
        _onError: ErrorFunction,
        context?: RowActionContext,
      ): void => {
        setDialog({
          kind: "clientAddress",
          row,
          ...(context ? { context } : {}),
        });
        onCompleteAction();
      },
    },
    {
      title: REMOVE_ACTION,
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      disabled: !writeGate.isAllowed && Boolean(writeGate.disabledReason),
      tooltip: writeGate.isAllowed ? undefined : writeGate.disabledReason,
      onClick: (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
        _onError: ErrorFunction,
        context?: RowActionContext,
      ): void => {
        setDialog({ kind: "remove", row, ...(context ? { context } : {}) });
        onCompleteAction();
      },
    },
  ];

  let modal: ReactElement = <></>;

  if (dialog?.kind === "add") {
    const options: Array<DropdownOption> = candidates
      ? getCloudWafOptions({ translator, candidates })
      : [];
    const notes: Array<string> = candidates
      ? getCloudWafAddNotes({ translator, candidates })
      : [];
    const clientAddressField: (
      kind: SecurityBlockCloudWafKind,
      description: string,
      choices: ReadonlyArray<SecurityBlockClientAddress>,
    ) => Field<JSONObject> = (
      kind: SecurityBlockCloudWafKind,
      description: string,
      choices: ReadonlyArray<SecurityBlockClientAddress>,
    ): Field<JSONObject> => {
      return {
        field: { [CLIENT_ADDRESS_FIELDS[kind]!]: true },
        title: CLIENT_ADDRESS_FIELD_TITLE,
        description,
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: getClientAddressOptions(translator, choices, kind),
        required: false,
        collapsibleSection: moreFields,
        showIf: (values: FormValues<JSONObject>): boolean => {
          const picked: CloudWafCandidate | undefined = candidateOf(
            values as JSONObject,
          );

          return getClientAddressField(picked) === CLIENT_ADDRESS_FIELDS[kind];
        },
      };
    };

    modal = (
      <BasicFormModal<JSONObject>
        title={ADD_WAF_TITLE}
        description={ADD_WAF_DESCRIPTION}
        name="Security Events > Blocklist > Add WAF"
        submitButtonText={ADD_WAF_TITLE}
        isLoading={!candidates}
        isSubmitting={isSubmitting}
        error={error}
        onClose={close}
        onSubmit={add}
        beforeFormElement={
          notes.length > 0 ? (
            <div
              className="mb-4 space-y-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"
              data-testid={CLOUD_WAF_TEST_IDS.addNote}
            >
              {notes.map((note: string, index: number): ReactElement => {
                return <p key={index}>{note}</p>;
              })}
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CLOUD_CONNECT] as Route,
                )}
                className="font-medium underline"
              >
                {say(translator, OPEN_CLOUD_CONNECTIONS)}
              </AppLink>
            </div>
          ) : undefined
        }
        formProps={{
          name: "Add WAF",
          initialValues: {
            [CLIENT_ADDRESS_FIELDS[SecurityBlockCloudWafKind.AwsWebAcl]!]:
              SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
            [CLIENT_ADDRESS_FIELDS[SecurityBlockCloudWafKind.AzureFrontDoor]!]:
              SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
            [CLIENT_ADDRESS_FIELDS[SecurityBlockCloudWafKind.CloudArmor]!]:
              SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
          },
          fields: [
            {
              field: { [WAF_FIELD]: true },
              title: WAF_FIELD_TITLE,
              description: WAF_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: options,
              required: true,
            },
            {
              field: { [ACCESS_FIELD]: true },
              title: "",
              fieldType: FormFieldSchemaType.CustomComponent,
              required: false,
              hideOptionalLabel: true,
              showIf: (values: FormValues<JSONObject>): boolean => {
                return isPolicyKind(
                  candidateOf(values as JSONObject)?.kind || null,
                );
              },
              getCustomElement: (
                values: FormValues<JSONObject>,
              ): ReactElement => {
                const picked: CloudWafCandidate | undefined = candidateOf(
                  values as JSONObject,
                );

                return picked ? (
                  <CloudWafAccessPanel
                    key={picked.cloudResourceId}
                    cloudResourceId={picked.cloudResourceId}
                    name={picked.name}
                    onChecked={(access: CloudWafAccess | null): void => {
                      setAccessByResource(
                        (
                          before: Map<string, CloudWafAccess | null>,
                        ): Map<string, CloudWafAccess | null> => {
                          const next: Map<string, CloudWafAccess | null> =
                            new Map(before);

                          next.set(picked.cloudResourceId, access);
                          return next;
                        },
                      );
                    }}
                  />
                ) : (
                  <></>
                );
              },
            },
            clientAddressField(
              SecurityBlockCloudWafKind.AwsWebAcl,
              CLIENT_ADDRESS_FIELD_DESCRIPTION,
              [
                SecurityBlockClientAddress.SourceIp,
                SecurityBlockClientAddress.XForwardedFor,
                SecurityBlockClientAddress.CfConnectingIp,
                SecurityBlockClientAddress.TrueClientIp,
              ],
            ),
            clientAddressField(
              SecurityBlockCloudWafKind.AzureFrontDoor,
              FRONT_DOOR_CLIENT_ADDRESS_DESCRIPTION,
              [
                SecurityBlockClientAddress.SourceIp,
                SecurityBlockClientAddress.ForwardedClient,
              ],
            ),
            clientAddressField(
              SecurityBlockCloudWafKind.CloudArmor,
              CLOUD_ARMOR_CLIENT_ADDRESS_DESCRIPTION,
              [
                SecurityBlockClientAddress.SourceIp,
                SecurityBlockClientAddress.UserIp,
              ],
            ),
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "rule") {
    modal = <CloudWafRuleModal row={dialog.row} onClose={close} />;
  }

  if (dialog?.kind === "clientAddress") {
    const row: SecurityBlockCloudWaf = dialog.row;
    const kind: SecurityBlockCloudWafKind | null = readCloudWafKind(row);
    const choices: ReadonlyArray<SecurityBlockClientAddress> =
      getRowClientAddresses(row);

    modal = (
      <BasicFormModal<JSONObject>
        title={CHANGE_CLIENT_ADDRESS_TITLE}
        name="Security Events > Blocklist > Change Client Address"
        submitButtonText={CHANGE_CLIENT_ADDRESS_TITLE}
        isSubmitting={isSubmitting}
        error={error}
        onClose={close}
        onSubmit={async (values: JSONObject) => {
          setIsSubmitting(true);
          setError(undefined);

          try {
            await ModelAPI.updateById<SecurityBlockCloudWaf>({
              modelType: SecurityBlockCloudWaf,
              id: row.id!,
              data: {
                clientAddress: readClientAddress(
                  values[CHANGE_CLIENT_ADDRESS_FIELD],
                ),
              },
            });
            Toast.success(
              translator.translateTemplate(CHANGED_CLIENT_ADDRESS_TOAST, {
                name: row.name || "",
              }),
            );
            dialog.context?.refresh();
            close();
            refresh();
          } catch (caught) {
            setError(API.getFriendlyMessage(caught));
            setIsSubmitting(false);
          }
        }}
        formProps={{
          name: "Change Client Address",
          initialValues: {
            [CHANGE_CLIENT_ADDRESS_FIELD]: readClientAddress(row.clientAddress),
          },
          fields: [
            {
              field: { [CHANGE_CLIENT_ADDRESS_FIELD]: true },
              title: CLIENT_ADDRESS_FIELD_TITLE,
              description:
                kind === SecurityBlockCloudWafKind.AzureFrontDoor
                  ? FRONT_DOOR_CLIENT_ADDRESS_DESCRIPTION
                  : kind === SecurityBlockCloudWafKind.CloudArmor
                    ? CLOUD_ARMOR_CLIENT_ADDRESS_DESCRIPTION
                    : CLIENT_ADDRESS_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: getClientAddressOptions(
                translator,
                choices,
                kind,
              ),
              required: true,
            },
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "remove") {
    const row: SecurityBlockCloudWaf = dialog.row;
    const name: string = row.name || "";
    const kind: SecurityBlockCloudWafKind | null = readCloudWafKind(row);

    modal = (
      <BasicFormModal<JSONObject>
        title={REMOVE_TITLE}
        description={translator.translateTemplate(
          kind === SecurityBlockCloudWafKind.CloudArmor
            ? REMOVE_CLOUD_ARMOR_DESCRIPTION
            : isPolicyKind(kind)
              ? REMOVE_AZURE_DESCRIPTION
              : REMOVE_DESCRIPTION,
          { name },
        )}
        name="Security Events > Blocklist > Remove WAF"
        submitButtonText={REMOVE_TITLE}
        submitButtonStyleType={ButtonStyleType.DANGER}
        isSubmitting={isSubmitting}
        error={error}
        onClose={close}
        onSubmit={async (values: JSONObject) => {
          setIsSubmitting(true);
          setError(undefined);

          try {
            const left: Array<SecurityBlockCloudWafLeftItem> =
              await removeCloudWaf({
                id: row.id!,
                keepInCloud: values[KEEP_IN_CLOUD_FIELD] === true,
              });

            dialog.context?.refresh();
            refresh();

            if (left.length > 0) {
              setIsSubmitting(false);
              setDialog({
                kind: "left",
                name,
                cloudProvider: row.cloudProvider || "",
                items: left,
              });
              return;
            }

            Toast.success(
              translator.translateTemplate(REMOVED_TOAST, { name }),
            );
            close();
          } catch (caught) {
            setError(API.getFriendlyMessage(caught));
            setIsSubmitting(false);
          }
        }}
        formProps={{
          name: "Remove WAF",
          initialValues: { [KEEP_IN_CLOUD_FIELD]: false },
          fields: [
            {
              field: { [KEEP_IN_CLOUD_FIELD]: true },
              title: KEEP_IN_CLOUD_FIELD_TITLE,
              description: isPolicyKind(kind)
                ? KEEP_IN_POLICY_FIELD_DESCRIPTION
                : KEEP_IN_CLOUD_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
            },
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "left") {
    const isAws: boolean = dialog.cloudProvider === CloudProvider.AWS;

    modal = (
      <ConfirmModal
        title={
          dialog.cloudProvider === CloudProvider.Azure
            ? LEFT_IN_AZURE_TITLE
            : dialog.cloudProvider === CloudProvider.GCP
              ? LEFT_IN_CLOUD_ARMOR_TITLE
              : LEFT_IN_CLOUD_TITLE
        }
        description={
          <div
            className="space-y-2"
            data-testid={CLOUD_WAF_TEST_IDS.leftInCloud}
          >
            <p>
              {translator.translateTemplate(
                isAws ? LEFT_IN_CLOUD_DESCRIPTION : LEFT_IN_POLICY_DESCRIPTION,
                { name: dialog.name },
              )}
            </p>
            <ul className="list-disc space-y-1 ps-5">
              {dialog.items.map(
                (item: SecurityBlockCloudWafLeftItem): ReactElement => {
                  return (
                    <li
                      key={`${item.kind}:${item.name}:${item.priority ?? ""}`}
                      className="break-all"
                    >
                      {writeLeftInCloud(translator, item)}
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        }
        submitButtonText={CLOSE}
        onSubmit={close}
      />
    );
  }

  return (
    <>
      <ModelTable<SecurityBlockCloudWaf>
        modelType={SecurityBlockCloudWaf}
        id="security-blocklist-cloud-wafs-table"
        name="Security Events > Blocklist > Cloud WAFs"
        userPreferencesKey="security-blocklist-cloud-wafs-table"
        singularName={WAF_SINGULAR}
        pluralName={WAF_PLURAL}
        createVerb={ADD_VERB}
        getItemName={(row: SecurityBlockCloudWaf): string => {
          return row.name || "";
        }}
        query={{ projectId: projectId }}
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        onCreateClick={() => {
          setDialog({ kind: "add" });
        }}
        actionButtons={actionButtons}
        sortBy="createdAt"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: CLOUD_WAFS_TITLE,
          description: CLOUD_WAFS_DESCRIPTION,
        }}
        emptyState={{
          title: CLOUD_WAFS_EMPTY_TITLE,
          description: CLOUD_WAFS_EMPTY_DESCRIPTION,
          icon: IconProp.ShieldCheck,
        }}
        showRefreshButton={true}
        filters={[]}
        selectMoreFields={{
          wafId: true,
          cloudProvider: true,
          clientAddress: true,
          status: true,
          statusMessage: true,
          statusReason: true,
          ruleDetails: true,
          createdAt: true,
        }}
        columns={[
          {
            field: { name: true },
            title: WAF_COLUMN_TITLE,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[16rem]",
            getElement: (row: SecurityBlockCloudWaf): ReactElement => {
              return <CloudWafWebAclCell row={row} />;
            },
          },
          {
            field: { clientAddress: true },
            title: CLIENT_ADDRESS_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (row: SecurityBlockCloudWaf): ReactElement => {
              return <CloudWafClientAddressCell row={row} />;
            },
          },
          {
            field: { status: true },
            title: STATUS_COLUMN_TITLE,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[24rem]",
            getElement: (row: SecurityBlockCloudWaf): ReactElement => {
              return <CloudWafStatusCell row={row} />;
            },
          },
          {
            field: { checkedAt: true },
            title: CHECKED_COLUMN_TITLE,
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />

      {modal}
    </>
  );
};

export default BlocklistCloudWafs;
