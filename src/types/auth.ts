export type AppRole = 'student' | 'coordinator' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  created_at: string;
}
