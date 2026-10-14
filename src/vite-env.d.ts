/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Overrides the bundled pose model, e.g. to point at a heavier variant. */
  readonly VITE_POSE_MODEL_URL?: string;
  /** Both must be set for the optional Supabase sync to activate. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Coach API origin for development, e.g. http://localhost:8000. Production uses same-origin /api. */
  readonly VITE_COACH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
