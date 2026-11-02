import EnterpriseSettingLicenseNotice from "../../Dashboard/EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../Dashboard/Identity/License/UseEnterpriseLicenseMode";
import SessionLengthCard from "./SessionLengthCard";
import SessionLengthCopy, {
  getSsoFoldedItem,
  SESSION_LENGTH_MORE_SETTINGS_TEST_ID,
  SESSION_LENGTH_PAGE_TEST_ID,
  SESSION_LENGTH_SIGNS_OUT,
} from "./SessionLengthCopy";
import {
  SESSION_LENGTH_SETTINGS_PAGE_PATH,
  SESSION_LENGTH_SETTINGS_PAGE_TITLE,
} from "./SessionLengthPaths";
import { ConfirmSessionLengthChange } from "./SessionLengthSettingRows";
import {
  fetchSessionLengthSettings,
  previewSessionLengthSettings,
  SessionLengthChange,
  SessionLengthPreview,
} from "./SessionLengthSettingsAPI";
import SsoSignInsCard from "./SsoSignInsCard";
import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  doesShortenAnySession,
  SessionLengthSettings,
  toSessionLengths,
} from "Common/Types/UserSession/SessionLength";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Settings > Session Length (Enterprise Edition): how
 * long people stay signed in to OneUptime - the Dashboard, the Admin
 * Dashboard and the mobile app - before they sign in again
 * (Common/Types/UserSession/SessionLength.ts). The server holds every
 * sign-in to it, on every request (ee/Server/SessionLength).
 *
 *   - Session Length: "Sign people out after" (No limit by default) and
 *     "Sign people out after inactivity" (30 days by default, the longest
 *     there is), for every sign-in. Each saves the moment it is picked.
 *   - More settings, folded: SSO Sign-ins, a switch that gives sign-ins
 *     through SSO two lengths of their own - most installations want one
 *     rule for everyone, so it stays out of the way, and the folded header
 *     says "SSO Sign-ins: On" while it is. Turned on, they start at the
 *     lengths above, so nothing changes until another is picked. A fold
 *     that holds one card says nothing of its own: the card says it.
 *
 * A change applies to everyone signed in now. One that signs people out at
 * once is asked first, with how many (the preview route), and whether the
 * master admin making it is one of them - or is the only one; anything that
 * only lengthens a sign-in is saved as it is picked. Without a license that includes it, the
 * page says so and offers only the defaults: what is set keeps applying,
 * and can always be removed.
 */

// A change waiting for the master admin to confirm it.
interface PendingConfirmation {
  // Null when the server could not say who the change signs out.
  preview: SessionLengthPreview | null;
  resolve: (isConfirmed: boolean) => void;
}

const SessionLengthSettingsPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.SessionLength,
  );
  const isLocked: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  const [settings, setSettings] = useState<SessionLengthSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  );

  // What the server holds, as last read or saved: every change is weighed against it.
  const settingsRef: MutableRefObject<SessionLengthSettings | null> =
    useRef<SessionLengthSettings | null>(null);

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const read: SessionLengthSettings = await fetchSessionLengthSettings();
      settingsRef.current = read;
      setSettings(read);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  /*
   * Whether a pick may be saved: at once, unless it signs people out right
   * away - then once the master admin confirms it.
   */
  const confirmChange: ConfirmSessionLengthChange = async (
    change: SessionLengthChange,
  ): Promise<boolean> => {
    const current: SessionLengthSettings | null = settingsRef.current;

    if (!current) {
      return false;
    }

    const proposed: SessionLengthSettings = {
      ...current,
      ...change,
    };

    if (
      !doesShortenAnySession(
        toSessionLengths(current),
        toSessionLengths(proposed),
      )
    ) {
      return true;
    }

    let preview: SessionLengthPreview | null = null;

    try {
      preview = await previewSessionLengthSettings(proposed);
    } catch {
      // The server could not say who: asked anyway, in general words.
      preview = null;
    }

    if (preview && preview.peopleSignedOut === 0) {
      return true;
    }

    return await new Promise<boolean>(
      (resolve: (isConfirmed: boolean) => void): void => {
        setConfirmation({ preview, resolve });
      },
    );
  };

  /*
   * What a saved change leaves, in one update: the SSO lengths a switch
   * turned on starts at are there as its two rows first draw.
   */
  const onSaved: (change: SessionLengthChange) => void = (
    change: SessionLengthChange,
  ): void => {
    const current: SessionLengthSettings | null = settingsRef.current;

    if (!current) {
      return;
    }

    const next: SessionLengthSettings = { ...current, ...change };
    settingsRef.current = next;
    setSettings(next);
  };

  // The one person a change signs out is the master admin making it.
  const isOnlyYou: (preview: SessionLengthPreview | null) => boolean = (
    preview: SessionLengthPreview | null,
  ): boolean => {
    return Boolean(
      preview && preview.includesYou && preview.peopleSignedOut === 1,
    );
  };

  const answer: (isConfirmed: boolean) => void = (
    isConfirmed: boolean,
  ): void => {
    confirmation?.resolve(isConfirmed);
    setConfirmation(null);
  };

  const getConfirmationDescription: (pending: PendingConfirmation) => string = (
    pending: PendingConfirmation,
  ): string => {
    if (!pending.preview) {
      return translator.translateText(SessionLengthCopy.confirmUnknown) || "";
    }

    if (isOnlyYou(pending.preview)) {
      return translator.translateText(SessionLengthCopy.confirmOnlyYou) || "";
    }

    const signsOut: string = translator.translatePlural(
      SESSION_LENGTH_SIGNS_OUT,
      pending.preview.peopleSignedOut,
    );

    return pending.preview.includesYou
      ? `${signsOut} ${translator.translateText(SessionLengthCopy.confirmIncludesYou) || ""}`
      : signsOut;
  };

  const getContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <Card
          title={SessionLengthCopy.cardTitle}
          description={SessionLengthCopy.cardDescription}
        >
          <ComponentLoader />
        </Card>
      );
    }

    if (error || !settings) {
      return (
        <Card
          title={SessionLengthCopy.cardTitle}
          description={SessionLengthCopy.cardDescription}
        >
          <ErrorMessage
            message={
              error ||
              translator.translateText(SessionLengthCopy.loadFailed) ||
              SessionLengthCopy.loadFailed
            }
            onRefreshClick={() => {
              void load();
            }}
          />
        </Card>
      );
    }

    return (
      <>
        <SessionLengthCard
          settings={settings}
          isLocked={isLocked}
          confirmChange={confirmChange}
          onSaved={onSaved}
        />
        <AdvancedPageSection
          items={[getSsoFoldedItem(settings.useSeparateSsoSessionLengths)]}
          dataTestId={SESSION_LENGTH_MORE_SETTINGS_TEST_ID}
        >
          <SsoSignInsCard
            settings={settings}
            isLocked={isLocked}
            confirmChange={confirmChange}
            onSaved={onSaved}
          />
        </AdvancedPageSection>
      </>
    );
  };

  const getConfirmButtonText: (pending: PendingConfirmation) => string = (
    pending: PendingConfirmation,
  ): string => {
    if (!pending.preview) {
      return SessionLengthCopy.confirmUnknownButton;
    }

    return isOnlyYou(pending.preview)
      ? SessionLengthCopy.confirmOnlyYouButton
      : SessionLengthCopy.confirmButton;
  };

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: SESSION_LENGTH_SETTINGS_PAGE_TITLE,
          to: getEnterpriseSettingsPageRoute(SESSION_LENGTH_SETTINGS_PAGE_PATH),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <div className="space-y-6" data-testid={SESSION_LENGTH_PAGE_TEST_ID}>
        <EnterpriseSettingLicenseNotice
          mode={licenseMode}
          feature={LicensedFeature.SessionLength}
        />
        {getContent()}
      </div>
      {confirmation ? (
        <ConfirmModal
          title={
            isOnlyYou(confirmation.preview)
              ? SessionLengthCopy.confirmOnlyYouTitle
              : SessionLengthCopy.confirmTitle
          }
          description={getConfirmationDescription(confirmation)}
          submitButtonText={getConfirmButtonText(confirmation)}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            answer(true);
          }}
          onClose={() => {
            answer(false);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SessionLengthSettingsPage;
