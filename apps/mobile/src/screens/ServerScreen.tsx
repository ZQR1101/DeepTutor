import { useState } from 'react';
import { Action, ErrorNotice, Field } from '../components/FormControls';
import { FormScreen } from '../components/Screen';

export function ServerScreen({
  initialAddress = '',
  busy = false,
  error,
  onConnect,
}: {
  initialAddress?: string;
  busy?: boolean;
  error?: string | null;
  onConnect: (address: string) => void;
}) {
  const [address, setAddress] = useState(initialAddress);
  const canConnect = !busy && address.trim().length > 0;

  function connect() {
    if (canConnect) onConnect(address.trim());
  }

  return (
    <FormScreen
      title="连接 DeepTutor"
      description="请输入 DeepTutor 服务器地址。如果服务器由他人配置，请向对方获取地址。"
    >
      <Field
        label="服务器地址"
        value={address}
        onChangeText={setAddress}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={connect}
        placeholder="https://tutor.example.com"
      />
      <ErrorNotice message={error} />
      <Action
        title={busy ? '正在连接…' : '连接'}
        busy={busy}
        disabled={!canConnect && !busy}
        onPress={connect}
      />
    </FormScreen>
  );
}
