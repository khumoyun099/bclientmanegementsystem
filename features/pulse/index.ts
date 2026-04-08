/**
 * Pulse feature — PUBLIC API.
 *
 * This is the ONLY file outside code should import from. Reaching into
 * `features/pulse/components/*` or `features/pulse/hooks/*` directly is
 * forbidden — it breaks the isolation boundary and makes Pulse harder
 * to delete or extract.
 *
 * When Pulse-2+ adds more exports (edge function clients, feedback
 * helpers), add them here and nowhere else.
 */

// Top-level components the app mounts
export { PulseDashboard } from './components/PulseDashboard';
export { PlaybookEditor } from './components/PlaybookEditor';

// Types that app-level code may need to reference (read-only)
export type {
  PulseFeedItem,
  PulseInsight,
  PulseBriefing,
  PulsePlaybook,
  PulseCategory,
  PulseSignal,
} from './types/pulse.types';
