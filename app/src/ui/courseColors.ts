import type { Course } from '../api/types';
import type { CourseColor } from './tokens';

/** A course's colour: its index in `courses`, wrapping; grey if unknown. */
export function courseColorFor(
  courseName: string | null,
  courses: Course[],
  palette: CourseColor[],
  unknown: CourseColor,
): CourseColor {
  if (courseName === null) {
    return unknown;
  }
  const index = courses.findIndex((c) => c.name === courseName);
  return index < 0 ? unknown : palette[index % palette.length];
}
