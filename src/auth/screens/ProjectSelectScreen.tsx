/**
 * Selector de proyecto.
 *
 * Despues del login, si el usuario tiene multiples proyectos,
 * debe elegir en cual trabajar (doc 01: aislamiento por proyecto).
 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useAuthStore } from '../../store/authStore';
import type { ProjectAssignment } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

export default function ProjectSelectScreen() {
  const { session, selectProject } = useAuthStore();
  const projects = session?.projects ?? [];

  const renderProject = ({ item }: { item: ProjectAssignment }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => selectProject(item.id)}
      activeOpacity={0.7}
    >
      <Text style={styles.projectName}>{item.name}</Text>
      <Text style={styles.projectMeta}>
        {item.permissions.length} permisos asignados
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seleccionar Proyecto</Text>
      <Text style={styles.subtitle}>
        Hola {session?.full_name ?? session?.email}
      </Text>
      <FlatList
        data={projects}
        keyExtractor={(p) => String(p.id)}
        renderItem={renderProject}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  list: {
    paddingBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  projectName: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  projectMeta: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
});
