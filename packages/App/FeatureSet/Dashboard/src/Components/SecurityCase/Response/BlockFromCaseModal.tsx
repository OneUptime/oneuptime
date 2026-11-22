import {
  BLOCK_ADMIN_PERMISSIONS,
  getBlockDurationOptions,
} from "../../SecurityEvents/Blocklist/BlockAddressModal";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
  ACTION_FIELD_DESCRIPTION,
  ACTION_FIELD_TITLE,
  EXPIRES_FIELD_TITLE,
  UNTIL_LIFTED_FIELD_DESCRIPTION,
  UNTIL_LIFTED_FIELD_TITLE,
  UNTIL_LIFTED_REFUSED,
} from "../../SecurityEvents/Blocklist/BlocklistCopy";
import {
  BLOCK_ASKED_TOAST,
  BLOCK_FROM_CASE_DESCRIPTION,
  BLOCK_FROM_CASE_TITLE,
  BLOCK_STARTED_TOAST,
} from "./SecurityCaseResponseCopy";
import {
  BlockFromCaseStarted,
  blockFromCase,
} from "./SecurityCaseAddressBlocks";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/UI/Utils/API/API";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * BLOCK... ON ONE OF A CASE'S ADDRESSES (#10342): how long - 24 hours unless
 * someone says - with Challenge instead of Block, and a Security Admin's
 * block that stays until someone lifts it, folded under More fields, as
 * the Blocklist's Block Address has them. It blocks through the playbook
 * engine, as the Response Plan's Block for 24 Hours does: the server says
 * why not (already blocked, protected, an address the case's requests only
 * claimed), and a block that waits for approval says so.
 */

const DURATION_FIELD: string = "duration";
const ACTION_FIELD: string = "blockAction";
const UNTIL_LIFTED_FIELD: string = "untilLifted";

const MORE_FIELDS: FormFieldCollapsibleSection<JSONObject> =
  getAdvancedFormSection<JSONObject>();

export interface ComponentProps {
  securityCaseId: ObjectID;
  address: string;
  onClose: () => void;
  // Told once the block is asked for, so the page reads it.
  onBlocked: () => void;
}

const BlockFromCaseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isAdmin: boolean = PermissionGate.holdsAnyOf(BLOCK_ADMIN_PERMISSIONS);

  return (
    <BasicFormModal<JSONObject>
      title={translator.translateTemplate(BLOCK_FROM_CASE_TITLE, {
        value: props.address,
      })}
      isTitleTranslated={true}
      description={BLOCK_FROM_CASE_DESCRIPTION}
      name="Security Case > Entities > Block"
      submitButtonText={ACTION_BLOCK_OPTION}
      isSubmitting={isSubmitting}
      error={error || undefined}
      onClose={props.onClose}
      onSubmit={async (values: JSONObject) => {
        setError("");
        setIsSubmitting(true);

        try {
          const isUntilLifted: boolean =
            isAdmin && values[UNTIL_LIFTED_FIELD] === true;
          const started: BlockFromCaseStarted = await blockFromCase({
            securityCaseId: props.securityCaseId,
            value: props.address,
            blockAction:
              values[ACTION_FIELD] === SecurityBlockAction.Challenge
                ? SecurityBlockAction.Challenge
                : SecurityBlockAction.Block,
            duration: isUntilLifted
              ? SecurityBlockDuration.UntilLifted
              : (values[DURATION_FIELD] as SecurityBlockDuration) ||
                SECURITY_BLOCK_DEFAULT_DURATION,
          });

          Toast.success(
            translator.translateTemplate(
              started.needsApproval ? BLOCK_ASKED_TOAST : BLOCK_STARTED_TOAST,
              { value: props.address },
            ),
          );

          props.onBlocked();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        } finally {
          setIsSubmitting(false);
        }
      }}
      formProps={{
        name: "Block From Case",
        initialValues: {
          [DURATION_FIELD]: SECURITY_BLOCK_DEFAULT_DURATION,
          [ACTION_FIELD]: SecurityBlockAction.Block,
          [UNTIL_LIFTED_FIELD]: false,
        },
        fields: [
          {
            field: { [DURATION_FIELD]: true },
            title: EXPIRES_FIELD_TITLE,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getBlockDurationOptions(translator),
            required: true,
            showIf: (values: FormValues<JSONObject>): boolean => {
              return (values as JSONObject)[UNTIL_LIFTED_FIELD] !== true;
            },
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

export default BlockFromCaseModal;
