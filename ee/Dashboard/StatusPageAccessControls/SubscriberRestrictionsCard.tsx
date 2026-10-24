import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import {
  ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN,
} from "Common/Types/StatusPage/SubscriberRestrictions";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import Pill from "Common/UI/Components/Pill/Pill";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import StatusPageSwitchRow from "@oneuptime/dashboard/Components/StatusPage/StatusPageSwitchRow";
import {
  getStatusPageAccessSelect,
  getStatusPageAccessState,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPageAccessCopy";
import {
  getStatusPageAccess,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import SubscriberRestrictionsCopy, {
  ALLOWED_EMAIL_DOMAINS_PLACEHOLDER,
  ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID,
  getAllowedEmailDomainsInputProblem,
  getPrivateUsersOnlyDescription,
  isSameAllowedEmailDomains,
  PRIVATE_USERS_ONLY_SWITCH_TEST_ID,
  SUBSCRIBER_RESTRICTIONS_CARD_TEST_ID,
  toAllowedEmailDomainsText,
} from "@oneuptime/dashboard/Components/StatusPage/SubscriberRestrictionsCopy";

/*
 * The Who Can Subscribe card on Subscribers -> Subscriber Settings (see
 * SubscriberRestrictionsCopy), two rows:
 *
 *   - Only Private Users Can Subscribe: a switch that saves the moment it is
 *     flipped (StatusPageSwitchRow). On a page no reader signs in to - one
 *     open to anyone, or to anyone with the password (Security -> Access)
 *     - it says what that means for sign-ups.
 *   - Allowed Email Domains: the domains, one a line, saved with Save
 *     Domains - a list is typed, not picked, so nothing saves half-typed.
 *     A domain that is not one is caught before anything is sent;
 *     "Saving…" and then "Saved" show beside the name, and what the server
 *     refuses is said under the box, with what was typed left in it.
 *
 * Someone who may not change a setting sees it locked, with the permission
 * that is missing; where the plan has to be upgraded, the plan's name is
 * beside it before anyone tries.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  // Told after a setting is saved, so the warnings above the lists can read it again.
  onSaved?: (() => void) | undefined;
}

interface AllowedEmailDomainsSettingProps {
  statusPageId: ObjectID;
  initialDomains: string;
  onSaved?: (() => void) | undefined;
}

const AllowedEmailDomainsSetting: FunctionComponent<
  AllowedEmailDomainsSettingProps
> = (props: AllowedEmailDomainsSettingProps): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  const labelId: string = `allowed-email-domains-label-${id}`;
  const textAreaId: string = `allowed-email-domains-${id}`;

  const [draft, setDraft] = useState<string>(props.initialDomains);
  const [problem, setProblem] = useState<string>("");

  const setting: SaveOnChange<string> = useSaveOnChange<string>({
    initialValue: props.initialDomains,
    save: async (domains: string): Promise<void> => {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: {
          [ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN]: domains || null,
        },
      });
    },
    isSame: isSameAllowedEmailDomains,
    onSaved: (domains: string): void => {
      // As the server keeps it: one domain a line.
      setDraft(toAllowedEmailDomainsText(domains));
      props.onSaved?.();
    },
  });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave the box locked for
   * someone who may change it.
   */
  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  );

  const planNeeded: PlanType | null = getPlanNeededToChangeColumn(
    statusPage,
    ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  );

  // What is typed differs from what is saved, or on its way to be.
  const hasChanges: boolean = !isSameAllowedEmailDomains(draft, setting.value);

  const save: () => void = (): void => {
    const found: { template: string; values: Record<string, string> } | null =
      getAllowedEmailDomainsInputProblem(draft);

    if (found) {
      setProblem(translator.translateTemplate(found.template, found.values));
      return;
    }

    setProblem("");
    setting.change(toAllowedEmailDomainsText(draft));
  };

  const discard: () => void = (): void => {
    setDraft(toAllowedEmailDomainsText(setting.value));
    setProblem("");
  };

  const editor: ReactElement = (
    <fieldset
      disabled={!updateGate.isAllowed}
      className="mt-1 max-w-md"
      data-testid={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-editor`}
    >
      <TextArea
        id={textAreaId}
        ariaLabelledby={labelId}
        initialValue={draft}
        placeholder={ALLOWED_EMAIL_DOMAINS_PLACEHOLDER}
        autoGrow={true}
        rows={3}
        maxRows={12}
        disableSpellCheck={true}
        error={problem || undefined}
        dataTestId={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-input`}
        onChange={(value: string) => {
          setDraft(value);
          setProblem("");
        }}
      />
      {hasChanges ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            title={SubscriberRestrictionsCopy.allowedDomainsSave}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            onClick={save}
            dataTestId={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-save`}
          />
          <Button
            title={SubscriberRestrictionsCopy.allowedDomainsDiscard}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={discard}
            dataTestId={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-discard`}
          />
        </div>
      ) : (
        <></>
      )}
    </fieldset>
  );

  return (
    <div data-testid={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-row`}>
      {/*
       * As on a switch's row: the plan's pill sits to the right from sm up,
       * and under the name on a phone.
       */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <label
            id={labelId}
            htmlFor={textAreaId}
            className="text-sm font-medium text-gray-900"
          >
            {translator.translateText(
              SubscriberRestrictionsCopy.allowedDomainsLabel,
            )}
          </label>
          <SaveStatus
            state={setting.saveState}
            dataTestId={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-status`}
          />
        </div>
        {planNeeded ? (
          <div className="flex-shrink-0">
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planNeeded,
              })}
              color={Yellow}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-description`}
      >
        {translator.translateText(
          SubscriberRestrictionsCopy.allowedDomainsDescription,
        )}
      </p>
      {updateGate.isAllowed ? (
        editor
      ) : (
        <Tooltip text={updateGate.disabledReason}>{editor}</Tooltip>
      )}
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

interface Settings {
  limitSubscribersToPrivateUsers: boolean;
  allowedSubscriberEmailDomains: string;
  // Whether readers sign in to the page, as Security -> Access has it.
  readersSignIn: boolean;
}

const SubscriberRestrictionsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.StatusPageAccessControls,
  );
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          [LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN]: true,
          [ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN]: true,
          // Who can see the page, read as the Access card reads it.
          ...getStatusPageAccessSelect(),
        },
      });

      if (item) {
        setSettings({
          limitSubscribersToPrivateUsers:
            item[LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN] === true,
          allowedSubscriberEmailDomains: toAllowedEmailDomainsText(
            item[ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN],
          ),
          readersSignIn:
            getStatusPageAccess(getStatusPageAccessState(item)) ===
            StatusPageAccess.SignIn,
        });
      } else {
        setError(
          translator.translateText("Status page not found.") ||
            "Status page not found.",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchStatusPage();
  }, [props.statusPageId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || !settings) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule, as on the
       * Channels card: the body reaches the card's edges and each row
       * brings its own padding back.
       */
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            statusPageId={props.statusPageId}
            column={LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN}
            initialValue={settings.limitSubscribersToPrivateUsers}
            title={SubscriberRestrictionsCopy.privateUsersOnlyTitle}
            getDescription={getPrivateUsersOnlyDescription}
            note={
              settings.readersSignIn
                ? undefined
                : SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote
            }
            onSaved={() => {
              props.onSaved?.();
            }}
            dataTestId={PRIVATE_USERS_ONLY_SWITCH_TEST_ID}
          />
        </div>
        <div className="px-5 py-4 md:px-6">
          <AllowedEmailDomainsSetting
            statusPageId={props.statusPageId}
            initialDomains={settings.allowedSubscriberEmailDomains}
            onSaved={props.onSaved}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.StatusPageAccessControls}
      />
      <Card
        title={SubscriberRestrictionsCopy.cardTitle}
        description={SubscriberRestrictionsCopy.cardDescription}
      >
        <div data-testid={SUBSCRIBER_RESTRICTIONS_CARD_TEST_ID}>
          {getBody()}
        </div>
      </Card>
    </Fragment>
  );
};

export default SubscriberRestrictionsCard;
