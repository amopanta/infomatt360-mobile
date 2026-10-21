/**
 * Llamadas de autenticacion contra el backend unificado.
 *
 * Endpoints usados:
 *   POST /auth/login         → login con device_fingerprint
 *   POST /auth/mfa/verify    → verificar TOTP si MFA esta activo
 *   POST /auth/refresh       → rotar refresh token
 *   GET  /auth/session        → proyectos y permisos del usuario
 */

import api from './client';
import type {
  AuthTokens,
  LoginRequest,
  MfaVerifyRequest,
  UserSession,
} from '../types';

export async function login(payload: LoginRequest): Promise<AuthTokens & { mfa_required?: boolean; mfa_token?: string }> {
  // El backend no recibe organization_slug y devuelve el reto MFA como
  // mfa_challenge_token (backend/app/schemas/auth.py: LoginResponse).
  const { email, password, device_fingerprint } = payload;
  const { data } = await api.post('/auth/login', { email, password, device_fingerprint });
  return { ...data, mfa_token: data.mfa_challenge_token ?? undefined };
}

export async function verifyMfa(payload: MfaVerifyRequest): Promise<AuthTokens> {
  const { data } = await api.post('/auth/mfa/verify', {
    challenge_token: payload.mfa_token,
    code: payload.totp_code,
    device_fingerprint: payload.device_fingerprint,
  });
  return data;
}

export async function getSession(): Promise<UserSession> {
  const { data } = await api.get('/auth/session');
  return data;
}

export async function refreshToken(token: string): Promise<AuthTokens> {
  const { data } = await api.post('/auth/refresh', { refresh_token: token });
  return data;
}
