export const CHAT_W_KEY = "dnext-chat-width";
export const CHAT_MIN_W = 320;

/** Runs in <head> before first paint: restores the saved chat width as a CSS variable on <html> (avoids hydration mismatch). */
export const LAYOUT_INIT_SCRIPT = `(function(){try{var w=parseInt(localStorage.getItem("${CHAT_W_KEY}"),10);if(w>=${CHAT_MIN_W})document.documentElement.style.setProperty("--chat-w",w+"px")}catch(e){}})()`;
