import React, { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse, TwoFactorMethod } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout, {
  AuthLink,
  AuthNotice,
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import IconBadge from "../../components/IconBadge";
import { ListGroup } from "../../components/ListGroup";
import { getFriendlyErrorMessage } from "../../utils/error";
import {
  decideTwoFactorFollowUp,
  TwoFactorFollowUp,
} from "../../auth/twoFactorFollowUp";
import { wasBackupCodeOfferSkippedRecently } from "../../storage/backupCodeOffer";

/*
 * THE SCREEN THIS APP DID NOT HAVE.
 *
 * Until now the mobile app answered a two factor account with a sentence: "not
 * yet supported, please sign in on the web dashboard". For an on-call engineer
 * that is the wrong answer at the worst possible time -- the page they cannot
 * reach is the one with the incident on it.
 *
 * It is deliberately the same flow as the web sign-in, screen for screen: pick
 * a method, type a code, and -- from ANY of those screens, whether or not the
 * account has recovery codes -- a way out. The web version of this exact dead
 * end is what OneUptime issue #3382 was filed about, so it is not recreated
 * here.
 *
 * WHAT IS DIFFERENT FROM THE WEB, AND WHY
 *
 * Security keys are LISTED but cannot be used. WebAuthn needs platform APIs
 * this client does not have. Hiding them would be worse than saying so: their
 * owner would see a two factor screen missing the factor they registered and
 * conclude the account had been tampered with. They are shown, greyed, with
 * the reason -- and the recovery route below them still works, which is what
 * actually gets that user in.
 */

type TwoFactorNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "TwoFactor"
>;

export default function TwoFactorScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const {
    pendingTwoFactor,
    verifyTotpAuth,
    verifyBackupCode,
    cancelTwoFactor,
    completePendingLogin,
  } = useAuth();
  const navigation: TwoFactorNavigationProp =
    useNavigation<TwoFactorNavigationProp>();

  const totpAuthList: Array<TwoFactorMethod> =
    pendingTwoFactor?.totpAuthList || [];
  const webAuthnList: Array<TwoFactorMethod> =
    pendingTwoFactor?.webAuthnList || [];

  /*
   * No auto-selection, even for the one-method account where skipping the
   * picker would save a tap.
   *
   * This flow is meant to be recognisable to somebody who has signed in on the
   * web: same screens, same order, same wording. A handset that quietly starts
   * a step further along than the browser did is a difference the user has to
   * discover mid-sign-in, which is the wrong moment for a surprise -- and the
   * saved tap is not worth it. The heading tells the single-method account
   * "Confirm it is you to finish signing in" rather than asking them to select
   * anything, which is the same wording the web screen uses.
   */
  const [selectedTotp, setSelectedTotp] = useState<TwoFactorMethod | null>(
    null,
  );

  const [isUsingBackupCode, setIsUsingBackupCode] = useState<boolean>(false);
  const [code, setCode] = useState<string>("");
  const [backupCode, setBackupCode] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Whether we POSITIVELY KNOW there are no recovery codes.
   *
   * Not `!count`. The server omits the count when it could not read it, and
   * null therefore means "unknown". Treating unknown as none would tell a user
   * holding ten printed codes to go and find an administrator, at the exact
   * moment a transient fault made the count unreadable.
   */
  const isKnownToHaveNoBackupCodes: boolean =
    pendingTwoFactor?.backupCodeCount === 0;

  const afterSecondStep: (
    response: LoginResponse,
    accountHasNoCodes: boolean,
  ) => Promise<void> = async (
    response: LoginResponse,
    accountHasNoCodes: boolean,
  ): Promise<void> => {
    const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: response.backupCodes?.length || 0,
      accountHasNoCodes,
      offerRecentlySkipped: accountHasNoCodes
        ? await wasBackupCodeOfferSkippedRecently({
            userId: response.user?._id || "",
          })
        : false,
    });

    if (followUp === "signed-in") {
      completePendingLogin();
      return;
    }

    navigation.navigate("BackupCodes", {
      mode: followUp === "show-codes" ? "show" : "offer",
    });
  };

  const submitTotpCode: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!selectedTotp) {
      return;
    }

    if (!code.trim()) {
      setError("Enter the code from your authenticator app.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response: LoginResponse = await verifyTotpAuth({
        twoFactorAuthId: selectedTotp._id,
        code: code.trim(),
      });

      await afterSecondStep(response, isKnownToHaveNoBackupCodes);
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const submitBackupCode: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!backupCode.trim()) {
      setError("Enter one of your backup codes.");
      return;
    }

    setError(null);
    setIsLoading(true);

    /*
     * Read BEFORE the await. `verifyBackupCode` clears the pending challenge
     * on success, so reading the count afterwards would be reading a value the
     * call itself has just destroyed. It happens to work today only because
     * this closure captured the pre-clear render, which is exactly the kind of
     * accident a later refactor removes silently.
     */
    const countBeforeSpending: number | null =
      pendingTwoFactor?.backupCodeCount ?? null;

    try {
      const response: LoginResponse = await verifyBackupCode({
        backupCode: backupCode.trim(),
      });

      /*
       * The code they just typed is gone -- single use is the whole point of
       * it -- so the count the challenge reported is now one too high. Signing
       * in WITH a recovery code and having none left afterwards is the
       * clearest "you are one lost handset from a support ticket" moment this
       * app has, and passing the stale count would sail straight past it: this
       * screen is only reachable when the count was above zero.
       */
      await afterSecondStep(
        response,
        countBeforeSpending !== null && countBeforeSpending <= 1,
      );
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const signInAsSomebodyElse: () => void = (): void => {
    cancelTwoFactor();
    navigation.navigate("Login");
  };

  /*
   * Rendered under EVERY challenge screen -- the picker, the code entry, and
   * the security key list -- and rendered whether or not the account has codes
   * to spend. Both of those are the fix for issue #3382, where the web link
   * lived on the picker only and was hidden from accounts with no codes, which
   * for as long as nothing minted codes meant hidden from nearly everybody.
   */
  /*
   * An account whose only factor is a security key has never owned an
   * authenticator app, so asking them about one labels the single route they
   * have for a thing they do not possess. The user who most needs this link is
   * then the one least likely to recognise it as addressed to them -- which is
   * the same failure the whole issue was filed about, one noun over.
   */
  const lostAccessLabel: string =
    totpAuthList.length === 0 && webAuthnList.length > 0
      ? "Lost access to your security key?"
      : "Lost access to your authenticator?";

  const renderLostAccessLink: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (isUsingBackupCode) {
        return null;
      }

      return (
        <AuthLink
          label={lostAccessLabel}
          testID="lost-access-link"
          disabled={isLoading}
          onPress={() => {
            setIsUsingBackupCode(true);
            setError(null);
          }}
        />
      );
    };

  const renderMethodPicker: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View style={{ gap: spacing.lg }}>
        {totpAuthList.length + webAuthnList.length > 0 ? (
          <ListGroup>
            {totpAuthList.map((method: TwoFactorMethod) => {
              return (
                <Pressable
                  key={method._id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${method.name}`}
                  accessibilityHint="Enter a code from this authenticator app."
                  testID={`totp-method-${method._id}`}
                  onPress={() => {
                    setSelectedTotp(method);
                    setError(null);
                  }}
                  style={({ pressed }: { pressed: boolean }): ViewStyle => {
                    return {
                      minHeight: 68,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.md,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      backgroundColor: pressed
                        ? theme.colors.backgroundTertiary
                        : "transparent",
                    };
                  }}
                >
                  <IconBadge name="phone-portrait-outline" />
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                    <AppText variant="headline">{method.name}</AppText>
                    <AppText variant="footnote" tone="secondary">
                      Authenticator App
                    </AppText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={theme.colors.textTertiary}
                  />
                </Pressable>
              );
            })}

            {webAuthnList.map((method: TwoFactorMethod) => {
              return (
                <View
                  key={method._id}
                  testID={`webauthn-method-${method._id}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: spacing.md,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    backgroundColor: theme.colors.backgroundTertiary,
                  }}
                >
                  <IconBadge
                    name="key-outline"
                    color={theme.colors.textTertiary}
                    background={theme.colors.backgroundElevated}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                    <AppText variant="headline" tone="secondary">
                      {method.name}
                    </AppText>
                    <AppText variant="footnote" tone="secondary">
                      Security keys are not supported in the mobile app. Use an
                      authenticator app, a backup code, or the web dashboard.
                    </AppText>
                  </View>
                </View>
              );
            })}
          </ListGroup>
        ) : null}

        {totpAuthList.length === 0 && webAuthnList.length > 0 ? (
          <AuthNotice
            testID="security-key-only-notice"
            tone="warning"
            message={
              isKnownToHaveNoBackupCodes
                ? "A security key is the only two factor method on this account, and this app cannot use one. Sign in on the web dashboard, or ask an administrator to reset two factor authentication."
                : "A security key is the only two factor method on this account, and this app cannot use one. Sign in with a backup code below, or use the web dashboard."
            }
          />
        ) : null}
      </View>
    );
  };

  const renderCodeEntry: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View style={{ gap: spacing.xl }}>
        <Card variant="tinted">
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <IconBadge
              name="phone-portrait-outline"
              background={theme.colors.backgroundElevated}
            />
            <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
              <AppText variant="headline">{selectedTotp?.name}</AppText>
              <AppText variant="subhead" tone="secondary">
                Open this authenticator and enter its current six-digit code
                below.
              </AppText>
            </View>
          </View>
        </Card>

        <AuthTextField
          testID="totp-code-input"
          containerTestID="totp-code-field"
          variant="code"
          label="Six-digit code"
          accessibilityLabel="Authenticator code"
          editable={!isLoading}
          errorMessage={error}
          value={code}
          onChangeText={(text: string) => {
            setCode(text);
            setError(null);
          }}
          placeholder="000000"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          /*
           * `oneTimeCode` is what lets iOS offer the code straight from the
           * Messages/keychain suggestion bar. Without it the user is
           * switching apps to read six digits they have to remember.
           * `one-time-code` is the same hint for Android autofill.
           */
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          returnKeyType="go"
          onSubmitEditing={submitTotpCode}
        />

        <GradientButton
          label="Verify"
          onPress={submitTotpCode}
          loading={isLoading}
          disabled={isLoading}
          style={authPrimaryButtonStyle}
        />
      </View>
    );
  };

  /*
   * THE DEAD END, AND WHAT REPLACED IT.
   *
   * A user who cannot reach their factor and has no recovery codes is shown
   * the route that actually exists -- an administrator can reset two factor
   * auth on the account -- rather than a form that could only refuse them, and
   * rather than nothing at all, which is what the web screen showed before
   * issue #3382 was fixed.
   */
  const renderRecovery: () => React.JSX.Element = (): React.JSX.Element => {
    if (isKnownToHaveNoBackupCodes) {
      return (
        <Card variant="outlined" testID="no-backup-codes">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <IconBadge
              name="warning-outline"
              color={theme.colors.statusWarning}
              background={theme.colors.statusWarningBg}
            />
            <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
              <AppText variant="headline">You have no backup codes.</AppText>
              <AppText variant="subhead" tone="secondary">
                There is no code you can enter here, because this account has
                never been given a set. Ask an administrator of this OneUptime
                instance to reset two factor authentication on your account. You
                will then be able to sign in with your password and set a new
                authenticator app up, and backup codes will be created for you
                at the same time.
              </AppText>
            </View>
          </View>
        </Card>
      );
    }

    return (
      <View style={{ gap: spacing.xl }}>
        <AppText variant="callout" tone="secondary">
          Enter one of the backup codes you saved when you set up two factor
          authentication. Each code works only once.
        </AppText>

        <AuthTextField
          testID="backup-code-input"
          containerTestID="backup-code-field"
          label="Backup code"
          icon="key-outline"
          accessibilityLabel="Backup code"
          editable={!isLoading}
          errorMessage={error}
          value={backupCode}
          onChangeText={(text: string) => {
            setBackupCode(text);
            setError(null);
          }}
          placeholder="ABCDE-12345"
          /*
           * Autocorrect and autocapitalise are both off: a recovery code is
           * not a word, and a keyboard that "helpfully" capitalises or
           * rewrites it produces a refusal the user cannot explain. Case and
           * hyphens are normalized on the server, so what is typed is what
           * matters, not how it looks.
           */
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={submitBackupCode}
        />

        <GradientButton
          label="Sign In"
          onPress={submitBackupCode}
          loading={isLoading}
          disabled={isLoading}
          style={authPrimaryButtonStyle}
        />
      </View>
    );
  };

  const renderBody: () => React.JSX.Element = (): React.JSX.Element => {
    /*
     * No challenge in the context means there is nothing to answer -- the app
     * was restarted, or this screen was reached without a password step in
     * front of it. Rendering the picker anyway produces a heading, two links
     * and an empty space where the methods should be, which reads as a broken
     * account rather than as a lost session.
     */
    if (!pendingTwoFactor) {
      return (
        <Card
          testID="no-pending-challenge"
          style={{ alignItems: "center", gap: spacing.md }}
        >
          <IconBadge name="time-outline" size="lg" shape="circle" />
          <AppText variant="subhead" tone="secondary" align="center">
            This sign-in has expired. Enter your email and password again to
            start over.
          </AppText>
        </Card>
      );
    }

    if (isUsingBackupCode) {
      return renderRecovery();
    }

    if (selectedTotp) {
      return renderCodeEntry();
    }

    return renderMethodPicker();
  };

  const subtitle: string = isUsingBackupCode
    ? "Use a backup code, or find out how to get back in without one."
    : selectedTotp || totpAuthList.length + webAuthnList.length <= 1
      ? "Confirm it is you to finish signing in."
      : "Select a two factor authentication method.";

  return (
    <AuthLayout
      title="Verify your identity"
      compact
      icon={isUsingBackupCode ? "key-outline" : "shield-checkmark-outline"}
      eyebrow={
        isUsingBackupCode ? "ACCOUNT RECOVERY" : "TWO-FACTOR AUTHENTICATION"
      }
      description={subtitle}
    >
      {renderBody()}

      <View style={{ marginTop: spacing.md }}>
        {renderLostAccessLink()}

        {isUsingBackupCode || selectedTotp ? (
          <AuthLink
            label="Use a different two factor method"
            testID="back-to-methods"
            icon="arrow-back"
            disabled={isLoading}
            onPress={() => {
              setIsUsingBackupCode(false);
              setSelectedTotp(null);
              setError(null);

              /*
               * The typed values go too. A six digit code is bound to the
               * factor it came from, so leaving it in the box while the user
               * picks a DIFFERENT authenticator means a reflex press of
               * Verify submits the first method's code against the second --
               * refused, with nothing on screen to explain why. Same for a
               * half-typed recovery code left behind a method switch.
               */
              setCode("");
              setBackupCode("");
            }}
          />
        ) : null}

        <AuthLink
          label="Sign in as a different user"
          tone="secondary"
          testID="sign-in-as-different-user"
          disabled={isLoading}
          onPress={signInAsSomebodyElse}
        />
      </View>
    </AuthLayout>
  );
}
