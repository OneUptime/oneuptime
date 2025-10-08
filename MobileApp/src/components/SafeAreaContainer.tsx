import { ReactNode } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

interface SafeAreaContainerProps {
  children: ReactNode;
}

export const SafeAreaContainer = ({ children }: SafeAreaContainerProps) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.inner}>{children}</View>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
  },
});
