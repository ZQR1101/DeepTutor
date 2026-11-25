import { StyleSheet, Text, View } from 'react-native';
import { Action, ErrorNotice } from '../components/FormControls';
import { FormScreen } from '../components/Screen';
import { radius, spacing, textSize, useTheme } from '../theme/useTheme';

export function SettingsScreen({
  origin,
  authenticated,
  busy = false,
  error,
  onChangeServer,
  onOpenKnowledge,
  onSignOut,
}: {
  origin: string;
  authenticated: boolean;
  busy?: boolean;
  error?: string | null;
  onChangeServer: () => void;
  onOpenKnowledge: () => void;
  onSignOut: () => void;
}) {
  const theme = useTheme();

  return (
    <FormScreen topInset={false}>
      <View
        style={[
          styles.connection,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.label, { color: theme.muted }]}>
          当前服务器
        </Text>
        <Text selectable style={[styles.address, { color: theme.text }]}>
          {origin}
        </Text>
      </View>
      <ErrorNotice message={error} />
      {authenticated ? (
        <Action
          title="知识库"
          onPress={onOpenKnowledge}
          tone="secondary"
          disabled={busy}
        />
      ) : null}
      <Action
        title="切换服务器"
        onPress={onChangeServer}
        tone="secondary"
        disabled={busy}
      />
      {authenticated ? (
        <Action
          title={busy ? '正在退出…' : '退出登录'}
          onPress={onSignOut}
          busy={busy}
        />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  connection: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  label: { fontSize: textSize.small },
  address: { fontSize: textSize.body, fontWeight: '600' },
});
