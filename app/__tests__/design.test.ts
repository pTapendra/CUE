import { contrastRatio } from '../src/ui/contrast';
import { courseColorFor } from '../src/ui/courseColors';
import {
  darkColors,
  darkCourses,
  darkUnknown,
  lightColors,
  lightCourses,
  lightUnknown,
} from '../src/ui/tokens';
import { getSkippedCanvas, setSkippedCanvas } from '../src/prefs';
import type { Course } from '../src/api/types';

const modes = [
  ['light', lightColors, lightCourses, lightUnknown],
  ['dark', darkColors, darkCourses, darkUnknown],
] as const;

describe.each(modes)('%s tokens', (_name, c, courses, unknown) => {
  it('every text colour passes 4.5:1 on its background', () => {
    const pairs: [string, string, string][] = [
      ['text', c.text, c.bg],
      ['text on bg2', c.text, c.bg2],
      ['text2', c.text2, c.bg],
      ['text2 on bg2', c.text2, c.bg2],
      ['text3', c.text3, c.bg],
      ['text3 on bg2', c.text3, c.bg2],
      ['accent', c.accent, c.bg],
      ['accent on bg2', c.accent, c.bg2],
      ['onAccent', c.onAccent, c.accent],
      ['onAccent on accentPressed', c.onAccent, c.accentPressed],
      ['accent on tint', c.accent, c.accentTint],
      ['exam on tint', c.exam, c.examTint],
      ['ok', c.ok, c.bg],
      ['warn', c.warn, c.bg],
      ['danger', c.danger, c.bg],
      ['danger on tint', c.danger, c.dangerTint],
      ['danger on dangerPressed', c.danger, c.dangerPressed],
      // Pressed backgrounds: plain buttons and segments darken to line, rows and cards to bg2.
      ['accent on line', c.accent, c.line],
      ['text on line', c.text, c.line],
      ['text2 on line', c.text2, c.line],
      ...courses.map((k, i): [string, string, string] => [`course ${i} on bg2`, k.text, c.bg2]),
      ...courses.map((k, i): [string, string, string] => [
        `course ${i}`,
        k.text,
        k.tint,
      ]),
      ['unknown course', unknown.text, unknown.tint],
      // Suggested study blocks show the course's text shade on the screen's background.
      ...courses.map((k, i): [string, string, string] => [`course ${i} on bg`, k.text, c.bg]),
      ['unknown course on bg', unknown.text, c.bg],
    ];
    for (const [label, fg, bg] of pairs) {
      expect([label, contrastRatio(fg, bg) >= 4.5]).toEqual([label, true]);
    }
  });

  it('course marks pass 3:1 on bg', () => {
    expect(courses).toHaveLength(6);
    for (const k of [...courses, unknown]) {
      expect(contrastRatio(k.mark, c.bg)).toBeGreaterThanOrEqual(3);
    }
  });
});

it('contrastRatio matches known values', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
  expect(contrastRatio('#8A8A8E', '#FFFFFF').toFixed(2)).toBe('3.44');
});

it('light colours match the spec', () => {
  expect(lightColors.accent).toBe('#4338CA');
  expect(lightCourses[0]).toEqual({
    mark: '#6D5BD0',
    tint: '#EFEDFC',
    text: '#4B3DB8',
  });
});

describe('courseColorFor', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const courses: Course[] = names.map((name) => ({
    id: name,
    source: 'manual',
    name,
    code: null,
  }));
  it('assigns by index, wrapping after 6', () => {
    expect(courseColorFor('A', courses, lightCourses, lightUnknown)).toBe(
      lightCourses[0],
    );
    expect(courseColorFor('F', courses, lightCourses, lightUnknown)).toBe(
      lightCourses[5],
    );
    expect(courseColorFor('G', courses, lightCourses, lightUnknown)).toBe(
      lightCourses[0],
    );
  });
  it('gives unknown names and null the unknown colour', () => {
    expect(courseColorFor('Nope', courses, lightCourses, lightUnknown)).toBe(
      lightUnknown,
    );
    expect(courseColorFor(null, courses, lightCourses, lightUnknown)).toBe(
      lightUnknown,
    );
  });
});

it('skipped Canvas is remembered', async () => {
  const data = new Map<string, string>();
  const store = {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: async (k: string) => {
      data.delete(k);
    },
  };
  expect(await getSkippedCanvas(store)).toBe(false);
  await setSkippedCanvas(store, true);
  expect(data.get('cue.skippedCanvas')).toBe('1');
  expect(await getSkippedCanvas(store)).toBe(true);
  await setSkippedCanvas(store, false);
  expect(await getSkippedCanvas(store)).toBe(false);
  expect(data.has('cue.skippedCanvas')).toBe(false);
});
