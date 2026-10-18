import {
  AUTO_RECHARGE_AMOUNTS_IN_USD,
  AUTO_RECHARGE_AMOUNT_TITLE,
  AUTO_RECHARGE_CARD_DESCRIPTION,
  AUTO_RECHARGE_CARD_TITLE,
  AUTO_RECHARGE_OFF,
  AUTO_RECHARGE_ON_TEMPLATE,
  AUTO_RECHARGE_SWITCH_DESCRIPTION,
  AUTO_RECHARGE_THRESHOLD_TITLE,
} from "./ProjectBalanceCopy";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  ProjectBalanceAutoRechargeColumn,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import Select from "Common/Types/BaseDatabase/Select";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A project balance's Auto Recharge (the SMS, call, WhatsApp and Telegram
 * balance on Notification Settings, the AI credits on AI Credits), drawn
 * the same way for both:
 *
 *   - the card says in one line what Auto Recharge does - "Off", or "Adds
 *     20 USD whenever the balance falls to 10 USD." - where it showed a
 *     switch and two amounts, the amounts even while it was off;
 *   - its Edit dialog asks whether to recharge automatically, and the two
 *     amounts only once that is on.
 *
 * The page decides who may edit it (its gate, from the columns' own update
 * permissions) and hears each save, as before. The three columns and what
 * they hold are unchanged.
 */

export interface ComponentProps {
  balance: ProjectBalanceType;
  projectId: ObjectID;
  // Who may edit, from the page's gate on these columns.
  isEditable: boolean;
  // The locked Edit button for who may not.
  lockedButtons: Array<CardButtonSchema>;
  onSaveSuccess?: (() => void) | undefined;
}

// The dropdowns' answers: each amount once, as "20 USD".
export const getAutoRechargeAmountOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    return AUTO_RECHARGE_AMOUNTS_IN_USD.map(
      (amount: number): DropdownOption => {
        return { value: amount, label: `${amount} USD` };
      },
    );
  };

interface AutoRechargeColumns {
  enable: ProjectBalanceAutoRechargeColumn;
  amount: ProjectBalanceAutoRechargeColumn;
  threshold: ProjectBalanceAutoRechargeColumn;
}

// The balance's three columns: its switch, how much is added, and when.
export const getAutoRechargeColumns: (
  balance: ProjectBalanceType,
) => AutoRechargeColumns = (
  balance: ProjectBalanceType,
): AutoRechargeColumns => {
  const [enable, amount, threshold] = PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[
    balance
  ] as [
    ProjectBalanceAutoRechargeColumn,
    ProjectBalanceAutoRechargeColumn,
    ProjectBalanceAutoRechargeColumn,
  ];

  return { enable, amount, threshold };
};

const selectColumn: (
  column: ProjectBalanceAutoRechargeColumn,
) => SelectFormFields<Project> = (
  column: ProjectBalanceAutoRechargeColumn,
): SelectFormFields<Project> => {
  return { [column]: true } as SelectFormFields<Project>;
};

/**
 * What the card says, from the project's three columns: "Off" while Auto
 * Recharge is off, else how much it adds and when. Exported for tests.
 */
export const getAutoRechargeSummary: (data: {
  project: Project | Record<string, unknown>;
  balance: ProjectBalanceType;
  translator: Translator;
}) => string = (data: {
  project: Project | Record<string, unknown>;
  balance: ProjectBalanceType;
  translator: Translator;
}): string => {
  const columns: AutoRechargeColumns = getAutoRechargeColumns(data.balance);
  const values: Record<string, unknown> = data.project as unknown as Record<
    string,
    unknown
  >;

  if (values[columns.enable] !== true) {
    return (
      data.translator.translateText(AUTO_RECHARGE_OFF) || AUTO_RECHARGE_OFF
    );
  }

  return data.translator.translateTemplate(AUTO_RECHARGE_ON_TEMPLATE, {
    amount: String(values[columns.amount] ?? ""),
    threshold: String(values[columns.threshold] ?? ""),
  });
};

const AutoRechargeCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const columns: AutoRechargeColumns = getAutoRechargeColumns(props.balance);

  const isOn: (values: FormValues<Project>) => boolean = (
    values: FormValues<Project>,
  ): boolean => {
    return Boolean((values as Record<string, unknown>)[columns.enable]);
  };

  const formFields: Array<ModelField<Project>> = [
    {
      field: selectColumn(columns.enable),
      title: "Enable Auto Recharge",
      description: AUTO_RECHARGE_SWITCH_DESCRIPTION,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: selectColumn(columns.amount),
      title: AUTO_RECHARGE_AMOUNT_TITLE,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getAutoRechargeAmountOptions(),
      required: isOn,
      hideColumnDescription: true,
      showIf: isOn,
    },
    {
      field: selectColumn(columns.threshold),
      title: AUTO_RECHARGE_THRESHOLD_TITLE,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getAutoRechargeAmountOptions(),
      required: isOn,
      hideColumnDescription: true,
      showIf: isOn,
    },
  ];

  return (
    <CardModelDetail<Project>
      name="Auto Recharge"
      cardProps={{
        title: AUTO_RECHARGE_CARD_TITLE,
        description: AUTO_RECHARGE_CARD_DESCRIPTION,
        buttons: props.lockedButtons,
      }}
      isEditable={props.isEditable}
      editButtonText="Edit Auto Recharge"
      // Titled like the button that opens it, not "Edit Project".
      editModalTitle="Edit Auto Recharge"
      onSaveSuccess={() => {
        props.onSaveSuccess?.();
      }}
      formFields={formFields}
      modelDetailProps={{
        modelType: Project,
        id:
          props.balance === ProjectBalanceType.AI
            ? "ai-auto-recharge"
            : "notifications",
        fields: [
          {
            field: {
              [columns.enable]: true,
              [columns.amount]: true,
              [columns.threshold]: true,
            } as Select<Project>,
            title: AUTO_RECHARGE_CARD_TITLE,
            fieldType: FieldType.Element,
            getElement: (project: Project): ReactElement => {
              return (
                <span data-testid="auto-recharge-summary">
                  {getAutoRechargeSummary({
                    project: project,
                    balance: props.balance,
                    translator: translator,
                  })}
                </span>
              );
            },
          },
        ],
        modelId: props.projectId,
      }}
    />
  );
};

export default AutoRechargeCard;
