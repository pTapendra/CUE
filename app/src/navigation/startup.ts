import { createContext, useContext } from 'react';

/** What start-up learnt about Canvas, for the screens that connect it. */
export type Startup = {
  /** The server has Canvas login set up. Without it the student pastes a token (token mode). */
  loginAvailable: boolean;
  /** The Canvas address already connected, to fill in the token form. */
  canvasUrl: string | null;
  /** The account has a Canvas identity (it can log out, and a login finds it again). */
  linked: boolean;
};

export const StartupContext = createContext<Startup>({ loginAvailable: false, canvasUrl: null, linked: false });

export function useStartup(): Startup {
  return useContext(StartupContext);
}
