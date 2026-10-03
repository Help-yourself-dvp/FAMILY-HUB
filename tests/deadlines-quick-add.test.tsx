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

    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1));
    // На Android сначала пробуем приложение календаря (Chrome откроет веб-форму,
    // если приложение не отзовётся — путь указан в browser_fallback_url).
    const openedUrl = String(openWindow.mock.calls[0]?.[0]);
    expect(openedUrl.startsWith('intent://calendar.google.com/calendar/render?')).toBe(true);
    const data = openedUrl.slice('intent://'.length).split('#Intent;')[0] ?? '';
    const created = new URL(`https://${data}`);
    expect(created.searchParams.get('text')).toBe('[Срок] Учебный срок календаря');
    expect(created.searchParams.get('dates')).toBe('20270501T090000/20270501T091500');
    // Срок сохранён, а на экране — подсказка с запасным файлом.
    expect((await db.deadlines.toArray()).map((row) => row.title)).toEqual([
      'Учебный срок календаря',
    ]);
    const prompt = await screen.findByTestId('calendar-prompt');
    expect(within(prompt).getByText(/Подтвердите событие в календаре/u)).toBeTruthy();
    expect(
      within(prompt).getByRole('button', { name: 'Файлом в календарь телефона' }),
    ).toBeTruthy();
  });

  it('без галочки ничего не открывается и срока-события в календаре не будет', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Учебный без календаря', '2027-06-01');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Добавить в календарь телефона' }));
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1));
    expect(openWindow).not.toHaveBeenCalled();
    expect(screen.queryByText(/Сохранено. Сохраните событие в календаре/u)).toBeNull();
  });

  it('выбор галочки запоминается для следующего срока', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const first = await fillNewDeadline('Первый', '2027-07-01');
    fireEvent.click(within(first).getByRole('checkbox', { name: 'Добавить в календарь телефона' }));
    const footer = first.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1));
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

  it('на компьютере открывается обычная веб-форма, без intent', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => DESKTOP_UA,
    });
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок с компьютера', '2027-05-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1));
    const url = new URL(String(openWindow.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('text')).toBe('[Срок] Срок с компьютера');
  });

  it('после сохранения окно показывает событие и оба способа добавления', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Срок с выбором', '2027-08-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));

    const prompt = await screen.findByTestId('calendar-prompt');
    expect(within(prompt).getByText('[Срок] Срок с выбором')).toBeTruthy();
    expect(within(prompt).getByText(/01\.08\.2027, 09:00–09:15/u)).toBeTruthy();
    expect(
      within(prompt).getByRole('button', { name: 'Файлом в календарь телефона' }),
    ).toBeTruthy();
    expect(within(prompt).getByRole('link', { name: 'Открыть Google Календарь' })).toBeTruthy();
    // Честное предупреждение про аккаунт браузера на месте.
    expect(
      within(prompt).getByText(/если это другой аккаунт, на телефоне записи не будет/u),
    ).toBeTruthy();
  });

  it('проверочная ссылка календаря совпадает с тем, что открывает приложение', async () => {
    render(<App ready />);
    await openDeadlineTab();
    const form = await fillNewDeadline('Сверка ссылки', '2027-05-01');
    const footer = form.querySelector<HTMLElement>('.sheet-footer')!;
    fireEvent.click(within(footer).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await db.deadlines.toArray()).length).toBe(1));
    const sample = (await db.deadlines.toArray())[0]!;
    await waitFor(() =>
      expect(openWindow).toHaveBeenCalledWith(
        calendarAddTarget({ title: sample.title, dueDate: sample.dueDate }, ANDROID_UA).url,
        '_blank',
      ),
    );
  });
});
