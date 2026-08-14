/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  siaiDesktop?: {
    platform: string;
    electronVersion: string;
    savePdf: (html: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath: string | null }>;
    saveExcel: (content: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath: string | null }>;
  };
}
