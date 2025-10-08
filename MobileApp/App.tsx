import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaContainer } from './src/components/SafeAreaContainer';
import { HomeScreen } from './src/screens/HomeScreen';
import { colors } from './src/theme/colors';

export default function App() {
  return (
    <SafeAreaContainer>
      <View style={styles.container}>
        <HomeScreen />
        <StatusBar style="light" />
      </View>
    </SafeAreaContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
