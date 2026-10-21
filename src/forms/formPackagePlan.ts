/**
 * Qué hacer con los formularios del teléfono frente al manifiesto del
 * servidor (H01). Sin dependencias de Expo: test/formPackage.test.ts.
 */

export interface ManifestEntry { template_id: string; version_hash: string }

export interface FormUpdatePlan {
  /** Nuevos o con otra versión: hay que descargarlos */
  download: string[];
  /** Ya están en la versión vigente */
  unchanged: string[];
  /** Están en el teléfono pero el servidor ya no los ofrece */
  retire: string[];
}

export function planFormUpdate(cached: Map<string, string | null>, manifest: ManifestEntry[]): FormUpdatePlan {
  const active = new Set(manifest.map((m) => m.template_id));
  const plan: FormUpdatePlan = { download: [], unchanged: [], retire: [] };
  for (const entry of manifest) {
    const local = cached.get(entry.template_id);
    if (local && local === entry.version_hash) plan.unchanged.push(entry.template_id);
    else plan.download.push(entry.template_id);
  }
  for (const id of cached.keys()) if (!active.has(id)) plan.retire.push(id);
  return plan;
}

/** ¿El borrador se empezó con otra versión del formulario? */
export function draftVersionChanged(draftVersion: string | null | undefined, currentVersion: string | null | undefined): boolean {
  return Boolean(draftVersion && currentVersion && draftVersion !== currentVersion);
}
