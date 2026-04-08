/**
 * This file used to contain the legacy Dashboard implementation.
 * It is now a thin re-export shim so callers (App.tsx) can keep
 * importing `./components/Dashboard` unchanged while the real
 * implementation lives in `features/pulse/`.
 *
 * To remove Pulse entirely, delete `features/pulse/` and restore
 * the original Dashboard from git history.
 */

export { PulseDashboard as Dashboard } from '../features/pulse';
