import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Share,
  Platform,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useRoute } from "@react-navigation/native";
import { radius, spacing, typography, useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { generateBackupCodes } from "../../api/auth";
import { AuthStackParamList } from "../../navigation/types";
import GradientButton from "../../components/GradientButton";
import AuthLayout, {
  AuthLink,
  AuthNotice,
  AuthStep,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import Card from "../../components/Card";
import StatusPill from "../../components/StatusPill";
import { getFriendlyErrorMessage } from "../../utils/error";
import {
  rememberBackupCodeOfferSkipped,
  clearBackupCodeOfferSkip,
} from "../../storage/backupCodeOffer";

/*
 * The last screen of a two factor sign-in, and the only one that can lose
 * something irrecoverable.
 *
 * TWO MODES, ONE SCREEN, because they are two halves of the same problem:
 *
 *   "show"  -- the server minted a set behind an enrolment. These strings
 *              exist in this app's memory and NOWHERE ELSE, ever: the server
 *              stores keyed digests, so no one -- not the user, not an
 *              operator, not somebody holding a database dump -- can produce
 *              them again. Navigating away from this screen destroys them.
 *              So there is exactly one way forward, it is disabled until the
 *              user says they have saved them, and there is no back gesture
 *              to lose them by reflex.
 *
 *   "offer" -- the account signed in with a second factor and has no recovery
 *              codes at all. That is everybody who set two factor auth up
 *              before codes existed and everybody an admin has just reset:
 *              one lost handset from a support ticket, and never told. The
 *              offer is skippable, and skipping is remembered for a week --
 *              a nudge that cannot be dismissed is a toll, and one that could
 *              wedge a completed sign-in would be worse than the problem it
 *              is solving.
 *
 * THE SESSION ALREADY EXISTS by the time either mode renders. The tokens are
 * stored and the server considers the user signed in; the only thing this
 * screen withholds is the navigation. That is deliberate -- it means nothing
 * here can lock anybody out, and every exit from it signs the user in.
 */

type BackupCodesRouteProp = RouteProp<AuthStackParamList, "BackupCodes">;

export default function BackupCodesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const {
    pendingBackupCodes,
    showBackupCodes,
    completePendingLogin,
    pendingLoginUserId,
  } = useAuth();
  const route: BackupCodesRouteProp = useRoute<BackupCodesRouteProp>();

  const [hasSavedCodes, setHasSavedCodes] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const codes: Array<string> = pendingBackupCodes || [];

  /*
   * The route param says which mode the caller INTENDED, but the codes decide.
   * A set arriving while the offer is on screen -- which is exactly what
   * pressing "Generate" does -- has to switch this screen to showing them,
   * without a second navigation that would put the offer in the back stack
   * behind a set of codes nobody has saved yet.
   */
  const isShowingCodes: boolean =
    codes.length > 0 || route.params?.mode === "show";

  /*
   * `user` from the context is null on this screen -- the login is being HELD,
   * so the provider has not published it yet -- which is exactly why the held
   * id is exposed separately. The snooze is per-account rather than
   * per-handset: a shared on-call phone must not let one engineer silence the
   * prompt for the next person who signs in on it.
   */
  const snoozeKey: string = pendingLoginUserId || "";

  const shareCodes: () => Promise<void> = async (): Promise<void> => {
    if (codes.length === 0) {
      return;
    }

    try {
      /*
       * The system share sheet, rather than a clipboard copy.
       *
       * A clipboard is the one place on a handset a recovery code should not
       * sit: it survives the app, it is readable by anything the user pastes
       * into next, and on older Android it is readable by every app on the
       * device. The share sheet hands the codes to a destination the user
       * picks -- a password manager, their notes, AirDrop to a laptop -- which
       * is both safer and what somebody actually wants to do with them.
       */
      await Share.share({
        title: "OneUptime backup codes",
        message: [
          "OneUptime two factor authentication backup codes",
          "",
          "Each code can be used once. Keep these somewhere safe and separate",
          "from the device that runs your authenticator app.",
          "",
          ...codes,
        ].join("\n"),
      });
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    }
  };

  const generate: () => Promise<void> = async (): Promise<void> => {
    if (isGenerating) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const generated: Array<string> = await generateBackupCodes();

      if (generated.length === 0) {
        throw new Error(
          "No backup codes were returned. Try again from User Profile > Two Factor Authentication on the web dashboard.",
        );
      }

      setHasSavedCodes(false);
      showBackupCodes(generated);

      /*
       * They have codes now, so an old "stop asking" stamp is stale. Left
       * behind it would silence a prompt this account may legitimately need
       * again after a later reset.
       */
      await clearBackupCodeOfferSkip({ userId: snoozeKey });
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const acknowledgeCodes: () => void = (): void => {
    /*
     * A set has been saved, so any "stop asking" stamp is now stale -- and it
     * matters on BOTH paths, not just the one that pressed Generate. Codes
     * minted by the server during an enrolment arrive here without ever
     * touching that button, and leaving an old stamp behind would silence a
     * prompt this account may legitimately need again after a later reset.
     *
     * Not awaited: `completePendingLogin` unmounts this screen, and holding
     * the user on a saved-codes screen while a best-effort storage write
     * settles would be paying for a nudge with the sign-in.
     */
    clearBackupCodeOfferSkip({ userId: snoozeKey }).catch(() => {
      /* A stale stamp expires on its own within the week. */
    });

    completePendingLogin();
  };

  const skip: () => Promise<void> = async (): Promise<void> => {
    /*
     * Recorded BEFORE the navigator swaps. `completePendingLogin` unmounts
     * this screen, so anything after it is running in a tree being torn down.
     */
    await rememberBackupCodeOfferSkipped({ userId: snoozeKey });
    completePendingLogin();
  };

  const renderError: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (!error) {
        return null;
      }

      return <AuthNotice tone="danger" message={error} />;
    };

  /*
   * A warning with its headline in bold. Not an alert: it is on screen from
   * the start, so announcing it would only interrupt the title being read.
   */
  const renderWarning: (
    headline: string,
    detail: string,
  ) => React.JSX.Element = (
    headline: string,
    detail: string,
  ): React.JSX.Element => {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.sm + 2,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md + 2,
          borderRadius: radius.md,
          backgroundColor: theme.colors.statusWarningBg,
        }}
      >
        <Ionicons
          name="warning"
          size={18}
          color={theme.colors.statusWarning}
          style={{ marginTop: 1 }}
        />
        <Text
          style={{
            ...typography.subhead,
            flex: 1,
            color: theme.colors.textSecondary,
          }}
        >
          <Text style={{ fontWeight: "700", color: theme.colors.textPrimary }}>
            {headline}{" "}
          </Text>
          {detail}
        </Text>
      </View>
    );
  };

  const renderShowCodes: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View>
        <AuthStep
          number={1}
          title="Save your recovery codes"
          description="Keep a copy in a password manager or another safe place."
        />

        {renderWarning(
          "This is the only time these codes will be shown.",
          "Save them somewhere other than the device that generates your codes. Each code can be used once.",
        )}

        <Card testID="backup-codes-list" style={{ marginTop: spacing.lg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
              marginBottom: spacing.md,
            }}
          >
            <AppText variant="overline" tone="secondary">
              Recovery codes
            </AppText>
            <StatusPill
              tone="accent"
              size="sm"
              label={`${codes.length} ${codes.length === 1 ? "code" : "codes"}`}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
              rowGap: spacing.sm,
            }}
          >
            {codes.map((backupCode: string) => {
              return (
                <View
                  key={backupCode}
                  testID="backup-code-cell"
                  style={{
                    width: "48.5%",
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.backgroundTertiary,
                  }}
                >
                  <Text
                    testID="backup-code-value"
                    selectable={true}
                    style={{
                      ...typography.callout,
                      fontWeight: "600",
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                      letterSpacing: 0.5,
                      textAlign: "center",
                      color: theme.colors.textPrimary,
                    }}
                  >
                    {backupCode}
                  </Text>
                </View>
              );
            })}
          </View>

          <GradientButton
            label="Save or Share Codes"
            onPress={shareCodes}
            variant="tonal"
            icon="share-outline"
            style={{ marginTop: spacing.lg }}
          />
        </Card>

        <View style={{ marginTop: spacing.xxl }}>
          <AuthStep number={2} title="Confirm you have saved them" />
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="I have saved these codes somewhere safe."
          accessibilityState={{ checked: hasSavedCodes }}
          aria-checked={hasSavedCodes}
          testID="backup-codes-saved-checkbox"
          onPress={() => {
            setHasSavedCodes(!hasSavedCodes);
          }}
          style={({ pressed }: { pressed: boolean }): ViewStyle => {
            return {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              minHeight: 56,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg - (hasSavedCodes ? 1 : 0),
              borderRadius: radius.md,
              borderWidth: hasSavedCodes ? 2 : 1,
              borderColor: hasSavedCodes
                ? theme.colors.actionPrimary
                : theme.colors.borderDefault,
              backgroundColor: hasSavedCodes
                ? theme.colors.cardAccent
                : pressed
                  ? theme.colors.backgroundTertiary
                  : theme.colors.backgroundElevated,
            };
          }}
        >
          <Ionicons
            name={hasSavedCodes ? "checkbox" : "square-outline"}
            size={24}
            color={
              hasSavedCodes
                ? theme.colors.actionPrimary
                : theme.colors.textTertiary
            }
          />
          <AppText variant="callout" style={{ flex: 1 }}>
            I have saved these codes somewhere safe.
          </AppText>
        </Pressable>

        <View style={{ marginTop: spacing.lg, gap: spacing.lg }}>
          {renderError()}

          <GradientButton
            label="Continue"
            testID="backup-codes-continue"
            onPress={acknowledgeCodes}
            disabled={!hasSavedCodes}
            style={authPrimaryButtonStyle}
          />
        </View>
      </View>
    );
  };

  const renderOffer: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View style={{ gap: spacing.lg }}>
        {renderWarning(
          "You have no backup codes.",
          "If you lose your authenticator app or security key, an administrator will have to reset two factor authentication before you can sign in again.",
        )}

        {renderError()}

        <GradientButton
          label="Generate Backup Codes"
          testID="generate-backup-codes"
          onPress={generate}
          loading={isGenerating}
          disabled={isGenerating}
          icon="key-outline"
          style={[authPrimaryButtonStyle, { marginTop: spacing.xs }]}
        />

        <AuthLink
          label="Skip for now"
          tone="secondary"
          testID="skip-backup-codes"
          onPress={skip}
          disabled={isGenerating}
        />
      </View>
    );
  };

  return (
    <AuthLayout
      title={isShowingCodes ? "Keep a way back in" : "Add backup codes"}
      eyebrow="ACCOUNT RECOVERY"
      icon="key-outline"
      iconTone={isShowingCodes ? "accent" : "warning"}
      compact
      description={
        isShowingCodes
          ? "Use one of these to sign in if you ever lose access to your authenticator app."
          : "One last thing before you continue."
      }
    >
      {isShowingCodes ? renderShowCodes() : renderOffer()}
    </AuthLayout>
  );
}
