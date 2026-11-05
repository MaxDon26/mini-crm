import { isAuthApiError } from '@supabase/supabase-js';
import { supabase } from '@/shared/supabaseClient';

export type Credentials = {
  email: string;
  password: string;
};

export async function signIn({ email, password }: Credentials): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function isInvalidCredentials(error: unknown): boolean {
  return isAuthApiError(error) && error.code === 'invalid_credentials';
}
