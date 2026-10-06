/**
 * Barra de progreso visual para formularios multi-pagina.
 *
 * Muestra un step indicator con:
 *   - Indicador de pagina actual (resaltada)
 *   - Indicadores de paginas completadas (check)
 *   - Indicadores de paginas con errores (rojo)
 *   - Titulo de la pagina actual
 *
 * Se usa tanto en FormCaptureScreen como en FormEditScreen.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { FormPage } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface PageProgressBarProps {
  pages: FormPage[];
  currentPage: number;
  /** Indices de paginas que tienen al menos un error */
  pagesWithErrors: Set<number>;
  /** Indices de paginas completamente llenas (sin campos vacios requeridos) */
  pagesCompleted: Set<number>;
  onPagePress: (pageIndex: number) => void;
}

export default function PageProgressBar({
  pages,
  currentPage,
  pagesWithErrors,
  pagesCompleted,
  onPagePress,
}: PageProgressBarProps) {
  if (pages.length <= 1) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stepsContainer}
      >
        {pages.map((page, idx) => {
          const isCurrent = idx === currentPage;
          const hasError = pagesWithErrors.has(idx);
          const isComplete = pagesCompleted.has(idx) && !hasError;

          return (
            <React.Fragment key={idx}>
              {/* Linea conectora */}
              {idx > 0 && (
                <View
                  style={[
                    styles.connector,
                    (pagesCompleted.has(idx - 1) && !pagesWithErrors.has(idx - 1))
                      ? styles.connectorDone
                      : styles.connectorPending,
                  ]}
                />
              )}

              <TouchableOpacity
                style={styles.stepWrapper}
                onPress={() => onPagePress(idx)}
                activeOpacity={0.7}
              >
                {/* Circulo */}
                <View
                  style={[
                    styles.circle,
                    isCurrent && styles.circleCurrent,
                    isComplete && styles.circleComplete,
                    hasError && styles.circleError,
                  ]}
                >
                  {isComplete ? (
                    <Text style={styles.checkmark}>✓</Text>
                  ) : hasError ? (
                    <Text style={styles.errorMark}>!</Text>
                  ) : (
                    <Text
                      style={[
                        styles.stepNumber,
                        isCurrent && styles.stepNumberCurrent,
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  )}
                </View>

                {/* Titulo abajo del circulo */}
                <Text
                  style={[
                    styles.stepLabel,
                    isCurrent && styles.stepLabelCurrent,
                    hasError && styles.stepLabelError,
                  ]}
                  numberOfLines={1}
                >
                  {page.title || `Pag ${idx + 1}`}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </ScrollView>

      {/* Barra de progreso simple */}
      <View style={styles.progressBarBg}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${((currentPage + 1) / pages.length) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  stepWrapper: {
    alignItems: 'center',
    minWidth: 56,
    maxWidth: 80,
  },
  connector: {
    height: 2,
    width: 20,
    alignSelf: 'center',
    marginTop: 14, // Centrar con el circulo
    marginHorizontal: -2,
  },
  connectorDone: {
    backgroundColor: colors.success,
  },
  connectorPending: {
    backgroundColor: colors.border,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  circleCurrent: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  circleComplete: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  circleError: {
    borderColor: colors.error,
    backgroundColor: colors.error,
  },
  stepNumber: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  stepNumberCurrent: {
    color: colors.textOnPrimary,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  errorMark: {
    fontSize: 14,
    fontWeight: '700',
    color: 'white',
  },
  stepLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stepLabelCurrent: {
    color: colors.primary,
    fontWeight: '600',
  },
  stepLabelError: {
    color: colors.error,
  },
  progressBarBg: {
    height: 3,
    backgroundColor: colors.border,
  },
  progressBarFill: {
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 1.5,
  },
});
