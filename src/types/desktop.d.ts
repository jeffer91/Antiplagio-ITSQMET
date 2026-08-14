export {};

declare global {
  interface Window {
    siaiDesktop?: {
      platform: string;
      electronVersion: string;
      savePdf: (html: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath: string | null }>;
      saveExcel: (content: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath: string | null }>;
    };
  }
}
