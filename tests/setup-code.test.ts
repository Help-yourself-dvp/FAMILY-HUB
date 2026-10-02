/**
 * Код подключения второго устройства: семейная модель доступа (0.1.3).
 * Код обязан переживать копирование в мессенджер, переносы строк при вставке
 * и опечатки — последние обязаны отклоняться внятной ошибкой, а не молча.
 */
import { describe, expect, it } from 'vitest';
import { encodeSetupCode, parseSetupCode, SetupCodeError } from '../src/data/remote/setupCode';

const PAYLOAD = {
  owner: 'help-yourself-dvp',
  repo: 'family-hub-data',
  branch: 'main',
  token: 'github_pat_11ABCDEFGHIJKLMNOP_abcdefghijklmnopqrstuvwxyz0123456789',
};

describe('encodeSetupCode → parseSetupCode', () => {
  it('круговой проход сохраняет все поля', () => {
    const code = encodeSetupCode(PAYLOAD);
    expect(parseSetupCode(code)).toEqual(PAYLOAD);
  });

  it('код — одна строка без пробелов (удобно копировать в мессенджер)', () => {
    const code = encodeSetupCode(PAYLOAD);
    expect(code).not.toMatch(/\s/);
    expect(code.startsWith('FHSETUP1.')).toBe(true);
  });

  it('переживает обрамляющие пробелы и переносы строк при вставке', () => {
    const code = encodeSetupCode(PAYLOAD);
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(parseSetupCode(messy)).toEqual(PAYLOAD);
  });

  it('переживает юникод в логине владельца', () => {
    const p = { ...PAYLOAD, owner: 'семья-Ивановых' };
    expect(parseSetupCode(encodeSetupCode(p))).toEqual(p);
  });

  it('ветка по умолчанию подставляется пустой', () => {
    const code = encodeSetupCode({ ...PAYLOAD, branch: '' });
    expect(parseSetupCode(code).branch).toBe('main');
  });
});

describe('parseSetupCode отклонывает мусор внятной ошибкой', () => {
  it('пустая строка', () => {
    expect(() => parseSetupCode('   ')).toThrow(SetupCodeError);
  });

  it('чужой текст', () => {
    expect(() => parseSetupCode('привет, это не код')).toThrow(SetupCodeError);
  });

  it('повреждённая контрольная сумма (опечатка при переписывании)', () => {
    const code = encodeSetupCode(PAYLOAD);
    const broken = `${code.slice(0, -1)}${code.slice(-1) === '0' ? '1' : '0'}`;
    expect(() => parseSetupCode(broken)).toThrow(/повреждён|не целиком/);
  });

  it('обрезанный код (скопировали не всё)', () => {
    const code = encodeSetupCode(PAYLOAD);
    expect(() => parseSetupCode(code.slice(0, code.length - 12))).toThrow(SetupCodeError);
  });

  it('устаревший или чужой префикс', () => {
    const code = encodeSetupCode(PAYLOAD);
    expect(() => parseSetupCode(`FHSETUP0.${code.split('.')[1]}.${code.split('.')[2]}`)).toThrow(
      /не код подключения/,
    );
  });
});

describe('encodeSetupCode не составляет код из неполных данных', () => {
  it('пустой токен', () => {
    expect(() => encodeSetupCode({ ...PAYLOAD, token: ' ' })).toThrow(/пустое/);
  });
  it('пустой репозиторий', () => {
    expect(() => encodeSetupCode({ ...PAYLOAD, repo: '' })).toThrow(/пустое/);
  });
});
