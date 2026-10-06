/**
 * Tipos centrales de InfoMatt360 Mobile.
 *
 * Reflejan el modelo de datos del backend:
 *   - Usuario unico para web, Android y escritorio
 *   - Aislamiento por proyecto via project_id
 *   - JSON Schema compartido para formularios
 *   - Record engine con field_value_json flexible
 */

// ─── Auth ────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
  organization_slug?: string;
  device_fingerprint?: string; // activa sesion extendida 10h si hay asset lock
}

export interface MfaVerifyRequest {
  mfa_token: string;
  totp_code: string;
  device_fingerprint?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface ProjectAssignment {
  id: number;
  name: string;
  role_id: number;
  permissions: string[];
}

export interface UserSession {
  user_id: number;
  email: string;
  full_name: string;
  organization_id: number;
  organization_name: string;
  projects: ProjectAssignment[];
  mfa_enabled: boolean;
}

// ─── Formularios ─────────────────────────────────────────────────────

/** Esquema JSON del constructor de formularios (doc 23) */
/** Regla de visibilidad condicional de un campo */
export interface ConditionalRule {
  fieldId: string;          // ID del campo que controla la visibilidad
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'empty' | 'notEmpty';
  value?: unknown;          // Valor a comparar (no aplica para empty/notEmpty)
}

export interface ConditionalVisibility {
  logic: 'and' | 'or';     // Combinar reglas con AND u OR
  rules: ConditionalRule[];
}

export interface FormComponent {
  id: string;
  type: string; // text, number, select, date, gps, photo, signature, etc.
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  validations?: Record<string, unknown>;
  config?: Record<string, unknown>;
  conditionalVisibility?: ConditionalVisibility;
}

export interface FormColumn {
  desktopWidth: number;
  tabletWidth: number;
  mobileWidth: number;
  components: FormComponent[];
}

export interface FormRow {
  columns: FormColumn[];
}

export interface FormSection {
  id?: string;             // ID unico de la seccion (usado para repeat groups)
  title: string;
  rows: FormRow[];
  repeatable?: boolean;    // Seccion repetible (repeat group)
  minRepetitions?: number; // Minimo de repeticiones (default 1)
  maxRepetitions?: number; // Maximo de repeticiones (default 50)
}

export interface FormPage {
  title: string;
  sections: FormSection[];
}

export interface FormTemplate {
  id: number;
  templateId: string;
  version: number;
  name: string;
  description?: string;
  project_id: number;
  pages: FormPage[];
  published: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Registros ───────────────────────────────────────────────────────

export type RecordStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'archived'
  | 'annulled';

export interface RecordValue {
  field_id: string;
  field_name: string;
  field_value_json: unknown; // texto, numero, GPS {lat,lng,accuracy}, archivo, etc.
}

export interface RuntimeRecord {
  id?: number;
  template_id: number;
  project_id: number;
  participant_id?: number;
  status: RecordStatus;
  values: RecordValue[];
  submitted_by?: number;
  created_at: string;
  updated_at?: string;
}

// ─── Cola offline ────────────────────────────────────────────────────

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'conflict';

export interface QueuedRecord {
  local_id: string;        // UUID v4 generado localmente
  project_id: number;
  template_id: number;
  participant_id?: number;
  status: QueueStatus;
  data: RecordValue[];     // valores capturados
  evidence_paths: string[]; // rutas locales de fotos/videos
  gps?: { lat: number; lng: number; accuracy: number };
  error_message?: string;
  created_at: string;
  synced_at?: string;
}

// ─── Evidencias ──────────────────────────────────────────────────────

export type EvidenceType = 'photo' | 'video' | 'audio' | 'document' | 'signature';

export interface Evidence {
  local_id: string;
  record_local_id: string;
  type: EvidenceType;
  file_uri: string;         // ruta local en el dispositivo
  remote_url?: string;      // URL en el backend despues de subir
  mime_type: string;
  file_size: number;
  gps?: { lat: number; lng: number; accuracy: number };
  uploaded: boolean;
  created_at: string;
}

// ─── Sync ────────────────────────────────────────────────────────────

export interface BulkSavePayload {
  project_id: number;
  template_id: number;
  idempotency_key: string;
  records: {
    participant_id?: number;
    status: RecordStatus;
    values: RecordValue[];
  }[];
}

export interface BulkSaveResult {
  attempted: number;
  synced: number;
  failed: number;
  results: {
    index: number;
    status: 'created' | 'error' | 'replayed' | 'conflict';
    record_id?: number;
    error?: string;
    server_values?: RecordValue[]; // datos del servidor cuando hay conflicto
    server_updated_at?: string;    // timestamp del servidor
  }[];
}

// ─── Conflictos ─────────────────────────────────────────────────────

export interface ConflictRecord {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  local_data: RecordValue[];
  server_data: RecordValue[];
  server_record_id: number | null;
  server_updated_at: string | null;
  created_at: string;
  detected_at: string;
}

// ─── GPS ─────────────────────────────────────────────────────────────

export interface GpsCoordinate {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number;
  timestamp: number;
}
