import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { Action, ErrorNotice, Field } from '../components/FormControls';
import { FormScreen } from '../components/Screen';

export function LoginScreen({
  origin,
  busy = false,
  error,
  onSignIn,
  onChangeServer,
}: {
  origin: string;
  busy?: boolean;
  error?: string | null;
  onSignIn: (username: string, password: string) => void;
  onChangeServer: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const passwordField = useRef<TextInput>(null);
  const canSignIn = !busy && username.trim().length > 0 && password.length > 0;

  function signIn() {
    if (!canSignIn) return;
    onSignIn(username.trim(), password);
    setPassword('');
  }

  return (
    <FormScreen title="登录 DeepTutor" description={origin}>
      <Field
        label="用户名"
        value={username}
        onChangeText={setUsername}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />
      <Field
        ref={passwordField}
        label="密码"
        value={password}
        onChangeText={setPassword}
        editable={!busy}
        autoComplete="current-password"
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      <ErrorNotice message={error} />
      <Action
        title={busy ? '正在登录…' : '登录'}
        busy={busy}
        disabled={!canSignIn && !busy}
        onPress={signIn}
      />
      <Action
        title="切换服务器"
        onPress={onChangeServer}
        tone="secondary"
        disabled={busy}
      />
    </FormScreen>
  );
}
