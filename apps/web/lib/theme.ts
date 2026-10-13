export type Theme = "light" | "dark";
export const THEME_KEY = "lw-theme";

/** Runs in <head> before first paint: stored choice, else the OS preference. Keep in sync with ThemeProvider. */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_KEY}");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
