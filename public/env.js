// Runtime config. In Docker, nginx overwrites this file from container env vars.
// In local dev it stays empty and the app falls back to Vite's import.meta.env.
window.__MYTOOLS_ENV = window.__MYTOOLS_ENV || {};
