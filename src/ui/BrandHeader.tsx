/**
 * Encabezado con la marca de la organización (logo y nombre) para las
 * pantallas de entrada (login y PIN). Sin marca configurada muestra
 * InfoMatt360.
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useBrandingStore } from '../store/brandingStore';
import { colors, fontSize, spacing } from './theme';

export default function BrandHeader({ subtitle, light = false }: { subtitle?: string; light?: boolean }) {
  const branding = useBrandingStore((s) => s.branding);
  const name = branding?.organizationName || 'InfoMatt360';
  return (
    <View style={styles.container} accessibilityRole="header">
      {branding?.logoUri ? (
        <Image source={{ uri: branding.logoUri }} style={styles.logo} resizeMode="contain" accessibilityLabel={`Logo de ${name}`} />
      ) : null}
      <Text style={[styles.name, light && styles.light, branding?.primaryColor && !light ? { color: branding.primaryColor } : null]}>{name}</Text>
      {branding?.slogan ? <Text style={[styles.subtitle, light && styles.light]}>{branding.slogan}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, light && styles.light]}>{subtitle}</Text> : null}
      {branding?.organizationName ? <Text style={[styles.powered, light && styles.light]}>con InfoMatt360</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', marginBottom: spacing.lg },
  logo: { width: 160, height: 90, marginBottom: spacing.sm },
  name: { fontSize: fontSize.title, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  subtitle: { fontSize: fontSize.subtitle, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  powered: { fontSize: fontSize.caption, color: colors.textSecondary, marginTop: spacing.xs },
  light: { color: '#FFFFFF' },
});
