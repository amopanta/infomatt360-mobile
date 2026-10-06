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
  const { data } = await api.post('/auth/login', payload);
  return data;
}

export async function verifyMfa(payload: MfaVerifyRequest): Promise<AuthTokens> {
  const { data } = await api.post('/auth/mfa/verify', payload);
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
