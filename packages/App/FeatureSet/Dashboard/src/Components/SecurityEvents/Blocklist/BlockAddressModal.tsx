import { BlockValueCheck, checkBlockValue } from "./BlocklistApi";
import {
  BLOCKLIST_KIND_WORDS,
  BlocklistKind,
  BlocklistKindWords,
  getBlocklistKindSentence,
} from "./BlocklistKinds";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  ACTION_FIELD_DESCRIPTION,
  ACTION_FIELD_TITLE,
  BLOCKED_TOAST,
  BLOCK_ANYWAY,
  EVERY_MACHINE_FIELD_DESCRIPTION,
  EVERY_MACHINE_FIELD_TITLE,
  QUARANTINE_FIELD_DESCRIPTION,
  QUARANTINE_FIELD_TITLE,
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
  SecurityBlockReach,
  SecurityBlockSentence,
  SecurityBlockValue,
  getSecurityBlockExpiry,
  getSecurityBlockLargestPrefix,
  readSecurityBlockValue,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
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
 * More fields: Challenge instead of Block, blocking it on every machine
 * too (#10346), and, for a Security Admin, a block that stays until
 * someone lifts it.
 *
 * The same dialog blocks each of the Blocklist's kinds (#10346), from its
 * tab: Block Domain or URL asks for a domain or a URL, Block File for a
 * file's hash, with Quarantine It - on - under More fields. Each takes its
 * own kind of value only, and says so of another.
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
const EVERY_MACHINE_FIELD: string = "everyMachine";
const QUARANTINE_FIELD: string = "quarantine";

/*
 * What a dialog's answers block a value with, and where: an address's
 * Block or Challenge, at the edge or - asked - everywhere, where it is
 * only blocked; a file blocked and quarantined unless asked not to; a
 * domain or a URL blocked.
 */
export function getBlockRequest(data: {
  kind: BlocklistKind;
  values: JSONObject;
}): { action: SecurityBlockAction; reach: SecurityBlockReach } {
  switch (data.kind) {
    case BlocklistKind.Files:
      return {
        action:
          data.values[QUARANTINE_FIELD] === false
            ? SecurityBlockAction.Block
            : SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Everywhere,
      };
    case BlocklistKind.DomainsAndUrls:
      return {
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      };
    default: {
      const isEverywhere: boolean = data.values[EVERY_MACHINE_FIELD] === true;

      return {
        action:
          !isEverywhere &&
          data.values[ACTION_FIELD] === SecurityBlockAction.Challenge
            ? SecurityBlockAction.Challenge
            : SecurityBlockAction.Block,
        reach: isEverywhere
          ? SecurityBlockReach.Everywhere
          : SecurityBlockReach.Edge,
      };
    }
  }
}

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
  // What it blocks: an address unless said (#10346).
  kind?: BlocklistKind | undefined;
}

const BlockAddressModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: BlocklistKind = props.kind || BlocklistKind.Addresses;
  const words: BlocklistKindWords = BLOCKLIST_KIND_WORDS[kind];
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // What was typed, kept for the form when a question asked before blocking is cancelled.
  const [typed, setTyped] = useState<JSONObject | null>(null);
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

    const request: { action: SecurityBlockAction; reach: SecurityBlockReach } =
      getBlockRequest({ kind, values });

    const model: SecurityBlock = new SecurityBlock();
    model.value = String(values[VALUE_FIELD] || "").trim();
    model.action = request.action;
    model.reach = request.reach;
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
    setTyped(values);

    try {
      const check: BlockValueCheck = await checkBlockValue(
        String(values[VALUE_FIELD] || ""),
        getBlockRequest({ kind, values }).reach,
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

  // What only this kind asks, folded under More fields.
  const kindFields: Array<Field<JSONObject>> =
    kind === BlocklistKind.Addresses
      ? [
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
            // A block on every machine blocks: a challenge is answered at the edge.
            showIf: (values: FormValues<JSONObject>): boolean => {
              return (values as JSONObject)[EVERY_MACHINE_FIELD] !== true;
            },
          },
          {
            field: { [EVERY_MACHINE_FIELD]: true },
            title: EVERY_MACHINE_FIELD_TITLE,
            description: EVERY_MACHINE_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: MORE_FIELDS,
          },
        ]
      : kind === BlocklistKind.Files
        ? [
            {
              field: { [QUARANTINE_FIELD]: true },
              title: QUARANTINE_FIELD_TITLE,
              description: QUARANTINE_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              collapsibleSection: MORE_FIELDS,
            },
          ]
        : [];

  return (
    <BasicFormModal<JSONObject>
      title={words.blockTitle}
      description={words.blockDescription}
      name={`Security Events > Blocklist > ${kind}`}
      submitButtonText={words.blockTitle}
      isSubmitting={isSubmitting}
      onClose={props.onClose}
      onSubmit={submit}
      // Why the block is not made: the server's reason in the reader's words, or what went wrong.
      error={refusal || undefined}
      formProps={{
        name: words.blockTitle,
        initialValues: typed || {
          [EXPIRES_FIELD]: SECURITY_BLOCK_DEFAULT_DURATION,
          [ACTION_FIELD]: SecurityBlockAction.Block,
          [UNTIL_LIFTED_FIELD]: false,
          [EVERY_MACHINE_FIELD]: false,
          [QUARANTINE_FIELD]: true,
        },
        fields: [
          {
            field: { [VALUE_FIELD]: true },
            title: words.fieldTitle,
            description: words.fieldDescription,
            placeholder: words.fieldPlaceholder,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<JSONObject>,
            ): string | null => {
              const sentence: SecurityBlockSentence | null =
                getBlocklistKindSentence({
                  kind,
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
          ...kindFields,
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
