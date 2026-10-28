// The website's api.ts is type-checked here for its shared types, and reads Vite's settings.
interface ImportMeta {
  readonly env: { readonly VITE_API_URL?: string };
}
