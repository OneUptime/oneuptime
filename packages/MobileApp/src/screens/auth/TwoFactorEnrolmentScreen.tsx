import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Platform,
  Linking,
  Pressable,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout, {
  AuthLink,
  AuthNotice,
  AuthStep,
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
import { secretFromOtpUrl } from "../../auth/otpUrl";
import {
  PasskeyEnrolmentOutcome,
  PasskeyEnrolmentProgress,
} from "../../passkeys/enrol";

/*
 * Finishing a two factor setup an administrator made mandatory.
 *
 * Two ways, as the web sign-in page offers (#9817): a PASSKEY, or an
 * AUTHENTICATOR APP. The passkey is offered only where it can work - the
 * server offers it, it is reached over HTTPS, and this phone's own browser
 * makes passkeys (passkeys/enrolment) - and comes first, because on a phone
 * it is the easier of the two: the phone's face, fingerprint or screen lock,
 * and next time Sign in with a passkey, with no code to type. Where it
 * cannot work the screen opens straight on the authenticator app, as it
 * always did; a browser that turns out not to make passkeys sends the
 * person to the authenticator app too, saying why.
 *
 * The web sign-in draws a QR code for the app. A phone cannot scan its own
 * screen, so copying that would be the one presentation guaranteed not to
 * work on the device this runs on. What works on a handset is the
 * otpauth:// URL itself: tapping it hands the enrolment straight to
 * whichever authenticator app is installed, already filled in. The secret
 * is printed underneath for the user whose authenticator lives on a
 * different device, or who prefers to type it.
 *
 * NO SESSION EXISTS ON THIS SCREEN. The user has proved their password and
 * nothing else; the server issues a session only when the code below - or
 * the new passkey - verifies. That is why every request re-submits the
 * credentials, and why abandoning this screen has to drop them.
 */

type EnrolmentNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "TwoFactorEnrolment"
>;

// Which way the person is setting up, or the choice between them.
type EnrolmentStep = "choose" | "passkey" | "authenticatorApp";

const PASSKEY_CANCELED_NOTICE: string =
  "Passkey setup was canceled. Try again when you're ready, or choose another way.";

const PASSKEY_UNSUPPORTED_NOTICE: string =
  "This phone's browser can't create a passkey. Set up an authenticator app instead.";

export default function TwoFactorEnrolmentScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const {
    pendingTwoFactor,
    verifyTotpEnrolment,
    enrolPasskey,
    cancelTwoFactor,
    completePendingLogin,
  } = useAuth();
  const navigation: EnrolmentNavigationProp =
    useNavigation<EnrolmentNavigationProp>();

  /*
   * Whether a passkey is offered here at all, and whether this browser
   * turned out not to make one: after that, the authenticator app is the
   * only way, and the choice is not drawn again.
   */
  const [isPasskeyUnsupported, setIsPasskeyUnsupported] =
    useState<boolean>(false);
  const isPasskeyOffered: boolean =
    pendingTwoFactor?.enrolment?.canEnrolPasskey === true &&
    !isPasskeyUnsupported;

  const [step, setStep] = useState<EnrolmentStep>(
    pendingTwoFactor?.enrolment?.canEnrolPasskey === true
      ? "choose"
      : "authenticatorApp",
  );

  const [code, setCode] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Where the current error belongs. A link that no app could open is a step
   * one problem and is shown beside the setup key; anything else is about the
   * code, and outlines the code field.
   */
  const [isOpenError, setIsOpenError] = useState<boolean>(false);
  const [didOpenAuthenticator, setDidOpenAuthenticator] =
    useState<boolean>(false);

  // The passkey's setup in flight, and what it last said.
  const [passkeyProgress, setPasskeyProgress] =
    useState<PasskeyEnrolmentProgress | null>(null);
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const passkeyAttempt: React.MutableRefObject<AbortController | null> =
    useRef<AbortController | null>(null);
  const isPasskeyBusy: boolean = passkeyProgress !== null;

  useEffect(() => {
    return (): void => {
      passkeyAttempt.current?.abort();
      passkeyAttempt.current = null;
    };
  }, []);

  const otpUrl: string = pendingTwoFactor?.enrolment?.twoFactorOtpUrl || "";
  const secret: string = secretFromOtpUrl(otpUrl);

  /*
   * Where a finished setup goes next, whichever way it was set up: the
   * codes it minted, the offer of some, or straight in.
   */
  const followUp: (response: LoginResponse) => void = (
    response: LoginResponse,
  ): void => {
    /*
     * There is no challenge count on this path -- /login answered with an
     * enrolment, not a list of factors -- so the server says it directly
     * instead. `hasBackupCodes` arrives only when the account already had a
     * set and none were minted; its absence means the account genuinely has
     * nothing, whether because the codes are in this response or because
     * minting them failed.
     */
    const next: TwoFactorFollowUp = decideTwoFactorFollowUp({
      mintedCodeCount: response.backupCodes?.length || 0,
      accountHasNoCodes: response.hasBackupCodes !== true,

      /*
       * Never suppressed here. A user finishing a mandated enrolment has no
       * recovery route at all, and this is the first sign-in of that
       * account's new second factor -- there is no "you already told us to
       * stop asking" to honour.
       */
      offerRecentlySkipped: false,
    });

    if (next === "signed-in") {
      completePendingLogin();
      return;
    }

    navigation.navigate("BackupCodes", {
      mode: next === "show-codes" ? "show" : "offer",
    });
  };

  const openInAuthenticator: () => Promise<void> = async (): Promise<void> => {
    if (!otpUrl) {
      return;
    }

    try {
      await Linking.openURL(otpUrl);
      setDidOpenAuthenticator(true);
    } catch {
      /*
       * No app on the handset claims otpauth://. Not an error worth
       * interrupting the flow for -- the secret is printed below and can be
       * typed in by hand, which is the whole reason it is printed.
       */
      setIsOpenError(true);
      setError(
        "No authenticator app on this device could open that link. Add the setup key below to your authenticator app instead.",
      );
    }
  };

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!code.trim()) {
      setIsOpenError(false);
      setError("Enter the code your authenticator app is showing.");
      return;
    }

    setIsOpenError(false);
    setError(null);
    setIsLoading(true);

    try {
      const response: LoginResponse = await verifyTotpEnrolment({
        code: code.trim(),
      });

      followUp(response);
    } catch (err: unknown) {
      setIsOpenError(false);
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const createPasskey: () => Promise<void> = async (): Promise<void> => {
    if (passkeyAttempt.current) {
      return;
    }

    const attempt: AbortController = new AbortController();
    passkeyAttempt.current = attempt;
    setPasskeyError(null);
    setPasskeyNotice(null);
    setPasskeyProgress("preparing");

    try {
      const outcome: PasskeyEnrolmentOutcome = await enrolPasskey({
        signal: attempt.signal,
        onProgress: (progress: PasskeyEnrolmentProgress): void => {
          if (passkeyAttempt.current === attempt && !attempt.signal.aborted) {
            setPasskeyProgress(progress);
          }
        },
      });

      if (outcome.status === "enrolled") {
        followUp(outcome.response);
        return;
      }

      if (passkeyAttempt.current !== attempt) {
        return;
      }

      if (outcome.status === "unsupported") {
        // The authenticator app is the way, and the screen says why.
        setIsPasskeyUnsupported(true);
        setStep("authenticatorApp");
        return;
      }

      setPasskeyNotice(PASSKEY_CANCELED_NOTICE);
    } catch (err: unknown) {
      if (passkeyAttempt.current === attempt && !attempt.signal.aborted) {
        setPasskeyError(getFriendlyErrorMessage(err));
      }
    } finally {
      if (passkeyAttempt.current === attempt) {
        passkeyAttempt.current = null;
        setPasskeyProgress(null);
      }
    }
  };

  const cancelPasskey: () => void = (): void => {
    // Once the passkey is being saved, it is the account's: no going back.
    if (passkeyProgress === "verifying") {
      return;
    }
    passkeyAttempt.current?.abort();
    passkeyAttempt.current = null;
    setPasskeyProgress(null);
    setPasskeyNotice(PASSKEY_CANCELED_NOTICE);
  };

  const chooseAnotherWay: () => void = (): void => {
    passkeyAttempt.current?.abort();
    passkeyAttempt.current = null;
    setPasskeyProgress(null);
    setPasskeyNotice(null);
    setPasskeyError(null);
    setError(null);
    setStep("choose");
  };

  const startOver: () => void = (): void => {
    passkeyAttempt.current?.abort();
    passkeyAttempt.current = null;

    /*
     * Clears the submitted credentials as well as the enrolment: those are the
     * email and password the next step would re-submit, and leaving them
     * behind would let the previous account's password ride along into a fresh
     * attempt.
     */
    cancelTwoFactor();
    navigation.navigate("Login");
  };

  const renderSignInAsSomebodyElse: () => React.JSX.Element =
    (): React.JSX.Element => {
      return (
        <AuthLink
          label="Sign in as a different user"
          tone="secondary"
          testID="sign-in-as-different-user"
          onPress={startOver}
          disabled={isLoading || passkeyProgress === "verifying"}
        />
      );
    };

  const renderChoice: (data: {
    testID: string;
    icon: React.ComponentProps<typeof IconBadge>["name"];
    title: string;
    description: string;
    onPress: () => void;
  }) => React.JSX.Element = (data: {
    testID: string;
    icon: React.ComponentProps<typeof IconBadge>["name"];
    title: string;
    description: string;
    onPress: () => void;
  }): React.JSX.Element => {
    return (
      <Pressable
        key={data.testID}
        accessibilityRole="button"
        accessibilityLabel={data.title}
        accessibilityHint={data.description}
        testID={data.testID}
        onPress={data.onPress}
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
        <IconBadge name={data.icon} />
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          <AppText variant="headline">{data.title}</AppText>
          <AppText variant="footnote" tone="secondary">
            {data.description}
          </AppText>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
        />
      </Pressable>
    );
  };

  if (step === "choose" && isPasskeyOffered) {
    return (
      <AuthLayout
        title="Protect your account"
        eyebrow="TWO-FACTOR SETUP"
        icon="shield-checkmark-outline"
        compact
        description="Your administrator requires two-factor authentication. Choose how you'll confirm it's you."
      >
        <View testID="enrolment-choices" style={{ gap: spacing.lg }}>
          <ListGroup>
            {renderChoice({
              testID: "enrolment-choice-passkey",
              icon: "finger-print-outline",
              title: "Passkey",
              description:
                "Use this phone's face, fingerprint or screen lock, or a security key. No code to type.",
              onPress: () => {
                setStep("passkey");
              },
            })}
            {renderChoice({
              testID: "enrolment-choice-authenticator-app",
              icon: "phone-portrait-outline",
              title: "Authenticator app",
              description:
                "Get a six-digit code from an app such as Google Authenticator, Microsoft Authenticator or 1Password.",
              onPress: () => {
                setStep("authenticatorApp");
              },
            })}
          </ListGroup>
          {renderSignInAsSomebodyElse()}
        </View>
      </AuthLayout>
    );
  }

  if (step === "passkey" && isPasskeyOffered) {
    return (
      <AuthLayout
        title="Create a passkey"
        eyebrow="TWO-FACTOR SETUP"
        icon="finger-print-outline"
        compact
        description="Your phone's browser opens to create it. Next time, sign in with your passkey: no password or code to type."
      >
        <Card variant="tinted" testID="passkey-enrolment-steps">
          <AppText variant="subhead" tone="secondary">
            Follow your browser’s prompt: use your face, fingerprint or screen
            lock, or touch your security key. Then come back here to finish
            signing in.
          </AppText>
        </Card>

        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <GradientButton
            testID="create-passkey"
            label={
              passkeyProgress === "preparing"
                ? "Preparing your passkey…"
                : passkeyProgress === "browser"
                  ? "Continue in your browser…"
                  : passkeyProgress === "verifying"
                    ? "Signing you in…"
                    : passkeyNotice || passkeyError
                      ? "Try Again"
                      : "Create Passkey"
            }
            onPress={(): void => {
              void createPasskey();
            }}
            loading={isPasskeyBusy}
            disabled={isPasskeyBusy}
            icon="finger-print-outline"
            style={authPrimaryButtonStyle}
          />

          {passkeyProgress === "browser" ? (
            <AuthNotice
              testID="passkey-enrolment-in-browser"
              tone="info"
              live
              icon="finger-print-outline"
              message="Create your passkey in the browser, then return to OneUptime."
            />
          ) : null}

          {isPasskeyBusy && passkeyProgress !== "verifying" ? (
            <AuthLink
              label="Cancel"
              accessibilityLabel="Cancel passkey setup"
              testID="cancel-passkey-enrolment"
              onPress={cancelPasskey}
            />
          ) : null}

          {passkeyError ? (
            <AuthNotice
              testID="passkey-enrolment-error"
              tone="danger"
              message={passkeyError}
            />
          ) : null}

          {passkeyNotice ? (
            <AuthNotice
              testID="passkey-enrolment-notice"
              tone="neutral"
              live
              message={passkeyNotice}
            />
          ) : null}
        </View>

        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <AuthLink
            label="Choose another way"
            testID="choose-another-way"
            onPress={chooseAnotherWay}
            disabled={passkeyProgress === "verifying"}
          />
          {renderSignInAsSomebodyElse()}
        </View>
      </AuthLayout>
    );
  }

  const codeError: string | null = error && !isOpenError ? error : null;

  return (
    <AuthLayout
      title="Protect your account"
      eyebrow="TWO-FACTOR SETUP"
      icon="shield-checkmark-outline"
      compact
      description="Set up an authenticator in two steps to finish signing in securely."
    >
      {isPasskeyUnsupported ? (
        <AuthNotice
          testID="passkey-unsupported-notice"
          tone="warning"
          message={PASSKEY_UNSUPPORTED_NOTICE}
          style={{ marginBottom: spacing.xl }}
        />
      ) : null}

      <AuthStep
        number={1}
        title="Add your account"
        description="Open your authenticator app or enter the setup key manually."
      />

      <GradientButton
        label="Add to Authenticator App"
        onPress={openInAuthenticator}
        icon="open-outline"
        variant="tonal"
        disabled={!otpUrl}
        style={authPrimaryButtonStyle}
      />

      {didOpenAuthenticator ? (
        <AuthNotice
          testID="opened-authenticator-hint"
          tone="success"
          icon="return-down-back"
          live
          message="Come back here and enter the six digit code it is showing."
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {error && isOpenError ? (
        <AuthNotice
          tone="danger"
          message={error}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {secret ? (
        <Card
          variant="outlined"
          testID="enrolment-secret-card"
          style={{ marginTop: spacing.lg, gap: spacing.sm }}
        >
          <AppText variant="subhead" weight="600" tone="secondary">
            Or add this setup key by hand
          </AppText>
          <View
            style={{
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          >
            <AppText
              testID="enrolment-secret"
              selectable={true}
              variant="headline"
              align="center"
              style={{
                letterSpacing: 2,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            >
              {secret}
            </AppText>
          </View>
          <AppText variant="footnote" tone="secondary">
            Press and hold the key to copy it. Choose a time-based key if your
            app asks.
          </AppText>
        </Card>
      ) : null}

      <View
        style={{
          marginTop: spacing.xxl,
          paddingTop: spacing.xl,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
        }}
      >
        <AuthStep
          number={2}
          title="Confirm the setup"
          description="Enter the current six-digit code from your authenticator app."
        />
        <View style={{ gap: spacing.xl }}>
          <AuthTextField
            testID="enrolment-code-input"
            containerTestID="enrolment-code-field"
            variant="code"
            label="Six-digit code"
            accessibilityLabel="Authenticator code"
            editable={!isLoading}
            errorMessage={codeError}
            value={code}
            onChangeText={(text: string) => {
              setCode(text);
              setError(null);
            }}
            placeholder="000000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <GradientButton
            label="Verify and Sign In"
            onPress={submit}
            loading={isLoading}
            disabled={isLoading}
            style={authPrimaryButtonStyle}
          />
        </View>
      </View>

      <View style={{ marginTop: spacing.md, gap: spacing.md }}>
        {isPasskeyOffered ? (
          <AuthLink
            label="Choose another way"
            testID="choose-another-way"
            onPress={chooseAnotherWay}
            disabled={isLoading}
          />
        ) : null}
        {renderSignInAsSomebodyElse()}
      </View>
    </AuthLayout>
  );
}
