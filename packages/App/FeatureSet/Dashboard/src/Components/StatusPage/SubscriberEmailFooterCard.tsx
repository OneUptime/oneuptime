import {
  EMAIL_FOOTER_CARD_TEST_ID,
  EMAIL_FOOTER_CHOICE,
  EmailFooterChoice,
  SubscriberEmailFooterCopy,
} from "./SubscriberEmailFooterCopy";
import { getColumnChoiceInForm } from "../../Utils/Form/ColumnChoice";
import { getColumnChoiceField } from "../../Utils/Form/ColumnChoiceField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { Gray500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
  isCustomSubscriberEmailFooterUsed,
} from "Common/Types/StatusPage/SubscriberEmailFooter";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Email Footer card under More settings on Subscriber Settings: the line
 * subscribers read at the end of every email, and one choice to change it -
 * the default footer, or your own text (SubscriberEmailFooterCopy).
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  // Told whether the page's emails end with its own text, as it loads.
  onLoaded?: ((isCustomFooter: boolean) => void) | undefined;
}

// Whether the form's answer is your own text.
const isCustomInForm: (values: FormValues<StatusPage>) => boolean = (
  values: FormValues<StatusPage>,
): boolean => {
  return (
    getColumnChoiceInForm(EMAIL_FOOTER_CHOICE, values) ===
    EmailFooterChoice.Custom
  );
};

/*
 * The line subscribers read: the page's own text, or the default line - in
 * English, as the emails send it - with a Default pill.
 */
export const EmailFooterLine: FunctionComponent<{ item: StatusPage }> = (props: {
  item: StatusPage;
}): ReactElement => {
  if (isCustomSubscriberEmailFooterUsed(props.item)) {
    return (
      <span className="whitespace-pre-line" data-testid="email-footer-line">
        {props.item.subscriberEmailNotificationFooterText}
      </span>
    );
  }

  return (
    <span data-testid="email-footer-line">
      <span className="mr-2">{DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT}</span>
      <span
        className="inline-flex align-middle"
        data-testid="email-footer-default-pill"
      >
        <Pill
          text={SubscriberEmailFooterCopy.defaultPill}
          color={Gray500}
          isMinimal={true}
        />
      </span>
    </span>
  );
};

const SubscriberEmailFooterCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <CardModelDetail<StatusPage>
      name="Status Page > Branding > Subscriber > Email Footer"
      cardProps={{
        title: SubscriberEmailFooterCopy.cardTitle,
        description: SubscriberEmailFooterCopy.cardDescription,
      }}
      isEditable={true}
      editButtonText={SubscriberEmailFooterCopy.editButton}
      editModalTitle={SubscriberEmailFooterCopy.editButton}
      formFields={[
        getColumnChoiceField<StatusPage, EmailFooterChoice>({
          config: EMAIL_FOOTER_CHOICE,
          column: "enableCustomSubscriberEmailNotificationFooterText",
        }),
        {
          field: {
            subscriberEmailNotificationFooterText: true,
          },
          title: SubscriberEmailFooterCopy.textTitle,
          fieldType: FormFieldSchemaType.LongText,
          // Your own text is the line itself: it cannot be left empty.
          required: isCustomInForm,
          hideColumnDescription: true,
          autoGrow: true,
          placeholder: DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
          showIf: isCustomInForm,
        },
        /*
         * The switch the answer writes, registered so the form loads and
         * saves it; never drawn.
         */
        {
          field: {
            enableCustomSubscriberEmailNotificationFooterText: true,
          },
          title: "Enable Custom Email Footer Text",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          hideColumnDescription: true,
          showIf: (): boolean => {
            return false;
          },
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: StatusPage,
        id: EMAIL_FOOTER_CARD_TEST_ID,
        onItemLoaded: (item: StatusPage): void => {
          props.onLoaded?.(isCustomSubscriberEmailFooterUsed(item));
        },
        selectMoreFields: {
          enableCustomSubscriberEmailNotificationFooterText: true,
          subscriberEmailNotificationFooterText: true,
        },
        fields: [
          {
            field: {
              subscriberEmailNotificationFooterText: true,
            },
            title: SubscriberEmailFooterCopy.rowTitle,
            fieldType: FieldType.Element,
            getElement: (item: StatusPage): ReactElement => {
              return <EmailFooterLine item={item} />;
            },
          },
        ],
        modelId: props.statusPageId,
      }}
    />
  );
};

export default SubscriberEmailFooterCard;
