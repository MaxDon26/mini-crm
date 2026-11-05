import { Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { toUserMessage } from '@/shared/dbErrors';
import { notifyError } from '@/shared/ui';
import { isInvalidCredentials } from './api';
import { useSignIn } from './hooks';

export function LoginForm() {
  const signInMutation = useSignIn();
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (value) => (value.trim() ? null : 'Укажите email'),
      password: (value) => (value ? null : 'Укажите пароль'),
    },
  });

  const handleSubmit = form.onSubmit(({ email, password }) => {
    signInMutation.mutate(
      { email: email.trim(), password },
      {
        onError: (error) => {
          if (isInvalidCredentials(error)) {
            form.setFieldError('password', toUserMessage(error));
          } else {
            notifyError(error);
          }
        },
      },
    );
  });

  const isPending = signInMutation.isPending;
  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack>
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          disabled={isPending}
          {...form.getInputProps('email')}
        />
        <PasswordInput
          label="Пароль"
          autoComplete="current-password"
          disabled={isPending}
          {...form.getInputProps('password')}
        />
        <Button type="submit" loading={isPending}>
          Войти
        </Button>
      </Stack>
    </form>
  );
}
