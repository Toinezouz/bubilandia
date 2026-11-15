import { describe, expect, it } from 'vitest';
import { calendarDaysBetween, formatDaysAgo, legDayWarning, nextTemplateId } from '../../src/engine/rotation.ts';

// Local-time dates (the engine uses the device time zone for day boundaries).
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime();
const HOUR = 60 * 60 * 1000;

describe('nextTemplateId', () => {
  // Deliberately unsorted: the rotation follows `order`, not array position.
  const templates = [
    { id: 'C', order: 2 },
    { id: 'A', order: 0 },
    { id: 'D', order: 3 },
    { id: 'B', order: 1 },
  ];

  it('starts with the first session when nothing was done yet', () => {
    expect(nextTemplateId(templates, null)).toBe('A');
  });

  it('follows A → B → C → D → A', () => {
    expect(nextTemplateId(templates, 'A')).toBe('B');
    expect(nextTemplateId(templates, 'B')).toBe('C');
    expect(nextTemplateId(templates, 'C')).toBe('D');
    expect(nextTemplateId(templates, 'D')).toBe('A');
  });

  it('restarts from the first session if the last one no longer exists', () => {
    expect(nextTemplateId(templates, 'deleted')).toBe('A');
  });

  it('returns null without templates', () => {
    expect(nextTemplateId([], null)).toBeNull();
  });
});

describe('calendarDaysBetween / formatDaysAgo', () => {
  it('counts calendar days, not 24 h blocks', () => {
    expect(calendarDaysBetween(at(14, 23), at(15, 1))).toBe(1);
    expect(calendarDaysBetween(at(15, 1), at(15, 23))).toBe(0);
    expect(calendarDaysBetween(at(10, 12), at(15, 9))).toBe(5);
  });

  it('is not fooled by daylight saving changes', () => {
    const before = new Date(2026, 2, 28, 12).getTime(); // Spain switches on 29 March 2026
    const after = new Date(2026, 2, 30, 12).getTime();
    expect(calendarDaysBetween(before, after)).toBe(2);
  });

  it('formats in Spanish', () => {
    expect(formatDaysAgo(null, at(15, 10))).toBe('nunca');
    expect(formatDaysAgo(at(15, 8), at(15, 10))).toBe('hoy');
    expect(formatDaysAgo(at(14, 20), at(15, 10))).toBe('ayer');
    expect(formatDaysAgo(at(10, 20), at(15, 10))).toBe('hace 5 días');
  });
});

describe('legDayWarning', () => {
  const now = at(15, 18);

  it('warns when a leg session is chosen < 48 h after the last one', () => {
    expect(legDayWarning(true, at(14, 18), now)).toBe(
      'Hiciste piernas hace 1 día, ¿seguro? Mejor un día de tren superior.',
    );
    expect(legDayWarning(true, at(15, 9), now)).toBe(
      'Hiciste piernas hoy, ¿seguro? Mejor un día de tren superior.',
    );
    expect(legDayWarning(true, now - 47 * HOUR, now)).toBe(
      'Hiciste piernas hace 2 días, ¿seguro? Mejor un día de tren superior.',
    );
  });

  it('says nothing from 48 h on', () => {
    expect(legDayWarning(true, now - 48 * HOUR, now)).toBeNull();
    expect(legDayWarning(true, at(10, 18), now)).toBeNull();
  });

  it('says nothing for upper-body sessions or without previous leg session', () => {
    expect(legDayWarning(false, at(15, 9), now)).toBeNull();
    expect(legDayWarning(true, null, now)).toBeNull();
  });
});
