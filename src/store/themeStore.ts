import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const THEME_STORAGE_KEY = 'voltlink-theme';
const DEFAULT_THEME: Theme = 'dark';

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

const readStored = (): Theme | null => {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
};

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return readStored() ?? DEFAULT_THEME;
};

const persist = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* fallback to in-memory */
  }
};

const applyTheme = (theme: Theme): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('light-theme', theme === 'light');
  root.classList.toggle('dark-theme', theme === 'dark');
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  setTheme: (theme) => {
    persist(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    persist(next);
    set({ theme: next });
  },
}));

if (typeof window !== 'undefined') {
  applyTheme(useThemeStore.getState().theme);
  useThemeStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === THEME_STORAGE_KEY && isTheme(e.newValue) && e.newValue !== useThemeStore.getState().theme) {
      useThemeStore.setState({ theme: e.newValue });
    }
  });
}
