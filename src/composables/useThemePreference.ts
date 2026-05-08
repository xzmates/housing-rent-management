import { computed, ref } from "vue";

type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "theme-preference";
const DAISY_THEME = "lofi";

const themePreference = ref<ThemePreference>("system");
let initialized = false;
let mediaQuery: MediaQueryList | null = null;

const ensureMediaQuery = () => {
  if (typeof window === "undefined") {
    return null;
  }

  if (!mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", handleMediaChange);
  }

  return mediaQuery;
};

const resolveTheme = () => {
  if (themePreference.value === "system") {
    const query = ensureMediaQuery();
    return query && query.matches ? "dark" : DAISY_THEME;
  }

  return themePreference.value === "light" ? DAISY_THEME : "dark";
};

const applyTheme = () => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", resolveTheme());
};

function handleMediaChange() {
  if (themePreference.value === "system") {
    applyTheme();
  }
}

const initialize = () => {
  if (initialized) {
    return;
  }

  initialized = true;

  if (typeof window === "undefined") {
    return;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    themePreference.value = stored;
  } else {
    themePreference.value = "system";
  }

  ensureMediaQuery();
  applyTheme();
};

const setThemePreference = (value: ThemePreference) => {
  themePreference.value = value;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  }

  applyTheme();
};

export const useThemePreference = () => {
  initialize();

  const resolvedTheme = computed(() => resolveTheme());

  return {
    themePreference,
    setThemePreference,
    resolvedTheme,
  };
};
