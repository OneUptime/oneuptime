import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * What the custom role, IP allowlist, status page, custom channel and
 * session length screens show above themselves when the Enterprise license
 * has lapsed, leaves their feature out, or is about to lapse.
 *
 * These are configuration: once the trial or the grace period is over, the
 * server refuses to set or change them (EditionPermissions), and removing
 * them still works. What is already set keeps applying - custom roles keep
 * giving teams their permissions, an allowlist and the access controls stay
 * enforced - except Powered by OneUptime, which every status page shows again
 * until a license is activated (StatusPagePoweredBy). Each notice says
 * which, so nobody reads a card as switched off when it is not, or as on when
 * it is off.
 *
 * Nothing is shown with a valid license, on OneUptime Cloud (the plan
 * decides there) or while the license state is Unknown.
 *
 * Each title is a key, which Alert looks up. Each description is worded
 * here with the reader's Translator (#8296): what stays after the lapse is
 * a sentence of its own, and the way back is another; the grace period's
 * days are values of one whole sentence.
 */

export type EnterpriseSettingFeature =
  | LicensedFeature.CustomRoles
  | LicensedFeature.IpAllowlists
  | LicensedFeature.StatusPageBranding
  | LicensedFeature.StatusPageAccessControls
  | LicensedFeature.CustomNotificationChannels
  | LicensedFeature.SessionLength;

interface FeatureSentences {
  readOnlyTitle: string;
  notIncludedTitle: string;
  graceTitle: string;
  // What still applies once the license lapses, and what can still be done.
  afterTheLapse: string;
}

const FEATURE_SENTENCES: Record<EnterpriseSettingFeature, FeatureSentences> = {
  [LicensedFeature.CustomRoles]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: custom roles cannot be created or changed.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include custom roles: they cannot be created or changed.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: custom roles become read-only when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "The custom roles you have keep giving teams their permissions, and you can still take them away from teams or delete them.",
    ),
  },
  [LicensedFeature.IpAllowlists]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: this IP allowlist cannot be set or changed.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include IP allowlists: this one cannot be set or changed.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: IP allowlists become read-only when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "An allowlist already set is still enforced, and you can still remove it.",
    ),
  },
  [LicensedFeature.StatusPageAccessControls]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: these access controls cannot be set or changed.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include status page access controls: these cannot be set or changed.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: status page access controls become read-only when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "The access controls already set still apply, and you can still remove them.",
    ),
  },
  [LicensedFeature.CustomNotificationChannels]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: custom channels cannot be added or changed, and nothing is sent to them.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include custom channels: they cannot be added or changed, and nothing is sent to them.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: custom channels stop when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "Your channels and the on-call rules that use them are kept, but no page or notification is sent to them. You can still delete a channel.",
    ),
  },
  [LicensedFeature.SessionLength]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: session lengths cannot be set or changed.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include session lengths: they cannot be set or changed.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: session lengths become read-only when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "The lengths already set still sign people out, and you can still remove them.",
    ),
  },
  [LicensedFeature.StatusPageBranding]: {
    readOnlyTitle: translationKey(
      "Enterprise license required: Powered by OneUptime is shown on every status page.",
    ),
    notIncludedTitle: translationKey(
      "Your Enterprise license does not include removing Powered by OneUptime: every status page shows it.",
    ),
    graceTitle: translationKey(
      "No valid Enterprise license: status pages show Powered by OneUptime again when the trial or grace period ends.",
    ),
    afterTheLapse: translationKey(
      "Every status page shows Powered by OneUptime, whatever this switch says. The switch is kept, and the line is hidden again as soon as a license is activated.",
    ),
  },
};

export interface EnterpriseSettingNoticeCopy {
  type: AlertType;
  title: string;
  description: string;
  dataTestId: string;
}

/*
 * What to say for a license mode, or null when there is nothing to say (a
 * valid license, OneUptime Cloud, or an unknown license state).
 */
// The language of a caller that hands no translator: English, word for word.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

const READ_ONLY_WAY_BACK: string = translationKey(
  "Activate or renew the Enterprise license in the Admin Dashboard to change this again.",
);

const NOT_INCLUDED_WAY_BACK: string = translationKey(
  "Activate a license that includes it in the Admin Dashboard to change this again.",
);

const GRACE_DESCRIPTION: string = translationKey(
  "Everything here can be changed during the {{trialDays}}-day trial of an installation with no license, or the {{graceDays}}-day grace period after a license expires. When it ends: {{afterTheLapse}}",
);

/*
 * What to say for a license mode, or null when there is nothing to say (a
 * valid license, OneUptime Cloud, or an unknown license state). The title
 * is English, a key Alert looks up; the description is in the language of
 * `translator` (English without one), drawn as given.
 */
export const getEnterpriseSettingNoticeCopy: (
  mode: EnterpriseLicenseMode,
  feature: EnterpriseSettingFeature,
  translator?: Translator,
) => EnterpriseSettingNoticeCopy | null = (
  mode: EnterpriseLicenseMode,
  feature: EnterpriseSettingFeature,
  translator: Translator = ENGLISH,
): EnterpriseSettingNoticeCopy | null => {
  const sentences: FeatureSentences = FEATURE_SENTENCES[feature];
  const text: (english: string) => string = (english: string): string => {
    return translator.translateText(english) || english;
  };

  if (mode === EnterpriseLicenseMode.ReadOnly) {
    return {
      type: AlertType.DANGER,
      title: sentences.readOnlyTitle,
      description: `${text(sentences.afterTheLapse)} ${text(READ_ONLY_WAY_BACK)}`,
      dataTestId: `enterprise-setting-license-read-only-notice-${feature}`,
    };
  }

  if (mode === EnterpriseLicenseMode.NotIncluded) {
    return {
      type: AlertType.DANGER,
      title: sentences.notIncludedTitle,
      description: `${text(sentences.afterTheLapse)} ${text(NOT_INCLUDED_WAY_BACK)}`,
      dataTestId: `enterprise-setting-license-not-included-notice-${feature}`,
    };
  }

  if (mode === EnterpriseLicenseMode.Grace) {
    return {
      type: AlertType.WARNING,
      title: sentences.graceTitle,
      description: translator.translateTemplate(GRACE_DESCRIPTION, {
        trialDays: translator.formatNumber(
          ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
        ),
        graceDays: translator.formatNumber(
          ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
        ),
        afterTheLapse: composedValue((sentence: Translator): string => {
          return (
            sentence.translateText(sentences.afterTheLapse) ||
            sentences.afterTheLapse
          );
        }),
      }),
      dataTestId: `enterprise-setting-license-grace-notice-${feature}`,
    };
  }

  return null;
};

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
  feature: EnterpriseSettingFeature;
}

const EnterpriseSettingLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: EnterpriseSettingNoticeCopy | null =
    getEnterpriseSettingNoticeCopy(props.mode, props.feature, translator);

  if (!copy) {
    return <></>;
  }

  return (
    <Alert
      type={copy.type}
      strongTitle={copy.title}
      // In the reader's words already: an element, drawn as given.
      title={<Fragment>{copy.description}</Fragment>}
      dataTestId={copy.dataTestId}
      className="mb-5"
    />
  );
};

export default EnterpriseSettingLicenseNotice;
