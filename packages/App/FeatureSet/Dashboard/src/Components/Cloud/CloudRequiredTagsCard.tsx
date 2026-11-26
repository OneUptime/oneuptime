import CloudRequiredTag from "Common/Models/DatabaseModels/CloudRequiredTag";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { parseCloudTagAllowedValues } from "Common/Types/Cloud/CloudRequiredTags";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * THE TAGS A PROJECT'S CLOUD RESOURCES MUST CARRY (#11012), on Cloud > Tags
 * (every account's and each account's own) and on an account's Tags (the
 * project's, and the account's own, which a person adds there).
 *
 * A required tag is three things to say - its key, the values it allows
 * and the account it is for - so its form is one page, with the line that
 * says what it is for folded under More fields. Allowed values are typed
 * as a person writes a list ("payments, search, platform-*") and kept as
 * one value each (parseCloudTagAllowedValues, as the server keeps them).
 */

export const REQUIRED_TAGS_TITLE: string = translationKey("Required Tags");
export const REQUIRED_TAGS_DESCRIPTION: string = translationKey(
  "The tags every resource must carry, with the values each may take. Keys match whatever their case: Team, team and TEAM are one key.",
);
export const REQUIRED_TAGS_ACCOUNT_DESCRIPTION: string = translationKey(
  "The tags every resource of this account must carry: the project's, and this account's own, which replace the project's of the same key here.",
);
export const REQUIRED_TAGS_EMPTY: string = translationKey(
  "No required tags yet. Require one, such as team or cost-center, to see how much of your spend carries it and to hear about new resources without it.",
);
export const REQUIRE_A_TAG: string = translationKey("Require a Tag");
export const EDIT_REQUIRED_TAG: string = translationKey("Edit Required Tag");
export const STOP_REQUIRING_TAG: string = translationKey("Stop Requiring Tag");
export const STOP_REQUIRING_QUESTION: string = translationKey(
  "Stop requiring {{key}}? Resources without it no longer count as missing a tag, and nobody is told about new ones.",
);
export const ANY_VALUE: string = translationKey("Any value");
export const EVERY_ACCOUNT: string = translationKey("Every account");
export const PROJECT_WIDE_HERE: string = translationKey(
  "Required in every account",
);
export const TAG_KEY_FIELD: string = translationKey("Tag Key");
export const TAG_KEY_FIELD_DESCRIPTION: string = translationKey(
  "Matched whatever its case: Team, team and TEAM are one key.",
);
export const ALLOWED_VALUES_FIELD: string = translationKey("Allowed Values");
export const ALLOWED_VALUES_FIELD_DESCRIPTION: string = translationKey(
  "Separated by commas or one a line, whatever their case. * and ? make a pattern: prod-* takes prod-eu. Empty: any value.",
);
export const ACCOUNT_FIELD: string = translationKey("Account");
export const ACCOUNT_FIELD_DESCRIPTION: string = translationKey(
  "Empty: every account. An account's own tag replaces the project's of the same key there.",
);
export const DESCRIPTION_FIELD: string = translationKey("Description");
export const DESCRIPTION_FIELD_DESCRIPTION: string = translationKey(
  "What the tag is for, said to the people told about a resource without it.",
);

export interface RequiredTagFormValues {
  tagKey: string;
  allowedValuesText: string;
  cloudAccountId: string;
  description: string;
}

// A required tag as its form edits it.
export function toRequiredTagFormValues(
  tag: CloudRequiredTag | null,
  fixedAccountId: ObjectID | null,
): RequiredTagFormValues {
  return {
    tagKey: tag?.tagKey || "",
    allowedValuesText: (tag?.allowedValues || []).join(", "),
    cloudAccountId:
      tag?.cloudAccountId?.toString() || fixedAccountId?.toString() || "",
    description: tag?.description || "",
  };
}

// What a form's values save as.
export function fromRequiredTagFormValues(values: RequiredTagFormValues): {
  tagKey: string;
  allowedValues: Array<string>;
  cloudAccountId: ObjectID | null;
  description: string;
} {
  return {
    tagKey: (values.tagKey || "").trim(),
    allowedValues: parseCloudTagAllowedValues(values.allowedValuesText || ""),
    cloudAccountId: values.cloudAccountId
      ? new ObjectID(values.cloudAccountId)
      : null,
    description: (values.description || "").trim(),
  };
}

export interface ComponentProps {
  projectId: ObjectID;
  // Its account's Tags: the account its new tags are for.
  cloudAccountId?: ObjectID | null | undefined;
  accounts: Array<CloudAccountRow>;
  // Told after a tag is required, changed or no longer required.
  onChanged?: (() => void) | undefined;
}

const CloudRequiredTagsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tags, setTags] = useState<Array<CloudRequiredTag> | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [editing, setEditing] = useState<CloudRequiredTag | "new" | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [removing, setRemoving] = useState<CloudRequiredTag | null>(null);
  const fixedAccountId: ObjectID | null = props.cloudAccountId || null;

  const createGate: PermissionGateResult = PermissionGate.check(
    new CloudRequiredTag(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new CloudRequiredTag(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new CloudRequiredTag(),
    ModelAction.Delete,
  );

  useEffect(() => {
    let ignore: boolean = false;

    setError("");

    ModelAPI.getList<CloudRequiredTag>({
      modelType: CloudRequiredTag,
      query: { projectId: props.projectId },
      select: {
        _id: true,
        tagKey: true,
        allowedValues: true,
        cloudAccountId: true,
        description: true,
      },
      sort: { tagKey: SortOrder.Ascending },
      limit: 200,
      skip: 0,
    })
      .then((result: ListResult<CloudRequiredTag>): void => {
        if (!ignore) {
          setTags(result.data);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [props.projectId.toString(), attempt]);

  // On an account's page: the project's tags, and the account's own.
  const shown: Array<CloudRequiredTag> = (tags || []).filter(
    (tag: CloudRequiredTag): boolean => {
      return (
        !fixedAccountId ||
        !tag.cloudAccountId ||
        tag.cloudAccountId.toString() === fixedAccountId.toString()
      );
    },
  );

  const accountName: (id: ObjectID | undefined) => string | null = (
    id: ObjectID | undefined,
  ): string | null => {
    if (!id) {
      return null;
    }

    const account: CloudAccountRow | undefined = props.accounts.find(
      (candidate: CloudAccountRow): boolean => {
        return candidate.id.toString() === id.toString();
      },
    );

    return account ? account.name || account.accountId : null;
  };

  const accountOptions: Array<DropdownOption> = props.accounts.map(
    (account: CloudAccountRow): DropdownOption => {
      return {
        label: account.name || account.accountId,
        value: account.id.toString(),
        isUserContent: true,
      };
    },
  );

  const fields: Fields<RequiredTagFormValues> = [
    {
      field: { tagKey: true },
      title: TAG_KEY_FIELD,
      description: TAG_KEY_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "team",
      dataTestId: "cloud-required-tag-key",
    },
    {
      field: { allowedValuesText: true },
      title: ALLOWED_VALUES_FIELD,
      description: ALLOWED_VALUES_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "payments, search, platform-*",
      dataTestId: "cloud-required-tag-values",
    },
  ];

  // On Cloud > Tags a tag is for every account or one; on an account's, for it.
  if (!fixedAccountId) {
    fields.push({
      field: { cloudAccountId: true },
      title: ACCOUNT_FIELD,
      description: ACCOUNT_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: accountOptions,
      required: false,
      placeholder: EVERY_ACCOUNT,
      dataTestId: "cloud-required-tag-account",
    });
  }

  fields.push({
    field: { description: true },
    title: DESCRIPTION_FIELD,
    description: DESCRIPTION_FIELD_DESCRIPTION,
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: "The team that pays for the resource.",
    collapsibleSection: getAdvancedFormSection<RequiredTagFormValues>(),
  });

  const save: (values: RequiredTagFormValues) => Promise<void> = async (
    values: RequiredTagFormValues,
  ): Promise<void> => {
    const data: ReturnType<typeof fromRequiredTagFormValues> =
      fromRequiredTagFormValues({
        ...values,
        cloudAccountId: fixedAccountId
          ? fixedAccountId.toString()
          : values.cloudAccountId,
      });

    setIsSaving(true);
    setSaveError("");

    try {
      if (editing && editing !== "new" && editing.id) {
        await ModelAPI.updateById<CloudRequiredTag>({
          modelType: CloudRequiredTag,
          id: editing.id,
          data: {
            tagKey: data.tagKey,
            allowedValues: data.allowedValues,
            cloudAccountId: data.cloudAccountId,
            description: data.description,
          } as never,
        });
      } else {
        const tag: CloudRequiredTag = new CloudRequiredTag();
        tag.projectId = props.projectId;
        tag.tagKey = data.tagKey;
        tag.allowedValues = data.allowedValues;
        tag.description = data.description;

        if (data.cloudAccountId) {
          tag.cloudAccountId = data.cloudAccountId;
        }

        await ModelAPI.create<CloudRequiredTag>({
          model: tag,
          modelType: CloudRequiredTag,
        });
      }

      setEditing(null);
      setAttempt(attempt + 1);
      props.onChanged?.();
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const remove: (tag: CloudRequiredTag) => Promise<void> = async (
    tag: CloudRequiredTag,
  ): Promise<void> => {
    try {
      await ModelAPI.deleteItem<CloudRequiredTag>({
        modelType: CloudRequiredTag,
        id: tag.id!,
      });
      setRemoving(null);
      setAttempt(attempt + 1);
      props.onChanged?.();
    } catch (err) {
      setRemoving(null);
      setError(API.getFriendlyMessage(err));
    }
  };

  const requireButton: ReactElement | null = createGate.isAllowed ? (
    <Button
      title={REQUIRE_A_TAG}
      icon={IconProp.Add}
      buttonStyle={ButtonStyleType.NORMAL}
      onClick={() => {
        setSaveError("");
        setEditing("new");
      }}
      dataTestId="cloud-require-a-tag"
    />
  ) : null;

  const renderBody: () => ReactElement = (): ReactElement => {
    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setAttempt(attempt + 1);
          }}
        />
      );
    }

    if (tags === null) {
      return <TableSkeleton />;
    }

    if (shown.length === 0) {
      return (
        <div
          className="flex flex-col items-start gap-3"
          data-testid="cloud-required-tags-empty"
        >
          <p className="text-sm text-gray-600">
            {translator.translateText(REQUIRED_TAGS_EMPTY) ||
              REQUIRED_TAGS_EMPTY}
          </p>
          {requireButton}
        </div>
      );
    }

    return (
      <ul
        className="divide-y divide-gray-100"
        data-testid="cloud-required-tags"
      >
        {shown.map((tag: CloudRequiredTag): ReactElement => {
          const values: Array<string> = tag.allowedValues || [];
          const isProjectWideOnAccountPage: boolean = Boolean(
            fixedAccountId && !tag.cloudAccountId,
          );
          const scope: string | null = tag.cloudAccountId
            ? accountName(tag.cloudAccountId)
            : null;

          return (
            <li
              key={tag.id?.toString()}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              data-testid="cloud-required-tag-row"
              data-key={tag.tagKey}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <bdi className="font-mono text-sm font-semibold text-gray-900">
                    {tag.tagKey}
                  </bdi>
                  <Pill
                    text={
                      scope ||
                      (isProjectWideOnAccountPage
                        ? PROJECT_WIDE_HERE
                        : EVERY_ACCOUNT)
                    }
                    tone={PillTone.Neutral}
                    isDotHidden={true}
                    isUserContent={Boolean(scope)}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {values.length === 0 ? (
                    <span className="text-xs text-gray-500">
                      {translator.translateText(ANY_VALUE) || ANY_VALUE}
                    </span>
                  ) : (
                    values.map((value: string): ReactElement => {
                      return (
                        <span
                          key={value}
                          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700"
                        >
                          <bdi>{value}</bdi>
                        </span>
                      );
                    })
                  )}
                </div>
                {tag.description ? (
                  <p className="mt-1 text-xs text-gray-500">
                    <bdi>{tag.description}</bdi>
                  </p>
                ) : (
                  <></>
                )}
              </div>
              {/* The project's tags are changed on Cloud > Tags, not on an account's. */}
              {isProjectWideOnAccountPage ? (
                <></>
              ) : (
                <div className="flex flex-none items-center gap-2">
                  {updateGate.isAllowed ? (
                    <Button
                      title="Edit"
                      buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                      onClick={() => {
                        setSaveError("");
                        setEditing(tag);
                      }}
                      dataTestId="cloud-required-tag-edit"
                    />
                  ) : (
                    <></>
                  )}
                  {deleteGate.isAllowed ? (
                    <Button
                      title="Delete"
                      buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                      onClick={() => {
                        setRemoving(tag);
                      }}
                      dataTestId="cloud-required-tag-delete"
                    />
                  ) : (
                    <></>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      <Card
        title={REQUIRED_TAGS_TITLE}
        description={
          fixedAccountId
            ? REQUIRED_TAGS_ACCOUNT_DESCRIPTION
            : REQUIRED_TAGS_DESCRIPTION
        }
        buttons={shown.length > 0 && requireButton ? [requireButton] : []}
      >
        <div data-testid="cloud-required-tags-card">{renderBody()}</div>
      </Card>

      {editing ? (
        <BasicFormModal<RequiredTagFormValues>
          title={editing === "new" ? REQUIRE_A_TAG : EDIT_REQUIRED_TAG}
          name={editing === "new" ? REQUIRE_A_TAG : EDIT_REQUIRED_TAG}
          submitButtonText={editing === "new" ? REQUIRE_A_TAG : "Save"}
          isLoading={isSaving}
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={(values: RequiredTagFormValues) => {
            save(values).catch((): void => {
              // save says what failed itself.
            });
          }}
          formProps={{
            name: "cloud-required-tag-form",
            error: saveError,
            fields,
            initialValues: toRequiredTagFormValues(
              editing === "new" ? null : editing,
              fixedAccountId,
            ),
          }}
        />
      ) : (
        <></>
      )}

      {removing ? (
        <ConfirmModal
          title={STOP_REQUIRING_TAG}
          description={translator.translateTemplate(STOP_REQUIRING_QUESTION, {
            key: removing.tagKey || "",
          })}
          submitButtonText={STOP_REQUIRING_TAG}
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setRemoving(null);
          }}
          onSubmit={() => {
            remove(removing).catch((): void => {
              // remove says what failed itself.
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CloudRequiredTagsCard;
