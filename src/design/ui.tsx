/**
 * Базовые UI-примитивы. Собственные компоненты вместо библиотеки (§6.17):
 * нам нужны точный контроль safe-area, touch targets ≥44px и graceful
 * degradation без backdrop-filter — готовые наборы этого не гарантируют.
 */
import { useEffect, type ReactNode } from 'react';

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Блокируем прокрутку фона, пока sheet открыт
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="row row--between" style={{ marginBottom: 'var(--sp-4)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'err';
  children: ReactNode;
  action?: ReactNode;
}) {
  const cls = tone === 'info' ? 'banner' : `banner banner--${tone}`;
  return (
    <div className={cls} role={tone === 'err' ? 'alert' : 'status'}>
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ emoji, title, hint, action }: { emoji: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji" aria-hidden="true">{emoji}</div>
      <div className="strong" style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-2)' }}>{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 64, count = 3 }: { h?: number; count?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: h }} />
      ))}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export type IconName =
  | 'home' | 'cart' | 'check' | 'calendar' | 'gear' | 'plus' | 'close'
  | 'cloud' | 'cloud-off' | 'refresh' | 'alert' | 'trash' | 'info' | 'shield' | 'bell';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2m8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  check: 'm4 12 5 5L20 6',
  calendar: 'M7 3v3M17 3v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m8-3.5 2 1.6-2 3.4-2.4-1a8 8 0 0 1-1.6.9L15.6 21h-4l-.4-2.6a8 8 0 0 1-1.6-.9l-2.4 1-2-3.4L7.2 12 5.2 8.9l2-3.4 2.4 1a8 8 0 0 1 1.6-.9L11.6 3h4l.4 2.6c.6.2 1.1.5 1.6.9l2.4-1 2 3.4z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  cloud: 'M7 18a4 4 0 0 1-.4-8A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-1 7.5z',
  'cloud-off': 'M3 3l18 18M7 18a4 4 0 0 1-.4-8M9.5 6.2A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1 2.9 4.6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  alert: 'M12 3 2 20h20zM12 9v5M12 17.2v.1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-13v.1M12 11v6',
  shield: 'M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0',
};

const FILLED: ReadonlySet<IconName> = new Set<IconName>(['home']);

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
