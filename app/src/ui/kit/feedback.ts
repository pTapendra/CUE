/**
 * Android's touch ripple in a control's foreground colour, faint enough to read through.
 * It goes with a pressed background (a token, never opacity on the text) that every platform shows.
 */
export function ripple(foreground: string, options: { borderless?: boolean; radius?: number } = {}) {
  return { color: `${foreground}33`, ...options };
}
