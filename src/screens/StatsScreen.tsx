/**
 * Pantalla de estadisticas de formularios.
 *
 * Muestra:
 *   - Totales globales (registros, enviados, pendientes, errores)
 *   - Cobertura de participantes (con barra visual)
 *   - Actividad diaria (mini grafico de barras)
 *   - Distribucion por hora del dia
 *   - Filtro por rango de fechas (inicio y fin)
 *   - Desglose por formulario con barras de progreso
 *   - Cantidad de evidencias por formulario
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  getStatsByTemplate,
  getGlobalStats,
  getParticipantCoverageStats,
  getDailyActivity,
  getHourlyDistribution,
} from '../db/database';
import { useAuthStore } from '../store/authStore';
import { exportRecords, shareExportFile } from '../utils/exportData';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function displayDate(date: Date): string {
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function shortDay(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  } catch {
    return dateStr.slice(5);
  }
}

// ── Componentes auxiliares ─────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProgressBar({
  synced,
  pending,
  error,
  total,
}: {
  synced: number;
  pending: number;
  error: number;
  total: number;
}) {
  if (total === 0) return null;
  const syncedPct = (synced / total) * 100;
  const pendingPct = (pending / total) * 100;
  const errorPct = (error / total) * 100;

  return (
    <View style={styles.progressBar}>
      {syncedPct > 0 && (
        <View style={[styles.progressSegment, { width: `${syncedPct}%`, backgroundColor: colors.success }]} />
      )}
      {pendingPct > 0 && (
        <View style={[styles.progressSegment, { width: `${pendingPct}%`, backgroundColor: colors.warning }]} />
      )}
      {errorPct > 0 && (
        <View style={[styles.progressSegment, { width: `${errorPct}%`, backgroundColor: colors.error }]} />
      )}
    </View>
  );
}

/** Mini grafico de barras para actividad diaria */
function DailyChart({
  data,
}: {
  data: { date: string; count: number; synced: number; pending: number }[];
}) {
  if (data.length === 0) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>Sin actividad en este periodo</Text>
      </View>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const chartHeight = 120;
  const barWidth = Math.max(
    12,
    Math.min(28, (SCREEN_WIDTH - spacing.md * 4) / data.length - 4),
  );

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartBars}>
        {data.map((day) => {
          const height = (day.count / maxCount) * chartHeight;
          const syncedH = day.count > 0 ? (day.synced / day.count) * height : 0;
          const pendingH = height - syncedH;

          return (
            <View key={day.date} style={styles.chartBarGroup}>
              <Text style={styles.chartBarCount}>
                {day.count > 0 ? day.count : ''}
              </Text>
              <View style={[styles.chartBarWrapper, { height: chartHeight }]}>
                <View style={{ flex: 1 }} />
                <View style={{ height: pendingH, backgroundColor: colors.warning, width: barWidth, borderTopLeftRadius: pendingH > 0 && syncedH === 0 ? 3 : 0, borderTopRightRadius: pendingH > 0 && syncedH === 0 ? 3 : 0 }} />
                <View style={{ height: syncedH, backgroundColor: colors.success, width: barWidth, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              </View>
              <Text style={styles.chartBarLabel} numberOfLines={1}>
                {shortDay(day.date)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Distribucion por hora */
function HourlyChart({
  data,
}: {
  data: { hour: number; count: number }[];
}) {
  if (data.length === 0) return null;

  // Llenar las 24 horas
  const hours = Array.from({ length: 24 }, (_, i) => {
    const found = data.find((d) => d.hour === i);
    return { hour: i, count: found?.count ?? 0 };
  });

  const maxCount = Math.max(...hours.map((h) => h.count), 1);
  const barHeight = 60;

  // Solo mostrar horas con actividad + vecinas
  const activeHours = hours.filter((h) => h.count > 0);
  if (activeHours.length === 0) return null;

  const minHour = Math.max(0, Math.min(...activeHours.map((h) => h.hour)) - 1);
  const maxHour = Math.min(23, Math.max(...activeHours.map((h) => h.hour)) + 1);
  const visibleHours = hours.slice(minHour, maxHour + 1);

  return (
    <View style={styles.hourlyContainer}>
      <View style={styles.hourlyBars}>
        {visibleHours.map((h) => {
          const height = (h.count / maxCount) * barHeight;
          return (
            <View key={h.hour} style={styles.hourlyBarGroup}>
              {h.count > 0 && (
                <Text style={styles.hourlyCount}>{h.count}</Text>
              )}
              <View style={[styles.hourlyBarWrapper, { height: barHeight }]}>
                <View style={{ flex: 1 }} />
                <View
                  style={{
                    height,
                    backgroundColor: colors.primary,
                    width: 16,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                    opacity: 0.7 + (h.count / maxCount) * 0.3,
                  }}
                />
              </View>
              <Text style={styles.hourlyLabel}>{h.hour}h</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Pantalla principal ────────────────────────────────────────────────

export default function StatsScreen() {
  const { activeProjectId } = useAuthStore();

  // Default: last 30 days
  const [dateFrom, setDateFrom] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [showPickerFrom, setShowPickerFrom] = useState(false);
  const [showPickerTo, setShowPickerTo] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const globalStats = useMemo(() => {
    void refreshKey;
    return getGlobalStats(formatDate(dateFrom), formatDate(dateTo));
  }, [dateFrom, dateTo, refreshKey]);

  const templateStats = useMemo(() => {
    void refreshKey;
    return getStatsByTemplate(formatDate(dateFrom), formatDate(dateTo));
  }, [dateFrom, dateTo, refreshKey]);

  const coverageStats = useMemo(() => {
    void refreshKey;
    if (!activeProjectId) return null;
    return getParticipantCoverageStats(activeProjectId);
  }, [activeProjectId, refreshKey]);

  const dailyActivity = useMemo(() => {
    void refreshKey;
    return getDailyActivity(formatDate(dateFrom), formatDate(dateTo));
  }, [dateFrom, dateTo, refreshKey]);

  const hourlyData = useMemo(() => {
    void refreshKey;
    return getHourlyDistribution(formatDate(dateFrom), formatDate(dateTo));
  }, [dateFrom, dateTo, refreshKey]);

  const onChangeFrom = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowPickerFrom(Platform.OS === 'ios');
    if (selected) {
      setDateFrom(selected);
    }
  };

  const onChangeTo = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowPickerTo(Platform.OS === 'ios');
    if (selected) {
      setDateTo(selected);
    }
  };

  const syncedPercentage =
    globalStats.total > 0
      ? Math.round((globalStats.synced / globalStats.total) * 100)
      : 0;

  const [exporting, setExporting] = useState(false);

  const handleGenerateReport = useCallback(
    async (format: 'csv' | 'json') => {
      setExporting(true);
      try {
        const result = await exportRecords({
          format,
          fromDate: formatDate(dateFrom),
          toDate: formatDate(dateTo),
          status: 'synced',
        });

        if (result.recordCount === 0) {
          Alert.alert(
            'Sin datos',
            'No hay registros enviados en el periodo seleccionado.',
          );
          return;
        }

        Alert.alert(
          'Informe generado',
          `Se exportaron ${result.recordCount} registros enviados.\n\nArchivo: ${result.fileName}`,
          [
            { text: 'Cerrar', style: 'cancel' },
            {
              text: 'Compartir',
              onPress: () => shareExportFile(result.filePath),
            },
          ],
        );
      } catch (err: any) {
        Alert.alert(
          'Error',
          `No se pudo generar el informe: ${err.message ?? 'Error desconocido'}`,
        );
      } finally {
        setExporting(false);
      }
    },
    [dateFrom, dateTo],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Filtro de fechas */}
      <View style={styles.filterCard}>
        <Text style={styles.filterTitle}>Periodo</Text>
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowPickerFrom(true)}
          >
            <Text style={styles.dateLabel}>Desde</Text>
            <Text style={styles.dateValue}>{displayDate(dateFrom)}</Text>
          </TouchableOpacity>

          <Text style={styles.dateSeparator}>—</Text>

          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowPickerTo(true)}
          >
            <Text style={styles.dateLabel}>Hasta</Text>
            <Text style={styles.dateValue}>{displayDate(dateTo)}</Text>
          </TouchableOpacity>
        </View>

        {/* Quick filters */}
        <View style={styles.quickFilters}>
          {[
            { label: '7 dias', days: 7 },
            { label: '30 dias', days: 30 },
            { label: '90 dias', days: 90 },
            { label: 'Todo', days: 365 * 5 },
          ].map((q) => (
            <TouchableOpacity
              key={q.label}
              style={styles.quickBtn}
              onPress={() => {
                const d = new Date();
                d.setDate(d.getDate() - q.days);
                setDateFrom(d);
                setDateTo(new Date());
              }}
            >
              <Text style={styles.quickBtnText}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {showPickerFrom && (
        <DateTimePicker
          value={dateFrom}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={dateTo}
          onChange={onChangeFrom}
        />
      )}
      {showPickerTo && (
        <DateTimePicker
          value={dateTo}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={dateFrom}
          maximumDate={new Date()}
          onChange={onChangeTo}
        />
      )}

      {/* Resumen global */}
      <Text style={styles.sectionTitle}>Resumen general</Text>
      <View style={styles.statsGrid}>
        <StatCard label="Total" value={globalStats.total} color={colors.primary} icon="📊" />
        <StatCard label="Enviados" value={globalStats.synced} color={colors.success} icon="✅" />
        <StatCard label="Pendientes" value={globalStats.pending} color={colors.warning} icon="⏳" />
        <StatCard label="Errores" value={globalStats.error} color={colors.error} icon="❌" />
      </View>

      {/* Barra global */}
      {globalStats.total > 0 && (
        <View style={styles.globalProgressCard}>
          <View style={styles.globalProgressHeader}>
            <Text style={styles.globalProgressLabel}>Tasa de envio</Text>
            <Text style={[styles.globalProgressPct, { color: syncedPercentage >= 80 ? colors.success : syncedPercentage >= 50 ? colors.warning : colors.error }]}>
              {syncedPercentage}%
            </Text>
          </View>
          <ProgressBar
            synced={globalStats.synced}
            pending={globalStats.pending}
            error={globalStats.error}
            total={globalStats.total}
          />
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
              <Text style={styles.legendText}>Enviados</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
              <Text style={styles.legendText}>Pendientes</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
              <Text style={styles.legendText}>Errores</Text>
            </View>
          </View>
        </View>
      )}

      {/* Cobertura de participantes */}
      {coverageStats && coverageStats.totalParticipants > 0 && (
        <>
          <Text style={styles.sectionTitle}>Cobertura de participantes</Text>
          <View style={styles.coverageCard}>
            <View style={styles.coverageHeader}>
              <View>
                <Text style={styles.coverageMainValue}>
                  {coverageStats.coveragePercent}%
                </Text>
                <Text style={styles.coverageSubtext}>
                  {coverageStats.withRecords} de {coverageStats.totalParticipants} participantes
                </Text>
              </View>
              <View style={styles.coverageCircle}>
                <View
                  style={[
                    styles.coverageCircleFill,
                    {
                      height: `${coverageStats.coveragePercent}%`,
                      backgroundColor:
                        coverageStats.coveragePercent >= 80
                          ? colors.success
                          : coverageStats.coveragePercent >= 50
                            ? colors.warning
                            : colors.error,
                    },
                  ]}
                />
              </View>
            </View>
            <View style={styles.coverageDetails}>
              <View style={styles.coverageDetailItem}>
                <View style={[styles.coverageDetailDot, { backgroundColor: colors.success }]} />
                <Text style={styles.coverageDetailText}>
                  Con registros: {coverageStats.withRecords}
                </Text>
              </View>
              <View style={styles.coverageDetailItem}>
                <View style={[styles.coverageDetailDot, { backgroundColor: colors.textSecondary }]} />
                <Text style={styles.coverageDetailText}>
                  Sin registros: {coverageStats.withoutRecords}
                </Text>
              </View>
            </View>
          </View>
        </>
      )}

      {/* Actividad diaria */}
      <Text style={styles.sectionTitle}>Actividad diaria</Text>
      <View style={styles.chartCard}>
        <DailyChart data={dailyActivity} />
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
            <Text style={styles.legendText}>Enviados</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
            <Text style={styles.legendText}>Pendientes</Text>
          </View>
        </View>
      </View>

      {/* Distribucion por hora */}
      {hourlyData.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Horas de mayor actividad</Text>
          <View style={styles.chartCard}>
            <HourlyChart data={hourlyData} />
          </View>
        </>
      )}

      {/* Info adicional */}
      <View style={styles.extraRow}>
        <View style={styles.extraItem}>
          <Text style={styles.extraValue}>{globalStats.templateCount}</Text>
          <Text style={styles.extraLabel}>Formularios</Text>
        </View>
        <View style={styles.extraItem}>
          <Text style={styles.extraValue}>{globalStats.evidenceCount}</Text>
          <Text style={styles.extraLabel}>Evidencias</Text>
        </View>
        <View style={styles.extraItem}>
          <Text style={styles.extraValue}>{globalStats.draft}</Text>
          <Text style={styles.extraLabel}>Borradores</Text>
        </View>
        <View style={styles.extraItem}>
          <Text style={styles.extraValue}>{globalStats.conflict}</Text>
          <Text style={styles.extraLabel}>Conflictos</Text>
        </View>
      </View>

      {/* Desglose por formulario */}
      <Text style={styles.sectionTitle}>Desglose por formulario</Text>

      {templateStats.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>
            No hay registros en el periodo seleccionado.
          </Text>
        </View>
      ) : (
        templateStats.map((tmpl) => (
          <View key={tmpl.templateId} style={styles.templateCard}>
            <View style={styles.templateHeader}>
              <Text style={styles.templateName} numberOfLines={1}>
                {tmpl.templateName}
              </Text>
              <Text style={styles.templateTotal}>{tmpl.total}</Text>
            </View>

            <ProgressBar
              synced={tmpl.synced}
              pending={tmpl.pending}
              error={tmpl.error}
              total={tmpl.total}
            />

            <View style={styles.templateDetails}>
              <DetailChip label="Enviados" value={tmpl.synced} color={colors.success} />
              <DetailChip label="Pendientes" value={tmpl.pending} color={colors.warning} />
              <DetailChip label="Errores" value={tmpl.error} color={colors.error} />
              <DetailChip label="Borradores" value={tmpl.draft} color={colors.textSecondary} />
              {tmpl.evidenceCount > 0 && (
                <DetailChip label="Evidencias" value={tmpl.evidenceCount} color={colors.primary} />
              )}
              {tmpl.conflict > 0 && (
                <DetailChip label="Conflictos" value={tmpl.conflict} color={colors.error} />
              )}
            </View>
          </View>
        ))
      )}

      {/* Generar informe */}
      <Text style={styles.sectionTitle}>Generar informe</Text>
      <View style={styles.reportCard}>
        <Text style={styles.reportDescription}>
          Exportar registros enviados del {displayDate(dateFrom)} al{' '}
          {displayDate(dateTo)}
        </Text>
        <View style={styles.reportActions}>
          <TouchableOpacity
            style={[styles.reportBtn, exporting && styles.buttonDisabled]}
            onPress={() => handleGenerateReport('csv')}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <>
                <Text style={styles.reportBtnIcon}>📄</Text>
                <Text style={styles.reportBtnText}>CSV</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reportBtn, styles.reportBtnJson, exporting && styles.buttonDisabled]}
            onPress={() => handleGenerateReport('json')}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Text style={styles.reportBtnIcon}>📋</Text>
                <Text style={[styles.reportBtnText, { color: colors.primary }]}>JSON</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Boton actualizar */}
      <TouchableOpacity style={styles.refreshButton} onPress={refresh}>
        <Text style={styles.refreshButtonText}>Actualizar estadisticas</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DetailChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  if (value === 0) return null;
  return (
    <View style={[styles.detailChip, { borderColor: color + '40' }]}>
      <Text style={[styles.detailChipValue, { color }]}>{value}</Text>
      <Text style={styles.detailChipLabel}>{label}</Text>
    </View>
  );
}

// ── Estilos ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },

  // Filter
  filterCard: {
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
  filterTitle: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  dateValue: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateSeparator: {
    fontSize: fontSize.subtitle,
    color: colors.textSecondary,
    marginHorizontal: spacing.sm,
  },
  quickFilters: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '10',
    alignItems: 'center',
  },
  quickBtnText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '600',
  },

  // Section
  sectionTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    minWidth: '45%' as any,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    borderTopWidth: 3,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  statIcon: {
    fontSize: 20,
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: fontSize.headline,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Global progress
  globalProgressCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    elevation: 1,
  },
  globalProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  globalProgressLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  globalProgressPct: {
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 10,
    color: colors.textSecondary,
  },

  // Coverage
  coverageCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    elevation: 1,
  },
  coverageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  coverageMainValue: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
  },
  coverageSubtext: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  coverageCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  coverageCircleFill: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  coverageDetails: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  coverageDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coverageDetailDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.xs,
  },
  coverageDetailText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },

  // Daily chart
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    elevation: 1,
  },
  chartContainer: {
    paddingVertical: spacing.sm,
  },
  chartBars: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  chartBarGroup: {
    alignItems: 'center',
    flex: 1,
  },
  chartBarCount: {
    fontSize: 9,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
    height: 12,
  },
  chartBarWrapper: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  chartBarLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  chartEmpty: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  chartEmptyText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Hourly chart
  hourlyContainer: {
    paddingVertical: spacing.xs,
  },
  hourlyBars: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  hourlyBarGroup: {
    alignItems: 'center',
    flex: 1,
  },
  hourlyCount: {
    fontSize: 8,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  hourlyBarWrapper: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  hourlyLabel: {
    fontSize: 8,
    color: colors.textSecondary,
    marginTop: 3,
  },

  // Extra row
  extraRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    elevation: 1,
  },
  extraItem: {
    flex: 1,
    alignItems: 'center',
  },
  extraValue: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  extraLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Template cards
  templateCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  templateName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  templateTotal: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.primary,
  },
  templateDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    gap: 4,
  },
  detailChipValue: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  detailChipLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },

  // Empty
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    elevation: 1,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Report
  reportCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  reportDescription: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  reportActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  reportBtnJson: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  reportBtnIcon: {
    fontSize: 16,
  },
  reportBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Refresh
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  refreshButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
