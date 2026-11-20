import { BlockValueCheck, checkBlockValue } from "./BlocklistApi";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  ACTION_FIELD_DESCRIPTION,
  ACTION_FIELD_TITLE,
  ADDRESS_FIELD_DESCRIPTION,
  ADDRESS_FIELD_PLACEHOLDER,
  ADDRESS_FIELD_TITLE,
  BLOCKED_TOAST,
  BLOCKLIST_TEST_IDS,
  BLOCK_ADDRESS_DESCRIPTION,
  BLOCK_ADDRESS_TITLE,
  BLOCK_ANYWAY,
  BLOCK_WIDE_RANGE_DESCRIPTION,
  BLOCK_WIDE_RANGE_TITLE,
  BLOCK_YOUR_ADDRESS_DESCRIPTION,
  BLOCK_YOUR_ADDRESS_TITLE,
  DURATION_COUNTS,
  EXPIRES_FIELD_TITLE,
  REASON_FIELD_DESCRIPTION,
  REASON_FIELD_TITLE,
  UNTIL_LIFTED_FIELD_DESCRIPTION,
  UNTIL_LIFTED_FIELD_TITLE,
  UNTIL_LIFTED_REFUSED,
} from "./BlocklistCopy";
import { writeBlockRefusal } from "./BlocklistWords";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SECURITY_BLOCK_EXPIRING_DURATIONS,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSentence,
  SecurityBlockValue,
  getSecurityBlockExpiry,
  getSecurityBlockLargestPrefix,
  getSecurityBlockValueSentence,
  readSecurityBlockValue,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * BLOCK ADDRESS (#10338): an address or a range, how long - 24 hours unless
 * someone says - and why, with what most people never change folded under
 * More fields: Challenge instead of Block, and, for a Security Admin, a
 * block that stays until someone lifts it.
 *
 * Before it blocks, it asks the server what the block would meet
 * (/security-block/check) and says why not in the reader's words: already
 * blocked (and by which range), one of the project's own or a protected
 * address (and what it is), or OneUptime could not tell. A block of the
 * address the person is using right now, or a range wider than the largest
 * one, is asked about first: either can lock a team out of its own app.
 * The server checks it all again when the block is made.
 */

export const BLOCK_ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

const VALUE_FIELD: string = "value";
const EXPIRES_FIELD: string = "duration";
const REASON_FIELD: string = "reason";
const ACTION_FIELD: string = "action";
const UNTIL_LIFTED_FIELD: string = "untilLifted";

const MORE_FIELDS: FormFieldCollapsibleSection<JSONObject> =
  getAdvancedFormSection<JSONObject>();

// The lengths offered, the default first among them as the field starts.
export function getBlockDurationOptions(
  translator: Translator,
): Array<DropdownOption> {
  return SECURITY_BLOCK_EXPIRING_DURATIONS.map(
    (duration: SecurityBlockDuration): DropdownOption => {
      const counted: { count: number; plural: { one: string; other: string } } =
        DURATION_COUNTS[
          duration as Exclude<
            SecurityBlockDuration,
            SecurityBlockDuration.UntilLifted
          >
        ];

      return {
        value: duration,
        label: translator.translatePlural(counted.plural, counted.count),
        isUserContent: true,
      };
    },
  );
}

// A warning to confirm before the block is made, or none.
interface BlockWarning {
  title: string;
  description: string;
}

export function getBlockWarnings(data: {
  translator: Translator;
  check: BlockValueCheck;
}): Array<BlockWarning> {
  const warnings: Array<BlockWarning> = [];
  const read: SecurityBlockValue | null = readSecurityBlockValue(
    data.check.value || "",
  );

  if (data.check.isYourAddress && data.check.yourAddress) {
    warnings.push({
      title: BLOCK_YOUR_ADDRESS_TITLE,
      description: data.translator.translateTemplate(
        BLOCK_YOUR_ADDRESS_DESCRIPTION,
        { address: data.check.yourAddress },
      ),
    });
  }

  if (data.check.isWiderThanLargestRange && read) {
    warnings.push({
      title: BLOCK_WIDE_RANGE_TITLE,
      description: data.translator.translateTemplate(
        BLOCK_WIDE_RANGE_DESCRIPTION,
        {
          value: read.value,
          largest: `/${getSecurityBlockLargestPrefix(read.block.family)}`,
        },
      ),
    });
  }

  return warnings;
}

export interface ComponentProps {
  onClose: () => void;
  // Told once the block is made, so the list reads it.
  onBlocked: () => void;
  // The case the block is made for, when it is made from one.
  securityCaseId?: ObjectID | undefined;
}

const BlockAddressModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [pending, setPending] = useState<{
    values: JSONObject;
    warnings: Array<BlockWarning>;
  } | null>(null);

  const isAdmin: boolean = PermissionGate.holdsAnyOf(BLOCK_ADMIN_PERMISSIONS);

  const block: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const isUntilLifted: boolean =
      isAdmin && values[UNTIL_LIFTED_FIELD] === true;
    const duration: SecurityBlockDuration =
      (values[EXPIRES_FIELD] as SecurityBlockDuration) ||
      SECURITY_BLOCK_DEFAULT_DURATION;

    const model: SecurityBlock = new SecurityBlock();
    model.value = String(values[VALUE_FIELD] || "").trim();
    model.action =
      values[ACTION_FIELD] === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block;
    model.expiresAt = isUntilLifted
      ? (null as unknown as Date)
      : (getSecurityBlockExpiry(duration, now) as Date);

    const reason: string = String(values[REASON_FIELD] || "").trim();

    if (reason) {
      model.reason = reason;
    }

    if (props.securityCaseId) {
      model.securityCaseId = props.securityCaseId;
    }

    await ModelAPI.create<SecurityBlock>({
      model,
      modelType: SecurityBlock,
    });

    Toast.success(
      translator.translateTemplate(BLOCKED_TOAST, {
        value: model.value,
      }),
    );

    props.onBlocked();
  };

  const submit: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    setRefusal(null);
    setIsSubmitting(true);

    try {
      const check: BlockValueCheck = await checkBlockValue(
        String(values[VALUE_FIELD] || ""),
      );

      const words: string | null = writeBlockRefusal({
        translator,
        typed: String(values[VALUE_FIELD] || ""),
        check,
      });

      if (words) {
        setRefusal(words);
        return;
      }

      const warnings: Array<BlockWarning> = getBlockWarnings({
        translator,
        check,
      });

      if (warnings.length > 0) {
        setPending({ values, warnings });
        return;
      }

      await block(values);
    } catch (error) {
      setRefusal(API.getFriendlyMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (pending) {
    return (
      <ConfirmModal
        title={pending.warnings[0]!.title}
        description={
          <div className="space-y-2">
            {pending.warnings.map(
              (warning: BlockWarning, index: number): ReactElement => {
                return <p key={index}>{warning.description}</p>;
              },
            )}
          </div>
        }
        submitButtonText={BLOCK_ANYWAY}
        isLoading={isSubmitting}
        error={refusal || undefined}
        onClose={() => {
          setPending(null);
        }}
        onSubmit={async () => {
          setIsSubmitting(true);
          setRefusal(null);

          try {
            await block(pending.values);
          } catch (error) {
            setRefusal(API.getFriendlyMessage(error));
          } finally {
            setIsSubmitting(false);
          }
        }}
      />
    );
  }

  return (
    <BasicFormModal<JSONObject>
      title={BLOCK_ADDRESS_TITLE}
      description={BLOCK_ADDRESS_DESCRIPTION}
      name="Security Events > Blocklist > Block Address"
      submitButtonText={BLOCK_ADDRESS_TITLE}
      isSubmitting={isSubmitting}
      onClose={props.onClose}
      onSubmit={submit}
      beforeFormElement={
        refusal ? (
          <div data-testid={BLOCKLIST_TEST_IDS.refusal}>
            <Alert
              type={AlertType.DANGER}
              title={<span>{refusal}</span>}
              className="mb-4"
            />
          </div>
        ) : undefined
      }
      formProps={{
        name: "Block Address",
        initialValues: {
          [EXPIRES_FIELD]: SECURITY_BLOCK_DEFAULT_DURATION,
          [ACTION_FIELD]: SecurityBlockAction.Block,
          [UNTIL_LIFTED_FIELD]: false,
        },
        fields: [
          {
            field: { [VALUE_FIELD]: true },
            title: ADDRESS_FIELD_TITLE,
            description: ADDRESS_FIELD_DESCRIPTION,
            placeholder: ADDRESS_FIELD_PLACEHOLDER,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<JSONObject>,
            ): string | null => {
              const sentence: SecurityBlockSentence | null =
                getSecurityBlockValueSentence({
                  value: (values as JSONObject)[VALUE_FIELD],
                  mayBlockWideRanges: isAdmin,
                });

              return sentence
                ? translator.translateTemplate(
                    sentence.template,
                    sentence.values,
                  )
                : null;
            },
          },
          {
            field: { [EXPIRES_FIELD]: true },
            title: EXPIRES_FIELD_TITLE,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getBlockDurationOptions(translator),
            required: true,
            showIf: (values: FormValues<JSONObject>): boolean => {
              return (values as JSONObject)[UNTIL_LIFTED_FIELD] !== true;
            },
          },
          {
            field: { [REASON_FIELD]: true },
            title: REASON_FIELD_TITLE,
            description: REASON_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
          {
            field: { [ACTION_FIELD]: true },
            title: ACTION_FIELD_TITLE,
            description: ACTION_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              { value: SecurityBlockAction.Block, label: ACTION_BLOCK_OPTION },
              {
                value: SecurityBlockAction.Challenge,
                label: ACTION_CHALLENGE_OPTION,
              },
            ],
            required: true,
            collapsibleSection: MORE_FIELDS,
          },
          {
            field: { [UNTIL_LIFTED_FIELD]: true },
            title: UNTIL_LIFTED_FIELD_TITLE,
            description: isAdmin
              ? UNTIL_LIFTED_FIELD_DESCRIPTION
              : UNTIL_LIFTED_REFUSED,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            disabled: !isAdmin,
            collapsibleSection: MORE_FIELDS,
          },
        ],
      }}
    />
  );
};

export default BlockAddressModal;
