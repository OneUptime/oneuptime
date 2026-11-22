import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  CloudWafWebAclCell,
  CloudWafClientAddressCell,
  CloudWafStatusCell,
  getClientAddressOptions,
  readClientAddress,
  writeLeftInCloud,
} from "./CloudWafCells";
import {
  CloudWafCandidate,
  CloudWafCandidates,
  CloudWafCheck,
  checkCloudWaf,
  readCloudWafCandidates,
  removeCloudWaf,
} from "./CloudWafApi";
import {
  ADDED_NOT_ENFORCING_TOAST,
  ADDED_TOAST,
  ADD_VERB,
  ADD_WEB_ACL_DESCRIPTION,
  ADD_WEB_ACL_TITLE,
  ALL_WEB_ACLS_PICKED,
  CHECKED_COLUMN_TITLE,
  CHECKED_TOAST,
  CHECK_AGAIN_ACTION,
  CLIENT_ADDRESS_COLUMN_TITLE,
  CLIENT_ADDRESS_FIELD_DESCRIPTION,
  CLIENT_ADDRESS_FIELD_TITLE,
  CLOUD_WAFS_DESCRIPTION,
  CLOUD_WAFS_EMPTY_DESCRIPTION,
  CLOUD_WAFS_EMPTY_TITLE,
  CLOUD_WAFS_TITLE,
  CLOUD_WAF_TEST_IDS,
  KEEP_IN_CLOUD_FIELD_DESCRIPTION,
  KEEP_IN_CLOUD_FIELD_TITLE,
  LEFT_IN_CLOUD_DESCRIPTION,
  LEFT_IN_CLOUD_TITLE,
  NO_AWS_CONNECTION,
  NO_WEB_ACLS,
  OPEN_CLOUD_CONNECTIONS,
  REMOVED_TOAST,
  REMOVE_ACTION,
  REMOVE_DESCRIPTION,
  REMOVE_TITLE,
  SHOW_RULE_ACTION,
  STATUS_COLUMN_TITLE,
  TURN_ON_BLOCKING,
  WEB_ACLS_NOT_READ,
  WEB_ACL_COLUMN_TITLE,
  WEB_ACL_FIELD_DESCRIPTION,
  WEB_ACL_FIELD_TITLE,
  WEB_ACL_OPTION,
  WEB_ACL_PLURAL,
  WEB_ACL_SINGULAR,
} from "./CloudWafCopy";
import CloudWafRuleModal from "./CloudWafRuleModal";
import SecurityBlockCloudWaf from "Common/Models/DatabaseModels/SecurityBlockCloudWaf";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import ActionButtonSchema, {
  RowActionContext,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
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
  useState,
} from "react";

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST > CLOUD WAFS (#10344): the AWS WAF
 * web ACLs the blocklist is enforced in, each with where it stands -
 * enforcing, waiting for its team's rule, without a free priority, or not
 * enforcing, and why in the server's words. Add Web ACL picks one from the
 * project's AWS inventory - of a connection with Block addresses in AWS WAF
 * on - and sets it up at once; Show Rule gives the rule as Terraform and
 * CloudFormation; Check Again sets it up and reads it now; Remove takes
 * OneUptime's rule and IP sets out of AWS WAF first, or leaves them -
 * naming what stays - when OneUptime may no longer write them. Adding,
 * checking and removing take a role that may change where the blocklist is
 * enforced (Project Owner, Project Admin, Security Admin).
 */

const WEB_ACL_FIELD: string = "cloudResourceId";
const CLIENT_ADDRESS_FIELD: string = "clientAddress";
const KEEP_IN_CLOUD_FIELD: string = "keepInCloud";

const CLOSE: string = translationKey("Close");

type Dialog =
  | { kind: "add" }
  | { kind: "rule"; row: SecurityBlockCloudWaf }
  | { kind: "remove"; row: SecurityBlockCloudWaf; context?: RowActionContext }
  | {
      kind: "left";
      name: string;
      items: Array<SecurityBlockCloudWafLeftItem>;
    };

// Words of this card in the reader's language, or as written when not translated.
function say(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

// Why some web ACLs are not offered, and what lets them be: one line each.
export function getCloudWafAddNotes(data: {
  translator: Translator;
  candidates: CloudWafCandidates;
}): Array<string> {
  const { translator, candidates } = data;

  if (candidates.connections.length === 0) {
    return [say(translator, NO_AWS_CONNECTION)];
  }

  if (candidates.candidates.length === 0) {
    return [say(translator, NO_WEB_ACLS)];
  }

  const notes: Array<string> = [];
  const offFor: Array<string> = Array.from(
    new Set(
      candidates.candidates
        .filter((candidate: CloudWafCandidate): boolean => {
          return !candidate.isBlockingOn && !candidate.isPicked;
        })
        .map((candidate: CloudWafCandidate): string => {
          return candidate.connectionName;
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        }),
    ),
  );

  if (offFor.length > 0) {
    notes.push(
      translator.translateTemplate(TURN_ON_BLOCKING, {
        connections: composedValue((words: Translator): string => {
          return formatList(offFor, words);
        }),
      }),
    );
  }

  if (
    candidates.candidates.some((candidate: CloudWafCandidate): boolean => {
      return candidate.isBlockingOn && !candidate.isListed;
    })
  ) {
    notes.push(say(translator, WEB_ACLS_NOT_READ));
  }

  if (getCloudWafOptions({ translator, candidates }).length === 0) {
    notes.push(say(translator, ALL_WEB_ACLS_PICKED));
  }

  return notes;
}

// The web ACLs that may be picked: of a connection that may block, read whole, not picked yet.
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
          where: candidate.isCloudFront ? "CloudFront" : candidate.region,
          connection: candidate.connectionName,
        }),
        value: candidate.cloudResourceId,
      };
    });
}

