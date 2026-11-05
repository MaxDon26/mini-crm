import { useMutation } from '@tanstack/react-query';
import { notifyError } from '@/shared/ui';
import { signIn, signOut } from './api';

export function useSignIn() {
  return useMutation({ mutationFn: signIn });
}

export function useSignOut() {
  return useMutation({ mutationFn: signOut, onError: notifyError });
}
