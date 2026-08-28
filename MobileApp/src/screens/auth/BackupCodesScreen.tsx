import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useRoute } from "@react-navigation/native";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { generateBackupCodes } from "../../api/auth";
import { AuthStackParamList } from "../../navigation/types";
import GradientButton from "../../components/GradientButton";
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

      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            marginTop: 14,
          }}
        >
          <Ionicons
            name="alert-circle"
            size={14}
            color={theme.colors.statusError}
            style={{ marginRight: 6, marginTop: 2 }}
          />
          <Text
            style={{ fontSize: 13, flex: 1, color: theme.colors.statusError }}
          >
            {error}
          </Text>
        </View>
      );
    };

  const renderShowCodes: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            padding: 14,
            borderRadius: 12,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.severityWarning,
          }}
        >
          <Ionicons
            name="warning-outline"
            size={18}
            color={theme.colors.severityWarning}
            style={{ marginRight: 10, marginTop: 1 }}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 19,
              color: theme.colors.textSecondary,
            }}
          >
            <Text
              style={{ fontWeight: "700", color: theme.colors.textPrimary }}
            >
              This is the only time these codes will be shown.{" "}
            </Text>
            Save them somewhere other than the device that generates your codes.
            Each code can be used once.
          </Text>
        </View>

        <View
          testID="backup-codes-list"
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 12,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.borderDefault,
          }}
        >
          {codes.map((backupCode: string) => {
            return (
              <Text
                key={backupCode}
                testID="backup-code-value"
                selectable={true}
                style={{
                  fontSize: 15,
                  letterSpacing: 1.5,
                  paddingVertical: 4,
                  color: theme.colors.textPrimary,
                }}
              >
                {backupCode}
              </Text>
            );
          })}
        </View>

        <View style={{ marginTop: 16 }}>
          <GradientButton
            label="Save or Share Codes"
            onPress={shareCodes}
            variant="secondary"
            icon="share-outline"
          />
        </View>

        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: hasSavedCodes }}
          testID="backup-codes-saved-checkbox"
          onPress={() => {
            setHasSavedCodes(!hasSavedCodes);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 22,
          }}
        >
          <Ionicons
            name={hasSavedCodes ? "checkbox" : "square-outline"}
            size={22}
            color={
              hasSavedCodes
                ? theme.colors.actionPrimary
                : theme.colors.textTertiary
            }
            style={{ marginRight: 10 }}
          />
          <Text
            style={{ flex: 1, fontSize: 14, color: theme.colors.textSecondary }}
          >
            I have saved these codes somewhere safe.
          </Text>
        </TouchableOpacity>

        {renderError()}

        <View style={{ marginTop: 22 }}>
          <GradientButton
            label="Continue"
            testID="backup-codes-continue"
            onPress={acknowledgeCodes}
            disabled={!hasSavedCodes}
          />
        </View>
      </View>
    );
  };

  const renderOffer: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            padding: 14,
            borderRadius: 12,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.severityWarning,
          }}
        >
          <Ionicons
            name="warning-outline"
            size={18}
            color={theme.colors.severityWarning}
            style={{ marginRight: 10, marginTop: 1 }}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 19,
              color: theme.colors.textSecondary,
            }}
          >
            <Text
              style={{ fontWeight: "700", color: theme.colors.textPrimary }}
            >
              You have no backup codes.{" "}
            </Text>
            If you lose your authenticator app or security key, an administrator
            will have to reset two factor authentication before you can sign in
            again.
          </Text>
        </View>

        {renderError()}

        <View style={{ marginTop: 22 }}>
          <GradientButton
            label="Generate Backup Codes"
            testID="generate-backup-codes"
            onPress={generate}
            loading={isGenerating}
            disabled={isGenerating}
          />
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="skip-backup-codes"
          onPress={skip}
          style={{ marginTop: 18, alignItems: "center" }}
        >
          <Text style={{ fontSize: 14, color: theme.colors.textTertiary }}>
            Skip for now
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ paddingHorizontal: 28, paddingVertical: 32 }}>
        <Text
          style={{
            fontSize: 24,
            fontWeight: "bold",
            textAlign: "center",
            color: theme.colors.textPrimary,
          }}
        >
          {isShowingCodes ? "Save Your Backup Codes" : "Set Up Backup Codes"}
        </Text>
        <Text
          style={{
            fontSize: 14,
            marginTop: 6,
            marginBottom: 26,
            textAlign: "center",
            lineHeight: 20,
            color: theme.colors.textSecondary,
          }}
        >
          {isShowingCodes
            ? "Use one of these to sign in if you ever lose access to your authenticator app."
            : "One last thing before you continue."}
        </Text>

        {isShowingCodes ? renderShowCodes() : renderOffer()}
      </View>
    </ScrollView>
  );
}
