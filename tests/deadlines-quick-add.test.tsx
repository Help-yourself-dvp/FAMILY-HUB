/** Реальная оболочка + HashRouter + тестовая IndexedDB. Сеть и семейные данные не используются. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { db, kvSet, KV_KEYS } from '../src/data/db';
import { loadSession } from '../src/data/session';
import { calendarAddTarget } from '../src/notifications/ics';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

beforeEach(async () => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    get: () => ANDROID_UA,
  });
  await Promise.all([
    db.kv.clear(),
    db.members.clear(),
    db.shopping.clear(),
    db.deadlines.clear(),
    db.activity.clear(),
  ]);
  await kvSet(KV_KEYS.profileName, 'Учебный участник');
  await loadSession();
  window.history.replaceState({}, '', '/#/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Сеть в тесте запрещена')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/#/');
});

async function quickDeadline() {
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  const menu = await screen.findByRole('dialog', { name: 'Что добавим?' });
  fireEvent.click(within(menu).getByRole('button', { name: 'Добавить срок' }));
  return await screen.findByRole('dialog', { name: 'Новый срок' });
}

async function openDeadlineTab() {
  const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
  fireEvent.click(within(nav).getByRole('link', { name: 'Сроки' }));
  await screen.findByRole('button', { name: 'Добавить срок' });
}

describe('Сроки: оба пути добавления', () => {
  it('круглый + с Главной открывает раздел Сроки и настоящую форму', async () => {
    render(<App ready />);
    const form = await quickDeadline();
    expect(within(form).getByLabelText('Что за срок')).toBeTruthy();
    expect(window.location.hash).toBe('#/deadlines');
    expect(screen.queryByRole('dialog', { name: 'Что добавим?' })).toBeNull();
  });

  it('круглый + в уже открытых Сроках позволяет закрыть и снова открыть форму', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const first = await quickDeadline();
    fireEvent.click(within(first).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull());
    const second = await quickDeadline();
    expect(within(second).getByLabelText('Что за срок')).toBeTruthy();
    expect(window.location.hash).toBe('#/deadlines');
  });

  it('созданный через + срок сохраняется один раз, закрытие формы не сбрасывает раздел', async () => {
    render(<App ready />);
    const form = await quickDeadline();
    fireEvent.change(within(form).getByLabelText('Что за срок'), {
      target: { value: 'Учебный срок FAB' },
    });
    fireEvent.change(within(form).getByLabelText(/^Дата/u), { target: { value: '2027-04-01' } });
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull());
    await waitFor(async () => expect(await db.deadlines.count()).toBe(1), { timeout: 5000 });
    expect((await db.deadlines.toArray()).map((row) => [row.title, row.dueDate])).toEqual([
      ['Учебный срок FAB', '2027-04-01'],
    ]);
    expect(window.location.hash).toBe('#/deadlines');
    await screen.findByRole('button', { name: 'Изменить «Учебный срок FAB»' });
    expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull();
  });

  it('обычная кнопка Добавить срок продолжает открывать ту же форму', async () => {
    render(<App ready />);
    await openDeadlineTab();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить срок' }));
    const form = await screen.findByRole('dialog', { name: 'Новый срок' });
    expect(within(form).getByLabelText('Что за срок')).toBeTruthy();
  });
});

describe('Сроки и календарь: галочка при сохранении (решение владельца 03.10)', () => {
  const openWindow = vi.fn();
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:test-calendar');

  beforeEach(() => {
    createObjectURL.mockClear();
    const holder = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    const prev = { create: holder.createObjectURL, revoke: holder.revokeObjectURL };
    holder.createObjectURL = createObjectURL;
    holder.revokeObjectURL = vi.fn();
    return () => {
      holder.createObjectURL = prev.create;
      holder.revokeObjectURL = prev.revoke;
    };
  });

  beforeEach(() => {
    openWindow.mockReset().mockReturnValue({
      location: { replace: vi.fn() },
      close: vi.fn(),
    });
    vi.stubGlobal('open', openWindow);
  });

  async function fillNewDeadline(title: string, date: string) {
    const form = await quickDeadline();
    fireEvent.change(within(form).getByLabelText('Что за срок'), { target: { value: title } });
    fireEvent.change(within(form).getByLabelText(/^Дата/u), { target: { value: date } });
    return form;
  }

  it('с галочкой открывается окно создания события с названием и датой', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Учебный срок календаря', '2027-05-01');
    expect(
      within(form)
        .getByRole('checkbox', { name: 'Добавить в календарь телефона' })
        .getAttribute('aria-checked'),
    ).toBe('true');

    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    // Ничего не открывается и не скачивается само: сначала вопрос, действие — по нажатию.
    await waitFor(async () => expect(await db.deadlines.count()).toBe(1), { timeout: 5000 });
    expect(openWindow).not.toHaveBeenCalled();
    const prompt = await screen.findByTestId('calendar-prompt');
    expect(within(prompt).getByText(/Добавить событие в календарь телефона/u)).toBeTruthy();
    expect(within(prompt).getByText('[Срок] Учебный срок календаря')).toBeTruthy();
    expect(within(prompt).getByText(/1 мая 2027|01\.05\.2027/u)).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: 'Не нужно' })).toBeTruthy();

    // Кнопка на Android скачивает файл события (открыть файл за человека сайт не может).
    fireEvent.click(within(prompt).getByRole('button', { name: 'Скачать файл события' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('calendar-prompt')).toBeNull());
    expect(screen.getByText(/Нажмите «Открыть» в плашке загрузки/u)).toBeTruthy();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('без галочки ничего не открывается и срока-события в календаре не будет', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Учебный без календаря', '2027-06-01');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Добавить в календарь телефона' }));
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1), {
      timeout: 5000,
    });
    expect(openWindow).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calendar-prompt')).toBeNull();
  });

  it('выбор галочки запоминается для следующего срока', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const first = await fillNewDeadline('Первый', '2027-07-01');
    fireEvent.click(within(first).getByRole('checkbox', { name: 'Добавить в календарь телефона' }));
    const footer = first.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1), {
      timeout: 5000,
    });
    // Ждём закрытия формы: иначе на экране две кнопки «Добавить» (форма и круглый +).
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый срок' })).toBeNull());

    const second = await quickDeadline();
    await waitFor(() =>
      expect(
        within(second)
          .getByRole('checkbox', { name: 'Добавить в календарь телефона' })
          .getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });

  it('на iPhone системное окно календаря открывается сразу после «Добавить»', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => IPHONE_UA,
    });
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок для iPhone', '2027-08-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    // Открывается синхронно, из самого нажатия: Safari принимает окно только от человека.
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(String(openWindow.mock.calls[0]?.[0]).startsWith('blob:')).toBe(true);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    expect(text).toContain('SUMMARY:[Срок] Срок для iPhone');
    expect(text).toContain('DTSTART;TZID=Europe/Moscow:20270801T090000');
    expect(text.match(/BEGIN:VALARM/gu)?.length).toBe(3);

    await waitFor(async () => expect(await db.deadlines.count()).toBe(1), { timeout: 5000 });
    // Окно-вопрос не нужно: система уже спрашивает сама. Видна только короткая подсказка.
    expect(screen.queryByTestId('calendar-prompt')).toBeNull();
    await waitFor(() => expect(screen.getByText(/Открылось системное окно события/u)).toBeTruthy());
  });

  it('на iPhone: если браузер заблокировал окно, показывается подстраховка', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => IPHONE_UA,
    });
    openWindow.mockReturnValue(null);
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок с блокировкой', '2027-08-02');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    const prompt = await screen.findByTestId('calendar-prompt');
    expect(within(prompt).getByRole('button', { name: 'Открыть окно события' })).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: 'Скачать файлом' })).toBeTruthy();
    // Google-ссылки на iPhone нет.
    expect(within(prompt).queryByRole('link', { name: /Google/u })).toBeNull();
  });

  it('на iPhone без галочки ничего не открывается и не спрашивается', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => IPHONE_UA,
    });
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('iPhone без галочки', '2027-08-03');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Добавить в календарь телефона' }));
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    await waitFor(async () => expect(await db.deadlines.count()).toBe(1), { timeout: 5000 });
    expect(openWindow).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calendar-prompt')).toBeNull();
  });

  it('на компьютере само ничего не открывается, а Google-ссылка ведёт на веб-форму', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => DESKTOP_UA,
    });
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок с компьютера', '2027-05-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    await waitFor(async () => expect(await db.deadlines.count()).toBe(1), { timeout: 5000 });
    expect(openWindow).not.toHaveBeenCalled();
    const prompt = await screen.findByTestId('calendar-prompt');
    const url = new URL(
      within(prompt).getByRole('link', { name: 'Google Календарь' }).getAttribute('href') ?? '',
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('text')).toBe('[Срок] Срок с компьютера');
    expect(within(prompt).getByRole('button', { name: 'Скачать файл события' })).toBeTruthy();
  });

  it('после сохранения окно-вопрос показывает событие и способы добавления', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок с выбором', '2027-08-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    const prompt = await screen.findByTestId('calendar-prompt');
    expect(within(prompt).getByText(/Добавить событие в календарь телефона/u)).toBeTruthy();
    expect(within(prompt).getByText('[Срок] Срок с выбором')).toBeTruthy();
    expect(within(prompt).getByText(/01\.08\.2027, 09:00–09:15/u)).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: 'Скачать файл события' })).toBeTruthy();
    expect(within(prompt).getByRole('link', { name: 'Google Календарь' })).toBeTruthy();
    // Честные подписи: что произойдёт после нажатия и чем чревата веб-версия.
    expect(within(prompt).getByText(/Нажмите «Открыть» в плашке загрузки/u)).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: 'Не нужно' })).toBeTruthy();
  });

  it('«Не нужно» закрывает окно-вопрос и ничего не открывает', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок без календаря', '2027-09-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    const prompt = await screen.findByTestId('calendar-prompt');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Не нужно' }));
    await waitFor(() => expect(screen.queryByTestId('calendar-prompt')).toBeNull());
    expect(openWindow).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('файл события собирается из сохранённого срока, а Google-ссылка — из тех же данных', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Сверка ссылки', '2027-05-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1), {
      timeout: 5000,
    });
    const sample = (await db.deadlines.toArray())[0]!;
    const expected = calendarAddTarget(
      { title: sample.title, dueDate: sample.dueDate },
      ANDROID_UA,
    );
    const prompt = await screen.findByTestId('calendar-prompt');
    const link = within(prompt).getByRole('link', { name: 'Google Календарь' });
    expect(link.getAttribute('href')).toBe(expected.url);

    fireEvent.click(within(prompt).getByRole('button', { name: 'Скачать файл события' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    expect(text).toContain('SUMMARY:[Срок] Сверка ссылки');
    expect(text).toContain('DTSTART;TZID=Europe/Moscow:20270501T090000');
  });
});
