/**
 * Локальная сессия устройства: ID устройства и профиль пользователя.
 *
 * Честная модель (§2.5): в приложении НЕТ логина. Идентичность — самодекларация,
 * хранится только на этом устройстве. `updatedBy` в сущностях = deviceId.
 */
import { kvGet, kvSet, KV_KEYS } from './db';
import { newDeviceId, newId } from '../shared/id';

export interface Session {
  deviceId: string;
  name: string;
  color: string;
  memberEntityId: string | null;
}

export const PROFILE_COLORS = [
  '#4f8cff',
  '#ff7a59',
  '#34c98e',
  '#b47cff',
  '#ffb020',
  '#ff6b9d',
  '#22b8cf',
  '#94a3b8',
] as const;

let cached: Session | null = null;

export async function loadSession(): Promise<Session> {
  if (cached) return cached;
  let deviceId = await kvGet<string>(KV_KEYS.deviceId);
  if (!deviceId) {
    deviceId = newDeviceId();
    await kvSet(KV_KEYS.deviceId, deviceId);
  }
  const name = (await kvGet<string>(KV_KEYS.profileName)) ?? '';
  const color = (await kvGet<string>(KV_KEYS.profileColor)) ?? PROFILE_COLORS[0];
  const memberEntityId = (await kvGet<string>('profile.memberId')) ?? null;
  cached = { deviceId, name, color, memberEntityId };
  return cached;
}

export function session(): Session {
  if (!cached) throw new Error('Сессия не инициализирована: сначала loadSession()');
  return cached;
}

export async function updateProfile(patch: { name?: string; color?: string }): Promise<Session> {
  const s = await loadSession();
  const next: Session = { ...s, ...patch };
  if (patch.name !== undefined) await kvSet(KV_KEYS.profileName, patch.name);
  if (patch.color !== undefined) await kvSet(KV_KEYS.profileColor, patch.color);
  cached = next;
  return next;
}

export function newEntityId(): string {
  return newId();
}
