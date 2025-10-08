import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FeatureCard } from '../components/FeatureCard';
import { GlowingButton } from '../components/GlowingButton';
import { MetricCard } from '../components/MetricCard';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { typography } from '../theme/typography';

const features = [
  {
    title: 'Incident Automation',
    description: 'Resolve outages faster with AI-assisted workflows, escalation policies, and chat integrations that keep everyone aligned.',
    badge: 'SRE Teams',
  },
  {
    title: 'Unified Observability',
    description: 'Bring metrics, logs, and traces together with root-cause insights so you always know what changed and why.',
    badge: 'Observable',
  },
  {
    title: 'Customer Trust Center',
    description: 'Status pages, SLA tracking, and proactive notifications that turn transparency into a competitive advantage.',
    badge: 'Transparency',
  },
];

const metrics = [
  { value: '2.5M+', label: 'Checks every day', trend: '+18% MoM' },
  { value: '300ms', label: 'Avg. response time', trend: 'Global median' },
  { value: '120+', label: 'Integrations', trend: 'GitHub, Slack, PagerDuty & more' },
  { value: '99.99%', label: 'Uptime delivered', trend: 'Managed by OneUptime' },
];

export const HomeScreen = () => {
  const heroGradient = useMemo(() => ['#14162D', '#05040F'] as const, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={heroGradient} style={styles.hero} start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }}>
        <Text style={styles.overline}>ONEUPTIME MOBILE</Text>
        <Text style={styles.heading}>Reliability intelligence for teams on the move</Text>
        <Text style={styles.subtitle}>
          Monitor services, acknowledge incidents, and keep your stakeholders informed without opening your laptop. Designed for
          modern SRE, platform, and customer teams.
        </Text>
        <View style={styles.actions}>
          <GlowingButton label="Sign in to your workspace" />
        </View>
      </LinearGradient>

      <View style={styles.metricsGrid}>
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Everything you need to stay ahead of incidents</Text>
        <Text style={styles.sectionDescription}>
          OneUptime brings the full power of our reliability platform to mobile. From on-call to executive updates, everyone gets
          the context they need in real time.
        </Text>
      </View>

      {features.map((feature, index) => (
        <FeatureCard key={feature.title} {...feature} badge={feature.badge} />
      ))}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Built for security and scale</Text>
        <Text style={styles.sectionDescription}>
          Enterprise-grade authentication, audit trails, SCIM provisioning, and on-prem options are available out of the box.
        </Text>
      </View>

      <LinearGradient
        colors={['rgba(108, 92, 231, 0.24)', 'rgba(0, 209, 255, 0.24)'] as const}
        style={styles.highlight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.highlightTitle}>Ready to go mobile?</Text>
        <Text style={styles.highlightText}>
          Join thousands of teams who rely on OneUptime to deliver always-on experiences. Use the mobile app to keep a pulse on
          the health of your infrastructure wherever you are.
        </Text>
        <GlowingButton label="Request early access" />
      </LinearGradient>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xxl,
    paddingBottom: spacing.xxl * 1.5,
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xxl,
  },
  overline: {
    ...typography.caption,
    color: colors.accentSecondary,
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.heading1,
    fontSize: 32,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.xxl,
  },
  sectionHeader: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.heading2,
    fontSize: 22,
    marginBottom: spacing.sm,
  },
  sectionDescription: {
    ...typography.body,
  },
  highlight: {
    borderRadius: radius.xl,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
  },
  highlightTitle: {
    ...typography.heading2,
    fontSize: 24,
  },
  highlightText: {
    ...typography.body,
  },
});
