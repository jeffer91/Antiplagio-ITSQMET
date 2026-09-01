export type AppRole = 'student' | 'coordinator' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  cedula?: string | null;
  created_at: string;
}