export interface ComponentProps {
  // Told once a web ACL is added, checked or removed: where the blocklist is enforced changed.
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

  // The candidates are read each time Add Web ACL opens: a connection may have changed.
  useEffect(() => {
    if (dialog?.kind !== "add") {
      return;
    }

    let isCurrent: boolean = true;

    setCandidates(null);
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

  const add: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const cloudResourceId: string = String(values[WEB_ACL_FIELD] || "");
    const picked: CloudWafCandidate | undefined = candidates?.candidates.find(
      (candidate: CloudWafCandidate): boolean => {
        return candidate.cloudResourceId === cloudResourceId;
      },
    );

    setIsSubmitting(true);
    setError(undefined);

    try {
      const model: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();
      model.cloudResourceId = new ObjectID(cloudResourceId);
      model.clientAddress = readClientAddress(values[CLIENT_ADDRESS_FIELD]);

      const created: JSONObject = (
        await ModelAPI.create<SecurityBlockCloudWaf>({
          model,
          modelType: SecurityBlockCloudWaf,
        })
      ).data as JSONObject;
      const id: string = String(created?.["_id"] || "");
      const name: string = picked?.name || "";

      // Set up at once: its IP sets made, its rule placed or looked for.
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
      onClick: (
        row: SecurityBlockCloudWaf,
        onCompleteAction: VoidFunction,
      ): void => {
        setDialog({ kind: "rule", row });
        onCompleteAction();
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

    modal = (
      <BasicFormModal<JSONObject>
        title={ADD_WEB_ACL_TITLE}
        description={ADD_WEB_ACL_DESCRIPTION}
        name="Security Events > Blocklist > Add Web ACL"
        submitButtonText={ADD_WEB_ACL_TITLE}
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
          name: "Add Web ACL",
          initialValues: {
            [CLIENT_ADDRESS_FIELD]: SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
          },
          fields: [
            {
              field: { [WEB_ACL_FIELD]: true },
              title: WEB_ACL_FIELD_TITLE,
              description: WEB_ACL_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: options,
              required: true,
            },
            {
              field: { [CLIENT_ADDRESS_FIELD]: true },
              title: CLIENT_ADDRESS_FIELD_TITLE,
              description: CLIENT_ADDRESS_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: getClientAddressOptions(translator),
              required: true,
            },
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "rule") {
    modal = <CloudWafRuleModal row={dialog.row} onClose={close} />;
  }

  if (dialog?.kind === "remove") {
    const row: SecurityBlockCloudWaf = dialog.row;
    const name: string = row.name || "";

    modal = (
      <BasicFormModal<JSONObject>
        title={REMOVE_TITLE}
        description={translator.translateTemplate(REMOVE_DESCRIPTION, {
          name,
        })}
        name="Security Events > Blocklist > Remove Web ACL"
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
              setDialog({ kind: "left", name, items: left });
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
          name: "Remove Web ACL",
          initialValues: { [KEEP_IN_CLOUD_FIELD]: false },
          fields: [
            {
              field: { [KEEP_IN_CLOUD_FIELD]: true },
              title: KEEP_IN_CLOUD_FIELD_TITLE,
              description: KEEP_IN_CLOUD_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
            },
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "left") {
    modal = (
      <ConfirmModal
        title={LEFT_IN_CLOUD_TITLE}
        description={
          <div
            className="space-y-2"
            data-testid={CLOUD_WAF_TEST_IDS.leftInCloud}
          >
            <p>
              {translator.translateTemplate(LEFT_IN_CLOUD_DESCRIPTION, {
                name: dialog.name,
              })}
            </p>
            <ul className="list-disc space-y-1 ps-5">
              {dialog.items.map(
                (item: SecurityBlockCloudWafLeftItem): ReactElement => {
                  return (
                    <li key={`${item.kind}:${item.name}`} className="break-all">
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
        singularName={WEB_ACL_SINGULAR}
        pluralName={WEB_ACL_PLURAL}
        createVerb={ADD_VERB}
        getItemName={(row: SecurityBlockCloudWaf): string => {
          return row.name || "";
        }}
        query={{ projectId: projectId }}
        refreshToggle={refreshCount > 0 ? String(refreshCount) : ""}
        isDeleteable={false}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        onCreateClick={() => {
          setDialog({ kind: "add" });
        }}
        formFields={[
          {
            field: { clientAddress: true },
            title: CLIENT_ADDRESS_FIELD_TITLE,
            description: CLIENT_ADDRESS_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getClientAddressOptions(translator),
            required: true,
          },
        ]}
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
          clientAddress: true,
          status: true,
          statusMessage: true,
          ruleDetails: true,
          createdAt: true,
        }}
        columns={[
          {
            field: { name: true },
            title: WEB_ACL_COLUMN_TITLE,
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
