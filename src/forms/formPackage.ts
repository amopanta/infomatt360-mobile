/**
 * Paquete de formularios versionado (H01).
 *
 * 1. Pide el manifiesto (una llamada) con la huella de cada formulario.
 * 2. Descarga solo los nuevos o cambiados.
 * 3. Si todas las descargas salen bien, aplica todo en una transacción;
 *    si alguna falla, el teléfono queda con las versiones anteriores completas.
 * Los formularios que el servidor ya no ofrece se retiran sin perder los
 * borradores ni los pendientes que dependen de ellos.
 */

import { getFormDetail, getOfflineManifest } from '../api/formsApi';
import { applyFormPackage, getCachedFormVersions, type CachedFormInput } from '../db/database';
import { planFormUpdate } from './formPackagePlan';

export interface FormPackageResult {
  added: number;
  updated: number;
  unchanged: number;
  retired: number;
}

export async function syncFormPackage(projectId: string): Promise<FormPackageResult> {
  const manifest = await getOfflineManifest(projectId);
  const cached = getCachedFormVersions(projectId);
  const plan = planFormUpdate(cached, manifest);
  const byId = new Map(manifest.map((m) => [m.template_id, m]));

  const changed: CachedFormInput[] = [];
  for (const id of plan.download) {
    const form = await getFormDetail(id); // un fallo aborta todo el paquete
    changed.push({
      id: form.id,
      projectId,
      templateId: form.templateId,
      name: form.name,
      description: form.description,
      schemaJson: JSON.stringify(form.pages),
      accessMode: form.accessMode,
      versionHash: form.versionHash || byId.get(id)?.version_hash || '',
      serverUpdatedAt: byId.get(id)?.updated_at ?? null,
    });
  }
  const { retired } = applyFormPackage(projectId, changed, manifest.map((m) => m.template_id));
  const added = plan.download.filter((id) => !cached.has(id)).length;
  return { added, updated: plan.download.length - added, unchanged: plan.unchanged.length, retired };
}
