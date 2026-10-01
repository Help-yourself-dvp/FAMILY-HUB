/**
 * Локальная сессия устройства: ID устройства и профиль пользователя.
 *
 * Честная модель (§2.5): в приложении НЕТ логина. Идентичность — самодекларация,
 * хранится только на этом устройстве. `updatedBy` в сущностях = deviceId.
 */
import { db, kvGet, kvSet, KV_KEYS } from './db';
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
  await publishMember(cached);
  return cached;
}

/**
 * Публикует профиль устройства в таблицу members: без этой строки цвет и имя
 * автора существуют только в kv, и семья (и точки у позиций) их не видит —
 * дефект приёмки 0.1.5 («менял цвет, но нигде нет отметок»).
 */
async function publishMember(s: Session): Promise<void> {
  const now = new Date().toISOString();
  const cur = await db.members.get(s.deviceId);
  await db.members.put({
    id: s.deviceId,
    kind: 'members',
    name: s.name.trim() || 'Без имени',
    color: s.color,
    emoji: null,
    rev: (cur?.rev ?? 0) + 1,
    createdAt: cur?.createdAt ?? now,
    updatedAt: now,
    updatedBy: s.deviceId,
    deletedAt: null,
  });
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
  // Приёмка 0.1.7: смена имени обновляет и прежние строки семейной ленты этого
  // устройства («было и стало»), чтобы история не расходилась с профилем.
  if (patch.name !== undefined) {
    const newName = next.name.trim() || 'Без имени';
    await db.activity.filter((a) => a.actorId === next.deviceId).modify({ actorName: newName });
  }
  cached = next;
  await publishMember(next);
  return next;
}

export function newEntityId(): string {
  return newId();
}
