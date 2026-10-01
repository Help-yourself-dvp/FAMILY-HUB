/** Настройки · ProfileSection */
import { useEffect, useState } from 'react';
import { db } from '../../data/db';
import { loadSession, PROFILE_COLORS, updateProfile } from '../../data/session';
import { Field } from '../../design/ui';

export default function ProfileSection() {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROFILE_COLORS[0] as string);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void loadSession().then((s) => {
      setName(s.name);
      setColor(s.color);
      setDeviceId(s.deviceId);
    });
  }, []);

  const save = async () => {
    await updateProfile({ name: name.trim() || 'Я', color });
    void db.members.count(); // профиль опубликуется в members.json при следующей синхронизации
  };

  return (
    <section className="stack">
      <h2 className="section-title">Кто вы</h2>
      <div className="card stack">
        <Field
          label="Имя"
          hint="В приложении нет логина: имя задаётся на этом устройстве и видно семье (§2.5)"
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void save()}
            placeholder="Например: Алексей"
          />
        </Field>
        <div className="field">
          <span className="field-label">Цвет</span>
          <div className="chips" role="group" aria-label="Цвет профиля">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={color === c}
                aria-label={`Цвет ${c}`}
                style={{ background: color === c ? c : undefined, borderColor: c, minWidth: 44 }}
                onClick={() => {
                  setColor(c);
                  void updateProfile({ color: c });
                }}
              >
                {color === c ? '✓' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="tiny muted mono">ID устройства: {deviceId || '…'}</div>
      </div>
    </section>
  );
}

/* --------------------------- Подключение к GitHub --------------------------- */
