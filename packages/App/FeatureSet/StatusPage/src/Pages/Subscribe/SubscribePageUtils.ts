import PageComponentProps from "../PageComponentProps";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import IconProp from "Common/Types/Icon/IconProp";
import Field, {
  CategoryCheckboxProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface SubscribePageProps extends PageComponentProps {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
  enableWebhookSubscribers: boolean;
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}

/*
 * Subscribing on a status page is one page: where to send updates (the
 * email address, phone number, workspace or webhook), then - on a page that
 * lets subscribers choose resources or event types - "Preferences", folded
 * to one line that says what the visitor will get, and Subscribe.
 *
 * Every resource and every event type start ticked, so most visitors never
 * open Preferences: the line under its title says so ("You will get every
 * update from this status page.") and Subscribe is right there. Someone who
 * wants less opens it, narrows the resources or event types down, and the
 * line follows what they pick.
 *
 * It was two steps for a while (details, then preferences), and since the
 * form's action moved to the last step only (SteppedFormFooter), a visitor
 * who wanted everything walked Next, then Subscribe. A fold keeps the
 * address and the button on one page without hiding what the defaults do.
 *
 * The section is the shared folded form section (FormFieldCollapsibleSection,
 * drawn by CollapsibleFormSection and FoldedSection): it is named for what
 * it holds, so it says its summary sentence while folded rather than
 * listing field names, and it opens by itself if a field in it fails
 * validation.
 */

export const SUBSCRIBE_PREFERENCES_SECTION_ID: string = "preferences";

// Status page locale keys (Locales/*.json), looked up with the page's t().
export const SUBSCRIBE_PREFERENCES_COPY: {
  title: string;
  description: string;
  summary: {
    everything: string;
    pickedResources: string;
    pickedEventTypes: string;
    pickedResourcesAndEventTypes: string;
    noResources: string;
    noEventTypes: string;
  };
} = {
  title: "subscribe.preferences.title",
  description: "subscribe.preferences.description",
  summary: {
    everything: "subscribe.preferences.summary.everything",
    pickedResources: "subscribe.preferences.summary.pickedResources",
    pickedEventTypes: "subscribe.preferences.summary.pickedEventTypes",
    pickedResourcesAndEventTypes:
      "subscribe.preferences.summary.pickedResourcesAndEventTypes",
    noResources: "subscribe.preferences.summary.noResources",
    noEventTypes: "subscribe.preferences.summary.noEventTypes",
  },
};

export interface SubscribePreferenceOptions {
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}

// How much of one kind of preference - resources, or event types - is taken.
export enum SubscribePreferenceChoice {
  /*
   * Everything: the "all" box is ticked, as it starts. Also what a page that
   * offers no choice of this kind means.
   */
  All = "all",
  // Only what was picked under the unticked "all" box.
  Picked = "picked",
  // The "all" box is unticked and nothing is picked yet.
  None = "none",
}

export interface SubscribePreferenceChoices {
  resources: SubscribePreferenceChoice;
  eventTypes: SubscribePreferenceChoice;
}

type GetChoiceFunction = (
  isSubscribedToAll: unknown,
  picks: unknown,
) => SubscribePreferenceChoice;

const getChoice: GetChoiceFunction = (
  isSubscribedToAll: unknown,
  picks: unknown,
): SubscribePreferenceChoice => {
  /*
   * Only an unticked box narrows anything down. Before the form has put
   * its defaults in, the box is about to be ticked (its default is on), so
   * an empty value counts as ticked too.
   */
  if (isSubscribedToAll !== false) {
    return SubscribePreferenceChoice.All;
  }

  return Array.isArray(picks) && picks.length > 0
    ? SubscribePreferenceChoice.Picked
    : SubscribePreferenceChoice.None;
};

/*
 * What the form's values take, of what the page lets subscribers choose.
 * A kind the page offers no choice of is everything: the server notifies
 * such a subscriber of all of it (StatusPageSubscriberService
 * .shouldSendNotification).
 */
export const getSubscribePreferenceChoices: (
  data: SubscribePreferenceOptions & {
    values: FormValues<StatusPageSubscriber> | undefined;
  },
) => SubscribePreferenceChoices = (
  data: SubscribePreferenceOptions & {
    values: FormValues<StatusPageSubscriber> | undefined;
  },
): SubscribePreferenceChoices => {
  const values: Record<string, unknown> = (data.values || {}) as Record<
    string,
    unknown
  >;

  return {
    resources: data.allowSubscribersToChooseResources
      ? getChoice(
          values["isSubscribedToAllResources"],
          values["statusPageResources"],
        )
      : SubscribePreferenceChoice.All,
    eventTypes: data.allowSubscribersToChooseEventTypes
      ? getChoice(
          values["isSubscribedToAllEventTypes"],
          values["statusPageEventTypes"],
        )
      : SubscribePreferenceChoice.All,
  };
};

/*
 * The line folded Preferences shows, as locale keys: what the visitor will
 * get, in one sentence - or, while an unticked "all" box has nothing picked
 * under it, that nothing is picked yet. Such a subscription is taken as it
 * always was; it just hears little: with no resources picked, only the
 * announcements about nothing this page shows, and with no event types
 * picked, nothing at all (StatusPageSubscriberService
 * .shouldSendNotification).
 */
export const getSubscribePreferencesSummaryKeys: (
  data: SubscribePreferenceOptions & {
    values: FormValues<StatusPageSubscriber> | undefined;
  },
) => Array<string> = (
  data: SubscribePreferenceOptions & {
    values: FormValues<StatusPageSubscriber> | undefined;
  },
): Array<string> => {
  const choices: SubscribePreferenceChoices =
    getSubscribePreferenceChoices(data);

  const nothingPicked: Array<string> = [];

  if (choices.resources === SubscribePreferenceChoice.None) {
    nothingPicked.push(SUBSCRIBE_PREFERENCES_COPY.summary.noResources);
  }

  if (choices.eventTypes === SubscribePreferenceChoice.None) {
    nothingPicked.push(SUBSCRIBE_PREFERENCES_COPY.summary.noEventTypes);
  }

  if (nothingPicked.length > 0) {
    return nothingPicked;
  }

  const allResources: boolean =
    choices.resources === SubscribePreferenceChoice.All;
  const allEventTypes: boolean =
    choices.eventTypes === SubscribePreferenceChoice.All;

  if (allResources && allEventTypes) {
    return [SUBSCRIBE_PREFERENCES_COPY.summary.everything];
  }

  if (allEventTypes) {
    return [SUBSCRIBE_PREFERENCES_COPY.summary.pickedResources];
  }

  if (allResources) {
    return [SUBSCRIBE_PREFERENCES_COPY.summary.pickedEventTypes];
  }

  return [SUBSCRIBE_PREFERENCES_COPY.summary.pickedResourcesAndEventTypes];
};

export type SubscribeTranslateFunction = (key: string) => string;

/*
 * The folded Preferences section, or nothing on a page that lets
 * subscribers choose neither resources nor event types - that form is the
 * address and Subscribe.
 */
export const getSubscribePreferencesSection: (
  data: SubscribePreferenceOptions & {
    translate: SubscribeTranslateFunction;
  },
) => FormFieldCollapsibleSection<StatusPageSubscriber> | undefined = (
  data: SubscribePreferenceOptions & {
    translate: SubscribeTranslateFunction;
  },
): FormFieldCollapsibleSection<StatusPageSubscriber> | undefined => {
  if (
    !data.allowSubscribersToChooseResources &&
    !data.allowSubscribersToChooseEventTypes
  ) {
    return undefined;
  }

  const options: SubscribePreferenceOptions = {
    allowSubscribersToChooseResources: data.allowSubscribersToChooseResources,
    allowSubscribersToChooseEventTypes: data.allowSubscribersToChooseEventTypes,
  };

  return {
    id: SUBSCRIBE_PREFERENCES_SECTION_ID,
    title: data.translate(SUBSCRIBE_PREFERENCES_COPY.title),
    description: data.translate(SUBSCRIBE_PREFERENCES_COPY.description),
    icon: IconProp.Bell,
    /*
     * The page's own words, already in the visitor's language: the shared
     * section looks each sentence up again, finds no such key and keeps it.
     */
    getSummary: (values: FormValues<StatusPageSubscriber>): Array<string> => {
      return getSubscribePreferencesSummaryKeys({
        ...options,
        values: values,
      }).map((key: string): string => {
        return data.translate(key);
      });
    },
  };
};

/*
 * The preference fields of every new subscription - email, SMS, Slack,
 * Microsoft Teams and webhook alike - in the folded Preferences section:
 * "Subscribe to All Resources" (ticked) with the resources under it once it
 * is unticked, then the same for event types. Only the kinds the page lets
 * subscribers choose are asked; a page that offers neither gets no fields.
 * The subscriber's data is what it always was: the boxes and the picks.
 */
export const getSubscribePreferenceFields: (
  data: SubscribePreferenceOptions & {
    translate: SubscribeTranslateFunction;
    // The status page's resources, in its groups.
    resourceOptions: CategoryCheckboxProps;
    eventTypeOptions: Field<StatusPageSubscriber>["dropdownOptions"];
  },
) => Array<Field<StatusPageSubscriber>> = (
  data: SubscribePreferenceOptions & {
    translate: SubscribeTranslateFunction;
    resourceOptions: CategoryCheckboxProps;
    eventTypeOptions: Field<StatusPageSubscriber>["dropdownOptions"];
  },
): Array<Field<StatusPageSubscriber>> => {
  const preferencesSection:
    | FormFieldCollapsibleSection<StatusPageSubscriber>
    | undefined = getSubscribePreferencesSection(data);

  // There is a section whenever there is a field to put in it.
  const fields: Array<Field<StatusPageSubscriber>> = [];

  if (data.allowSubscribersToChooseResources) {
    fields.push({
      field: {
        isSubscribedToAllResources: true,
      },
      title: data.translate("subscribe.resources.all"),
      description: data.translate("subscribe.resources.allDescription"),
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: true,
      collapsibleSection: preferencesSection,
    });

    fields.push({
      field: {
        statusPageResources: true,
      },
      title: data.translate("subscribe.resources.select"),
      description: data.translate("subscribe.resources.selectDescription"),
      fieldType: FormFieldSchemaType.CategoryCheckbox,
      required: false,
      categoryCheckboxProps: data.resourceOptions,
      showIf: (values: FormValues<StatusPageSubscriber>): boolean => {
        return !values || !values.isSubscribedToAllResources;
      },
      collapsibleSection: preferencesSection,
    });
  }

  if (data.allowSubscribersToChooseEventTypes) {
    fields.push({
      field: {
        isSubscribedToAllEventTypes: true,
      },
      title: data.translate("subscribe.eventTypes.all"),
      description: data.translate("subscribe.eventTypes.allDescription"),
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: true,
      collapsibleSection: preferencesSection,
    });

    fields.push({
      field: {
        statusPageEventTypes: true,
      },
      title: data.translate("subscribe.eventTypes.select"),
      description: data.translate("subscribe.eventTypes.selectDescription"),
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      dropdownOptions: data.eventTypeOptions,
      showIf: (values: FormValues<StatusPageSubscriber>): boolean => {
        return !values || !values.isSubscribedToAllEventTypes;
      },
      collapsibleSection: preferencesSection,
    });
  }

  return fields;
};
