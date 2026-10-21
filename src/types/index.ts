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
  id: string;
  name: string;
  role_id: string;
  permissions: string[];
}

export interface UserSession {
  user_id: string;
  email: string;
  full_name: string;
  organization_id: string;
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
  /** Solo en type 'repeat': campos de un grupo repetible anidado dentro de
   * la fila de otro grupo (repeat dentro de repeat en XLSForm). */
  children?: FormComponent[];
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
  id: string;
  templateId: string;
  version: number;
  name: string;
  description?: string;
  project_id: string;
  pages: FormPage[];
  published: boolean;
  /** legacy | open | closed: reglas de asignación (ver assignmentRules) */
  accessMode?: string;
  /** Huella de la versión en el servidor (H01) */
  versionHash?: string;
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
  id?: string;
  template_id: string;
  project_id: string;
  participant_id?: string;
  status: RecordStatus;
  values: RecordValue[];
  submitted_by?: string;
  created_at: string;
  updated_at?: string;
}

// ─── Cola offline ────────────────────────────────────────────────────

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'error' | 'conflict';

export interface QueuedRecord {
  local_id: string;        // UUID v4 generado localmente
  project_id: string;
  template_id: string;
  participant_id?: string;
  status: QueueStatus;
  data: RecordValue[];     // valores capturados
  evidence_paths: string[]; // rutas locales de fotos/videos
  gps?: { lat: number; lng: number; accuracy: number };
  error_message?: string;
  created_at: string;
  synced_at?: string;
}

// ─── Evidencias ──────────────────────────────────────────────────────

export type EvidenceType = 'photo' | 'video' | 'audio' | 'document' | 'signature' | 'fingerprint';

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

/** Contrato de POST /runtime/session/bulk-save (backend schemas/runtime_record.py) */
export interface BulkSavePayload {
  project_id: string;
  template_id: string;
  idempotency_key: string;
  records: {
    project_id: string;
    template_id: string;
    participant_id?: string | null;
    status: RecordStatus;
    /** field_value_json va serializado como texto JSON */
    values: { field_name: string; field_value_json: string }[];
  }[];
}

export interface BulkSaveResult {
  received: number;
  created: number;
  failed: number;
  replayed?: boolean;
  results: {
    index: number;
    id?: string;
    status: 'created' | 'failed' | 'queued' | 'conflict';
    error?: string;
    server_values?: RecordValue[]; // datos del servidor cuando hay conflicto
    server_updated_at?: string;    // timestamp del servidor
  }[];
}

// ─── Conflictos ─────────────────────────────────────────────────────

export interface ConflictRecord {
  local_id: string;
  project_id: string;
  template_id: string;
  participant_id: string | null;
  local_data: RecordValue[];
  server_data: RecordValue[];
  server_record_id: string | null;
  server_updated_at: string | null;
  created_at: string;
  detected_at: string;
}

// ─── Participantes (Vista 360) ──────────────────────────────────────

export interface Participant {
  id: string;
  project_id: string;
  full_name: string;
  document_type: string;       // CC, TI, CE, etc.
  document_number: string;     // Numero de cedula/documento
  code: string;                // Codigo interno (P-0001)
  phone?: string;
  email?: string;
  address?: string;
  extra_json?: string;         // Campos adicionales del backend
  created_at: string;
  updated_at?: string;
}

/** Relacion participante ↔ formulario con estado de aplicacion */
export interface ParticipantForm {
  participant_id: string;
  template_id: string;
  form_name: string;
  /** Si ya existe un registro para este participante+formulario */
  applied: boolean;
  /** Fecha de aplicacion (si applied) */
  applied_at?: string;
  /** local_id del registro asociado (si applied) */
  record_local_id?: string;
  /** Status del registro asociado */
  record_status?: QueueStatus;
}

// ─── GPS ─────────────────────────────────────────────────────────────

export interface GpsCoordinate {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number;
  timestamp: number;
}
