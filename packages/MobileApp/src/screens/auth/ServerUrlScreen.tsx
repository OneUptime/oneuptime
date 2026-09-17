import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import { spacing } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { getServerUrl, setServerUrl } from "../../storage/serverUrl";
import { validateServerUrl } from "../../api/auth";
import AuthLayout, {
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import Banner from "../../components/Banner";
import GradientButton from "../../components/GradientButton";

type ServerUrlNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "ServerUrl"
>;

export default function ServerUrlScreen(): React.JSX.Element {
  const { setNeedsServerUrl } = useAuth();
  const navigation: ServerUrlNavigationProp =
    useNavigation<ServerUrlNavigationProp>();
  const [url, setUrl] = useState("https://oneuptime.com");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasEditedUrl: React.MutableRefObject<boolean> = useRef(false);

  useEffect(() => {
    let mounted: boolean = true;
    void getServerUrl()
      .then((storedUrl: string): void => {
        if (mounted && !hasEditedUrl.current) {
          setUrl(storedUrl);
        }
      })
      .catch((): void => {
        // Keep the editable default available when local storage is unreadable.
      });
    return (): void => {
      mounted = false;
    };
  }, []);

  const handleConnect: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!url.trim()) {
      setError("Please enter a server URL");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const normalizedUrl: string = url.trim().replace(/\/+$/, "");
      const isValid: boolean = await validateServerUrl(normalizedUrl);

      if (!isValid) {
        setError(
          "Could not connect to the server. Please check the URL and try again.",
        );
        return;
      }

      await setServerUrl(normalizedUrl);
      setNeedsServerUrl(false);
      navigation.navigate("Login");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      showBrand
      compact
      title="Connect your workspace"
      description="Enter your team's OneUptime address to get started."
    >
      <View style={{ gap: spacing.xl }}>
        <AuthTextField
          label="Server URL"
          containerTestID="server-url-field"
          icon="globe-outline"
          accessibilityLabel="Server URL"
          accessibilityHint="Enter the full address of your OneUptime server, including https://."
          editable={!isLoading}
          errorMessage={error}
          value={url}
          onChangeText={(text: string) => {
            hasEditedUrl.current = true;
            setUrl(text);
            setError(null);
          }}
          placeholder="https://oneuptime.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />

        <GradientButton
          label="Connect"
          onPress={handleConnect}
          loading={isLoading}
          disabled={isLoading}
          style={authPrimaryButtonStyle}
        />
      </View>

      <Banner
        tone="neutral"
        icon="information-circle-outline"
        message="Using OneUptime Cloud? Keep the address above. Self-hosting? Enter your own server URL."
        style={{ marginTop: spacing.xxl }}
      />
    </AuthLayout>
  );
}
